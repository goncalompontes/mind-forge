// ── Summarize Tool: Generate structured / narrative summaries of ingested documents ───

import { getDocument, getDocumentsByTags } from "../store/document-queries.js"
import { getOrInitDatabase } from "../store/database.js"
import { createDocumentId } from "../types.js"
import type { SourceDocument } from "../types.js"

// ── Types ───────────────────────────────────────────────────────────────────

export interface SummarizeSection {
  title: string
  keyPoints: string[]
  entities: Array<{ name: string; type: string; relevance: string }>
}

export interface SummarizeResult {
  documentIds: string[]
  title: string
  structured?: { sections: SummarizeSection[] }
  narrative?: string
  generatedAt: string
}

// ── SummarizeTool ───────────────────────────────────────────────────────────

export class SummarizeTool {
  constructor(private dbPath: string) {
    getOrInitDatabase(dbPath)
  }

  async execute(input: {
    documentIds?: string[]
    tags?: string[]
    format?: string
    maxLength?: number
  }): Promise<SummarizeResult> {
    // 1. Resolve document IDs
    let docs: SourceDocument[]
    if (input.documentIds) {
      docs = input.documentIds
        .map(id => getDocument(createDocumentId(id)))
        .filter((d): d is NonNullable<typeof d> => d !== undefined)
    } else if (input.tags) {
      docs = getDocumentsByTags(input.tags)
    } else {
      throw new Error("Either documentIds[] or tags must be provided")
    }

    if (docs.length === 0) throw new Error("No matching documents found")

    // 2. Build structured outline per document
    const sections: SummarizeSection[] = docs.map(doc => ({
      title: doc.title || doc.filename,
      keyPoints: [
        `Document: ${doc.title || doc.filename}`,
        `Format: ${doc.format}`,
        `Text length: ${doc.text.length} characters`,
        `Tags: ${(doc.tags || []).join(", ") || "none"}`,
      ],
      entities: [],
    }))

    // 3. Build narrative version if requested
    const format = input.format || "both"
    const maxLength = input.maxLength ?? 2000
    const narrative =
      format !== "structured"
        ? docs
            .map(
              d =>
                `## ${d.title || d.filename}\n\n${d.text.substring(0, Math.floor(maxLength / docs.length))}\n`,
            )
            .join("\n\n")
        : undefined

    return {
      documentIds: docs.map(d => d.id),
      title: docs.length === 1 ? docs[0].title : `${docs.length} documents`,
      structured: format !== "narrative" ? { sections } : undefined,
      narrative,
      generatedAt: new Date().toISOString(),
    }
  }
}
