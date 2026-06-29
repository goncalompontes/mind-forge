import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initDatabase, closeDatabase } from "../../src/store/database.js"
import { insertDocument } from "../../src/store/documents.js"
import type { SourceDocument } from "../../src/types.js"
import { SummarizeTool } from "../../src/mcp/summarize.tool.js"

// ── Test Fixtures ──────────────────────────────────────────────────────────

const DOC_A: SourceDocument = {
  id: "doc-a" as any,
  filename: "ai-overview.md",
  format: "md",
  title: "AI Overview",
  text: "Artificial Intelligence is a branch of computer science that aims to create intelligent machines. Machine Learning is a key subset of AI.",
  metadata: {},
  tags: ["ai", "technology"],
  ingestedAt: new Date("2025-01-01"),
}

const DOC_B: SourceDocument = {
  id: "doc-b" as any,
  filename: "rust-guide.md",
  format: "md",
  title: "Rust Programming Guide",
  text: "Rust is a systems programming language focused on safety, speed, and concurrency. It provides memory safety without a garbage collector.",
  metadata: {},
  tags: ["rust", "programming"],
  ingestedAt: new Date("2025-01-02"),
}

const DOC_C: SourceDocument = {
  id: "doc-c" as any,
  filename: "ml-basics.md",
  format: "md",
  title: "Machine Learning Basics",
  text: "Machine Learning enables computers to learn from data without explicit programming. Supervised learning uses labeled data while unsupervised learning finds patterns in unlabeled data.",
  metadata: {},
  tags: ["ai", "ml"],
  ingestedAt: new Date("2025-01-03"),
}

// ── Helpers ────────────────────────────────────────────────────────────────

function seedDatabase(): void {
  insertDocument(DOC_A)
  insertDocument(DOC_B)
  insertDocument(DOC_C)
}

function createTool(): SummarizeTool {
  return new SummarizeTool(":memory:")
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("SummarizeTool", () => {
  beforeEach(() => {
    initDatabase(":memory:")
    seedDatabase()
  })

  afterEach(() => {
    closeDatabase()
  })

  describe("document ID resolution", () => {
    it("single document ID returns summary with that doc", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
      })

      expect(result.documentIds).toEqual(["doc-a"])
      expect(result.title).toBe("AI Overview")
      expect(result.structured?.sections).toHaveLength(1)
      expect(result.structured!.sections[0].title).toBe("AI Overview")
    })

    it("multiple document IDs returns both docs in sections", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a", "doc-b"],
      })

      expect(result.documentIds).toEqual(["doc-a", "doc-b"])
      expect(result.title).toBe("2 documents")
      expect(result.structured?.sections).toHaveLength(2)
      expect(result.structured!.sections[0].title).toBe("AI Overview")
      expect(result.structured!.sections[1].title).toBe("Rust Programming Guide")
    })
  })

  describe("tag-based document resolution", () => {
    it("returns documents matching a single tag", async () => {
      const tool = createTool()
      const result = await tool.execute({
        tags: ["ai"],
      })

      expect(result.documentIds).toContain("doc-a")
      expect(result.documentIds).toContain("doc-c")
      expect(result.structured?.sections).toHaveLength(2)
    })

    it("returns documents matching multiple tags (any match)", async () => {
      const tool = createTool()
      const result = await tool.execute({
        tags: ["rust", "ml"],
      })

      expect(result.documentIds).toContain("doc-b")
      expect(result.documentIds).toContain("doc-c")
      expect(result.structured?.sections).toHaveLength(2)
    })

    it("returns empty error when no documents match tags", async () => {
      const tool = createTool()
      await expect(
        tool.execute({ tags: ["nonexistent"] }),
      ).rejects.toThrow("No matching documents found")
    })
  })

  describe("format parameter", () => {
    it('format "structured" returns structured only', async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
        format: "structured",
      })

      expect(result.structured).toBeDefined()
      expect(result.narrative).toBeUndefined()
    })

    it('format "narrative" returns narrative only', async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
        format: "narrative",
      })

      expect(result.structured).toBeUndefined()
      expect(result.narrative).toBeDefined()
    })

    it('format "both" returns both', async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
        format: "both",
      })

      expect(result.structured).toBeDefined()
      expect(result.narrative).toBeDefined()
    })

    it('defaults to "both" when format is omitted', async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
      })

      expect(result.structured).toBeDefined()
      expect(result.narrative).toBeDefined()
    })
  })

  describe("error handling", () => {
    it("no matching documents throws error", async () => {
      const tool = createTool()
      await expect(
        tool.execute({ documentIds: ["nonexistent-id"] }),
      ).rejects.toThrow("No matching documents found")
    })

    it("neither documentIds nor tags provided throws error", async () => {
      const tool = createTool()
      await expect(tool.execute({})).rejects.toThrow(
        /Either documentIds.*or tags must be provided/i,
      )
    })
  })

  describe("narrative content", () => {
    it("narrative includes document titles and truncated text", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-b"],
        format: "narrative",
        maxLength: 500,
      })

      expect(result.narrative).toContain("Rust Programming Guide")
      expect(result.narrative).toContain("systems programming language")
      // Should be truncated to maxLength
      expect(result.narrative!.length).toBeLessThanOrEqual(600)
    })

    it("narrative split proportionally for multiple docs", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a", "doc-c"],
        format: "narrative",
        maxLength: 1000,
      })

      expect(result.narrative).toContain("AI Overview")
      expect(result.narrative).toContain("Machine Learning Basics")
      // Each section gets ~500 chars
      expect(result.narrative!.length).toBeLessThanOrEqual(1200)
    })
  })

  describe("structured content", () => {
    it("keyPoints include document metadata", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
        format: "structured",
      })

      const section = result.structured!.sections[0]
      const keyPoints = section.keyPoints.join(" ")
      expect(keyPoints).toContain("AI Overview")
      expect(keyPoints).toContain("md")
      expect(keyPoints).toContain("characters")
      expect(keyPoints).toContain("ai, technology")
    })

    it("documents without tags show 'none'", async () => {
      // Insert a document without tags
      const docUntagged: SourceDocument = {
        id: "doc-untagged" as any,
        filename: "untagged.md",
        format: "md",
        title: "Untagged Document",
        text: "Some content.",
        metadata: {},
        tags: undefined,
        ingestedAt: new Date(),
      }
      insertDocument(docUntagged)

      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-untagged"],
        format: "structured",
      })

      const keyPoints = result.structured!.sections[0].keyPoints.join(" ")
      expect(keyPoints).toContain("none")
    })
  })

  describe("result metadata", () => {
    it("generatedAt is a valid ISO timestamp", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
      })

      expect(result.generatedAt).toBeTruthy()
      expect(() => new Date(result.generatedAt)).not.toThrow()
    })

    it("title uses document title for single doc", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a"],
      })

      expect(result.title).toBe("AI Overview")
    })

    it("title shows count for multiple docs", async () => {
      const tool = createTool()
      const result = await tool.execute({
        documentIds: ["doc-a", "doc-b", "doc-c"],
      })

      expect(result.title).toBe("3 documents")
    })
  })
})
