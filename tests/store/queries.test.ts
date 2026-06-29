// ── Query Layer Tests ─────────────────────────────────────────────────────
// Tests all exported functions from src/store/queries.ts (the barrel),
// covering document CRUD, chunk ops, embeddings, study cards, quizzes,
// exams, and graph operations. Also tests error paths like malformed JSON
// metadata, non-existent entity lookup, and dimension mismatch.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { SourceDocument, DocumentChunk, Entity, Relationship, StudyCard, Quiz, ExamSession } from "../../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string
let dbPath: string
let dbModule: typeof import("../../src/store/database.js")
let q: typeof import("../../src/store/queries.js")
let createDocumentId: (id: string) => string
let createChunkId: (id: string) => string
let createEntityId: (id: string) => string
let createRelationshipId: (id: string) => string
let createCardId: (id: string) => string
let createQuizId: (id: string) => string
let createExamId: (id: string) => string

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-queries-test-"))
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

function makeDoc(overrides: Partial<SourceDocument> = {}): SourceDocument {
  return {
    id: createDocumentId("doc-1"),
    filename: "test.md",
    format: "md",
    title: "Test Document",
    text: "Hello world",
    metadata: { source: "test" },
    ingestedAt: new Date("2025-01-01"),
    ...overrides,
  }
}

function makeChunks(docId: string, count: number = 3): DocumentChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: createChunkId(`chunk-${i}`),
    documentId: createDocumentId(docId),
    index: i,
    content: `Content ${i}`,
    tokenCount: 10,
  }))
}

function makeEntities(chunkId: string): Entity[] {
  return [
    {
      id: createEntityId("entity-1"),
      label: "Test Concept",
      type: "concept",
      description: "A test concept entity",
      chunkId: createChunkId(chunkId),
      metadata: { importance: "high" },
    },
    {
      id: createEntityId("entity-2"),
      label: "Test Person",
      type: "person",
      description: "A test person entity",
      chunkId: createChunkId(chunkId),
      metadata: { role: "author" },
    },
  ]
}

function makeRelationships(): Relationship[] {
  return [
    {
      id: createRelationshipId("rel-1"),
      fromEntityId: createEntityId("entity-1"),
      toEntityId: createEntityId("entity-2"),
      type: "defined_by",
      chunkId: createChunkId("chunk-0"),
      confidence: 0.95,
    },
  ]
}

function makeVector(dim: number = 768, fillValue: number = 0.1): number[] {
  return new Array(dim).fill(fillValue)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Query layer — document CRUD", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createChunkId = bid.createChunkId
    createEntityId = bid.createEntityId
    createRelationshipId = bid.createRelationshipId
    createCardId = bid.createCardId
    createQuizId = bid.createQuizId
    createExamId = bid.createExamId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert and find a document by filename", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    const found = q.findDocumentByFilename("test.md")
    expect(found).toBeDefined()
    expect(found!.filename).toBe("test.md")
  })

  it("should return undefined for non-existent filename", () => {
    const found = q.findDocumentByFilename("nonexistent.md")
    expect(found).toBeUndefined()
  })

  it("should list all documents", () => {
    const doc1 = makeDoc({ id: createDocumentId("doc-1"), title: "First" })
    const doc2 = makeDoc({ id: createDocumentId("doc-2"), filename: "second.md", title: "Second" })
    q.insertDocument(doc1)
    q.insertDocument(doc2)

    const docs = q.listDocuments()
    expect(docs).toHaveLength(2)
  })

  it("should return empty list when no documents exist", () => {
    const docs = q.listDocuments()
    expect(docs).toEqual([])
  })

  it("should get a document with its chunks", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    const chunks = makeChunks("doc-1", 2)
    q.insertChunks(chunks)

    const retrieved = q.getDocument(createDocumentId("doc-1"))
    expect(retrieved).toBeDefined()
    expect(retrieved!.chunks).toHaveLength(2)
  })

  it("should delete a document", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.deleteDocument(createDocumentId("doc-1"))

    const retrieved = q.getDocument(createDocumentId("doc-1"))
    expect(retrieved).toBeUndefined()
  })

  it("should handle malformed JSON metadata gracefully", () => {
    const db = dbModule.getDatabase()
    // Insert raw row with bad JSON metadata
    db.prepare(
      "INSERT INTO documents (id, filename, format, title, text, metadata, ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("doc-bad", "bad.md", "md", "Bad", "text", "{invalid json}", "2025-01-01T00:00:00.000Z")

    const doc = q.findDocumentByFilename("bad.md")
    expect(doc).toBeDefined()
    expect(doc!.metadata).toEqual({})
  })
})

