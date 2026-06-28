import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { SourceDocument, DocumentChunk } from "../../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string
let dbPath: string
let dbModule: typeof import("../../src/store/database.js")
let docModule: typeof import("../../src/store/documents.js")
let vecModule: typeof import("../../src/store/vectors.js")

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-vec-test-"))
  dbPath = join(tmpDir, "test.db")
  return dbPath
}

function cleanup() {
  if (tmpDir) {
    try {
      dbModule?.closeDatabase()
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function makeDoc(
  id: string,
  overrides: Partial<SourceDocument> = {},
): SourceDocument {
  return {
    id,
    filename: `${id}.md`,
    format: "md",
    title: `Document ${id}`,
    text: "",
    metadata: {},
    ingestedAt: new Date("2025-01-01"),
    ...overrides,
  }
}

function makeChunks(docId: string, count: number = 2): DocumentChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${docId}-chunk-${i}`,
    documentId: docId,
    index: i,
    content: `Content ${i} of ${docId}`,
    tokenCount: 5,
  }))
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Vector operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    docModule = await import("../../src/store/documents.js")
    vecModule = await import("../../src/store/vectors.js")
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert and search with exact vector match", () => {
    // Insert doc and chunks
    docModule.insertDocument(makeDoc("doc-a"))
    docModule.insertChunks(makeChunks("doc-a"))

    // Embed with a known vector
    const vector = new Array(768).fill(0)
    vector[0] = 1.0
    vecModule.insertEmbedding("doc-a-chunk-0", vector)

    // Search for the same vector
    const results = vecModule.searchSimilar(vector, 5)

    expect(results).toHaveLength(1)
    expect(results[0].chunk.id).toBe("doc-a-chunk-0")
    expect(results[0].score).toBeCloseTo(0, 1) // distance near 0 for exact match
  })

  it("should return results ordered by similarity (distance)", () => {
    docModule.insertDocument(makeDoc("doc-a"))
    docModule.insertChunks(makeChunks("doc-a", 2))

    // Chunk 0: vector[0] = 1.0
    const vec0 = new Array(768).fill(0)
    vec0[0] = 1.0
    vecModule.insertEmbedding("doc-a-chunk-0", vec0)

    // Chunk 1: vector[1] = 1.0
    const vec1 = new Array(768).fill(0)
    vec1[1] = 1.0
    vecModule.insertEmbedding("doc-a-chunk-1", vec1)

    // Search with a vector closest to chunk 0
    const query = new Array(768).fill(0)
    query[0] = 1.0
    query[1] = 0.1

    const results = vecModule.searchSimilar(query, 5)

    expect(results).toHaveLength(2)
    expect(results[0].chunk.id).toBe("doc-a-chunk-0")
    expect(results[1].chunk.id).toBe("doc-a-chunk-1")
    // First result should have smaller distance
    expect(results[0].score).toBeLessThanOrEqual(results[1].score)
  })

  it("should include chunk content and source document metadata", () => {
    docModule.insertDocument(
      makeDoc("doc-a", { title: "My Document" }),
    )
    docModule.insertChunks(makeChunks("doc-a"))

    const vector = new Array(768).fill(0)
    vector[0] = 1.0
    vecModule.insertEmbedding("doc-a-chunk-0", vector)

    const results = vecModule.searchSimilar(vector, 5)

    expect(results).toHaveLength(1)
    expect(results[0].chunk.content).toBe("Content 0 of doc-a")
    expect(results[0].source.title).toBe("My Document")
    expect(results[0].source.id).toBe("doc-a")
  })

  it("should respect limit parameter", () => {
    docModule.insertDocument(makeDoc("doc-a"))
    docModule.insertChunks(makeChunks("doc-a", 5))

    // Insert 5 embeddings (all identical vector)
    const vector = new Array(768).fill(0.5)
    for (let i = 0; i < 5; i++) {
      vecModule.insertEmbedding(`doc-a-chunk-${i}`, vector)
    }

    const results = vecModule.searchSimilar(vector, 3)
    expect(results).toHaveLength(3)
  })

  it("should return empty array when no vectors match", () => {
    const query = new Array(768).fill(0.1)
    const results = vecModule.searchSimilar(query, 5)
    expect(results).toEqual([])
  })

  it("should allow filtering by document ID", () => {
    // Document A with chunk 0
    docModule.insertDocument(makeDoc("doc-a"))
    docModule.insertChunks(makeChunks("doc-a", 1))

    // Document B with chunk 0
    docModule.insertDocument(makeDoc("doc-b"))
    const bChunks = makeChunks("doc-b", 1)
    docModule.insertChunks(bChunks)

    // Both get same vector
    const vector = new Array(768).fill(0.5)
    vecModule.insertEmbedding("doc-a-chunk-0", vector)
    vecModule.insertEmbedding("doc-b-chunk-0", vector)

    // Search with filter on doc-a
    const results = vecModule.searchSimilar(vector, 10, {
      documentId: "doc-a",
    })

    expect(results).toHaveLength(1)
    expect(results[0].chunk.documentId).toBe("doc-a")
  })

  it("should handle high-dimensional vectors correctly", () => {
    docModule.insertDocument(makeDoc("doc-a"))
    docModule.insertChunks(makeChunks("doc-a", 1))

    // Use a vector with many non-zero dimensions
    const vector = new Array(768).fill(0)
    for (let i = 0; i < 10; i++) {
      vector[i * 10] = 0.5
    }
    vecModule.insertEmbedding("doc-a-chunk-0", vector)

    const results = vecModule.searchSimilar(vector, 5)
    expect(results).toHaveLength(1)
    expect(results[0].chunk.id).toBe("doc-a-chunk-0")
  })

  it("should throw on embedding with wrong dimension", () => {
    const wrongVector = new Array(128).fill(0.5) // wrong dimension
    expect(() => {
      vecModule.insertEmbedding("chunk-x", wrongVector)
    }).toThrow()
  })
})
