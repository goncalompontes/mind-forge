import crypto from "node:crypto"
import { isIP } from "node:net"
import { promises as dns } from "node:dns"
import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import type { SourceDocument, DocumentChunk, DocumentFormat } from "../types.js"

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_REDIRECTS = 5

// ── SSRF protection ───────────────────────────────────────────────────────

/** Private/reserved IPv4 ranges (RFC 1918, RFC 5735, RFC 3927). */
const PRIVATE_IPV4_BLOCKS: [number, number, number, number, number][] = [
  [127, 0, 0, 0, 8],    // loopback
  [10, 0, 0, 0, 8],     // private class A
  [172, 16, 0, 0, 12],  // private class B
  [192, 168, 0, 0, 16], // private class C
  [169, 254, 0, 0, 16], // link-local
  [0, 0, 0, 0, 8],      // "this" network
]

function ip4ToNumber(a: number, b: number, c: number, d: number): number {
  return ((a * 256 + b) * 256 + c) * 256 + d
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) return false

  const addr = ip4ToNumber(parts[0], parts[1], parts[2], parts[3])
  for (const [a, b, c, d, mask] of PRIVATE_IPV4_BLOCKS) {
    const blockStart = ip4ToNumber(a, b, c, d)
    const blockEnd = blockStart + (1 << (32 - mask)) - 1
    if (addr >= blockStart && addr <= blockEnd) return true
  }
  return false
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  // ::1 is loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true
  // fe80::/10 is link-local
  if (normalized.startsWith("fe80") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb")) return true
  // fc00::/7 is unique local address (ULA)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  return false
}

/**
 * Resolve a hostname and reject if any IP falls in a private/reserved range.
 * Throws on private/reserved addresses.
 */
async function rejectPrivateHost(url: URL): Promise<void> {
  // Strip brackets from IPv6 hostnames (Node.js v25+ includes them in URL.hostname)
  const hostname = url.hostname.replace(/^\[|\]$/g, "")

  // Reject raw IPv4/IPv6 addresses that are private
  if (isIP(hostname)) {
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
      throw new Error(
        `Access denied: cannot connect to a private IP address (${hostname})`,
      )
    }
    return
  }

  // Resolve hostname to IPv4 addresses and check each
  try {
    const v4Addresses = await dns.resolve4(hostname)
    for (const addr of v4Addresses) {
      if (isPrivateIpv4(addr)) {
        throw new Error(
          `Access denied: host ${hostname} resolves to private IP (${addr})`,
        )
      }
    }
  } catch (err: unknown) {
    // DNS resolution failures are not SSRF — re-throw only on private IP match
    if (err instanceof Error && err.message.includes("Access denied")) {
      throw err
    }
  }

  // Also check IPv6
  try {
    const v6Addresses = await dns.resolve6(hostname)
    for (const addr of v6Addresses) {
      if (isPrivateIpv6(addr)) {
        throw new Error(
          `Access denied: host ${hostname} resolves to private IPv6 address (${addr})`,
        )
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Access denied")) {
      throw err
    }
  }
}

// ── Response body streaming reader with size limit ────────────────────────

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  // Quick check via Content-Length header
  const contentLength = response.headers.get("content-length")
  if (contentLength) {
    const length = parseInt(contentLength, 10)
    if (!isNaN(length) && length > maxBytes) {
      throw new Error(
        `Response too large: ${length} bytes exceeds limit of ${maxBytes} bytes`,
      )
    }
  }

  if (!response.body) {
    throw new Error("Response body is not readable")
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalSize = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      totalSize += value.byteLength
      if (totalSize > maxBytes) {
        throw new Error(
          `Response body exceeds size limit of ${maxBytes} bytes`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  // Concatenate chunks into a single buffer
  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(combined)
}

// ── URL extraction ────────────────────────────────────────────────────────

export async function extractUrl(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }> {
  if (!source) {
    throw new Error("URL is required")
  }

  // Basic URL validation
  let urlObj: URL
  try {
    urlObj = new URL(source)
  } catch {
    throw new Error(`Invalid URL: ${source}`)
  }

  if (!urlObj.protocol.startsWith("http")) {
    throw new Error(`Unsupported protocol: ${urlObj.protocol}. Only http/https URLs are supported.`)
  }

  // SSRF: reject private/resolved IPs before connecting
  await rejectPrivateHost(urlObj)

  // Fetch the page with redirect safety
  const response = await fetch(source, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MindForge/1.0; +https://github.com/mind-forge)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "follow",
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }

  // Validate content type before reading body
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Unsupported content type: ${contentType}. Expected HTML.`)
  }

  // Read body with size limit
  const html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES)

  // Parse with Readability
  const dom = new JSDOM(html, { url: source })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  const title = article?.title || urlObj.hostname
  const text = article?.textContent?.trim() || ""
  const byline = article?.byline || ""
  const siteName = article?.siteName || ""

  if (!text) {
    throw new Error("No readable content found at the URL")
  }

  const pathPart = urlObj.pathname === "/" ? "" : urlObj.pathname.replace(/\/$/, "").replace(/\//g, "-")
  const document: SourceDocument = {
    id: crypto.randomUUID(),
    filename: `${urlObj.hostname}${pathPart || ""}`,
    format: "url" as DocumentFormat,
    title,
    author: byline || undefined,
    text,
    metadata: {
      sourceUrl: source,
      siteName: siteName || undefined,
      excerpt: article?.excerpt || "",
      contentLength: text.length,
    },
    ingestedAt: new Date(),
  }

  return { document, chunks: [] }
}
