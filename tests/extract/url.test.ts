import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { extractUrl } from "../../src/extract/url.js"

// Mock node:dns for SSRF tests — return public IP by default so the existing
// happy-path test still works (the mock avoids a real DNS lookup for the SSRF
// check, then fetch() resolves DNS independently to the real example.com).
vi.mock("node:dns", () => ({
  promises: {
    resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
    resolve6: vi.fn().mockResolvedValue([]),
  },
}))

import { promises as dns } from "node:dns"

describe("extractUrl", () => {
  it("should extract content from a URL", async () => {
    // Use a well-known stable URL
    const result = await extractUrl("https://example.com")

    expect(result.document).toBeDefined()
    expect(result.document.format).toBe("url")
    expect(result.document.text.length).toBeGreaterThan(0)
    expect(result.document.text.toLowerCase()).toContain("example")
    expect(result.document.metadata.sourceUrl).toBe("https://example.com")
    // Chunking is handled by the orchestrator (src/extract/index.ts), not the individual extractor
    expect(result.chunks).toEqual([])
  }, 30000)

  it("should throw on empty URL", async () => {
    await expect(extractUrl("")).rejects.toThrow()
  })

  it("should throw on invalid URL", async () => {
    await expect(extractUrl("not-a-url")).rejects.toThrow()
  })
})

/**
 * SSRF protection tests — these do NOT need fetch mocking because
 * `rejectPrivateHost` catches private IPs before any network call.
 */
describe("extractUrl — SSRF protection", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should reject private IPv4 (loopback)", async () => {
    await expect(extractUrl("http://127.0.0.1")).rejects.toThrow(/private IP/i)
  })

  it("should reject private IPv4 (RFC 1918)", async () => {
    await expect(extractUrl("http://10.0.0.1")).rejects.toThrow(/private IP/i)
    await expect(extractUrl("http://192.168.1.1")).rejects.toThrow(/private IP/i)
    await expect(extractUrl("http://172.16.0.1")).rejects.toThrow(/private IP/i)
  })

  it("should reject private IPv6 (loopback)", async () => {
    await expect(extractUrl("http://[::1]")).rejects.toThrow(/private IP/i)
  })

  it("should reject private IPv6 (link-local)", async () => {
    await expect(extractUrl("http://[fe80::1]")).rejects.toThrow(/private IP/i)
  })

  it("should reject private IPv6 (ULA)", async () => {
    await expect(extractUrl("http://[fc00::1]")).rejects.toThrow(/private IP/i)
    await expect(extractUrl("http://[fd00::1]")).rejects.toThrow(/private IP/i)
  })

  it("should reject hostname that resolves to a private IPv4", async () => {
    vi.mocked(dns.resolve4).mockImplementation(() => Promise.resolve(["10.0.0.1"]))
    await expect(extractUrl("http://private.example.com")).rejects.toThrow(/private IP/i)
    vi.mocked(dns.resolve4).mockImplementation(() => Promise.resolve(["93.184.216.34"]))
  })
})

describe("extractUrl — content validation", () => {
  beforeEach(() => {
    // Reset DNS mocks to default public-IP behaviour for all content tests
    vi.mocked(dns.resolve4).mockReset()
    vi.mocked(dns.resolve4).mockResolvedValue(["93.184.216.34"])
    vi.mocked(dns.resolve6).mockReset()
    vi.mocked(dns.resolve6).mockResolvedValue([])

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        return new Response(
          "<html><head><title>Test</title></head><body><p>Readable content.</p></body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html", "content-length": "80" },
          },
        )
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should reject non-HTML content type", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    )

    await expect(extractUrl("http://example.com/data.json")).rejects.toThrow(
      /Unsupported content type/i,
    )
  })

  it("should reject response with Content-Length exceeding 10MB limit", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      async () =>
        new Response("<html>large</html>", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "content-length": String(11 * 1024 * 1024), // 11 MB
          },
        }),
    )

    await expect(extractUrl("http://example.com/large")).rejects.toThrow(
      /too large/i,
    )
  })
})
