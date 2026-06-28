import { describe, it, expect } from "vitest"
import { extractDocx } from "../../src/extract/docx.js"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

/**
 * Create a minimal DOCX file.
 * DOCX is a ZIP containing XML files. We create the minimum viable structure.
 */
function createMinimalDocx(
  tmpDir: string,
  content: string,
  title?: string,
  author?: string,
): string {
  const docxPath = join(tmpDir, "test.docx")

  // We'll use a simple approach: mammoth can read from buffer,
  // so we create the docx using JSZip-style manual XML
  // The minimal DOCX structure needs:
  //  - [Content_Types].xml
  //  - word/document.xml
  //  - _rels/.rels
  //  - word/_rels/document.xml.rels

  const { execSync } = require("node:child_process")

  // Create directory structure
  const tmpSrc = join(tmpDir, "docx-src")
  execSync(`mkdir -p "${tmpSrc}/word/_rels" "${tmpSrc}/_rels"`, { stdio: "ignore" })

  // [Content_Types].xml
  writeFileSync(
    join(tmpSrc, "[Content_Types].xml"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )

  // _rels/.rels
  writeFileSync(
    join(tmpSrc, "_rels/.rels"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )

  // word/_rels/document.xml.rels
  writeFileSync(
    join(tmpSrc, "word/_rels/document.xml.rels"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`,
  )

  // word/document.xml
  const escapedContent = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  writeFileSync(
    join(tmpSrc, "word/document.xml"),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${escapedContent}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`,
  )

  // Zip it up
  execSync(`cd "${tmpSrc}" && zip -q -r "${docxPath}" .`, { stdio: "ignore", timeout: 10000 })

  return docxPath
}

describe("extractDocx", () => {
  it("should extract text content from a DOCX file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const docxPath = createMinimalDocx(tmpDir, "Hello DOCX World")

    try {
      const result = await extractDocx(docxPath)

      expect(result.document).toBeDefined()
      expect(result.document.format).toBe("docx")
      expect(result.document.text).toContain("Hello DOCX World")
      expect(result.document.filename).toBe("test.docx")
      // Chunking is handled by the orchestrator (src/extract/index.ts), not the individual extractor
      expect(result.chunks).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should throw on non-existent file", async () => {
    await expect(extractDocx("/nonexistent/file.docx")).rejects.toThrow()
  })

  it("should throw on empty path", async () => {
    await expect(extractDocx("")).rejects.toThrow()
  })
})
