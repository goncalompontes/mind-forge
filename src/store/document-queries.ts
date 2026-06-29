// ── Document + Chunk Queries ─────────────────────────────────────────────
// Document CRUD, chunk operations, tag queries, and full-text search (FTS5).

import { getDatabase } from "./database.js"
import { createDocumentId, createChunkId } from "../lib/branded-ids.js"
import type { SourceDocument, DocumentChunk } from "../types.js"
import type { DocumentId, ChunkId } from "../lib/branded-ids.js"

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    console.warn("[mind-forge] Failed to parse JSON column, using default:", raw.slice(0, 80))
    return fallback
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Row Mappers
// ═══════════════════════════════════════════════════════════════════════════

function rowToDocument(row: Record<string, unknown>): SourceDocument {
  return {
    id: createDocumentId(row.id as string),
    filename: row.filename as string,
    format: row.format as SourceDocument["format"],
    title: row.title as string,
    author: (row.author as string) || undefined,
    text: row.text as string,
    metadata: safeJsonParse(row.metadata as string, {} as Record<string, unknown>),
    tags: safeJsonParse((row.tags as string) || "[]", [] as string[]),
    ingestedAt: new Date(row.ingested_at as string),
  }
}

function rowToChunk(row: Record<string, unknown>): DocumentChunk {
  return {
    id: createChunkId(row.id as string),
    documentId: createDocumentId(row.document_id as string),
    index: row.chunk_index as number,
    content: row.content as string,
    tokenCount: row.token_count as number,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Document Queries
// ═══════════════════════════════════════════════════════════════════════════

export function insertDocument(doc: SourceDocument): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO documents (id, filename, format, title, author, text, metadata, tags, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    doc.id,
    doc.filename,
    doc.format,
    doc.title,
    doc.author ?? null,
    doc.text,
    JSON.stringify(doc.metadata),
    JSON.stringify(doc.tags ?? []),
    doc.ingestedAt.toISOString(),
  )
}

export function insertChunks(chunks: DocumentChunk[]): void {
  if (chunks.length === 0) return

  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
     VALUES (?, ?, ?, ?, ?)`,
  )

  const insertMany = db.transaction((items: DocumentChunk[]) => {
    for (const chunk of items) {
      stmt.run(chunk.id, chunk.documentId, chunk.index, chunk.content, chunk.tokenCount)
    }
  })

  insertMany(chunks)
}

export function deleteDocument(id: DocumentId): void {
  const db = getDatabase()
  db.prepare("DELETE FROM documents WHERE id = ?").run(id)
}

export function findDocumentByFilename(filename: string): SourceDocument | undefined {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM documents WHERE filename = ?").get(filename) as
    | Record<string, unknown>
    | undefined
  return row ? rowToDocument(row) : undefined
}

export function listDocuments(): SourceDocument[] {
  const db = getDatabase()
  const rows = db
    .prepare("SELECT * FROM documents ORDER BY ingested_at DESC")
    .all() as Record<string, unknown>[]
  return rows.map(rowToDocument)
}

export function getDocument(id: DocumentId): (SourceDocument & { chunks: DocumentChunk[] }) | undefined {
  const db = getDatabase()

  const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined

  if (!docRow) return undefined

  const chunkRows = db
    .prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC")
    .all(id) as Record<string, unknown>[]

  return {
    ...rowToDocument(docRow),
    chunks: chunkRows.map(rowToChunk),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tag Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find documents that have all (matchAll=true) or any (matchAll=false) of the specified tags.
 * Uses SQLite JSON_EACH to extract individual tags from the JSON array stored in the `tags` column.
 */
export function getDocumentsByTags(tags: string[], matchAll: boolean = false): SourceDocument[] {
  if (tags.length === 0) return []

  const db = getDatabase()
  const dbTagList = tags

  if (matchAll) {
    // Document must have ALL specified tags
    // Count matching tags per document and compare to total requested
    const placeholders = dbTagList.map(() => "?").join(",")
    const sql = `
      SELECT d.*
      FROM documents d
      WHERE (
        SELECT COUNT(DISTINCT value)
        FROM json_each(d.tags)
        WHERE value IN (${placeholders})
      ) = ?
    `
    const rows = db.prepare(sql).all(...dbTagList, tags.length) as Record<string, unknown>[]
    return rows.map(rowToDocument)
  } else {
    // Document must have ANY of the specified tags
    const placeholders = dbTagList.map(() => "?").join(",")
    const sql = `
      SELECT DISTINCT d.*
      FROM documents d, json_each(d.tags) AS jt
      WHERE jt.value IN (${placeholders})
    `
    const rows = db.prepare(sql).all(...dbTagList) as Record<string, unknown>[]
    return rows.map(rowToDocument)
  }
}

/**
 * Add tags to an existing document. Duplicates are not added.
 */
export function addTagsToDocument(id: DocumentId, tags: string[]): void {
  if (tags.length === 0) return

  const db = getDatabase()
  const row = db.prepare("SELECT tags FROM documents WHERE id = ?").get(id) as
    | { tags: string }
    | undefined
  if (!row) return

  const currentTags: string[] = safeJsonParse(row.tags || "[]", [] as string[])
  const newTags = tags.filter((t) => !currentTags.includes(t))
  if (newTags.length === 0) return

  const merged = [...currentTags, ...newTags]
  db.prepare("UPDATE documents SET tags = ? WHERE id = ?").run(JSON.stringify(merged), id)
}

/**
 * Remove tags from an existing document. Non-existent tags are silently ignored.
 */
export function removeTagsFromDocument(id: DocumentId, tags: string[]): void {
  if (tags.length === 0) return

  const db = getDatabase()
  const row = db.prepare("SELECT tags FROM documents WHERE id = ?").get(id) as
    | { tags: string }
    | undefined
  if (!row) return

  const currentTags: string[] = safeJsonParse(row.tags || "[]", [] as string[])
  const remaining = currentTags.filter((t) => !tags.includes(t))
  db.prepare("UPDATE documents SET tags = ? WHERE id = ?").run(JSON.stringify(remaining), id)
}

// ═══════════════════════════════════════════════════════════════════════════
// Chunk Queries
// ═══════════════════════════════════════════════════════════════════════════

export function getChunksByDocumentId(documentId: DocumentId): DocumentChunk[] {
  const db = getDatabase()
  const rows = db
    .prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC")
    .all(documentId) as Record<string, unknown>[]
  return rows.map(rowToChunk)
}

export function getAllChunks(): Array<{ rowid: number; id: string; content: string }> {
  const db = getDatabase()
  return db
    .prepare("SELECT rowid, id, content FROM chunks")
    .all() as { rowid: number; id: string; content: string }[]
}

/** Get the count of chunks in the database. */
export function getChunkCount(): number {
  const db = getDatabase()
  return (db.prepare("SELECT COUNT(*) AS cnt FROM chunks").get() as { cnt: number }).cnt
}

// ═══════════════════════════════════════════════════════════════════════════
// Full-Text Search Queries
// ═══════════════════════════════════════════════════════════════════════════

/** Get the count of rows in chunks_fts. */
export function getFTSCount(): number {
  const db = getDatabase()
  return (
    db.prepare("SELECT COUNT(*) AS cnt FROM chunks_fts").get() as { cnt: number }
  ).cnt
}

/** Delete all rows from chunks_fts. */
export function clearFTS(): void {
  const db = getDatabase()
  db.exec("DELETE FROM chunks_fts")
}

/** Insert a row into chunks_fts. */
export function insertFTSRow(rowid: number, chunkId: string, content: string): void {
  const db = getDatabase()
  db.prepare(
    "INSERT INTO chunks_fts (rowid, chunk_id, content) VALUES (?, ?, ?)",
  ).run(rowid, chunkId, content)
}

/**
 * Escape special FTS5 characters in a user query string.
 * Replaces characters that have special meaning in FTS5 syntax with a space,
 * so the query is treated as plain text terms to match.
 */
function sanitizeFTSQuery(query: string): string {
  // FTS5 special characters: ^ * " ( ) { } ~ : + -
  // Replace them with spaces to prevent query injection via FTS syntax
  return query.replace(/[*^"(){}~:+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Execute an FTS5 query with optional document filter, returning raw rows. */
export function ftsSearch(
  query: string,
  limit: number,
  filters?: { documentIds?: string[] },
): Record<string, unknown>[] {
  const db = getDatabase()
  const sanitizedQuery = sanitizeFTSQuery(query)
  const escapedQuery = sanitizedQuery.replace(/'/g, "''")

  // If after sanitization the query is empty, return no results
  if (!escapedQuery) return []

  let whereClause = `chunks_fts MATCH '${escapedQuery}'`
  const params: unknown[] = []

  if (filters?.documentIds && filters.documentIds.length > 0) {
    const placeholders = filters.documentIds.map(() => "?").join(",")
    whereClause += ` AND d.id IN (${placeholders})`
    params.push(...filters.documentIds)
  }

  params.push(limit)

  const sql = `
    SELECT f.rowid, f.chunk_id, rank AS fts_score,
           c.id AS chunk_id, c.document_id, c.chunk_index, c.content, c.token_count,
           d.id AS doc_id, d.filename, d.format, d.title, d.author, d.text, d.metadata, d.tags, d.ingested_at
    FROM chunks_fts f
    JOIN chunks c ON c.id = f.chunk_id
    JOIN documents d ON d.id = c.document_id
    WHERE ${whereClause}
    ORDER BY rank
    LIMIT ?
  `

  try {
    return db.prepare(sql).all(...params) as Record<string, unknown>[]
  } catch {
    return []
  }
}
