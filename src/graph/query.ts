// ── Graph Queries ─────────────────────────────────────────────────────────

import { getDatabase } from "../store/database.js"
import type { Entity, EntityType } from "../types.js"

// ── Row → Entity mapper ─────────────────────────────────────────────────

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: String(row.id),
    label: String(row.label),
    type: String(row.type) as EntityType,
    description: String(row.description),
    chunkId: String(row.chunk_id),
    metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>,
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Get a single entity by its ID.
 * Returns `null` when the entity does not exist.
 */
export function getEntity(id: string): Entity | null {
  const db = getDatabase()
  const row = db
    .prepare("SELECT * FROM entities WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToEntity(row) : null
}

/**
 * Find all entities connected to `entityId` within `depth` hops.
 * Uses a breadth-first traversal over the relationships table.
 */
export function getNeighbors(entityId: string, depth: number): Entity[] {
  const db = getDatabase()

  const visited = new Set<string>()
  const result: Entity[] = []
  let currentLevel = new Set([entityId])
  visited.add(entityId)

  for (let d = 0; d < depth; d++) {
    if (currentLevel.size === 0) break

    const ids = [...currentLevel]
    const placeholders = ids.map(() => "?").join(",")

    const rows = db
      .prepare(
        `SELECT DISTINCT e.*
         FROM entities e
         JOIN relationships r
           ON (r.from_entity_id = e.id OR r.to_entity_id = e.id)
         WHERE (r.from_entity_id IN (${placeholders}) OR r.to_entity_id IN (${placeholders}))
           AND e.id NOT IN (${placeholders})`,
      )
      .all(...ids, ...ids, ...ids) as Record<string, unknown>[]

    const nextLevel = new Set<string>()
    for (const row of rows) {
      const id = String(row.id)
      if (!visited.has(id)) {
        visited.add(id)
        nextLevel.add(id)
        result.push(rowToEntity(row))
      }
    }

    currentLevel = nextLevel
  }

  return result
}

/**
 * Find the shortest path between two entities using BFS.
 * Returns an ordered array of entities from `fromId` to `toId`.
 * Returns an empty array when no path exists.
 */
export function findPath(fromId: string, toId: string): Entity[] {
  if (fromId === toId) {
    const entity = getEntity(fromId)
    return entity ? [entity] : []
  }

  const db = getDatabase()

  // BFS over relationships
  const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }]
  const visited = new Set([fromId])

  while (queue.length > 0) {
    const { id, path } = queue.shift()!

    const rows = db
      .prepare(
        `SELECT DISTINCT
          CASE WHEN r.from_entity_id = ? THEN r.to_entity_id ELSE r.from_entity_id END AS neighbor_id
         FROM relationships r
         WHERE r.from_entity_id = ? OR r.to_entity_id = ?`,
      )
      .all(id, id, id) as { neighbor_id: string }[]

    for (const row of rows) {
      const neighborId = row.neighbor_id
      if (neighborId === toId) {
        const fullPath = [...path, neighborId]
        return fullPath.map((pid) => getEntity(pid)!).filter(Boolean)
      }
      if (!visited.has(neighborId)) {
        visited.add(neighborId)
        queue.push({ id: neighborId, path: [...path, neighborId] })
      }
    }
  }

  return []
}

/**
 * Return all entities of a given type.
 */
export function queryByType(type: EntityType): Entity[] {
  const db = getDatabase()
  const rows = db
    .prepare("SELECT * FROM entities WHERE type = ?")
    .all(type) as Record<string, unknown>[]
  return rows.map(rowToEntity)
}

/**
 * Search entities by label or description (case-insensitive).
 * Returns all matching entities, ordered by label.
 */
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
