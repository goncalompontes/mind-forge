import { describe, it, expect } from "vitest"
import { ZodError } from "zod"
import {
  IngestInputSchema,
  QueryInputSchema,
  GenerateInputSchema,
  SummarizeInputSchema,
} from "../../src/lib/schemas.js"

describe("IngestInputSchema", () => {
  it("parses valid input with sources array (single source)", () => {
    const result = IngestInputSchema.parse({ sources: ["/path/to/doc.pdf"] })
    expect(result.sources).toEqual(["/path/to/doc.pdf"])
    // Defaults
    expect(result.chunkSize).toBe(1000)
    expect(result.mode).toBe("create")
    expect(result.format).toBeUndefined()
    expect(result.ocrLang).toBeUndefined()
    expect(result.tags).toBeUndefined()
  })

  it("parses valid input with multiple sources", () => {
    const result = IngestInputSchema.parse({
      sources: ["/tmp/a.md", "/tmp/b.pdf", "/tmp/c.docx"],
    })
    expect(result.sources).toEqual(["/tmp/a.md", "/tmp/b.pdf", "/tmp/c.docx"])
  })

  it("parses valid input with pattern", () => {
    const result = IngestInputSchema.parse({ pattern: "/tmp/docs/*.md" })
    expect(result.pattern).toBe("/tmp/docs/*.md")
  })

  it("parses valid input with all fields including tags", () => {
    const result = IngestInputSchema.parse({
      sources: ["https://example.com"],
      format: "url",
      ocrLang: "por",
      chunkSize: 500,
      mode: "replace",
      tags: ["important", "reference"],
    })
    expect(result.sources).toEqual(["https://example.com"])
    expect(result.format).toBe("url")
    expect(result.ocrLang).toBe("por")
    expect(result.chunkSize).toBe(500)
    expect(result.mode).toBe("replace")
    expect(result.tags).toEqual(["important", "reference"])
  })

  it("rejects when both sources and pattern are provided", () => {
    expect(() =>
      IngestInputSchema.parse({
        sources: ["/tmp/a.md"],
        pattern: "/tmp/*.md",
      }),
    ).toThrow(/both/i)
  })

  it("rejects when neither sources nor pattern is provided", () => {
    expect(() => IngestInputSchema.parse({})).toThrow(
      /Either sources.*or pattern must be provided/i,
    )
  })

  it("rejects empty sources array", () => {
    expect(() => IngestInputSchema.parse({ sources: [] })).toThrow(ZodError)
  })

  it("rejects empty pattern string", () => {
    expect(() => IngestInputSchema.parse({ pattern: "" })).toThrow(ZodError)
  })

  it("rejects invalid format enum", () => {
    expect(() =>
      IngestInputSchema.parse({ sources: ["x"], format: "txt" }),
    ).toThrow(ZodError)
  })

  it("rejects negative chunkSize", () => {
    expect(() =>
      IngestInputSchema.parse({ sources: ["x"], chunkSize: -1 }),
    ).toThrow(ZodError)
  })

  it("rejects chunkSize over 10000", () => {
    expect(() =>
      IngestInputSchema.parse({ sources: ["x"], chunkSize: 99999 }),
    ).toThrow(ZodError)
  })

  it("rejects non-integer chunkSize", () => {
    expect(() =>
      IngestInputSchema.parse({ sources: ["x"], chunkSize: 100.5 }),
    ).toThrow(ZodError)
  })

  it("rejects invalid mode enum", () => {
    expect(() =>
      IngestInputSchema.parse({ sources: ["x"], mode: "delete" }),
    ).toThrow(ZodError)
  })

  it("applies defaults for undefined optional fields", () => {
    const result = IngestInputSchema.parse({ sources: ["x"] })
    expect(result.chunkSize).toBe(1000)
    expect(result.mode).toBe("create")
  })

  it("accepts tags as empty array", () => {
    const result = IngestInputSchema.parse({
      sources: ["x"],
      tags: [],
    })
    expect(result.tags).toEqual([])
  })
})

