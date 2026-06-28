import { describe, it, expect } from "vitest"
import { extractPdf } from "../../src/extract/pdf.js"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"

/**
 * Create a minimal valid PDF with text content using Ghostscript ps2pdf.
 * Returns the path to the generated PDF.
 */
function createTestPdf(tmpDir: string, text: string, title?: string, author?: string): string {
  const psPath = join(tmpDir, "input.ps")
  const pdfPath = join(tmpDir, "test.pdf")

  const ps = `%!PS-Adobe-3.0
%%Creator: Mind Forge Test
%%Pages: 1
%%Page: 1 1
/Courier findfont 14 scalefont setfont
newpath
50 700 moveto
(${text.replace(/[()\\]/g, "")}) show
showpage`

  writeFileSync(psPath, ps, "utf-8")

  // pdfmark for metadata must come after -f
  const pdfmark =
    title || author
      ? `-c "[/Title (${title || ""}) /Author (${author || ""}) /DOCINFO pdfmark"`
      : ""

  execSync(
    `gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dUseFlateCompression=false \
      -sOutputFile="${pdfPath}" -f "${psPath}" ${pdfmark}`,
    { stdio: "ignore", timeout: 15000 },
  )

  return pdfPath
}

describe("extractPdf", () => {
  it("should extract text content from a PDF file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const pdfPath = createTestPdf(tmpDir, "Hello PDF World")

    try {
      const result = await extractPdf(pdfPath)

      expect(result.document).toBeDefined()
      expect(result.document.format).toBe("pdf")
      expect(result.document.text).toContain("Hello PDF World")
      expect(result.document.filename).toBe("test.pdf")
      // Chunking is handled by the orchestrator (src/extract/index.ts), not the individual extractor
      expect(result.chunks).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should throw on non-existent file", async () => {
    await expect(extractPdf("/nonexistent/file.pdf")).rejects.toThrow()
  })

  it("should throw on empty path", async () => {
    await expect(extractPdf("")).rejects.toThrow()
  })

  it("should extract metadata (title, author)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const pdfPath = createTestPdf(tmpDir, "Metadata Test", "My Title", "My Author")

    try {
      const result = await extractPdf(pdfPath)
      expect(result.document.title).toBe("My Title")
      expect(result.document.author).toBe("My Author")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should fallback to filename for title when no metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const pdfPath = createTestPdf(tmpDir, "No metadata")

    try {
      const result = await extractPdf(pdfPath)
      // No pdfmark set, so title should come from filename
      expect(result.document.title).toBe("test")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should extract page count", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const pdfPath = createTestPdf(tmpDir, "Page count test")

    try {
      const result = await extractPdf(pdfPath)
      expect(result.document.metadata.pageCount).toBe(1)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
