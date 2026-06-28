import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initDatabase, closeDatabase, getDatabase } from "../../src/store/database.js"
import { storeGraphData } from "../../src/graph/index.js"
import type { Entity, Relationship } from "../../src/types.js"

beforeEach(() => {
  initDatabase(":memory:")
})

afterEach(() => {
  closeDatabase()
})

describe("storeGraphData", () => {
  it("should store entities in the entities table", () => {
    const entities: Entity[] = [
      {
        id: "e1",
        label: "Machine Learning",
        type: "concept",
        description: "A subset of AI",
        chunkId: "c1",
        metadata: { source: "test" },
      },
    ]

    storeGraphData(entities, [])

    const db = getDatabase()
    const row = db.prepare("SELECT * FROM entities WHERE id = ?").get("e1") as Record<string, unknown>
    expect(row).toBeDefined()
    expect(row.label).toBe("Machine Learning")
    expect(row.type).toBe("concept")
    expect(row.description).toBe("A subset of AI")
    expect(row.chunk_id).toBe("c1")
    expect(JSON.parse(String(row.metadata))).toEqual({ source: "test" })
  })

  it("should store relationships in the relationships table", () => {
    const entities: Entity[] = [
      { id: "e1", label: "AI", type: "concept", description: "", chunkId: "c1", metadata: {} },
      { id: "e2", label: "ML", type: "concept", description: "", chunkId: "c1", metadata: {} },
    ]
    const relationships: Relationship[] = [
      {
        id: "r1",
        fromEntityId: "e1",
        toEntityId: "e2",
        type: "depends_on",
        chunkId: "c1",
        confidence: 0.9,
      },
    ]

    storeGraphData(entities, relationships)

    const db = getDatabase()
    const row = db.prepare("SELECT * FROM relationships WHERE id = ?").get("r1") as Record<string, unknown>
    expect(row).toBeDefined()
    expect(row.from_entity_id).toBe("e1")
    expect(row.to_entity_id).toBe("e2")
    expect(row.type).toBe("depends_on")
    expect(row.confidence).toBe(0.9)
  })

  it("should handle empty arrays without error", () => {
    expect(() => storeGraphData([], [])).not.toThrow()
  })

  it("should upsert entities with the same ID", () => {
    const entities1: Entity[] = [
      { id: "e1", label: "Old Label", type: "concept", description: "original", chunkId: "c1", metadata: {} },
    ]
    const entities2: Entity[] = [
      { id: "e1", label: "Updated Label", type: "definition", description: "updated", chunkId: "c2", metadata: { updated: true } },
    ]

    storeGraphData(entities1, [])
    storeGraphData(entities2, [])

    const db = getDatabase()
    const row = db.prepare("SELECT * FROM entities WHERE id = ?").get("e1") as Record<string, unknown>
    expect(row.label).toBe("Updated Label")
    expect(row.type).toBe("definition")
  })

  it("should store multiple entities in a transaction", () => {
    const entities: Entity[] = [
      { id: "e1", label: "Entity 1", type: "concept", description: "", chunkId: "c1", metadata: {} },
      { id: "e2", label: "Entity 2", type: "concept", description: "", chunkId: "c1", metadata: {} },
      { id: "e3", label: "Entity 3", type: "concept", description: "", chunkId: "c1", metadata: {} },
    ]

    storeGraphData(entities, [])

    const db = getDatabase()
    const count = db.prepare("SELECT COUNT(*) as count FROM entities").get() as { count: number }
    expect(count.count).toBe(3)
  })

  it("should create chunk stubs for foreign key compliance", () => {
    const entities: Entity[] = [
      { id: "e1", label: "Test", type: "concept", description: "", chunkId: "custom-chunk-id", metadata: {} },
    ]

    storeGraphData(entities, [])

    const db = getDatabase()
    const chunk = db.prepare("SELECT * FROM chunks WHERE id = ?").get("custom-chunk-id") as Record<string, unknown> | undefined
    expect(chunk).toBeDefined()
    expect(chunk!.document_id).toBe("__graph__")
  })
})