describe("QueryInputSchema", () => {
  it("parses valid input with only query", () => {
    const result = QueryInputSchema.parse({ query: "test query" })
    expect(result.query).toBe("test query")
    expect(result.filters).toBeUndefined()
  })

  it("parses valid input with filters including tags", () => {
    const result = QueryInputSchema.parse({
      query: "machine learning",
      filters: {
        documentIds: ["doc-1", "doc-2"],
        entityTypes: ["concept", "term"],
        limit: 5,
        minScore: 0.5,
        tags: ["important", "reference"],
      },
    })
    expect(result.query).toBe("machine learning")
    expect(result.filters?.documentIds).toEqual(["doc-1", "doc-2"])
    expect(result.filters?.entityTypes).toEqual(["concept", "term"])
    expect(result.filters?.tags).toEqual(["important", "reference"])
  })

  it("applies defaults for filters sub-fields", () => {
    const result = QueryInputSchema.parse({
      query: "test",
      filters: {},
    })
    expect(result.filters?.limit).toBe(10)
    expect(result.filters?.minScore).toBe(0)
  })

  it("rejects empty query", () => {
    expect(() => QueryInputSchema.parse({ query: "" })).toThrow(ZodError)
  })

  it("rejects missing query", () => {
    expect(() => QueryInputSchema.parse({})).toThrow(ZodError)
  })

  it("rejects limit > 100", () => {
    expect(() =>
      QueryInputSchema.parse({ query: "x", filters: { limit: 200 } }),
    ).toThrow(ZodError)
  })

  it("rejects negative limit", () => {
    expect(() =>
      QueryInputSchema.parse({ query: "x", filters: { limit: -1 } }),
    ).toThrow(ZodError)
  })

  it("rejects minScore above 1", () => {
    expect(() =>
      QueryInputSchema.parse({ query: "x", filters: { minScore: 1.5 } }),
    ).toThrow(ZodError)
  })

  it("rejects minScore below 0", () => {
    expect(() =>
      QueryInputSchema.parse({ query: "x", filters: { minScore: -0.1 } }),
    ).toThrow(ZodError)
  })

  it("accepts valid minScore boundary values", () => {
    const r1 = QueryInputSchema.parse({ query: "x", filters: { minScore: 0 } })
    expect(r1.filters?.minScore).toBe(0)
    const r2 = QueryInputSchema.parse({ query: "x", filters: { minScore: 1 } })
    expect(r2.filters?.minScore).toBe(1)
  })
})

describe("GenerateInputSchema", () => {
  it("parses valid cards generation", () => {
    const result = GenerateInputSchema.parse({
      type: "cards",
      documentIds: ["doc-1"],
    })
    expect(result.type).toBe("cards")
    expect(result.documentIds).toEqual(["doc-1"])
    expect(result.count).toBeUndefined()
    expect(result.durationMinutes).toBeUndefined()
  })

  it("parses valid exam generation with optional fields", () => {
    const result = GenerateInputSchema.parse({
      type: "exam",
      documentIds: ["doc-1", "doc-2"],
      count: 15,
      durationMinutes: 60,
    })
    expect(result.type).toBe("exam")
    expect(result.count).toBe(15)
    expect(result.durationMinutes).toBe(60)
  })

  it("rejects empty type", () => {
    expect(() => GenerateInputSchema.parse({ type: "", documentIds: ["x"] })).toThrow(ZodError)
  })

  it("rejects invalid type enum", () => {
    expect(() =>
      GenerateInputSchema.parse({ type: "invalid", documentIds: ["x"] }),
    ).toThrow(ZodError)
  })

  it("rejects empty documentIds", () => {
    expect(() =>
      GenerateInputSchema.parse({ type: "quiz", documentIds: [] }),
    ).toThrow(ZodError)
  })

  it("rejects missing documentIds", () => {
    expect(() => GenerateInputSchema.parse({ type: "quiz" })).toThrow(ZodError)
  })

  it("rejects count over 50", () => {
    expect(() =>
      GenerateInputSchema.parse({ type: "quiz", documentIds: ["x"], count: 100 }),
    ).toThrow(ZodError)
  })

  it("rejects negative count", () => {
    expect(() =>
      GenerateInputSchema.parse({ type: "quiz", documentIds: ["x"], count: -1 }),
    ).toThrow(ZodError)
  })

  it("rejects non-integer count", () => {
    expect(() =>
      GenerateInputSchema.parse({ type: "quiz", documentIds: ["x"], count: 3.5 }),
    ).toThrow(ZodError)
  })

  it("rejects durationMinutes over 180", () => {
    expect(() =>
      GenerateInputSchema.parse({
        type: "exam",
        documentIds: ["x"],
        durationMinutes: 200,
      }),
    ).toThrow(ZodError)
  })

  it("rejects negative durationMinutes", () => {
    expect(() =>
      GenerateInputSchema.parse({
        type: "exam",
        documentIds: ["x"],
        durationMinutes: -5,
      }),
    ).toThrow(ZodError)
  })

  it("rejects non-integer durationMinutes", () => {
    expect(() =>
      GenerateInputSchema.parse({
        type: "exam",
        documentIds: ["x"],
        durationMinutes: 45.5,
      }),
    ).toThrow(ZodError)
  })
})

