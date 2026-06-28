import crypto from "node:crypto"
import { extname } from "node:path"
import type { SourceDocument, DocumentChunk, DocumentFormat } from "../types.js"
import { extractPdf } from "./pdf.js"
import { extractDocx } from "./docx.js"
import { extractMarkdown } from "./markdown.js"
import { extractImage } from "./image.js"
import { extractUrl } from "./url.js"

// ── Constants ────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4

// ── Paragraph/sentence-aware chunking ────────────────────────────────────

/**
 * Split text into `DocumentChunk[]` using paragraph and sentence boundaries.
 *
 * Strategy:
 * 1. Split on double-newline boundaries (paragraphs).
 * 2. If a paragraph fits in the current chunk, append it.
 * 3. If a paragraph alone exceeds the limit, split it by sentence boundaries.
 * 4. Never break mid-sentence.
 */
export function chunkText(
  text: string,
  documentId: string,
  maxTokens: number = 1000,
): DocumentChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN
  const chunks: DocumentChunk[] = []

  if (!text) return chunks

  // Split into paragraphs (double newlines, preserving whitespace)
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
  let current = ""

  const flush = () => {
    if (current.length > 0) {
      chunks.push(makeChunk(current, documentId, chunks.length))
      current = ""
    }
  }

  for (const para of paragraphs) {
    // Paragraph fits within maxChars by itself
    if (para.length <= maxChars) {
      // Adding it to the current buffer would overflow → flush first
      if (current.length > 0 && current.length + 2 + para.length > maxChars) {
        flush()
      }
      current += (current.length > 0 ? "\n\n" : "") + para
      continue
    }

    // Paragraph is longer than maxChars — split by sentence boundaries
    flush()

    // Split on sentence-ending punctuation: . ! ? followed by space or end
    const parts: string[] = []
    let buf = ""
    for (const ch of para) {
      buf += ch
      if (/[.!?](?:\s|$)/.test(buf.slice(-2)) || /[.!?]$/.test(buf)) {
        parts.push(buf)
        buf = ""
      }
    }
    if (buf.length > 0) parts.push(buf) // trailing text without punctuation

    // If no sentence splits were found, fall back to word boundaries
    const segments = parts.length === 1 && parts[0].length === para.length
      ? splitByWords(para, maxChars)
      : parts

    let sentenceBuf = ""
    for (const seg of segments) {
      if (sentenceBuf.length > 0 && sentenceBuf.length + seg.length > maxChars) {
        chunks.push(makeChunk(sentenceBuf, documentId, chunks.length))
        sentenceBuf = ""
      }
      sentenceBuf += sentenceBuf.length > 0 ? " " : ""
      sentenceBuf += seg
    }
    if (sentenceBuf.length > 0) {
      chunks.push(makeChunk(sentenceBuf, documentId, chunks.length))
    }
  }

  flush()
  return chunks
}

/**
 * Fallback word-boundary split for paragraphs that have no sentence breaks
 * (e.g. repeated strings, code, or whitespace-separated text).
 */
function splitByWords(text: string, maxChars: number): string[] {
  const parts: string[] = []
  const words = text.split(/\s+/)
  let buf = ""
  for (const word of words) {
    const sep = buf.length > 0 ? " " : ""
    if (buf.length + sep.length + word.length > maxChars && buf.length > 0) {
      parts.push(buf)
      buf = ""
    }
    buf += (buf.length > 0 ? " " : "") + word
  }
  if (buf.length > 0) parts.push(buf)
  return parts
}

function makeChunk(content: string, documentId: string, index: number): DocumentChunk {
  return {
    id: crypto.randomUUID(),
    documentId,
    index,
    content,
    tokenCount: Math.ceil(content.length / CHARS_PER_TOKEN),
  }
}

// ── Format detection ─────────────────────────────────────────────────────

/**
 * Detect the document format from a source string.
 *
 * Checks URL pattern first, then file extension.
 */
export function detectFormat(source: string): DocumentFormat | null {
  if (!source) return null

  // URL pattern
  if (/^https?:\/\//i.test(source)) return "url"

  const ext = extname(source).toLowerCase()
  switch (ext) {
    case ".pdf":
      return "pdf"
    case ".docx":
      return "docx"
    case ".md":
    case ".mdx":
      return "md"
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
      return "image"
    default:
      return null
  }
}

// ── Extraction options ───────────────────────────────────────────────────

export interface ExtractOptions {
  /** Explicit document format override (bypasses auto-detection) */
  format?: DocumentFormat
  /** Target chunk size in tokens (default: 1000) */
  chunkSize?: number
  /** OCR language for image extraction (default: "eng") */
  ocrLang?: string
}

// ── Extractor type ───────────────────────────────────────────────────────

type ExtractorResult = { document: SourceDocument; chunks: DocumentChunk[] }

// ── Orchestrator ─────────────────────────────────────────────────────────

/**
 * Extract text from any supported source.
 *
 * Auto-detects format from file extension or URL pattern unless an explicit
 * `format` is provided in `options`.
 *
 * Returns the source document and its paragraph/sentence-aware chunks.
 */
export async function extract(
  source: string,
  options?: ExtractOptions,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }> {
  if (!source) {
    throw new Error("Source is required — provide a file path or URL")
  }

  const format = options?.format ?? detectFormat(source)

  if (!format) {
    throw new Error(
      `Could not detect document format from "${source}". ` +
        "Supported: pdf, docx, md/mdx, png/jpg/webp, http(s):// URLs. " +
        "Use the `format` option to override.",
    )
  }

  let result: ExtractorResult

  switch (format) {
    case "pdf":
      result = await extractPdf(source)
      break
    case "docx":
      result = await extractDocx(source)
      break
    case "md":
      result = await extractMarkdown(source)
      break
    case "image":
      result = await extractImage(source, options?.ocrLang)
      break
    case "url":
      result = await extractUrl(source)
      break
  }

  // Re-chunk using paragraph/sentence-aware split
  const maxTokens = options?.chunkSize ?? 1000
  const chunks = chunkText(result.document.text, result.document.id, maxTokens)

  return { document: result.document, chunks }
}