describe("Query layer — chunk operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createChunkId = bid.createChunkId
    createEntityId = bid.createEntityId
    createRelationshipId = bid.createRelationshipId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert chunks and get chunk count", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 5))

    expect(q.getChunkCount()).toBe(5)
  })

  it("should handle empty chunk array", () => {
    q.insertChunks([])
    expect(q.getChunkCount()).toBe(0)
  })

  it("should get all chunks as rowid/id/content tuples", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 2))

    const all = q.getAllChunks()
    expect(all).toHaveLength(2)
    expect(all[0]).toHaveProperty("rowid")
    expect(all[0]).toHaveProperty("id")
    expect(all[0]).toHaveProperty("content")
  })
})

describe("Query layer — embedding operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createChunkId = bid.createChunkId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert an embedding and search for it", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    const vec = makeVector(768, 0.5)
    q.insertEmbedding(createChunkId("chunk-0"), vec)

    const results = q.searchSimilar(vec, 5)
    expect(results).toHaveLength(1)
    expect(results[0].chunk.id).toBe("chunk-0")
  })

  it("should throw on dimension mismatch in insertEmbedding", () => {
    expect(() => {
      q.insertEmbedding(createChunkId("chunk-x"), makeVector(128, 0.5))
    }).toThrow("Embedding dimension mismatch")
  })

  it("should throw on dimension mismatch in searchSimilar", () => {
    expect(() => {
      q.searchSimilar(makeVector(128, 0.5), 5)
    }).toThrow("Query dimension mismatch")
  })

  it("should return empty array when no vectors match", () => {
    const results = q.searchSimilar(makeVector(768, 0.1), 5)
    expect(results).toEqual([])
  })
})

describe("Query layer — study card operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createChunkId = bid.createChunkId
    createCardId = bid.createCardId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert and retrieve a study card", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    const card = {
      id: createCardId("card-1"),
      documentId: createDocumentId("doc-1"),
      chunkId: createChunkId("chunk-0"),
      question: "What is 2+2?",
      answer: "4",
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
    }
    q.insertStudyCard(card)

    const retrieved = q.getStudyCard(createCardId("card-1"))
    expect(retrieved).toBeDefined()
    expect(retrieved!.question).toBe("What is 2+2?")
  })

  it("should return due cards", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    const pastDue = {
      id: createCardId("card-due"),
      documentId: createDocumentId("doc-1"),
      chunkId: createChunkId("chunk-0"),
      question: "Past due?",
      answer: "Yes",
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      dueDate: new Date("2020-01-01").toISOString(),
      createdAt: new Date("2020-01-01").toISOString(),
    }
    q.insertStudyCard(pastDue)

    const due = q.getDueCards()
    expect(due).toHaveLength(1)
    expect(due[0].id).toBe("card-due")
  })

  it("should update a study card review", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    const card = {
      id: createCardId("card-1"),
      documentId: createDocumentId("doc-1"),
      chunkId: createChunkId("chunk-0"),
      question: "Q",
      answer: "A",
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      dueDate: new Date("2020-01-01").toISOString(),
      createdAt: new Date("2020-01-01").toISOString(),
    }
    q.insertStudyCard(card)

    const futureDate = new Date(Date.now() + 86400000).toISOString()
    q.updateStudyCardReview(createCardId("card-1"), 3.0, 5, 2, futureDate)

    const updated = q.getStudyCard(createCardId("card-1"))
    expect(updated!.easeFactor).toBe(3.0)
    expect(updated!.interval).toBe(5)
    expect(updated!.repetitions).toBe(2)
  })

  it("should limit due cards with limit parameter", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 3))

    for (let i = 0; i < 3; i++) {
      q.insertStudyCard({
        id: createCardId(`card-${i}`),
        documentId: createDocumentId("doc-1"),
        chunkId: createChunkId(`chunk-${i}`),
        question: `Q${i}`,
        answer: `A${i}`,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        dueDate: new Date("2020-01-01").toISOString(),
        createdAt: new Date("2020-01-01").toISOString(),
      })
    }

    const limited = q.getDueCards(2)
    expect(limited).toHaveLength(2)
  })
})

