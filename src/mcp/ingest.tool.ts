// ── Ingest Tool: Extract → Embed → Store → Graph Pipeline ───────────────────

import type { EmbeddingProvider, DocumentChunk } from "../types.js"
import { extract as defaultExtract, type ExtractOptions } from "../extract/index.js"
import { createEmbeddingProvider } from "../embed/provider.js"
import { insertDocument, insertChunks, findDocumentByFilename, deleteDocument } from "../store/documents.js"
import { insertEmbedding } from "../store/vectors.js"
import { extractEntitiesAndRelationships as defaultGraphExtract } from "../graph/extractor.js"
import { storeGraphData } from "../graph/index.js"
import { getOrInitDatabase } from "../store/database.js"

// ── Types ───────────────────────────────────────────────────────────────────

export interface IngestInput {
  /** File path, URL, or text content of the document to ingest */
  source: string
  /** Document format override (auto-detected if omitted) */
  format?: string
  /** OCR language for image extraction (default: "eng") */
  ocrLang?: string
  /** Target chunk size in tokens (default: 1000) */
  chunkSize?: number
  /** Ingestion mode: create (default), replace, or append */
  mode?: "create" | "replace" | "append"
}

export interface IngestResult {
  documentId: string
  title: string
  format: string
  chunkCount: number
  entityCount: number
  relationshipCount: number
  ingestedAt: string
}

// ── Dependency Injection (for testing) ──────────────────────────────────────

export interface IngestToolDeps {
  embedProvider?: EmbeddingProvider
  extractFn?: typeof defaultExtract
  graphExtractFn?: typeof defaultGraphExtract
}

// ── IngestTool ──────────────────────────────────────────────────────────────

export class IngestTool {
  private embedProvider: EmbeddingProvider
  private extractFn: typeof defaultExtract
  private graphExtractFn: typeof defaultGraphExtract

  constructor(deps?: IngestToolDeps) {
    this.embedProvider = deps?.embedProvider ?? createEmbeddingProvider()
    this.extractFn = deps?.extractFn ?? defaultExtract
    this.graphExtractFn = deps?.graphExtractFn ?? defaultGraphExtract
  }

  /**
   * Execute the full ingestion pipeline:
   * 1. Resolve mode (default: "create")
   * 2. Mode-specific checks (delete existing / check duplicate)
   * 3. Extract document + chunks
   * 4. Embed all chunk texts in parallel
   * 5. Store document + chunks
   * 6. Store embeddings (graceful degradation on failure)
   * 7. Extract graph entities + relationships
   * 8. Store graph data (graceful degradation on failure)
   * 9. Return structured result
   */
  async execute(input: IngestInput): Promise<IngestResult> {
    const mode = input.mode ?? "create"
    const chunkSize = input.chunkSize ?? 1000

    // ── Step 2: Mode-specific logic ──────────────────────────────────────

    if (mode === "replace") {
      const existing = findDocumentByFilename(input.source)
      if (existing) {
        deleteDocument(existing.id)
      }
    } else if (mode === "create") {
      const existing = findDocumentByFilename(input.source)
      if (existing) {
        throw new Error(
          `Document with source "${input.source}" already exists (ID: ${existing.id}). ` +
            "Use mode: 'replace' to re-ingest or mode: 'append' to add more chunks.",
        )
      }
    }

    // ── Step 3: Extract ─────────────────────────────────────────────────

    const extractOptions: ExtractOptions = {
      chunkSize,
    }
    if (input.format) {
      extractOptions.format = input.format as ExtractOptions["format"]
    }
    if (input.ocrLang) {
      extractOptions.ocrLang = input.ocrLang
    }

    const { document: doc, chunks } = await this.extractFn(input.source, extractOptions)

    // ── Step 4: Embed ───────────────────────────────────────────────────

    const chunkTexts = chunks.map((c: DocumentChunk) => c.content)
    let embeddings: number[][] = []
    let embedFailed = false

    if (chunkTexts.length > 0) {
      try {
        embeddings = await this.embedProvider.embed(chunkTexts)
      } catch {
        embedFailed = true
      }
    }

    // ── Step 5: Store doc + chunks ──────────────────────────────────────

    // In append mode, the document already exists — skip insert to avoid
    // UNIQUE constraint violations. New chunks are added alongside existing ones.
    if (mode !== "append") {
      insertDocument(doc)
    }
    if (chunks.length > 0) {
      insertChunks(chunks)
    }

    // ── Step 6: Store embeddings (graceful degradation) ─────────────────

    if (!embedFailed && embeddings.length > 0 && embeddings.length === chunks.length) {
      for (let i = 0; i < chunks.length; i++) {
        try {
          insertEmbedding(chunks[i].id, embeddings[i])
        } catch {
          // Graceful degradation: skip failed embedding inserts
        }
      }
    }

    // ── Step 7: Extract graph ───────────────────────────────────────────

    let entitiesCount = 0
    let relationshipsCount = 0

    if (chunks.length > 0) {
      try {
        const graphResult = await this.graphExtractFn(chunks)
        entitiesCount = graphResult.entities.length
        relationshipsCount = graphResult.relationships.length

        // ── Step 8: Store graph (graceful degradation) ──────────────────

        if (entitiesCount > 0 || relationshipsCount > 0) {
          try {
            storeGraphData(graphResult.entities, graphResult.relationships)
          } catch {
            // Graceful degradation: skip graph storage
            entitiesCount = 0
            relationshipsCount = 0
          }
        }
      } catch {
        // Graceful degradation: skip graph extraction entirely
      }
    }

    // ── Step 9: Return result ───────────────────────────────────────────

    return {
      documentId: doc.id,
      title: doc.title,
      format: doc.format,
      chunkCount: chunks.length,
      entityCount: entitiesCount,
      relationshipCount: relationshipsCount,
      ingestedAt: doc.ingestedAt.toISOString(),
    }
  }
}
