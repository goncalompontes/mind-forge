import { describe, it, expect } from "vitest"
import { extract } from "../../src/extract/index.js"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("extract (orchestrator)", () => {
  it("should auto-detect markdown format from file extension", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const mdPath = join(tmpDir, "test.md")
    writeFileSync(mdPath, "# Hello\n\nWorld", "utf-8")

    try {
      const result = await extract(mdPath)
      expect(result.document.format).toBe("md")
      expect(result.document.text).toContain("# Hello")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should support explicit format parameter", async () => {
    // This is a text file we tell the system is markdown
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const txtPath = join(tmpDir, "readme.txt")
    writeFileSync(txtPath, "# Title\n\nContent", "utf-8")

    try {
      const result = await extract(txtPath, { format: "md" })
      expect(result.document.format).toBe("md")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should chunk documents into configurable sizes", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const mdPath = join(tmpDir, "long.md")
    // Create content long enough for multiple chunks
    writeFileSync(mdPath, "word ".repeat(5000), "utf-8")

    try {
      const result = await extract(mdPath)
      expect(result.chunks.length).toBeGreaterThan(1)
      // Verify all chunks reference the same document
      for (const chunk of result.chunks) {
        expect(chunk.documentId).toBe(result.document.id)
      }
      // Verify chunks are sequential
      for (let i = 0; i < result.chunks.length; i++) {
        expect(result.chunks[i].index).toBe(i)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should handle MIME type detection", async () => {
    // URL test - should detect as url format
    const result = await extract("https://example.com")
    expect(result.document.format).toBe("url")
    expect(result.document.text.length).toBeGreaterThan(0)
  }, 30000)

  it("should throw on unsupported file extension", async () => {
    await expect(extract("file.xyz")).rejects.toThrow()
  })

  it("should throw on empty source", async () => {
    await expect(extract("")).rejects.toThrow()
  })
})
