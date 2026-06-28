import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { QueryTool } from "./query.tool.js"
import { IngestTool } from "./ingest.tool.js"
import { homedir } from "node:os"
import { join } from "node:path"
import { getOrInitDatabase } from "../store/database.js"
import { createCards, getDueCards } from "../study/cards.js"
import { generateQuiz, gradeQuiz } from "../study/quiz.js"
import { createExam, startExam, submitExam, getExamResult } from "../study/exam.js"

const server = new Server(
  { name: "mind-forge", version: "0.1.0" },
  { capabilities: { tools: {} } },
)

// ── Lazy singletons ────────────────────────────────────────────────────────

let queryTool: QueryTool | null = null
let ingestTool: IngestTool | null = null

function getQueryTool(): QueryTool {
  if (!queryTool) {
    const dbPath = process.env.MIND_FORGE_DB_PATH ?? join(homedir(), ".mind-forge", "store.db")
    queryTool = new QueryTool(dbPath)
  }
  return queryTool
}

function getIngestTool(): IngestTool {
  if (!ingestTool) {
    getOrInitDatabase(process.env.MIND_FORGE_DB_PATH ?? join(homedir(), ".mind-forge", "store.db"))
    ingestTool = new IngestTool()
  }
  return ingestTool
}

function ensureDatabase(): void {
  const dbPath = process.env.MIND_FORGE_DB_PATH ?? join(homedir(), ".mind-forge", "store.db")
  getOrInitDatabase(dbPath)
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ingest",
      description: "Ingest a document into the Mind Forge knowledge base for study and querying",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Path, URL, or text content of the document to ingest" },
          format: {
            type: "string",
            description: "Document format (auto-detected if omitted)",
            enum: ["pdf", "docx", "md", "image", "url"],
          },
          ocrLang: {
            type: "string",
            description: "OCR language for image extraction (default: 'eng')",
          },
          chunkSize: {
            type: "number",
            description: "Target chunk size in tokens (default: 1000)",
          },
          mode: {
            type: "string",
            description: "Ingestion mode: 'create' (default, throws on duplicate), 'replace' (delete + re-ingest), or 'append' (add chunks to existing)",
            enum: ["create", "replace", "append"],
          },
        },
        required: ["source"],
      },
    },
    {
      name: "query",
      description: "Query the ingested knowledge base for relevant content and entities",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language query or search terms" },
          filters: {
            type: "object",
            description: "Optional filters to narrow results by document, entity type, etc.",
            properties: {
              documentIds: { type: "array", items: { type: "string" }, description: "Filter by document IDs" },
              entityTypes: {
                type: "array",
                items: { type: "string", enum: ["concept", "person", "date", "term", "formula", "definition"] },
                description: "Filter by entity types",
              },
              limit: { type: "number", description: "Maximum number of results to return" },
              minScore: { type: "number", description: "Minimum relevance score (0.0–1.0)" },
            },
          },
        },
        required: ["query"],
      },
    },
    {
      name: "generate",
      description: "Generate study materials (flash cards, quiz, exam, or review) from ingested documents",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Type of study material to generate",
            enum: ["cards", "quiz", "exam", "review"],
          },
          documentIds: {
            type: "array",
            items: { type: "string" },
            description: "Document IDs to generate materials from",
          },
          questionCount: {
            type: "number",
            description: "Number of questions for quiz/exam (default: 10)",
          },
          durationMinutes: {
            type: "number",
            description: "Duration in minutes for exam mode (default: 30)",
          },
          limit: {
            type: "number",
            description: "Maximum cards to return for review (default: 20)",
          },
        },
        required: ["type", "documentIds"],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  switch (name) {
    case "ingest": {
      const source = String(args?.source ?? "")
      if (!source) {
        return {
          content: [{ type: "text", text: "Error: 'source' is required." }],
        }
      }

      const tool = getIngestTool()
      const result = await tool.execute({
        source,
        format: args?.format ? String(args.format) : undefined,
        ocrLang: args?.ocrLang ? String(args.ocrLang) : undefined,
        chunkSize: args?.chunkSize != null ? Number(args.chunkSize) : undefined,
        mode: (args?.mode as "create" | "replace" | "append") ?? "create",
      })

      return {
        content: [
          {
            type: "text",
            text: [
              `Ingested: ${result.title}`,
              `  Document ID: ${result.documentId}`,
              `  Format: ${result.format}`,
              `  Chunks: ${result.chunkCount}`,
              `  Entities: ${result.entityCount}`,
              `  Relationships: ${result.relationshipCount}`,
              `  Ingested at: ${result.ingestedAt}`,
            ].join("\n"),
          },
        ],
      }
    }
    case "query": {
      const query = String(args?.query ?? "")
      const filters = (args?.filters as Record<string, unknown>) ?? {}
      const tools = getQueryTool()
      const results = await tools.execute({
        query,
        filters: {
          documentIds: filters.documentIds as string[] | undefined,
          entityTypes: filters.entityTypes as string[] | undefined,
          limit: filters.limit != null ? Number(filters.limit) : undefined,
          minScore: filters.minScore != null ? Number(filters.minScore) : undefined,
        },
      })

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No results found." }],
        }
      }

      // Format results as structured text for the LLM
      const lines: string[] = [`Found ${results.length} result(s):`, ""]
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        lines.push(
          `[${i + 1}] Score: ${(r.score * 100).toFixed(1)}%`,
          `    Document: ${r.source.title} (${r.source.filename})`,
          `    Chunk: ${r.chunk.content.substring(0, 200)}${r.chunk.content.length > 200 ? "…" : ""}`,
        )
        if (r.entities && r.entities.length > 0) {
          const entityLabels = r.entities.map((e) => `${e.label} (${e.type})`).join(", ")
          lines.push(`    Entities: ${entityLabels}`)
        }
        if (r.relationships && r.relationships.length > 0) {
          const relSummaries = r.relationships.map(
            (rel) => `${rel.fromEntityId} → ${rel.toEntityId} [${rel.type}]`,
          ).join(", ")
          lines.push(`    Relationships: ${relSummaries}`)
        }
        lines.push("")
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      }
    }
    case "generate": {
      const genType = String(args?.type ?? "")
      const documentIds = Array.isArray(args?.documentIds) ? args.documentIds.map(String) : []
      ensureDatabase()

      switch (genType) {
        case "cards": {
          // Fetch chunks for the given documents, create cards
          const { getDatabase } = await import("../store/database.js")
          const chunks = getDatabase()
            .prepare("SELECT * FROM chunks WHERE document_id IN (" + documentIds.map(() => "?").join(",") + ") ORDER BY chunk_index ASC")
            .all(...documentIds) as Record<string, unknown>[]

          if (chunks.length === 0) {
            return { content: [{ type: "text", text: "No chunks found for the specified documents." }] }
          }

          const allCards: Array<{ id: string; documentId: string; question: string; answer: string }> = []
          for (const docId of documentIds) {
            const docChunks = chunks.filter((c) => c.document_id === docId)
            if (docChunks.length === 0) continue
            const cards = createCards(
              docId,
              docChunks.map((c) => ({
                id: c.id as string,
                documentId: c.document_id as string,
                index: c.chunk_index as number,
                content: c.content as string,
                tokenCount: c.token_count as number,
              })),
            )
            allCards.push(...cards.map((c) => ({ id: c.id, documentId: c.documentId, question: c.question, answer: c.answer })))
          }

          return {
            content: [{ type: "text", text: JSON.stringify({ type: "cards", count: allCards.length, cards: allCards }, null, 2) }],
          }
        }

        case "quiz": {
          const quiz = generateQuiz(documentIds)
          const output = {
            type: "quiz",
            id: quiz.id,
            questions: quiz.questions.map((q) => ({
              id: q.id,
              type: q.type,
              prompt: q.prompt,
              options: q.options,
            })),
          }
          return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }
        }

        case "exam": {
          const questionCount = args?.questionCount ? Number(args.questionCount) : 10
          const durationMinutes = args?.durationMinutes ? Number(args.durationMinutes) : 30
          const exam = createExam(documentIds, { questionCount, durationMinutes })
          const output = {
            type: "exam",
            id: exam.id,
            config: exam.config,
            questions: exam.questions.map((q) => ({
              id: q.id,
              type: q.type,
              prompt: q.prompt,
              options: q.options,
            })),
          }
          return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }
        }

        case "review": {
          const limit = args?.limit ? Number(args.limit) : 20
          const cards = getDueCards(limit)
          const output = {
            type: "review",
            dueCount: cards.length,
            cards: cards.map((c) => ({
              id: c.id,
              documentId: c.documentId,
              question: c.question,
              answer: c.answer,
              dueDate: c.dueDate.toISOString(),
            })),
          }
          return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }
        }

        default:
          return { content: [{ type: "text", text: `Unknown generate type: ${genType}. Use: cards, quiz, exam, review` }] }
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error("[mind-forge] MCP server error:", error instanceof Error ? error.message : String(error))
  process.exit(1)
})
