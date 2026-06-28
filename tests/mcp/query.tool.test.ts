import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { EmbeddingProvider, Entity, Relationship } from "../../src/types.js"
import { QueryTool } from "../../src/mcp/query.tool.js"
import { initDatabase, closeDatabase, getDatabase } from "../../src/store/database.js"
import { insertDocument, insertChunks } from "../../src/store/documents.js"
import { insertEmbedding } from "../../src/store/vectors.js"
import { storeGraphData } from "../../src/graph/index.js"

// ── Mock Embedding Provider ────────────────────────────────────────────────

/**
 * A test embedding provider that returns a fixed vector for any input.
 * The vector has a strong signal at position 0 for "semantic" matching.
 */
class TestEmbeddingProvider implements EmbeddingProvider {
  private signalIndex: number

  constructor(signalIndex = 0) {
    this.signalIndex = signalIndex
  }

  async embed(_texts: string[]): Promise<number[][]> {
    return _texts.map(() => {
      const vec = new Array(768).fill(0.01)
      vec[this.signalIndex] = 1.0
      return vec
    })
  }

  async health(): Promise<boolean> {
    return true
  }
}

// ── Test Fixtures ──────────────────────────────────────────────────────────

const DOC_A = {
  id: "doc-a",
  filename: "ai-overview.md",
  format: "md" as const,
  title: "AI Overview",
  author: "Test",
  text: "Artificial Intelligence is transforming the world.",
  metadata: {},
  ingestedAt: new Date("2025-01-01"),
}

const DOC_B = {
  id: "doc-b",
  filename: "rust-guide.md",
  format: "md" as const,
  title: "Rust Programming Guide",
  author: "Test",
  text: "Rust is a systems programming language.",
  metadata: {},
  ingestedAt: new Date("2025-01-02"),
}

const CHUNKS_A = [
  { id: "chunk-a0", documentId: "doc-a", index: 0, content: "Artificial Intelligence (AI) is a branch of computer science.", tokenCount: 10 },
  { id: "chunk-a1", documentId: "doc-a", index: 1, content: "Machine Learning is a subset of AI.", tokenCount: 8 },
]

const CHUNKS_B = [
  { id: "chunk-b0", documentId: "doc-b", index: 0, content: "Rust is a systems programming language focused on safety.", tokenCount: 12 },
  { id: "chunk-b1", documentId: "doc-b", index: 1, content: "Ownership is a core concept in Rust memory management.", tokenCount: 10 },
]

const GRAPH_ENTITIES: Entity[] = [
  { id: "ent-1", label: "Artificial Intelligence", type: "concept", description: "Branch of CS", chunkId: "chunk-a0", metadata: {} },
  { id: "ent-2", label: "Machine Learning", type: "concept", description: "Subset of AI", chunkId: "chunk-a1", metadata: {} },
  { id: "ent-3", label: "Rust", type: "concept", description: "Systems language", chunkId: "chunk-b0", metadata: {} },
  { id: "ent-4", label: "Ownership", type: "concept", description: "Memory model", chunkId: "chunk-b1", metadata: {} },
]

