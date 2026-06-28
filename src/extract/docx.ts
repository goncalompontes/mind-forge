import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { extname, basename, join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import mammoth from "mammoth"
import type { SourceDocument, DocumentChunk, DocumentFormat } from "../types.js"
import { sanitizePath } from "./pdf.js"

/**
 * Extract metadata (title, author) from a DOCX file's docProps/core.xml.
 */
function extractDocxMetadata(filePath: string): { title: string; author: string } {
  const result = { title: "", author: "" }

  try {
    const safePath = sanitizePath(filePath)
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-docx-"))
    try {
      spawnSync("unzip", ["-o", safePath, "docProps/core.xml", "-d", tmpDir], {
        stdio: "ignore",
        timeout: 5000,
        shell: false,
      })

      const corePath = join(tmpDir, "docProps/core.xml")
      const coreXml = readFileSync(corePath, "utf-8")
      const titleMatch = coreXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)
      const authorMatch = coreXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)
      if (titleMatch) result.title = titleMatch[1]
      if (authorMatch) result.author = authorMatch[1]
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        // cleanup is best-effort
      }
    }
  } catch {
    // Metadata extraction is best-effort
  }

  return result
}

export async function extractDocx(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }> {
  if (!source) {
    throw new Error("File path is required")
  }

  const safeSource = sanitizePath(source)

  if (!existsSync(safeSource)) {
    throw new Error(`File not found: ${source}`)
  }

  const dataBuffer = readFileSync(safeSource)

  // Extract content as raw text
  const result = await mammoth.extractRawText({ buffer: dataBuffer })
  const text = result.value || ""

  // Extract metadata
  const meta = extractDocxMetadata(source)
  const filename = basename(source)
  const docTitle = meta.title || filename.replace(extname(filename), "")
  const docAuthor = meta.author || undefined

  const document: SourceDocument = {
    id: crypto.randomUUID(),
    filename,
    format: "docx" as DocumentFormat,
    title: docTitle,
    author: docAuthor,
    text,
    metadata: {
      messages: result.messages ?? [],
    },
    ingestedAt: new Date(),
  }

  return { document, chunks: [] }
}