describe("Query layer — quiz operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createQuizId = bid.createQuizId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert and retrieve a quiz", () => {
    const quiz: Quiz = {
      id: createQuizId("quiz-1"),
      documentIds: [createDocumentId("doc-1")],
      questions: [{ id: "q1", type: "multiple_choice", prompt: "What is X?", options: ["A", "B"], answer: "A" }],
      answerKeys: { q1: "A" },
      createdAt: new Date("2025-01-01"),
    }
    q.insertQuiz(quiz)

    const retrieved = q.getQuiz(createQuizId("quiz-1"))
    expect(retrieved).toBeDefined()
    expect(retrieved!.questions).toHaveLength(1)
    expect(retrieved!.questions[0].prompt).toBe("What is X?")
  })

  it("should return undefined for non-existent quiz", () => {
    const result = q.getQuiz(createQuizId("nonexistent"))
    expect(result).toBeUndefined()
  })
})

describe("Query layer — exam operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createExamId = bid.createExamId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should upsert a new exam session", () => {
    q.upsertExamSession("exam-session-1", "exam-1", new Date().toISOString())

    const session = q.getExamSessionByExamId(createExamId("exam-1"))
    expect(session).toBeDefined()
    expect(session!.examId).toBe("exam-1")
  })

  it("should update an existing exam session on second upsert", () => {
    q.upsertExamSession("exam-session-1", "exam-1", new Date("2020-01-01").toISOString())
    const laterDate = new Date("2025-06-01").toISOString()
    q.upsertExamSession("exam-session-1", "exam-1", laterDate)

    const session = q.getExamSessionByExamId(createExamId("exam-1"))
    expect(session!.startedAt.toISOString()).toBe(laterDate)
  })

  it("should update exam submission", () => {
    q.upsertExamSession("exam-session-1", "exam-1", new Date().toISOString())
    // updateExamSubmission expects the exam_id (not the row id) in its first parameter
    q.updateExamSubmission(createExamId("exam-1"), 85, new Date().toISOString(), JSON.stringify({ q1: "A" }))

    const session = q.getExamSessionByExamId(createExamId("exam-1"))
    expect(session!.score).toBe(85)
    expect(session!.answers).toEqual({ q1: "A" })
  })

  it("should return undefined for non-existent exam", () => {
    const result = q.getExamSessionByExamId(createExamId("nonexistent"))
    expect(result).toBeUndefined()
  })
})

