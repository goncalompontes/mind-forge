import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type {
  EmbeddingProvider,
  SourceDocument,
  DocumentChunk,
  Entity,
  Relationship,
} from "../../src/types.js"
import { initDatabase, closeDatabase, getDatabase } from "../../src/store/database.js"
import { insertDocument } from "../../src/store/documents.js"

// ── Mock Extract Result ─────────────────────────────────────────────────────

const MOCK_DOC: SourceDocument = {
  id: "mock-doc-1",
  filename: "/tmp/test-doc.md",
  format: "md",
  title: "Test Document",
  text: "Machine Learning is a subset of Artificial Intelligence. Deep Learning is a subset of Machine Learning. Neural Networks are a key component of Deep Learning.",
  metadata: {},
  ingestedAt: new Date("2025-06-01"),
}

const MOCK_CHUNKS: DocumentChunk[] = [
  {
    id: "mock-chunk-0",
    documentId: "mock-doc-1",
    index: 0,
    content: "Machine Learning is a subset of Artificial Intelligence.",
    tokenCount: 10,
  },
  {
    id: "mock-chunk-1",
    documentId: "mock-doc-1",
    index: 1,
    content: "Deep Learning is a subset of Machine Learning. Neural Networks are a key component of Deep Learning.",
    tokenCount: 20,
  },
]

const MOCK_ENTITIES: Entity[] = [
  { id: "ent-1", label: "Machine Learning", type: "concept", description: "A subset of AI", chunkId: "mock-chunk-0", metadata: {} },
  { id: "ent-2", label: "Artificial Intelligence", type: "concept", description: "Broader field", chunkId: "mock-chunk-0", metadata: {} },
  { id: "ent-3", label: "Deep Learning", type: "concept", description: "Subset of ML", chunkId: "mock-chunk-1", metadata: {} },
]

const MOCK_RELATIONSHIPS: Relationship[] = [
  { id: "rel-1", fromEntityId: "ent-1", toEntityId: "ent-2", type: "part_of", chunkId: "mock-chunk-0", confidence: 0.9 },
  { id: "rel-2", fromEntityId: "ent-3", toEntityId: "ent-1", type: "part_of", chunkId: "mock-chunk-1", confidence: 0.85 },
]

// ── Mock Functions ─────────────────────────────────────────────────────────

function createMockEmbedProvider(): EmbeddingProvider {
  return {
    async embed(_texts: string[]): Promise<number[][]> {
      return _texts.map(() => {
        const vec = new Array(768).fill(0.01)
        vec[0] = 1.0
        return vec
      })
    },
    async health(): Promise<boolean> {
      return true
    },
  }
}

function createMockExtractFn() {
  return vi.fn(async (_source: string, _options?: unknown) => ({
    document: { ...MOCK_DOC, ingestedAt: new Date(MOCK_DOC.ingestedAt) },
    chunks: MOCK_CHUNKS.map((c) => ({ ...c })),
  }))
}

function createMockEmbedProviderThatFails(): EmbeddingProvider {
  return {
    async embed(_texts: string[]): Promise<number[][]> {
      throw new Error("Embedding service unavailable")
    },
    async health(): Promise<boolean> {
      return false
    },
  }
}

function createMockGraphExtractFn() {
  return vi.fn(async () => ({
    entities: MOCK_ENTITIES.map((e) => ({ ...e })),
    relationships: MOCK_RELATIONSHIPS.map((r) => ({ ...r })),
  }))
}

function createMockGraphExtractFnThatFails() {
  return vi.fn(async () => {
    throw new Error("Graph extraction failed")
  })
}

// ── Helper: create IngestTool with mocks ───────────────────────────────────

