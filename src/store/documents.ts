import type { SourceDocument, DocumentChunk } from "../types.js"
import { getDatabase } from "./database.js"

// ── Document CRUD ────────────────────────────────────────────────────────

/**
 * Insert a single document into the store.
 */
export function insertDocument(doc: SourceDocument): void {
  const db = getDatabase()

  db.prepare(
    `INSERT INTO documents (id, filename, format, title, author, text, metadata, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    doc.id,
    doc.filename,
    doc.format,
    doc.title,
    doc.author ?? null,
    doc.text,
    JSON.stringify(doc.metadata),
    doc.ingestedAt.toISOString(),
  )
}

/**
 * Insert multiple document chunks.
 */
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

/**
 * Delete a document and its chunks (cascading).
 */
export function deleteDocument(id: string): void {
  const db = getDatabase()
  db.prepare("DELETE FROM documents WHERE id = ?").run(id)
}

/**
 * Find a document by its filename (source path).
 * Returns null if not found.
 */
export function findDocumentByFilename(filename: string): SourceDocument | null {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM documents WHERE filename = ?").get(filename) as
    | Record<string, unknown>
    | undefined
  return row ? rowToDocument(row) : null
}

/**
 * List all documents (without chunks).
 */
export function listDocuments(): SourceDocument[] {
  const db = getDatabase()
  const rows = db
    .prepare("SELECT * FROM documents ORDER BY ingested_at DESC")
    .all() as Record<string, unknown>[]

  return rows.map(rowToDocument)
}

/**
 * Get a document by ID, including its chunks.
 * Returns null if not found.
 */
export function getDocument(
  id: string,
): (SourceDocument & { chunks: DocumentChunk[] }) | null {
  const db = getDatabase()

  const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined

  if (!docRow) return null

  const chunks = db
    .prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC")
    .all(id) as Record<string, unknown>[]

  return {
    ...rowToDocument(docRow),
    chunks: chunks.map(rowToChunk),
  }
}

// ── Row mapping ──────────────────────────────────────────────────────────

function rowToDocument(row: Record<string, unknown>): SourceDocument {
  return {
    id: row.id as string,
    filename: row.filename as string,
    format: row.format as SourceDocument["format"],
    title: row.title as string,
    author: (row.author as string) || undefined,
    text: row.text as string,
    metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    ingestedAt: new Date(row.ingested_at as string),
  }
}

function rowToChunk(row: Record<string, unknown>): DocumentChunk {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    index: row.chunk_index as number,
    content: row.content as string,
    tokenCount: row.token_count as number,
  }
}
