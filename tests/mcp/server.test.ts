import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"

// ── Shared handler store ──────────────────────────────────────────────────
// vi.hoisted is required because vi.mock factories are hoisted above imports.

const { handlerStore } = vi.hoisted(() => {
  const handlers: Array<{ schema: any; handler: any }> = []
  return {
    handlerStore: {
      push: (schema: any, handler: any) => handlers.push({ schema, handler }),
      /** Return the LAST registered handler — server.ts registers
       *  ListToolsRequestSchema first, then CallToolRequestSchema. */
      getCallToolHandler: (): any | null =>
        handlers.length > 0 ? handlers[handlers.length - 1].handler : null,
      clear: () => (handlers.length = 0),
    },
  }
})

// ── Mock @modelcontextprotocol/sdk ───────────────────────────────────────

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: class MockServer {
    constructor() {
      // no-op
    }
    setRequestHandler(schema: any, handler: any) {
      handlerStore.push(schema, handler)
    }
    connect() {
      return Promise.resolve()
    }
  },
}))

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}))

// ── Mock IngestTool ──────────────────────────────────────────────────────

const mockIngestResult = vi.hoisted(() => ({
  documentId: "doc-ingest-1",
  title: "Ingested Document",
  format: "txt",
  chunkCount: 3,
  entityCount: 2,
  relationshipCount: 1,
  ingestedAt: "2025-01-01T00:00:00.000Z",
}))

vi.mock("../../src/mcp/ingest.tool.js", () => ({
  IngestTool: class MockIngestTool {
    execute(_input: any) {
      return Promise.resolve(mockIngestResult)
    }
  },
}))

// ── Mock QueryTool ───────────────────────────────────────────────────────

const mockQueryResults = vi.hoisted(() => [
  {
    chunk: {
      id: "chunk-1",
      documentId: "doc-1",
      index: 0,
      content: "Sample content for testing",
      tokenCount: 5,
    },
    score: 0.95,
    source: {
      id: "doc-1",
      filename: "test.txt",
      format: "txt",
      title: "Test Document",
      author: "Author",
      text: "Sample content for testing",
      metadata: {},
      ingestedAt: new Date("2025-01-01"),
    },
    entities: [
      {
        id: "e1",
        label: "Concept",
        type: "concept",
        description: "A test concept",
        chunkId: "chunk-1",
        metadata: {},
      },
    ],
    relationships: [],
  },
])

vi.mock("../../src/mcp/query.tool.js", () => ({
  QueryTool: class MockQueryTool {
    constructor() {
      // no-op
    }
    execute(_input: any) {
      return Promise.resolve(mockQueryResults)
    }
  },
}))

// ── Mock store/database ──────────────────────────────────────────────────

const fakeChunks = vi.hoisted(() => [
  { id: "chunk-1", document_id: "doc-1", chunk_index: 0, content: "Test content one", token_count: 5 },
  { id: "chunk-2", document_id: "doc-1", chunk_index: 1, content: "Test content two", token_count: 5 },
])

const mockDb = vi.hoisted(() => ({
  prepare: vi.fn((sql: string) => ({
    all: vi.fn((..._params: any[]) => {
      if (sql.includes("SELECT * FROM chunks")) return fakeChunks
      return []
    }),
    get: vi.fn(() => ({ cnt: 0 })),
    run: vi.fn(),
  })),
  exec: vi.fn(),
  transaction: vi.fn((fn: (...args: any[]) => any) => fn()),
}))

vi.mock("../../src/store/database.js", () => ({
  getOrInitDatabase: vi.fn(),
  getDatabase: vi.fn(() => mockDb),
}))

// ── Mock study modules ───────────────────────────────────────────────────

vi.mock("../../src/study/cards.js", () => ({
  createCards: vi.fn(() => [
    { id: "card-1", documentId: "doc-1", chunkId: "chunk-1", question: "What is X?", answer: "X is Y" },
    { id: "card-2", documentId: "doc-1", chunkId: "chunk-2", question: "What is Z?", answer: "Z is W" },
  ]),
  getDueCards: vi.fn((_limit?: number) => [
    {
      id: "card-due-1",
      documentId: "doc-1",
      chunkId: "chunk-1",
      question: "Review Q?",
      answer: "Review A",
      easeFactor: 2.5,
      interval: 1,
      repetitions: 0,
      dueDate: new Date("2025-01-01"),
      createdAt: new Date("2025-01-01"),
    },
  ]),
}))

vi.mock("../../src/study/quiz.js", () => ({
  generateQuiz: vi.fn(() => ({
    id: "quiz-1",
    documentIds: ["doc-1"],
    questions: [
      {
        id: "q-1",
        type: "multiple_choice",
        prompt: "What is the capital of France?",
        options: ["Paris", "London", "Berlin", "Madrid"],
        answer: "Paris",
      },
    ],
    answerKeys: { "q-1": "Paris" },
    createdAt: new Date("2025-01-01"),
  })),
  gradeQuiz: vi.fn(),
}))

vi.mock("../../src/study/exam.js", () => ({
  createExam: vi.fn(() => ({
    id: "exam-1",
    documentIds: ["doc-1"],
    questions: [
      {
        id: "eq-1",
        type: "multiple_choice",
        prompt: "What is 2+2?",
        options: ["3", "4", "5", "6"],
        answer: "4",
      },
    ],
    answerKeys: { "eq-1": "4" },
    config: { questionCount: 10, durationMinutes: 30 },
  })),
  startExam: vi.fn(),
  submitExam: vi.fn(),
  getExamResult: vi.fn(),
}))

// ── Tests ────────────────────────────────────────────────────────────────

