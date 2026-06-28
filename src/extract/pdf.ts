import { readFileSync, existsSync } from "node:fs"
import { extname, basename, resolve, normalize } from "node:path"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import type { SourceDocument, DocumentChunk, DocumentFormat } from "../types.js"

// ── Chunking helper (shared across extractors) ──────────────────────────

const CHARS_PER_TOKEN = 4

export function chunkText(
  text: string,
  documentId: string,
  maxTokens: number = 1000,
): DocumentChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN
  const chunks: DocumentChunk[] = []

  if (!text) return chunks

  for (let i = 0; i < text.length; i += maxChars) {
    const content = text.slice(i, i + maxChars)
    chunks.push({
      id: crypto.randomUUID(),
      documentId,
      index: chunks.length,
      content,
      tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
    })
  }

  return chunks
}

// ── Path sanitization ────────────────────────────────────────────────────

const BLOCKED_PATH_CHARS = /[;$`|&><()\n\0]/

/**
 * Sanitize a file path for use in command-line tools.
 * - Resolves to absolute path (prevents path traversal)
 * - Rejects characters used in shell injection
 * - Throws if the path is unsafe
 */
export function sanitizePath(path: string): string {
  if (!path || typeof path !== "string") {
    throw new Error("File path must be a non-empty string")
  }

  // Reject shell metacharacters and null bytes
  if (BLOCKED_PATH_CHARS.test(path)) {
    throw new Error("File path contains disallowed characters")
  }

  // Resolve to absolute path
  const resolved = resolve(normalize(path))

  return resolved
}

// ── CLI tool helpers ────────────────────────────────────────────────────

/**
 * Run a CLI tool with the given arguments using spawnSync (shell: false).
 * This avoids shell injection via crafted filenames.
 */
function runTool(cmd: string, args: string[]): string | null {
  try {
    const result = spawnSync(cmd, args, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    })
    if (result.error) return null
    return (result.stdout as string) || null
  } catch {
    return null
  }
}

interface PdfMetadata {
  title: string
  author: string
  pageCount: number
  extra: Record<string, string>
}

function parsePdfinfo(filePath: string): PdfMetadata | null {
  const safePath = sanitizePath(filePath)
  const output = runTool("pdfinfo", [safePath])
  if (output === null) return null

  const meta: PdfMetadata = { title: "", author: "", pageCount: 0, extra: {} }
  for (const line of output.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key === "Title") meta.title = value
    else if (key === "Author") meta.author = value
    else if (key === "Pages") meta.pageCount = parseInt(value, 10) || 0
    else meta.extra[key] = value
  }
  return meta
}

// ── PDF extraction ──────────────────────────────────────────────────────

export async function extractPdf(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }> {
  if (!source) {
    throw new Error("File path is required")
  }

  if (!existsSync(source)) {
    throw new Error(`File not found: ${source}`)
  }

  // --- Extract text ---
  const safeSource = sanitizePath(source)
  let text = runTool("pdftotext", ["-layout", safeSource, "-"])

  // Fallback to pdf-parse
  if (text === null) {
    const pdfParse = (await import("pdf-parse")).default
    const dataBuffer = readFileSync(source)
    const data = await pdfParse(dataBuffer)
    text = data.text || ""
  }

  // --- Extract metadata ---
  const meta = parsePdfinfo(safeSource)
  const filename = basename(safeSource)
  const title = meta?.title || filename.replace(extname(filename), "")

  const document: SourceDocument = {
    id: crypto.randomUUID(),
    filename,
    format: "pdf" as DocumentFormat,
    title,
    author: meta?.author || undefined,
    text: text || "",
    metadata: {
      pageCount: meta?.pageCount || 0,
      pdfinfo: meta?.extra || {},
    },
    ingestedAt: new Date(),
  }

  return { document, chunks: [] }
}
