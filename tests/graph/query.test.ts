import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initDatabase, closeDatabase } from "../../src/store/database.js"
import { storeGraphData } from "../../src/graph/index.js"
import { getEntity, getNeighbors, findPath, queryByType, searchEntities } from "../../src/graph/query.js"
import type { Entity, Relationship } from "../../src/types.js"

const sampleEntities: Entity[] = [
  { id: "e1", label: "Machine Learning", type: "concept", description: "AI subset", chunkId: "c1", metadata: {} },
  { id: "e2", label: "Deep Learning", type: "concept", description: "ML subset using neural networks", chunkId: "c1", metadata: {} },
  { id: "e3", label: "Neural Network", type: "concept", description: "Computing system inspired by biology", chunkId: "c1", metadata: {} },
  { id: "e4", label: "Supervised Learning", type: "concept", description: "Learning with labeled data", chunkId: "c1", metadata: {} },
  { id: "e5", label: "Albert Einstein", type: "person", description: "Theoretical physicist", chunkId: "c1", metadata: {} },
  { id: "e6", label: "Relativity", type: "definition", description: "Einstein's theory", chunkId: "c2", metadata: {} },
]

const sampleRelationships: Relationship[] = [
  { id: "r1", fromEntityId: "e2", toEntityId: "e1", type: "part_of", chunkId: "c1", confidence: 0.9 },
  { id: "r2", fromEntityId: "e3", toEntityId: "e2", type: "part_of", chunkId: "c1", confidence: 0.85 },
  { id: "r3", fromEntityId: "e4", toEntityId: "e2", type: "part_of", chunkId: "c1", confidence: 0.8 },
  { id: "r4", fromEntityId: "e2", toEntityId: "e3", type: "depends_on", chunkId: "c1", confidence: 0.75 },
  { id: "r5", fromEntityId: "e6", toEntityId: "e5", type: "defined_by", chunkId: "c2", confidence: 0.95 },
]

beforeEach(() => {
  initDatabase(":memory:")
  storeGraphData(sampleEntities, sampleRelationships)
})

afterEach(() => {
  closeDatabase()
})

// ── getEntity ───────────────────────────────────────────────────────────

describe("getEntity", () => {
  it("should return an entity by ID", () => {
    const entity = getEntity("e1")
    expect(entity).toBeDefined()
    expect(entity!.label).toBe("Machine Learning")
    expect(entity!.type).toBe("concept")
  })

  it("should return null for non-existent ID", () => {
    const entity = getEntity("nonexistent")
    expect(entity).toBeNull()
  })
})

// ── getNeighbors ────────────────────────────────────────────────────────

describe("getNeighbors", () => {
  it("should return direct neighbors at depth 1", () => {
    const neighbors = getNeighbors("e2", 1)
    // e2 has direct relationships with: e1 (part_of), e3 (part_of, depends_on), e4 (part_of)
    const neighborIds = neighbors.map((n) => n.id)
    expect(neighborIds).toContain("e1")
    expect(neighborIds).toContain("e3")
    expect(neighborIds).toContain("e4")
    // e5/e6 should not appear (only connected to each other)
    expect(neighborIds).not.toContain("e5")
    expect(neighborIds).not.toContain("e6")
  })

  it("should return indirect neighbors at depth > 1", () => {
    const neighbors = getNeighbors("e1", 2)
    // e1 → e2 (depth 1) → e3, e4 (depth 2)
    const neighborIds = neighbors.map((n) => n.id)
    expect(neighborIds).toContain("e2")
    expect(neighborIds).toContain("e3")
    expect(neighborIds).toContain("e4")
  })

  it("should return neighbors for entity with relationships", () => {
    const neighbors = getNeighbors("e5", 1)
    expect(neighbors.length).toBeGreaterThanOrEqual(1)
    expect(neighbors[0].id).toBe("e6")
  })

  it("should return empty array for non-existent entity", () => {
    const neighbors = getNeighbors("nonexistent", 1)
    expect(neighbors).toEqual([])
  })
})

// ── findPath ────────────────────────────────────────────────────────────

describe("findPath", () => {
  it("should find a direct path between two entities", () => {
    const path = findPath("e2", "e1")
    expect(path.length).toBeGreaterThanOrEqual(2)
    expect(path[0].id).toBe("e2")
    expect(path[path.length - 1].id).toBe("e1")
  })

  it("should find a path through intermediate entities", () => {
    const path = findPath("e3", "e1")
    // e3 → e2 → e1
    expect(path.length).toBeGreaterThanOrEqual(3)
    expect(path[0].id).toBe("e3")
    expect(path[path.length - 1].id).toBe("e1")
    const pathIds = path.map((n) => n.id)
    expect(pathIds).toContain("e2")
  })

  it("should return empty array when no path exists", () => {
    const path = findPath("e1", "nonexistent")
    expect(path).toEqual([])
  })
})

// ── queryByType ─────────────────────────────────────────────────────────

describe("queryByType", () => {
  it("should return all entities of a given type", () => {
    const concepts = queryByType("concept")
    const conceptIds = concepts.map((e) => e.id)
    expect(conceptIds).toEqual(expect.arrayContaining(["e1", "e2", "e3", "e4"]))
  })

  it("should return empty array for type with no entities", () => {
    const terms = queryByType("term")
    expect(terms).toEqual([])
  })
})

// ── searchEntities ──────────────────────────────────────────────────────

describe("searchEntities", () => {
  it("should find entities by label match", () => {
    const results = searchEntities("Learning")
    const labels = results.map((e) => e.label)
    expect(labels).toContain("Machine Learning")
    expect(labels).toContain("Deep Learning")
  })

  it("should find entities by description match", () => {
    const results = searchEntities("neural")
    const labels = results.map((e) => e.label)
    expect(labels).toContain("Neural Network")
    expect(labels).toContain("Deep Learning")
  })

  it("should return empty array for no matches", () => {
    const results = searchEntities("zzz_not_found")
    expect(results).toEqual([])
  })

  it("should perform case-insensitive search", () => {
    const results = searchEntities("MACHINE")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].label).toBe("Machine Learning")
  })
})