async function createIngestToolWithMocks(
  overrides?: {
    embedProvider?: EmbeddingProvider
    extractFn?: ReturnType<typeof createMockExtractFn>
    graphExtractFn?: ReturnType<typeof createMockGraphExtractFn>
    dbPath?: string
  },
) {
  const mod = await import("../../src/mcp/ingest.tool.js")
  const tool = new mod.IngestTool({
    embedProvider: overrides?.embedProvider ?? createMockEmbedProvider(),
    extractFn: overrides?.extractFn ?? createMockExtractFn(),
    graphExtractFn: overrides?.graphExtractFn ?? createMockGraphExtractFn(),
  })
  return { tool, IngestTool: mod.IngestTool }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("IngestTool — Full Pipeline", () => {
  beforeEach(() => {
    initDatabase(":memory:")
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should orchestrate the full pipeline: extract → embed → store → graph", async () => {
    const extractFn = createMockExtractFn()
    const graphExtractFn = createMockGraphExtractFn()
    const { tool } = await createIngestToolWithMocks({
      extractFn,
      graphExtractFn,
    })

    const result = await tool.execute({
      source: "/tmp/test-doc.md",
      chunkSize: 500,
    })

    // Verify extract was called with correct args
    expect(extractFn).toHaveBeenCalledWith("/tmp/test-doc.md", {
      chunkSize: 500,
    })

    // Verify graph extractor was called with chunks
    expect(graphExtractFn).toHaveBeenCalled()

    // Verify return structure
    expect(result.documentId).toBe("mock-doc-1")
    expect(result.title).toBe("Test Document")
    expect(result.format).toBe("md")
    expect(result.chunkCount).toBe(2)
    expect(result.entityCount).toBe(3)
    expect(result.relationshipCount).toBe(2)
    expect(result.ingestedAt).toBeTruthy()

    // Verify doc was stored in database
    const db = getDatabase()
    const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get("mock-doc-1") as Record<string, unknown> | undefined
    expect(docRow).toBeDefined()
    expect(docRow!.title).toBe("Test Document")

    // Verify chunks were stored
    const chunkRows = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all("mock-doc-1") as Record<string, unknown>[]
    expect(chunkRows).toHaveLength(2)

    // Verify embeddings were stored
    const vecRows = db.prepare("SELECT * FROM vec_chunks").all() as Record<string, unknown>[]
    expect(vecRows).toHaveLength(2)

    // Verify graph data was stored
    const entityRows = db.prepare("SELECT * FROM entities").all() as Record<string, unknown>[]
    expect(entityRows).toHaveLength(3)
    const relRows = db.prepare("SELECT * FROM relationships").all() as Record<string, unknown>[]
    expect(relRows).toHaveLength(2)
  })

  it("should default mode to 'create'", async () => {
    const { tool } = await createIngestToolWithMocks()

    const result = await tool.execute({
      source: "/tmp/new-doc.md",
    })

    expect(result.documentId).toBeTruthy()
  })

  it("should use default chunk size of 1000 when not specified", async () => {
    const extractFn = createMockExtractFn()
    const { tool } = await createIngestToolWithMocks({ extractFn })

    await tool.execute({ source: "/tmp/test-doc.md" })

    expect(extractFn).toHaveBeenCalledWith("/tmp/test-doc.md", {
      chunkSize: 1000,
    })
  })
})

describe("IngestTool — Mode: create", () => {
  beforeEach(() => {
    initDatabase(":memory:")
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should throw when source already exists in database", async () => {
    // Insert an existing document with the same filename
    insertDocument({
      id: "existing-doc",
      filename: "/tmp/duplicate.md",
      format: "md",
      title: "Existing",
      text: "Existing content",
      metadata: {},
      ingestedAt: new Date(),
    })

    const { tool } = await createIngestToolWithMocks()

    await expect(
      tool.execute({ source: "/tmp/duplicate.md", mode: "create" }),
    ).rejects.toThrow(/already exists/i)
  })

  it("should succeed when source does not exist", async () => {
    const { tool } = await createIngestToolWithMocks()

    const result = await tool.execute({
      source: "/tmp/fresh-doc.md",
      mode: "create",
    })

    expect(result.documentId).toBe("mock-doc-1")
  })
})

describe("IngestTool — Mode: replace", () => {
  beforeEach(() => {
    initDatabase(":memory:")
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should delete existing document before re-ingesting", async () => {
    // Insert existing document with chunks and embeddings
    insertDocument({
      id: "old-doc",
      filename: "/tmp/replaced.md",
      format: "md",
      title: "Old Document",
      text: "Old content",
      metadata: {},
      ingestedAt: new Date("2025-01-01"),
    })

    // Insert old chunks
    const db = getDatabase()
    db.prepare("INSERT INTO chunks (id, document_id, chunk_index, content, token_count) VALUES (?, ?, ?, ?, ?)")
      .run("old-chunk-0", "old-doc", 0, "Old content", 5)

    // Verify old data exists
    const oldDoc = db.prepare("SELECT * FROM documents WHERE id = ?").get("old-doc")
    expect(oldDoc).toBeDefined()

    const { tool } = await createIngestToolWithMocks()

    const result = await tool.execute({
      source: "/tmp/replaced.md",
      mode: "replace",
    })

    // Old document should be gone
    const deletedDoc = db.prepare("SELECT * FROM documents WHERE id = ?").get("old-doc")
    expect(deletedDoc).toBeUndefined()

    // New document should exist
    expect(result.documentId).toBe("mock-doc-1")
    const newDoc = db.prepare("SELECT * FROM documents WHERE id = ?").get("mock-doc-1") as Record<string, unknown> | undefined
    expect(newDoc).toBeDefined()
    expect(newDoc!.title).toBe("Test Document")
  })

  it("should succeed when source does not already exist (no-op delete)", async () => {
    const { tool } = await createIngestToolWithMocks()

    const result = await tool.execute({
      source: "/tmp/brand-new.md",
      mode: "replace",
    })

    expect(result.documentId).toBe("mock-doc-1")
  })
})

describe("IngestTool — Mode: append", () => {
  beforeEach(() => {
    initDatabase(":memory:")
  })

  afterEach(() => {
    closeDatabase()
  })

  // For append, we need a mock extract that reuses the same document ID
  // but adds new chunks
  const APPEND_DOC_ID = "append-doc-1"
  const EXISTING_CHUNK: DocumentChunk = {
    id: "existing-chunk",
    documentId: APPEND_DOC_ID,
    index: 0,
    content: "Existing chunk content.",
    tokenCount: 5,
  }
  const NEW_CHUNKS: DocumentChunk[] = [
    {
      id: "new-chunk-0",
      documentId: APPEND_DOC_ID,
      index: 1,
      content: "New appended chunk.",
      tokenCount: 5,
    },
  ]

  // An extract function that uses the same document ID as existing data
  const appendExtractFn = vi.fn(async () => ({
    document: {
      id: APPEND_DOC_ID,
      filename: "/tmp/append-doc.md",
      format: "md" as const,
      title: "Append Document",
      text: "Existing chunk content. New appended chunk.",
      metadata: {},
      ingestedAt: new Date("2025-06-01"),
    },
    chunks: NEW_CHUNKS.map((c) => ({ ...c })),
  }))

  it("should add new chunks without removing existing ones", async () => {
    // Insert existing document with one chunk
    insertDocument({
      id: APPEND_DOC_ID,
      filename: "/tmp/append-doc.md",
      format: "md",
      title: "Append Document",
      text: "Existing chunk content.",
      metadata: {},
      ingestedAt: new Date("2025-06-01"),
    })

    const db = getDatabase()
    db.prepare("INSERT INTO chunks (id, document_id, chunk_index, content, token_count) VALUES (?, ?, ?, ?, ?)")
      .run(EXISTING_CHUNK.id, EXISTING_CHUNK.documentId, EXISTING_CHUNK.index, EXISTING_CHUNK.content, EXISTING_CHUNK.tokenCount)

    // Verify existing data
    const existingChunks = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all(APPEND_DOC_ID) as Record<string, unknown>[]
    expect(existingChunks).toHaveLength(1)

    const embedProvider = createMockEmbedProvider()
    const graphExtractFn = createMockGraphExtractFn()
    const { tool } = await createIngestToolWithMocks({
      embedProvider,
      extractFn: appendExtractFn,
      graphExtractFn,
    })

    const result = await tool.execute({
      source: "/tmp/append-doc.md",
      mode: "append",
    })

    // Document should still exist
    const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get(APPEND_DOC_ID) as Record<string, unknown> | undefined
    expect(docRow).toBeDefined()

    // Existing chunk should still be there
    const oldChunk = db.prepare("SELECT * FROM chunks WHERE id = ?").get("existing-chunk")
    expect(oldChunk).toBeDefined()

    // New chunk should also be there
    const newChunk = db.prepare("SELECT * FROM chunks WHERE id = ?").get("new-chunk-0")
    expect(newChunk).toBeDefined()

    // Total chunks should be 2
    const allChunks = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all(APPEND_DOC_ID) as Record<string, unknown>[]
    expect(allChunks).toHaveLength(2)

    // Verify return value
    expect(result.documentId).toBe(APPEND_DOC_ID)
    expect(result.chunkCount).toBe(1) // Only the newly extracted chunks
  })
})

describe("IngestTool — Graceful Degradation", () => {
  beforeEach(() => {
    initDatabase(":memory:")
  })

  afterEach(() => {
    closeDatabase()
  })

  it("should store document and chunks even when embedding fails", async () => {
    const extractFn = createMockExtractFn()
    const failingEmbed = createMockEmbedProviderThatFails()
    const graphExtractFn = createMockGraphExtractFn()
    const { tool } = await createIngestToolWithMocks({
      embedProvider: failingEmbed,
      extractFn,
      graphExtractFn,
    })

    const result = await tool.execute({
      source: "/tmp/test-doc.md",
    })

    // Document should be stored
    const db = getDatabase()
    const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get("mock-doc-1") as Record<string, unknown> | undefined
    expect(docRow).toBeDefined()
    expect(docRow!.title).toBe("Test Document")

    // Chunks should be stored
    const chunkRows = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all("mock-doc-1") as Record<string, unknown>[]
    expect(chunkRows).toHaveLength(2)

    // Embeddings should NOT be stored (graceful degradation)
    const vecRows = db.prepare("SELECT * FROM vec_chunks").all() as Record<string, unknown>[]
    expect(vecRows).toHaveLength(0)

    // Graph should still be extracted and stored
    const entityRows = db.prepare("SELECT * FROM entities").all() as Record<string, unknown>[]
    expect(entityRows).toHaveLength(3)

    // Return value should still be valid
    expect(result.documentId).toBe("mock-doc-1")
    expect(result.chunkCount).toBe(2)
    expect(result.entityCount).toBe(3)
  })

  it("should store document, chunks, and embeddings even when graph extraction fails", async () => {
    const extractFn = createMockExtractFn()
    const failingGraphFn = createMockGraphExtractFnThatFails()
    const { tool } = await createIngestToolWithMocks({
      extractFn,
      graphExtractFn: failingGraphFn,
    })

    const result = await tool.execute({
      source: "/tmp/test-doc.md",
    })

    // Document should be stored
    const db = getDatabase()
    const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get("mock-doc-1") as Record<string, unknown> | undefined
    expect(docRow).toBeDefined()

    // Chunks should be stored
    const chunkRows = db.prepare("SELECT * FROM chunks WHERE document_id = ?").all("mock-doc-1") as Record<string, unknown>[]
    expect(chunkRows).toHaveLength(2)

    // Embeddings should be stored (they happen before graph)
    const vecRows = db.prepare("SELECT * FROM vec_chunks").all() as Record<string, unknown>[]
    expect(vecRows).toHaveLength(2)

    // Graph data should NOT be stored
    const entityRows = db.prepare("SELECT * FROM entities").all() as Record<string, unknown>[]
    expect(entityRows).toHaveLength(0)

    // Return value should be valid with 0 entities/relationships
    expect(result.documentId).toBe("mock-doc-1")
    expect(result.chunkCount).toBe(2)
    expect(result.entityCount).toBe(0)
    expect(result.relationshipCount).toBe(0)
  })

  it("should handle empty chunks gracefully", async () => {
    const emptyExtractFn = vi.fn(async () => ({
      document: { ...MOCK_DOC, ingestedAt: new Date(MOCK_DOC.ingestedAt) },
      chunks: [],
    }))

    const { tool } = await createIngestToolWithMocks({
      extractFn: emptyExtractFn,
    })

    const result = await tool.execute({
      source: "/tmp/empty.md",
    })

    expect(result.documentId).toBe("mock-doc-1")
    expect(result.chunkCount).toBe(0)
    expect(result.entityCount).toBe(0)
    expect(result.relationshipCount).toBe(0)

    // Document should be stored even with no chunks
    const db = getDatabase()
    const docRow = db.prepare("SELECT * FROM documents WHERE id = ?").get("mock-doc-1")
    expect(docRow).toBeDefined()
  })
})
