# Mind Forge — Architecture Decisions

**Plugin:** OpenCode plugin for document-based knowledge management  
**Status:** MVP implemented  
**Date:** 2026-06-28

## Design Decisions (from Phase 4 Discussion)

**D-01: Architecture** — OpenCode plugin (separate from FlowDeck).  
- Rationale: FlowDeck is a CLI-only AI coding workflow orchestrator; adding document processing, vector storage, and study tools would violate its single-responsibility boundary.
- Implementation: Standalone project at `/home/pontes/projects/mind-forge/` with its own package.json, tsconfig, and plugin entry point.

**D-02: Interface Modality** — MCP tools (ingest, query, generate) auto-invoked by the LLM.  
- Rationale: NotebookLM-like workflow is conversational — user says "summarize this PDF" and the LLM calls the tool automatically. No slash commands needed.
- Implementation: `@modelcontextprotocol/sdk` with `StdioServerTransport`. 3 tools registered with JSON Schema input schemas.

**D-03: Source Formats (MVP)** — All: PDF, DOCX, Markdown, images (OCR), web URLs.  
- Rationale: User wants full format support from the start.
- Implementation: 5 extractors in `src/extract/` with auto-detection via file extension + URL pattern. Uses `pdf-parse`/`pdftotext`, `mammoth`, native read, `tesseract.js`, and `@mozilla/readability`.

**D-04: Embedding Approach** — Local Ollama preferred (conditional ≤8GB RAM), fallback to LLM provider.  
- Rationale: Ollama carries zero recurring cost and keeps data on-device. Abstraction layer allows future provider swaps.
- Implementation: `EmbeddingProvider` interface in `src/types.ts`, factory in `src/embed/provider.ts`. Ollama adapter via `ollama` npm package, LLM adapter via OpenAI-compatible API.

**D-05: Vector Storage** — SQLite + sqlite-vec.  
- Rationale: Single-user plugin needs no client-server vector DB. SQLite is zero-dependency, single-file, easy to back up.
- Implementation: `better-sqlite3` with sqlite-vec extension. 768-dimension fixed (nomic-embed-text default). ANN search via sqlite-vec virtual table.

**D-06: Knowledge Graph** — Full property graph at MVP (entity extraction + relationship inference).  
- Rationale: User wants graph-based exploration from the start. Pattern-based extraction for MVP with LLM callback extension point.
- Implementation: `src/graph/extractor.ts` with regex patterns for 6 entity types and 4 relationship types. BFS traversal for neighbors/path queries. Co-occurrence-based relationship fallback.

**D-07: Study Tools (MVP)** — All three: study cards (SM-2), quiz generation, exam mode.  
- Rationale: User wants full learning toolset from the start.
- Implementation: SM-2 algorithm in `src/study/cards.ts`. 3 quiz types (MCQ, true/false, fill-blank) in `src/study/quiz.ts`. Timed exam sessions in `src/study/exam.ts`.

**D-08: UI Classification** — No custom UI. All interaction through OpenCode chat via MCP tools.  
- Rationale: All functionality works through chat. A companion web UI would add a full-stack project for something that already has a working delivery channel.

## Implementation Decisions (discovered during development)

**ID-01: SSRF Protection Strategy** — DNS-level private IP rejection before fetch.  
- All URLs are resolved to IPs via `dns.resolve4`/`dns.resolve6` before connecting. Private/reserved ranges (loopback, RFC 1918, link-local, ULA) are rejected with clear error messages. This prevents SSRF via hostname obfuscation.
- File: `src/extract/url.ts`, function `rejectPrivateHost()`.

**ID-02: Graceful Degradation Strategy** — Embedding and graph extraction failures do not block document ingestion.  
- If embeddings fail, the document and chunks are still stored. If graph extraction fails, document + chunks + embeddings are still stored. This ensures the user always has access to their ingested content.
- File: `src/mcp/ingest.tool.ts`, steps 6 and 8 wrapped in try/catch.

**ID-03: Hybrid Search Weighting** — Vector score × 0.7 + FTS score × 0.3.  
- Empirical weighting favoring semantic similarity over keyword matching. Both results are deduplicated by chunk ID.
- File: `src/mcp/query.tool.ts`, constants `VECTOR_WEIGHT` and `FTS_WEIGHT`, function `mergeHybridResults()`.

**ID-04: Pattern-Based Graph Extraction** — Regex patterns over LLM extraction at MVP.  
- LLM-based entity extraction is expensive and adds latency to the ingest pipeline. Pattern-based extraction (capitalized terms, definition patterns, co-occurrence) covers most academic content with near-zero latency.
- File: `src/graph/extractor.ts`. Optional `llmCallback` in `ExtractorOptions` for later upgrade path.

**ID-05: Singleton Database Pattern** — `getDatabase()` singleton via `better-sqlite3`.  
- SQLite in WAL mode with a single connection per process. Foreign keys enabled with `ON DELETE CASCADE`.
- File: `src/store/database.ts`, functions `initDatabase()` and `getDatabase()`.

**ID-06: Chunking Algorithm** — Paragraph-aware with sentence boundary fallback.  
- Primary split on double-newlines (paragraphs), fallback on sentence punctuation (`.`, `!`, `?`), ultimate fallback on word boundaries. Configurable chunk size (default 1000 tokens / ~4000 chars).
- File: `src/extract/index.ts`, function `chunkText()`.