describe("SummarizeInputSchema", () => {
  it("parses valid input with documentIds only", () => {
    const result = SummarizeInputSchema.parse({ documentIds: ["doc-1"] })
    expect(result.documentIds).toEqual(["doc-1"])
    expect(result.tags).toBeUndefined()
    expect(result.format).toBe("both")
    expect(result.maxLength).toBe(2000)
  })

  it("parses valid input with tags only", () => {
    const result = SummarizeInputSchema.parse({ tags: ["important", "reference"] })
    expect(result.tags).toEqual(["important", "reference"])
    expect(result.documentIds).toBeUndefined()
  })

  it("rejects when both documentIds and tags are provided", () => {
    expect(() =>
      SummarizeInputSchema.parse({
        documentIds: ["doc-1"],
        tags: ["important"],
      }),
    ).toThrow(/Provide either documentIds.*or tags, not both/i)
  })

  it("rejects when neither documentIds nor tags is provided", () => {
    expect(() => SummarizeInputSchema.parse({})).toThrow(
      /Either documentIds.*or tags must be provided/i,
    )
  })

  it("accepts valid format enum values", () => {
    const r1 = SummarizeInputSchema.parse({ documentIds: ["x"], format: "structured" })
    expect(r1.format).toBe("structured")
    const r2 = SummarizeInputSchema.parse({ documentIds: ["x"], format: "narrative" })
    expect(r2.format).toBe("narrative")
    const r3 = SummarizeInputSchema.parse({ documentIds: ["x"], format: "both" })
    expect(r3.format).toBe("both")
  })

  it("rejects invalid format enum", () => {
    expect(() =>
      SummarizeInputSchema.parse({
        documentIds: ["x"],
        format: "invalid",
      }),
    ).toThrow(ZodError)
  })

  it("rejects negative maxLength", () => {
    expect(() =>
      SummarizeInputSchema.parse({ documentIds: ["x"], maxLength: -1 }),
    ).toThrow(ZodError)
  })

  it("rejects maxLength over 10000", () => {
    expect(() =>
      SummarizeInputSchema.parse({ documentIds: ["x"], maxLength: 99999 }),
    ).toThrow(ZodError)
  })

  it("rejects non-integer maxLength", () => {
    expect(() =>
      SummarizeInputSchema.parse({ documentIds: ["x"], maxLength: 100.5 }),
    ).toThrow(ZodError)
  })

  it("accepts valid maxLength boundary values", () => {
    const r1 = SummarizeInputSchema.parse({ documentIds: ["x"], maxLength: 1 })
    expect(r1.maxLength).toBe(1)
    const r2 = SummarizeInputSchema.parse({ documentIds: ["x"], maxLength: 10000 })
    expect(r2.maxLength).toBe(10000)
  })

  it("applies defaults for optional fields", () => {
    const result = SummarizeInputSchema.parse({ documentIds: ["x"] })
    expect(result.format).toBe("both")
    expect(result.maxLength).toBe(2000)
  })
})
