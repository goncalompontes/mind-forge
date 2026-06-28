import { describe, it, expect } from "vitest"
import { extractImage } from "../../src/extract/image.js"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"

/**
 * Create a simple test image with text using ImageMagick.
 */
function createTestImage(tmpDir: string, filename: string, text: string): string {
  const imgPath = join(tmpDir, filename)
  execSync(
    `magick -size 400x100 xc:white -pointsize 20 \
      -fill black -gravity center -annotate 0 "${text}" "${imgPath}"`,
    { stdio: "ignore", timeout: 15000 },
  )
  return imgPath
}

describe("extractImage", () => {
  it("should extract text from a PNG image", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const imgPath = createTestImage(tmpDir, "test.png", "Hello OCR")

    try {
      const result = await extractImage(imgPath)

      expect(result.document).toBeDefined()
      expect(result.document.format).toBe("image")
      expect(result.document.text.length).toBeGreaterThan(0)
      // OCR should recognize the text (may have slight variations)
      expect(result.document.text.toLowerCase()).toContain("hello")
      expect(result.document.filename).toBe("test.png")
      // Chunking is handled by the orchestrator (src/extract/index.ts), not the individual extractor
      expect(result.chunks).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 60000) // OCR can be slow

  it("should throw on non-existent file", async () => {
    await expect(extractImage("/nonexistent/file.png")).rejects.toThrow()
  })

  it("should throw on empty path", async () => {
    await expect(extractImage("")).rejects.toThrow()
  })

  it("should support JPG format", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const imgPath = createTestImage(tmpDir, "test.jpg", "JPG Text")

    try {
      const result = await extractImage(imgPath)
      expect(result.document.text.length).toBeGreaterThan(0)
      expect(result.document.filename).toBe("test.jpg")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 60000)
})
