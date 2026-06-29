# Mind Forge

**Ingest, query, and generate study materials from documents — all through your OpenCode chat.**

Mind Forge is an OpenCode plugin that turns documents (PDFs, DOCX files, Markdown, images, web pages) into a searchable knowledge base with vector search, a knowledge graph, and study tools. You describe what you want in chat, and the LLM calls the right MCP tool automatically.

> **Status:** MVP implemented. The full pipe — ingest → embed → graph → study — is functional.

<p align="center">
  <a href="https://github.com/goncalompontes/mind-forge/actions/workflows/ci.yml">
    <img src="https://github.com/goncalompontes/mind-forge/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/goncalompontes/mind-forge/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <img src="https://img.shields.io/badge/version-0.1.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/coverage-90%25-brightgreen.svg" alt="Coverage">
</p>

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/goncalompontes/mind-forge.git
cd mind-forge
npm install
npm run build

# 2. Register in your OpenCode config
```

Add to your `opencode.json`:

```json
{
  "mcpServers": {
    "mind-forge": {
      "command": "node",
      "args": ["/path/to/mind-forge/dist/index.js"]
    }
  }
}
```

Then use it in chat:

> **You:** Ingest the PDF at ~/papers/transformer-attention.pdf
>
> **Mind Forge:** Ingested "Attention Is All You Need" (PDF, 15 chunks, 42 entities, 18 relationships)
>
> **You:** Query: "how does multi-head attention work?"
>
> **Mind Forge:** [3 results, scores 84–92%] Found in "Attention Is All You Need" chunk 4: "Multi-head attention allows the model to jointly attend to information from different representation subspaces..."

---

## Architecture

Mind Forge registers **three MCP tools** that the LLM calls automatically:

| Tool | Purpose | Pipeline |
|------|---------|----------|
| `ingest` | Import a document | extract → embed → store → graph |
| `query` | Search your knowledge base | vector search + graph enrichment + FTS5 |
| `generate` | Create study materials | cards, quiz, exam, or review |

### Data Flow

```
Document → extract() → chunks → embed() → store (SQLite + sqlite-vec)
                                   ↘ extractEntitiesAndRelationships() → graph store
                                                   ↓
User query → embed() → vector search (ANN) → merge with FTS5 + graph enrichment → results
                                                   ↓
User request → createCards() / generateQuiz() / createExam() → study materials
```

### Storage

- **SQLite** via `better-sqlite3` with WAL mode
- **Vector index** via `sqlite-vec` (768-dimension FLOAT embeddings)
- **Full-text search** via FTS5 virtual table
- **Knowledge graph** in SQLite (entities + relationships tables)
- Single file at `~/.mind-forge/store.db` (configurable via `MIND_FORGE_DB_PATH`)

---

## Source Format Support

| Format | Extractor | Library | Notes |
|--------|-----------|---------|-------|
| PDF | `src/extract/pdf.ts` | `pdftotext` CLI + `pdf-parse` fallback | Metadata via `pdfinfo` |
| DOCX | `src/extract/docx.ts` | `mammoth` | Metadata from `docProps/core.xml` |
| Markdown | `src/extract/markdown.ts` | `gray-matter` | Frontmatter parsing (title, author, custom fields) |
| Image | `src/extract/image.ts` | `tesseract.js` | PNG, JPG, JPEG, WebP; configurable OCR language |
| URL | `src/extract/url.ts` | `@mozilla/readability` | SSRF protection, size-limited streaming |

---

## Configuration

Mind Forge auto-detects the best embedding provider. You can configure via environment variables:

| Env Variable | Purpose | Default |
|-------------|---------|---------|
| `MIND_FORGE_DB_PATH` | Database file path | `~/.mind-forge/store.db` |
| `OLLAMA_HOST` | Ollama server URL | `http://127.0.0.1:11434` |

Embedding provider selection (via `EmbeddingConfig`):
- **`auto`** (default) — tries Ollama first, falls back to API provider if configured
- **`ollama`** — local Ollama (`nomic-embed-text` default, falls back to `all-minilm`, `mxbai-embed-large`)
- **`llm`** — OpenAI-compatible API (requires `apiKey`)

Default chunk size: **1000 tokens** (~4000 characters), paragraph-aware splitting.

---

## Project Structure

```
src/
├── index.ts              # Plugin entry point — registers MCP server
├── types.ts              # All shared domain types (12 interfaces, 5 type aliases)
├── embed/                # Embedding providers
│   ├── provider.ts       # Factory — auto/Ollama/LLM selection
│   ├── ollama.ts         # Ollama adapter (ollama npm package)
│   └── llm-provider.ts   # OpenAI-compatible API adapter
├── extract/              # Document extraction
│   ├── index.ts          # Orchestrator + paragraph-aware chunking
│   ├── pdf.ts            # PDF via pdftotext + pdf-parse
│   ├── docx.ts           # DOCX via mammoth
│   ├── markdown.ts       # Markdown via gray-matter
│   ├── image.ts          # Image OCR via tesseract.js
│   └── url.ts            # Web pages via @mozilla/readability
├── store/                # SQLite persistence
│   ├── database.ts       # Singleton, schema, sqlite-vec init
│   ├── documents.ts      # Document + chunk CRUD
│   └── vectors.ts        # Vector insert + ANN search
├── graph/                # Knowledge graph
│   ├── extractor.ts      # Pattern-based entity/relationship extraction
│   ├── index.ts          # Graph storage (atomic transactions)
│   └── query.ts          # BFS traversal, neighbors, pathfinding
├── study/                # Study tools
│   ├── cards.ts          # SM-2 spaced repetition cards
│   ├── quiz.ts           # Quiz generation + grading (MCQ, T/F, fill-blank)
│   └── exam.ts           # Timed exam mode
└── mcp/                  # MCP server
    ├── server.ts         # Server registration + 3 tool handlers
    ├── ingest.tool.ts    # IngestTool class (extract → embed → store → graph)
    └── query.tool.ts     # QueryTool class (hybrid search)
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `@opencode-ai/plugin` | OpenCode plugin registration |
| `better-sqlite3` | SQLite database |
| `sqlite-vec` | Vector search extension |
| `ollama` | Local embedding via Ollama |
| `tesseract.js` | Image OCR |
| `@mozilla/readability` | Web page content extraction |
| `mammoth` | DOCX text extraction |
| `gray-matter` | Markdown frontmatter parsing |
| `pdf-parse` | PDF text extraction (fallback) |
| `jsdom` | DOM parsing for Readability |

---

## Scripts

| Script | Command |
|--------|---------|
| `build` | `tsc` |
| `test` | `vitest run` |
| `typecheck` | `tsc --noEmit` |

---

## Key Design Decisions

- **Conversational interface**: All interaction through OpenCode chat via MCP tools. No slash commands, no custom UI.
- **Graceful degradation**: Embedding or graph failures don't block ingestion. Document + chunks are always stored.
- **Hybrid search**: Vector similarity (0.7 weight) + FTS5 BM25 (0.3 weight) merged with dedup by chunk ID.
- **Pattern-based extraction**: Regex patterns for entities and relationships at MVP (LLM callback extension point available).
- **SSRF protection**: URL extraction resolves hostnames to IPs and rejects private/reserved ranges before connecting.