describe("Mind Forge MCP server", () => {
  let callToolHandler: ((request: any) => Promise<any>) | null = null

  // Import the server module ONCE (ESM is cached, so re-importing won't
  // re-register handlers). We do it in beforeAll to ensure the mock DB
  // counter is also stable.
  beforeAll(async () => {
    await import("../../src/mcp/server.js")
    callToolHandler = handlerStore.getCallToolHandler()
  })

  beforeEach(() => {
    mockDb.prepare.mockClear()
  })

  describe("CallTool handler registration", () => {
    it("should register a handler for CallToolRequestSchema", () => {
      expect(callToolHandler).toBeDefined()
      expect(typeof callToolHandler).toBe("function")
    })
  })

  describe("ingest tool", () => {
    it("should call IngestTool with correct args and return formatted result", async () => {
      const response = await callToolHandler!({
        params: {
          name: "ingest",
          arguments: { source: "/tmp/test.txt", format: "txt", ocrLang: "eng", chunkSize: 500, mode: "create" },
        },
      })

      expect(response.content).toBeDefined()
      expect(response.content.length).toBe(1)
      expect(response.content[0].type).toBe("text")
      expect(response.content[0].text).toContain("Ingested: Ingested Document")
      expect(response.content[0].text).toContain("doc-ingest-1")
      expect(response.content[0].text).toContain("Chunks: 3")
      expect(response.content[0].text).toContain("Entities: 2")
      expect(response.content[0].text).toContain("Relationships: 1")
    })

    it("should return error when 'source' argument is missing", async () => {
      const response = await callToolHandler!({
        params: { name: "ingest", arguments: {} },
      })

      expect(response.content[0].text).toContain("Error: 'source' is required")
    })
  })

  describe("query tool", () => {
    it("should call QueryTool with correct args and return formatted results", async () => {
      const response = await callToolHandler!({
        params: {
          name: "query",
          arguments: {
            query: "test query",
            filters: { documentIds: ["doc-1"], entityTypes: ["concept"], limit: 5, minScore: 0.5 },
          },
        },
      })

      expect(response.content[0].text).toContain("Found 1 result(s)")
      expect(response.content[0].text).toContain("Score: 95.0%")
      expect(response.content[0].text).toContain("Test Document")
      expect(response.content[0].text).toContain("Sample content for testing")
      expect(response.content[0].text).toContain("Entities: Concept (concept)")
    })

    it("should return 'No results found' when query returns empty", async () => {
      const snapshot = mockQueryResults.splice(0, mockQueryResults.length)

      const response = await callToolHandler!({
        params: { name: "query", arguments: { query: "nothing" } },
      })

      expect(response.content[0].text).toBe("No results found.")

      // Restore
      mockQueryResults.push(...snapshot)
    })
  })

  describe("generate tool", () => {
    it('should route to "cards" handler and return flash cards', async () => {
      const response = await callToolHandler!({
        params: { name: "generate", arguments: { type: "cards", documentIds: ["doc-1"] } },
      })

      const parsed = JSON.parse(response.content[0].text)
      expect(parsed.type).toBe("cards")
      expect(parsed.count).toBeGreaterThan(0)
      expect(parsed.cards[0]).toHaveProperty("question")
      expect(parsed.cards[0]).toHaveProperty("answer")
    })

    it('should route to "quiz" handler and return quiz questions', async () => {
      const response = await callToolHandler!({
        params: { name: "generate", arguments: { type: "quiz", documentIds: ["doc-1"] } },
      })

      const parsed = JSON.parse(response.content[0].text)
      expect(parsed.type).toBe("quiz")
      expect(parsed.id).toBe("quiz-1")
      expect(parsed.questions.length).toBeGreaterThan(0)
      expect(parsed.questions[0]).toHaveProperty("prompt")
      expect(parsed.questions[0]).toHaveProperty("options")
    })

    it('should route to "exam" handler and return exam questions', async () => {
      const response = await callToolHandler!({
        params: {
          name: "generate",
          arguments: { type: "exam", documentIds: ["doc-1"], questionCount: 10, durationMinutes: 30 },
        },
      })

      const parsed = JSON.parse(response.content[0].text)
      expect(parsed.type).toBe("exam")
      expect(parsed.id).toBe("exam-1")
      expect(parsed.questions.length).toBeGreaterThan(0)
      expect(parsed.questions[0]).toHaveProperty("prompt")
    })

    it('should route to "review" handler and return due cards', async () => {
      const response = await callToolHandler!({
        params: { name: "generate", arguments: { type: "review", documentIds: ["doc-1"], limit: 10 } },
      })

      const parsed = JSON.parse(response.content[0].text)
      expect(parsed.type).toBe("review")
      expect(parsed.dueCount).toBeGreaterThan(0)
      expect(parsed.cards[0]).toHaveProperty("question")
      expect(parsed.cards[0]).toHaveProperty("answer")
      expect(parsed.cards[0]).toHaveProperty("dueDate")
    })

    it("should return error for unknown generate type", async () => {
      const response = await callToolHandler!({
        params: { name: "generate", arguments: { type: "unknown_type", documentIds: ["doc-1"] } },
      })

      expect(response.content[0].text).toContain("Unknown generate type")
      expect(response.content[0].text).toContain("cards, quiz, exam, review")
    })
  })

  describe("unknown tool", () => {
    it("should throw error for unknown tool name", async () => {
      await expect(
        callToolHandler!({
          params: { name: "nonexistent_tool", arguments: {} },
        }),
      ).rejects.toThrow("Unknown tool: nonexistent_tool")
    })
  })
})
