import { readFileSync, existsSync } from "node:fs"
import { extname, basename } from "node:path"
import crypto from "node:crypto"
import matter from "gray-matter"
import type { SourceDocument, DocumentChunk, DocumentFormat } from "../types.js"
import { sanitizePath } from "./pdf.js"

export async function extractMarkdown(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }> {
  if (!source) {
    throw new Error("File path is required")
  }

  const safeSource = sanitizePath(source)

  if (!existsSync(safeSource)) {
    throw new Error(`File not found: ${source}`)
  }

  const raw = readFileSync(safeSource, "utf-8")

  // Parse frontmatter with gray-matter
  const parsed = matter(raw)

  const content = parsed.content || ""
  const frontmatter = parsed.data || {}

  const filename = basename(source)
  const title =
    (frontmatter.title as string) || filename.replace(extname(filename), "")
  const author = (frontmatter.author as string) || undefined

  // Separate frontmatter-only fields from reserved fields
  // Convert Date objects to ISO strings for serialization
  const restMetadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === "title" || key === "author") continue
    restMetadata[key] = value instanceof Date ? value.toISOString() : value
  }

  const document: SourceDocument = {
    id: crypto.randomUUID(),
    filename,
    format: "md" as DocumentFormat,
    title,
    author,
    text: content,
    metadata: {
      ...restMetadata,
      hasFrontmatter: Object.keys(frontmatter).length > 0,
    },
    ingestedAt: new Date(),
  }

  return { document, chunks: [] }
}
