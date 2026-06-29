// ── Document Queries: Tag Operations ──────────────────────────────────────
// Tests for tags-related functions in document-queries.ts:
//   - getDocumentsByTags(tags, matchAll)
//   - addTagsToDocument(id, tags)
//   - removeTagsFromDocument(id, tags)
//   - tags parsing in rowToDocument/insertDocument

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { SourceDocument } from "../../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string
let dbPath: string
let dbModule: typeof import("../../src/store/database.js")
let q: typeof import("../../src/store/document-queries.js")
let createDocumentId: (id: string) => string

function setup(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-dq-test-"))
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
    tags: [],
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Document queries — tag operations", () => {
  beforeEach(async () => {
    setup()
    dbModule = await import("../../src/store/database.js")
    q = await import("../../src/store/document-queries.js")
    const bid = await import("../../src/lib/branded-ids.js")
    createDocumentId = bid.createDocumentId
    dbModule.initDatabase(dbPath)
  })

  afterEach(() => {
    cleanup()
  })

  describe("insertDocument with tags", () => {
    it("should store a document with empty tags by default", () => {
      const doc = makeDoc()
      q.insertDocument(doc)

      const db = dbModule.getDatabase()
      const row = db
        .prepare("SELECT * FROM documents WHERE id = ?")
        .get(doc.id) as Record<string, unknown> | undefined
      expect(row).toBeDefined()
      expect(JSON.parse(row!.tags as string)).toEqual([])
    })

    it("should store a document with provided tags", () => {
      const doc = makeDoc({ tags: ["important", "ai", "reference"] })
      q.insertDocument(doc)

      const db = dbModule.getDatabase()
      const row = db
        .prepare("SELECT * FROM documents WHERE id = ?")
        .get(doc.id) as Record<string, unknown> | undefined
      expect(JSON.parse(row!.tags as string)).toEqual(["important", "ai", "reference"])
    })

    it("should include tags in rowToDocument mapping", () => {
      const doc = makeDoc({ tags: ["tag1", "tag2"] })
      q.insertDocument(doc)

      const found = q.findDocumentByFilename(doc.filename)
      expect(found).toBeDefined()
      expect(found!.tags).toEqual(["tag1", "tag2"])
    })
  })

  describe("getDocumentsByTags", () => {
    it("should return documents matching ANY tag (matchAll=false)", () => {
      const doc1 = makeDoc({ id: createDocumentId("doc-a"), filename: "a.md", tags: ["ai", "ml"] })
      const doc2 = makeDoc({ id: createDocumentId("doc-b"), filename: "b.md", tags: ["physics"] })
      const doc3 = makeDoc({ id: createDocumentId("doc-c"), filename: "c.md", tags: ["ml", "physics"] })
      q.insertDocument(doc1)
      q.insertDocument(doc2)
      q.insertDocument(doc3)

      // Match "ai" or "physics" with ANY
      const results = q.getDocumentsByTags(["ai", "physics"], false)
      expect(results).toHaveLength(3)
      const filenames = results.map((d) => d.filename).sort()
      expect(filenames).toEqual(["a.md", "b.md", "c.md"])
    })

    it("should return documents matching ALL tags (matchAll=true)", () => {
      const doc1 = makeDoc({ id: createDocumentId("doc-a"), filename: "a.md", tags: ["ai", "ml"] })
      const doc2 = makeDoc({ id: createDocumentId("doc-b"), filename: "b.md", tags: ["physics"] })
      const doc3 = makeDoc({ id: createDocumentId("doc-c"), filename: "c.md", tags: ["ml", "physics"] })
      q.insertDocument(doc1)
      q.insertDocument(doc2)
      q.insertDocument(doc3)

      // Match both "ml" AND "physics"
      const results = q.getDocumentsByTags(["ml", "physics"], true)
      expect(results).toHaveLength(1)
      expect(results[0].filename).toBe("c.md")
    })

    it("should return documents matching ALL tags when single tag provided", () => {
      const doc1 = makeDoc({ id: createDocumentId("doc-a"), filename: "a.md", tags: ["ai"] })
      const doc2 = makeDoc({ id: createDocumentId("doc-b"), filename: "b.md", tags: ["physics"] })
      q.insertDocument(doc1)
      q.insertDocument(doc2)

      const results = q.getDocumentsByTags(["ai"], true)
      expect(results).toHaveLength(1)
      expect(results[0].filename).toBe("a.md")
    })

    it("should return empty array when no documents match ANY tags", () => {
      const doc = makeDoc({ tags: ["biology"] })
      q.insertDocument(doc)

      const results = q.getDocumentsByTags(["astronomy"], false)
      expect(results).toEqual([])
    })

    it("should return empty array when no documents match ALL tags", () => {
      const doc = makeDoc({ tags: ["ai"] })
      q.insertDocument(doc)

      const results = q.getDocumentsByTags(["ai", "ml"], true)
      expect(results).toEqual([])
    })

    it("should return empty array when tags array is empty", () => {
      const doc = makeDoc()
      q.insertDocument(doc)

      const results = q.getDocumentsByTags([], false)
      expect(results).toEqual([])
    })

    it("should handle documents with no tags (empty array)", () => {
      const doc = makeDoc({ tags: [] })
      q.insertDocument(doc)

      const results = q.getDocumentsByTags(["ai"], false)
      expect(results).toEqual([])
    })
  })

  describe("addTagsToDocument", () => {
    it("should add new tags to a document", () => {
      const doc = makeDoc({ tags: ["existing"] })
      q.insertDocument(doc)

      q.addTagsToDocument(createDocumentId("doc-1"), ["new1", "new2"])

      const updated = q.findDocumentByFilename("test.md")
      expect(updated!.tags).toContain("existing")
      expect(updated!.tags).toContain("new1")
      expect(updated!.tags).toContain("new2")
    })

    it("should not duplicate tags on re-add", () => {
      const doc = makeDoc({ tags: ["tag1"] })
      q.insertDocument(doc)

      q.addTagsToDocument(createDocumentId("doc-1"), ["tag1", "tag2"])

      const updated = q.findDocumentByFilename("test.md")
      expect(updated!.tags).toEqual(["tag1", "tag2"])
    })
  })

  describe("removeTagsFromDocument", () => {
    it("should remove specified tags from a document", () => {
      const doc = makeDoc({ tags: ["keep", "remove1", "remove2"] })
      q.insertDocument(doc)

      q.removeTagsFromDocument(createDocumentId("doc-1"), ["remove1", "remove2"])

      const updated = q.findDocumentByFilename("test.md")
      expect(updated!.tags).toEqual(["keep"])
    })

    it("should do nothing when removing non-existent tags", () => {
      const doc = makeDoc({ tags: ["keep"] })
      q.insertDocument(doc)

      q.removeTagsFromDocument(createDocumentId("doc-1"), ["nonexistent"])

      const updated = q.findDocumentByFilename("test.md")
      expect(updated!.tags).toEqual(["keep"])
    })

    it("should leave empty array when removing all tags", () => {
      const doc = makeDoc({ tags: ["only"] })
      q.insertDocument(doc)

      q.removeTagsFromDocument(createDocumentId("doc-1"), ["only"])

      const updated = q.findDocumentByFilename("test.md")
      expect(updated!.tags).toEqual([])
    })
  })
})