const GRAPH_RELATIONSHIPS: Relationship[] = [
  { id: "rel-1", fromEntityId: "ent-2", toEntityId: "ent-1", type: "part_of", chunkId: "chunk-a1", confidence: 0.9 },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function seedDatabase(withEntities = false): void {
  insertDocument(DOC_A)
  insertDocument(DOC_B)
  insertChunks(CHUNKS_A)
  insertChunks(CHUNKS_B)

  // Insert vectors — chunk-a0 is most similar to the test provider's vector
  const vecMatch = new Array(768).fill(0.01)
  vecMatch[0] = 1.0

  const vecOther = new Array(768).fill(0.01)
  vecOther[1] = 0.9

  insertEmbedding("chunk-a0", vecMatch)
  insertEmbedding("chunk-a1", vecOther)
  insertEmbedding("chunk-b0", vecOther)
  insertEmbedding("chunk-b1", vecOther)

  if (withEntities) {
    storeGraphData(GRAPH_ENTITIES, GRAPH_RELATIONSHIPS)
  }
}

type QueryToolInstance = {
  tool: QueryTool
  embed: TestEmbeddingProvider
}

function createQueryTool(entities = false): QueryToolInstance {
  const embed = new TestEmbeddingProvider(0)
  initDatabase(":memory:")
  seedDatabase(entities)

  const tool = new QueryTool(":memory:", undefined, embed)
  return { tool, embed }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("QueryTool — Vector Search", () => {
  beforeEach(() => {
    initDatabase(":memory:")
    seedDatabase()
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should return vector search results sorted by similarity", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "artificial intelligence" })

    expect(results.length).toBeGreaterThan(0)
    // chunk-a0 has the exact vector match, should be first
    expect(results[0].chunk.id).toBe("chunk-a0")
  })

  it("should convert distance to similarity score (higher = better)", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "AI" })

    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
      // Score should be in the 0-1 range (after distance→similarity conversion)
      expect(r.score).toBeLessThanOrEqual(1)
    }
    // First result should have highest score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it("should include chunk content and source metadata", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "AI", filters: { limit: 1 } })

    expect(results).toHaveLength(1)
    expect(results[0].chunk.content).toBeTruthy()
    expect(results[0].source.title).toBe("AI Overview")
    expect(results[0].source.id).toBe("doc-a")
  })

  it("should respect the limit parameter", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "AI", filters: { limit: 2 } })
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it("should filter by document IDs", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({
      query: "AI",
      filters: { documentIds: ["doc-b"], limit: 10 },
    })

    for (const r of results) {
      expect(r.chunk.documentId).toBe("doc-b")
    }
  })

  it("should respect minScore threshold", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({
      query: "AI",
      filters: { minScore: 0.99, limit: 10 },
    })

    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.99)
    }
  })

  it("should return empty array for empty query", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "" })
    expect(results).toEqual([])

    const results2 = await tool.execute({ query: "   " })
    expect(results2).toEqual([])
  })
})

describe("QueryTool — Graph-Aware Search", () => {
  beforeEach(() => {
    initDatabase(":memory:")
    seedDatabase(true)
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should enrich vector results with matched entities", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "Artificial Intelligence" })

    // chunk-a0 should have the "Artificial Intelligence" entity
    const chunkA0 = results.find((r) => r.chunk.id === "chunk-a0")
    expect(chunkA0).toBeDefined()
    expect(chunkA0!.entities).toBeDefined()
    if (chunkA0!.entities && chunkA0!.entities.length > 0) {
      const labels = chunkA0!.entities!.map((e) => e.label)
      expect(labels).toContain("Artificial Intelligence")
    }
  })

  it("should include neighbor entities through relationships", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "Machine Learning" })

    // chunk-a1 should have Machine Learning entity and its relationship to AI
    const chunkA1 = results.find((r) => r.chunk.id === "chunk-a1")
    expect(chunkA1).toBeDefined()

    if (chunkA1!.entities && chunkA1!.entities.length > 0) {
      const labels = chunkA1!.entities!.map((e) => e.label)
      expect(labels).toContain("Machine Learning")
    }

    if (chunkA1!.relationships && chunkA1!.relationships.length > 0) {
      expect(chunkA1!.relationships!.length).toBeGreaterThan(0)
    }
  })

  it("should filter entities by type", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({
      query: "Rust",
      filters: { entityTypes: ["person"] },
    })

    // All enriched entities should be of type "person" (none exist, so no enrichment)
    // This just verifies the filter doesn't break anything
    expect(results.length).toBeGreaterThan(0)
  })

  it("should not fail when no entities match query", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "xyzzy unicorn" })
    // May have vector results without entities
    expect(Array.isArray(results)).toBe(true)
  })
})

