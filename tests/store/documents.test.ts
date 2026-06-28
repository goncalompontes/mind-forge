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

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-docs-test-"))
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
    id: "doc-1",
    filename: "test.md",
    format: "md",
    title: "Test Document",
    text: "Hello world",
    metadata: { source: "test" },
    ingestedAt: new Date("2025-01-01"),
    ...overrides,
  }
}

function makeChunks(
  docId: string,
  count: number = 3,
): DocumentChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    documentId: docId,
    index: i,
    content: `Content ${i}`,
    tokenCount: 10,
  }))
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Document CRUD", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    docModule = await import("../../src/store/documents.js")
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  it("should insert a document", () => {
    const doc = makeDoc()
    docModule.insertDocument(doc)

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved).toBeDefined()
    expect(retrieved!.id).toBe("doc-1")
    expect(retrieved!.title).toBe("Test Document")
    expect(retrieved!.format).toBe("md")
  })

  it("should insert chunks for a document", () => {
    const doc = makeDoc()
    docModule.insertDocument(doc)

    const chunks = makeChunks("doc-1", 3)
    docModule.insertChunks(chunks)

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved).toBeDefined()
    expect(retrieved!.chunks).toHaveLength(3)
    expect(retrieved!.chunks[0].index).toBe(0)
    expect(retrieved!.chunks[1].index).toBe(1)
    expect(retrieved!.chunks[2].index).toBe(2)
  })

  it("should list all documents", () => {
    const doc1 = makeDoc({ id: "doc-1", title: "First" })
    const doc2 = makeDoc({ id: "doc-2", title: "Second" })
    docModule.insertDocument(doc1)
    docModule.insertDocument(doc2)

    const docs = docModule.listDocuments()
    expect(docs).toHaveLength(2)
    expect(docs.map((d) => d.id)).toContain("doc-1")
    expect(docs.map((d) => d.id)).toContain("doc-2")
  })

  it("should return chunks in index order", () => {
    const doc = makeDoc()
    docModule.insertDocument(doc)

    const chunks = [
      { id: "chunk-2", documentId: "doc-1", index: 2, content: "C2", tokenCount: 1 },
      { id: "chunk-0", documentId: "doc-1", index: 0, content: "C0", tokenCount: 1 },
      { id: "chunk-1", documentId: "doc-1", index: 1, content: "C1", tokenCount: 1 },
    ] as DocumentChunk[]
    docModule.insertChunks(chunks)

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved!.chunks.map((c) => c.index)).toEqual([0, 1, 2])
  })

  it("should delete a document and its chunks", () => {
    const doc = makeDoc()
    docModule.insertDocument(doc)
    docModule.insertChunks(makeChunks("doc-1", 2))

    docModule.deleteDocument("doc-1")

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved).toBeNull()
  })

  it("should return empty list when no documents exist", () => {
    const docs = docModule.listDocuments()
    expect(docs).toEqual([])
  })

  it("should handle document with no chunks", () => {
    const doc = makeDoc()
    docModule.insertDocument(doc)

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved).toBeDefined()
    expect(retrieved!.chunks).toEqual([])
  })

  it("should return null for non-existent document", () => {
    const result = docModule.getDocument("nonexistent")
    expect(result).toBeNull()
  })

  it("should store and retrieve metadata as object", () => {
    const doc = makeDoc({
      metadata: { key: "value", nested: { a: 1 } },
    })
    docModule.insertDocument(doc)

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved!.metadata).toEqual({ key: "value", nested: { a: 1 } })
  })

  it("should store and retrieve ingestedAt as Date", () => {
    const date = new Date("2026-06-28T12:00:00Z")
    const doc = makeDoc({ ingestedAt: date })
    docModule.insertDocument(doc)

    const retrieved = docModule.getDocument("doc-1")
    expect(retrieved!.ingestedAt.getTime()).toBe(date.getTime())
  })
})