describe("Query layer — graph operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createChunkId = bid.createChunkId
    createEntityId = bid.createEntityId
    createRelationshipId = bid.createRelationshipId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should store graph data (entities + relationships) and get entity by ID", () => {
    // Insert a doc + chunk first (FK constraint)
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    const entities = makeEntities("chunk-0")
    const relationships = makeRelationships()

    q.storeGraphData(entities, relationships)

    const retrieved = q.getEntity(createEntityId("entity-1"))
    expect(retrieved).toBeDefined()
    expect(retrieved!.label).toBe("Test Concept")
  })

  it("should return undefined for non-existent entity", () => {
    const retrieved = q.getEntity(createEntityId("nonexistent"))
    expect(retrieved).toBeUndefined()
  })

  it("should search entities by label text", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))
    q.storeGraphData(makeEntities("chunk-0"), [])

    const results = q.searchEntities("Concept")
    expect(results).toHaveLength(1)
    expect(results[0].label).toBe("Test Concept")
  })

  it("should get relationships for an entity", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))
    q.storeGraphData(makeEntities("chunk-0"), makeRelationships())

    const rels = q.getRelationshipsForEntity(createEntityId("entity-1"))
    expect(rels).toHaveLength(1)
    expect(rels[0].type).toBe("defined_by")
  })

  it("should get neighbor entities via relationships", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))
    q.storeGraphData(makeEntities("chunk-0"), makeRelationships())

    // Pass the source entity as excludeIds to get only its neighbors
    const neighbors = q.getNeighborEntities(["entity-1"], ["entity-1"])
    expect(neighbors).toHaveLength(1)
    expect(neighbors[0].label).toBe("Test Person")
  })

  it("should get neighbor IDs for an entity", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))
    q.storeGraphData(makeEntities("chunk-0"), makeRelationships())

    const ids = q.getNeighborIds("entity-1")
    expect(ids).toContain("entity-2")
  })

  it("should find path between entities (via BFS)", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    // Create a chain: entity-1 → entity-2 → entity-3
    const entities: Entity[] = [
      {
        id: createEntityId("entity-1"),
        label: "Alpha",
        type: "concept",
        description: "First",
        chunkId: createChunkId("chunk-0"),
        metadata: {},
      },
      {
        id: createEntityId("entity-2"),
        label: "Beta",
        type: "concept",
        description: "Second",
        chunkId: createChunkId("chunk-0"),
        metadata: {},
      },
      {
        id: createEntityId("entity-3"),
        label: "Gamma",
        type: "concept",
        description: "Third",
        chunkId: createChunkId("chunk-0"),
        metadata: {},
      },
    ]
    const relationships: Relationship[] = [
      {
        id: createRelationshipId("rel-1"),
        fromEntityId: createEntityId("entity-1"),
        toEntityId: createEntityId("entity-2"),
        type: "depends_on",
        chunkId: createChunkId("chunk-0"),
        confidence: 1.0,
      },
      {
        id: createRelationshipId("rel-2"),
        fromEntityId: createEntityId("entity-2"),
        toEntityId: createEntityId("entity-3"),
        type: "depends_on",
        chunkId: createChunkId("chunk-0"),
        confidence: 1.0,
      },
    ]
    q.storeGraphData(entities, relationships)

    // Find path: start at entity-1, BFS to entity-3
    // getNeighborIds on entity-1 should return entity-2
    const hop1 = q.getNeighborIds("entity-1")
    expect(hop1).toContain("entity-2")

    // getNeighborIds on entity-2 should return entity-1 and entity-3
    const hop2 = q.getNeighborIds("entity-2")
    expect(hop2).toContain("entity-3")
    expect(hop2).toContain("entity-1")

    // getNeighbors of entity-2 excluding entity-1 returns entity-2 and entity-3
    const neighborsOf1 = q.getNeighborEntities(["entity-2"], ["entity-1"])
    expect(neighborsOf1).toHaveLength(2)
    const labels = neighborsOf1.map((e: Entity) => e.label)
    expect(labels).toContain("Beta")
    expect(labels).toContain("Gamma")
  })

  it("should store graph data with auto-stub chunk IDs", () => {
    // storeGraphData should auto-create chunk stubs for FK constraints
    const entities = makeEntities("chunk-auto")
    q.storeGraphData(entities, [])

    const retrieved = q.getEntity(createEntityId("entity-1"))
    expect(retrieved).toBeDefined()
    expect(retrieved!.label).toBe("Test Concept")
  })
})

describe("Query layer — FTS operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    createChunkId = bid.createChunkId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert FTS rows and search them", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    // Get the rowid of the inserted chunk
    const chunks = q.getAllChunks()
    expect(chunks).toHaveLength(1)

    q.insertFTSRow(chunks[0].rowid, chunks[0].id, chunks[0].content)

    const results = q.ftsSearch("Content", 10)
    expect(results).toHaveLength(1)
    expect((results[0] as Record<string, unknown>).chunk_id as string).toBe("chunk-0")
  })

  it("should get FTS count", () => {
    expect(q.getFTSCount()).toBe(0)
  })

  it("should clear FTS table", () => {
    const doc = makeDoc()
    q.insertDocument(doc)
    q.insertChunks(makeChunks("doc-1", 1))

    const chunks = q.getAllChunks()
    q.insertFTSRow(chunks[0].rowid, chunks[0].id, chunks[0].content)
    expect(q.getFTSCount()).toBe(1)

    q.clearFTS()
    expect(q.getFTSCount()).toBe(0)
  })

  it("should handle empty FTS search results", () => {
    const results = q.ftsSearch("nonexistent", 10)
    expect(results).toEqual([])
  })
})
