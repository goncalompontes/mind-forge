import type { SearchResult } from "../types.js"
import { getDatabase } from "./database.js"

// ── Types ────────────────────────────────────────────────────────────────

export interface VectorSearchFilters {
  documentId?: string
}

const VEC_DIMENSION = 768

// ── Insert ───────────────────────────────────────────────────────────────

/**
 * Insert or update an embedding vector for a chunk.
 */
export function insertEmbedding(chunkId: string, vector: number[]): void {
  if (vector.length !== VEC_DIMENSION) {
    throw new Error(
      `Embedding dimension mismatch: expected ${VEC_DIMENSION}, got ${vector.length}`,
    )
  }

  const db = getDatabase()

  // Convert to a float-compatible string for sqlite-vec
  // The vec0 table accepts vectors as float64 JSON arrays
  const vecStr = `[${vector.join(",")}]`

  db.prepare(
    `INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding)
     VALUES (?, ?)`,
  ).run(chunkId, vecStr)
}

// ── Search ───────────────────────────────────────────────────────────────

/**
 * Search for similar chunks using ANN (Approximate Nearest Neighbor) via sqlite-vec.
 * Returns results ordered by distance (ascending).
 */
export function searchSimilar(
  query: number[],
  limit: number,
  filters?: VectorSearchFilters,
): SearchResult[] {
  const db = getDatabase()

  if (query.length !== VEC_DIMENSION) {
    throw new Error(
      `Query dimension mismatch: expected ${VEC_DIMENSION}, got ${query.length}`,
    )
  }

  const vecStr = `[${query.join(",")}]`

  // sqlite-vec's vec0 supports WHERE on the primary key (chunk_id),
  // so we join after the ANN search for other filters
  const annRows = db
    .prepare(
      `SELECT chunk_id, distance
       FROM vec_chunks
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    )
    .all(vecStr, limit) as { chunk_id: string; distance: number }[]

  if (annRows.length === 0) return []

  // Gather all matching chunk IDs
  const chunkIds = annRows.map((r) => r.chunk_id)

  // Apply document-level filter if specified
  let docFilterSql = ""
  const params: unknown[] = []

  if (filters?.documentId) {
    docFilterSql = "AND c.document_id = ?"
    params.push(filters.documentId)
  }

  // Build a query to join vec results with chunks and documents
  const placeholders = chunkIds.map(() => "?").join(",")
  const joinRows = db
    .prepare(
      `SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.content, c.token_count,
              d.id AS doc_id, d.filename, d.format, d.title, d.author, d.text, d.metadata, d.ingested_at
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.id IN (${placeholders}) ${docFilterSql}`,
    )
    .all(...chunkIds, ...params) as Record<string, unknown>[]

  // Build a lookup from chunk_id to the joined row
  const joinMap = new Map<string, Record<string, unknown>>()
  for (const row of joinRows) {
    joinMap.set(row.chunk_id as string, row)
  }

  // Build results in ANN order, respecting the document filter
  const results: SearchResult[] = []
  for (const ann of annRows) {
    const row = joinMap.get(ann.chunk_id)
    if (!row) continue // filtered out or missing

    results.push({
      chunk: {
        id: row.chunk_id as string,
        documentId: row.document_id as string,
        index: row.chunk_index as number,
        content: row.content as string,
        tokenCount: row.token_count as number,
      },
      score: ann.distance,
      source: {
        id: row.doc_id as string,
        filename: row.filename as string,
        format: row.format as SearchResult["source"]["format"],
        title: row.title as string,
        author: (row.author as string) || undefined,
        text: row.text as string,
        metadata: JSON.parse(row.metadata as string) as Record<
          string,
          unknown
        >,
        ingestedAt: new Date(row.ingested_at as string),
      },
    })
  }

  return results
}
