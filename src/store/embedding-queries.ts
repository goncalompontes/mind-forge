// ── Embedding / Vector Queries ───────────────────────────────────────────
// Vector operations: insert embeddings and ANN search via sqlite-vec.

import { getDatabase } from "./database.js"
import { createChunkId, createDocumentId } from "../lib/branded-ids.js"
import type { SearchResult } from "../types.js"
import type { ChunkId, DocumentId } from "../lib/branded-ids.js"

const VEC_DIMENSION = 768

export function insertEmbedding(chunkId: ChunkId, vector: number[]): void {
  if (vector.length !== VEC_DIMENSION) {
    throw new Error(
      `Embedding dimension mismatch: expected ${VEC_DIMENSION}, got ${vector.length}`,
    )
  }

  const db = getDatabase()
  const vecStr = `[${vector.join(",")}]`

  db.prepare(
    `INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding)
     VALUES (?, ?)`,
  ).run(chunkId, vecStr)
}

export function searchSimilar(
  query: number[],
  limit: number,
  filters?: { documentIds?: DocumentId[] },
): SearchResult[] {
  const db = getDatabase()

  if (query.length !== VEC_DIMENSION) {
    throw new Error(
      `Query dimension mismatch: expected ${VEC_DIMENSION}, got ${query.length}`,
    )
  }

  const vecStr = `[${query.join(",")}]`

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

  const chunkIds = annRows.map((r) => r.chunk_id)

  let docFilterSql = ""
  const params: unknown[] = []

  if (filters?.documentIds && filters.documentIds.length > 0) {
    const placeholders = filters.documentIds.map(() => "?").join(",")
    docFilterSql = `AND c.document_id IN (${placeholders})`
    params.push(...filters.documentIds)
  }

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

  const joinMap = new Map<string, Record<string, unknown>>()
  for (const row of joinRows) {
    joinMap.set(row.chunk_id as string, row)
  }

  const results: SearchResult[] = []
  for (const ann of annRows) {
    const row = joinMap.get(ann.chunk_id)
    if (!row) continue

    results.push({
      chunk: {
        id: createChunkId(row.chunk_id as string),
        documentId: createDocumentId(row.document_id as string),
        index: row.chunk_index as number,
        content: row.content as string,
        tokenCount: row.token_count as number,
      },
      score: ann.distance,
      source: {
        id: createDocumentId(row.doc_id as string),
        filename: row.filename as string,
        format: row.format as SearchResult["source"]["format"],
        title: row.title as string,
        author: (row.author as string) || undefined,
        text: row.text as string,
        metadata: (() => {
          try {
            return JSON.parse(row.metadata as string) as Record<string, unknown>
          } catch {
            console.warn("[mind-forge] Failed to parse metadata JSON in embedding-queries")
            return {} as Record<string, unknown>
          }
        })(),
        ingestedAt: new Date(row.ingested_at as string),
      },
    })
  }

  return results
}