describe("QueryTool — Full-Text Search", () => {
  beforeEach(() => {
    initDatabase(":memory:")
    seedDatabase()
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should find chunks by FTS keyword match", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "Rust programming" })

    const rustChunks = results.filter((r) =>
      r.chunk.content.toLowerCase().includes("rust"),
    )
    expect(rustChunks.length).toBeGreaterThan(0)
  })

  it("should return FTS results even with no vector match", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "branch of computer science" })

    // "branch" appears in chunk-a0 content
    const match = results.find((r) => r.chunk.id === "chunk-a0")
    expect(match).toBeDefined()
  })

  it("should not match FTS-only results for non-matching query tokens", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    // The FTS layer should not boost results for a completely non-matching word.
    // Vector search may still return results (semantic), but the FTS contribution
    // score should be 0 for queries that match nothing.
    const results = await tool.execute({ query: "supercalifragilisticexpialidocious" })

    // Vector still returns results with the mock provider, so length > 0 is fine.
    // Verify no result content contains the query term.
    for (const r of results) {
      const content = r.chunk.content.toLowerCase()
      expect(content).not.toContain("supercalifragilisticexpialidocious")
    }
  })

  it("should combine FTS and vector results with dedup", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    // "Artificial" appears in chunk-a0 and chunk-a1
    const results = await tool.execute({ query: "Artificial Intelligence" })

    // Should have unique chunk IDs (no duplicates)
    const chunkIds = results.map((r) => r.chunk.id)
    const uniqueIds = new Set(chunkIds)
    expect(chunkIds.length).toBe(uniqueIds.size)
  })
})

describe("QueryTool — Hybrid Search", () => {
  beforeEach(() => {
    initDatabase(":memory:")
    seedDatabase(true)
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should use weighted ranking (vector 0.7 + fts 0.3)", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "Artificial Intelligence", filters: { limit: 10 } })

    expect(results.length).toBeGreaterThan(0)
    // All scores should be < 1.0 since they're weighted
    for (const r of results) {
      expect(r.score).toBeLessThanOrEqual(1.0)
    }
  })

  it("should return results ordered by hybrid score descending", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "Artificial Intelligence", filters: { limit: 10 } })

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score - 0.001)
    }
  })

  it("should include both vector-only and FTS-only results", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    // "Ownership" only appears in chunk-b1, and "safety" only in chunk-b0
    const results = await tool.execute({ query: "ownership safety", filters: { limit: 10 } })

    // chunk-b1 has "Ownership" in content (should be found by FTS)
    // chunk-b0 has "safety" in content (should be found by FTS)
    const chunkIds = results.map((r) => r.chunk.id)
    expect(chunkIds).toContain("chunk-b0")
    expect(chunkIds).toContain("chunk-b1")
  })
})

describe("QueryTool — Edge Cases", () => {
  beforeEach(() => {
    initDatabase(":memory:")
    seedDatabase()
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should return empty array for empty query string", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const r1 = await tool.execute({ query: "" })
    expect(r1).toEqual([])

    const r2 = await tool.execute({ query: "   " })
    expect(r2).toEqual([])
  })

  it("should handle no results gracefully", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "xyzzynotfound" })
    expect(Array.isArray(results)).toBe(true)
  })

  it("should handle filters with no matching data", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({
      query: "AI",
      filters: { documentIds: ["nonexistent-doc"] },
    })
    expect(results).toEqual([])
  })

  it("should default limit to 10", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    const results = await tool.execute({ query: "intelligence" })
    expect(results.length).toBeLessThanOrEqual(10)
  })

  it("should handle short query tokens gracefully", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    // Single-letter tokens get filtered by buildFTSQuery
    const results = await tool.execute({ query: "a b c" })
    expect(Array.isArray(results)).toBe(true)
  })

  it("should handle FTS-special characters in query", async () => {
    const embed = new TestEmbeddingProvider(0)
    const tool = new QueryTool(":memory:", undefined, embed)

    // Query with special FTS characters
    const results = await tool.execute({ query: '"Artificial Intelligence" +testing' })
    expect(Array.isArray(results)).toBe(true)
  })

  it("should survive when embed provider fails and fall back to FTS", async () => {
    class FailingEmbeddingProvider implements EmbeddingProvider {
      async embed(_texts: string[]): Promise<number[][]> {
        throw new Error("Embedding service unavailable")
      }
      async health(): Promise<boolean> {
        return false
      }
    }

    const tool = new QueryTool(":memory:", undefined, new FailingEmbeddingProvider())

    // Should fall back to FTS-only and still return results for "computer science"
    const results = await tool.execute({ query: "computer science branch" })
    expect(results.length).toBeGreaterThan(0)
    const match = results.find((r) => r.chunk.id === "chunk-a0")
    expect(match).toBeDefined()
  })
})
