// ── Graph Storage ─────────────────────────────────────────────────────────

import { getDatabase } from "../store/database.js"
import type { Entity, Relationship } from "../types.js"

/**
 * Store entities and relationships in the SQLite graph database.
 *
 * The database must be initialized first via `initDatabase()`.
 * Tables are created by the database module — this function does not
 * create them. Chunk stubs are inserted automatically to satisfy
 * foreign key constraints.
 */
export function storeGraphData(entities: Entity[], relationships: Relationship[]): void {
  const db = getDatabase()

  // Ensure referenced chunks exist (for FK constraints)
  const chunkIds = new Set<string>()
  for (const e of entities) chunkIds.add(e.chunkId)
  for (const r of relationships) chunkIds.add(r.chunkId)

  // Create a stub document for graph-only chunks (no source document)
  const insertDoc = db.prepare(`
    INSERT OR IGNORE INTO documents (id, filename, format, title, text, metadata, ingested_at)
    VALUES ('__graph__', '__graph__', 'md', '__graph__', '', '{}', datetime('now'))
  `)

  const insertChunk = db.prepare(`
    INSERT OR IGNORE INTO chunks (id, document_id, chunk_index, content, token_count)
    VALUES (?, '__graph__', 0, '', 0)
  `)

  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities (id, label, type, description, chunk_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertRel = db.prepare(`
    INSERT OR REPLACE INTO relationships (id, from_entity_id, to_entity_id, type, chunk_id, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    insertDoc.run()
    for (const cid of chunkIds) {
      insertChunk.run(cid)
    }
    for (const entity of entities) {
      insertEntity.run(
        entity.id,
        entity.label,
        entity.type,
        entity.description,
        entity.chunkId,
        JSON.stringify(entity.metadata),
      )
    }
    for (const rel of relationships) {
      insertRel.run(
        rel.id,
        rel.fromEntityId,
        rel.toEntityId,
        rel.type,
        rel.chunkId,
        rel.confidence,
      )
    }
  })

  transaction()
}
