// ── Graph Entity + Relationship Queries ──────────────────────────────────
// Entities, relationships, neighbor traversal, and path finding.

import { getDatabase } from "./database.js"
import { createEntityId, createRelationshipId, createChunkId } from "../lib/branded-ids.js"
import type { Entity, EntityType, Relationship, RelationshipType } from "../types.js"
import type { EntityId, RelationshipId } from "../lib/branded-ids.js"

// ═══════════════════════════════════════════════════════════════════════════
// Row Mappers
// ═══════════════════════════════════════════════════════════════════════════

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    console.warn("[mind-forge] Failed to parse JSON column in graph-queries:", raw.slice(0, 80))
    return fallback
  }
}

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: createEntityId(String(row.id)),
    label: String(row.label),
    type: String(row.type) as EntityType,
    description: String(row.description),
    chunkId: createChunkId(String(row.chunk_id)),
    metadata: safeJsonParse(String(row.metadata), {} as Record<string, unknown>),
  }
}

function rowToRelationship(row: Record<string, unknown>): Relationship {
  return {
    id: createRelationshipId(String(row.id)),
    fromEntityId: createEntityId(String(row.from_entity_id)),
    toEntityId: createEntityId(String(row.to_entity_id)),
    type: String(row.type) as RelationshipType,
    chunkId: createChunkId(String(row.chunk_id)),
    confidence: Number(row.confidence),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Graph Storage
// ═══════════════════════════════════════════════════════════════════════════

/** Insert a stub document and chunk for graph-only entities (FK constraint). */
function ensureGraphStubs(chunkIds: Set<string>): void {
  const db = getDatabase()

  db.prepare(
    `INSERT OR IGNORE INTO documents (id, filename, format, title, text, metadata, ingested_at)
     VALUES ('__graph__', '__graph__', 'md', '__graph__', '', '{}', datetime('now'))`,
  ).run()

  const insertStub = db.prepare(
    `INSERT OR IGNORE INTO chunks (id, document_id, chunk_index, content, token_count)
     VALUES (?, '__graph__', 0, '', 0)`,
  )
  for (const cid of chunkIds) {
    insertStub.run(cid)
  }
}

export function storeGraphData(entities: Entity[], relationships: Relationship[]): void {
  const db = getDatabase()

  const chunkIds = new Set<string>()
  for (const e of entities) chunkIds.add(e.chunkId)
  for (const r of relationships) chunkIds.add(r.chunkId)

  const insertEntity = db.prepare(
    `INSERT OR REPLACE INTO entities (id, label, type, description, chunk_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  const insertRel = db.prepare(
    `INSERT OR REPLACE INTO relationships (id, from_entity_id, to_entity_id, type, chunk_id, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  const transaction = db.transaction(() => {
    ensureGraphStubs(chunkIds)
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

// ═══════════════════════════════════════════════════════════════════════════
// Entity Queries
// ═══════════════════════════════════════════════════════════════════════════

export function getEntity(id: EntityId): Entity | undefined {
  const db = getDatabase()
  const row = db
    .prepare("SELECT * FROM entities WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToEntity(row) : undefined
}

export function queryByType(type: EntityType): Entity[] {
  const db = getDatabase()
  const rows = db
    .prepare("SELECT * FROM entities WHERE type = ?")
    .all(type) as Record<string, unknown>[]
  return rows.map(rowToEntity)
}

export function searchEntities(query: string): Entity[] {
  const db = getDatabase()
  const pattern = `%${query}%`
  const rows = db
    .prepare(
      "SELECT * FROM entities WHERE label LIKE ? OR description LIKE ? ORDER BY label",
    )
    .all(pattern, pattern) as Record<string, unknown>[]
  return rows.map(rowToEntity)
}

// ═══════════════════════════════════════════════════════════════════════════
// Relationship Queries
// ═══════════════════════════════════════════════════════════════════════════

/** Get all relationships connected to an entity. */
export function getRelationshipsForEntity(entityId: EntityId): Relationship[] {
  const db = getDatabase()
  const rows = db
    .prepare("SELECT * FROM relationships WHERE from_entity_id = ? OR to_entity_id = ?")
    .all(entityId, entityId) as Record<string, unknown>[]
  return rows.map(rowToRelationship)
}

/** BFS helper: get neighbors of the given entity IDs (excluding the IDs themselves). */
export function getNeighborEntities(entityIds: string[], excludeIds: string[]): Entity[] {
  const db = getDatabase()
  const placeholders = entityIds.map(() => "?").join(",")
  const excludePlaceholders = excludeIds.map(() => "?").join(",")

  const rows = db
    .prepare(
      `SELECT DISTINCT e.*
       FROM entities e
       JOIN relationships r
         ON (r.from_entity_id = e.id OR r.to_entity_id = e.id)
       WHERE (r.from_entity_id IN (${placeholders}) OR r.to_entity_id IN (${placeholders}))
         AND e.id NOT IN (${excludePlaceholders})`,
    )
    .all(...entityIds, ...entityIds, ...excludeIds) as Record<string, unknown>[]
  return rows.map(rowToEntity)
}

/** Find immediate neighbor IDs for a given entity ID (used in BFS path finding). */
export function getNeighborIds(entityId: string): string[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT DISTINCT
        CASE WHEN r.from_entity_id = ? THEN r.to_entity_id ELSE r.from_entity_id END AS neighbor_id
       FROM relationships r
       WHERE r.from_entity_id = ? OR r.to_entity_id = ?`,
    )
    .all(entityId, entityId, entityId) as { neighbor_id: string }[]
  return rows.map((r) => r.neighbor_id)
}
