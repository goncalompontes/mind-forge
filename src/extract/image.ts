import { readFileSync, existsSync } from "node:fs"
import { extname, basename } from "node:path"
import crypto from "node:crypto"
import { createWorker } from "tesseract.js"
import type { SourceDocument, DocumentChunk, DocumentFormat } from "../types.js"
import { sanitizePath } from "./pdf.js"

const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"]

export async function extractImage(
  source: string,
  lang: string = "eng",
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }> {
  if (!source) {
    throw new Error("File path is required")
  }

  const safeSource = sanitizePath(source)

  if (!existsSync(safeSource)) {
    throw new Error(`File not found: ${source}`)
  }

  const ext = extname(safeSource).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`)
  }

  const imageBuffer = readFileSync(safeSource)

  // Run OCR with tesseract.js
  const worker = await createWorker(lang)

  try {
    const { data } = await worker.recognize(imageBuffer)
    const text = data.text || ""

    const filename = basename(source)
    const title = filename.replace(extname(filename), "")

    const document: SourceDocument = {
      id: crypto.randomUUID(),
      filename,
      format: "image" as DocumentFormat,
      title,
      text,
      metadata: {
        ocrLanguage: lang,
        confidence: data.confidence ?? 0,
        blocks: data.blocks?.length ?? 0,
        detectedLanguages: data.words
          ? data.words.map((w) => w.text || "").filter(Boolean).slice(0, 5)
          : [],
      },
      ingestedAt: new Date(),
    }

    return { document, chunks: [] }
  } finally {
    await worker.terminate()
  }
}
