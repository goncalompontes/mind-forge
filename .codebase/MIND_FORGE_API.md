# Mind Forge API Reference

Generated from all 24 `.ts` source files. Every exported symbol is listed with its full type signature.

---

## Module: `src/index.ts`

**Plugin entry point.** Default export returns an OpenCode-compatible plugin registration object.

### Exported Default

- `export default plugin` — async function that returns `Promise<PluginReturn>`
  - `PluginReturn` (internal type alias, not exported): `Record<string, unknown> & { name: string; mcp: Record<string, { type: "local"; command: string[]; enabled: boolean }> }`
  - Registers one MCP server named `"mind-forge"` pointing to `src/mcp/server.js`

---

## Module: `src/types.ts`

Core domain types shared across all modules.

### Exported Types

```typescript
// Document format union
export type DocumentFormat = "pdf" | "docx" | "md" | "image" | "url"

// Source document with extracted text and metadata
export interface SourceDocument {
  id: string
  filename: string
  format: DocumentFormat
  title: string
  author?: string
  text: string
  metadata: Record<string, unknown>
  ingestedAt: Date
}

// A single chunk of a source document after text splitting
export interface DocumentChunk {
  id: string
  documentId: string
  index: number
  content: string
  tokenCount: number
  embedding?: number[]
}

// Entity type discriminator
export type EntityType = "concept" | "person" | "date" | "term" | "formula" | "definition"

// An extracted entity from a document chunk
export interface Entity {
  id: string
  label: string
  type: EntityType
  description: string
  chunkId: string
  metadata: Record<string, unknown>
}

// Relationship type discriminator
export type RelationshipType = "depends_on" | "part_of" | "defined_by" | "example_of"

// A typed relationship between two entities
export interface Relationship {
  id: string
  fromEntityId: string
  toEntityId: string
  type: RelationshipType
  chunkId: string
  confidence: number
}

// SM-2 spaced repetition study card
export interface StudyCard {
  id: string
  documentId: string
  chunkId: string
  question: string
  answer: string
  easeFactor: number
  interval: number
  repetitions: number
  dueDate: Date
  createdAt: Date
}

// Question type discriminator
export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "short_answer"

// A single question within a quiz or exam
export interface Question {
  id: string
  type: QuestionType
  prompt: string
  options?: string[]
  answer: string
}

// A generated quiz
export interface Quiz {
  id: string
  documentIds: string[]
  questions: Question[]
  answerKeys: Record<string, string>
  createdAt: Date
}

// A timed exam session
export interface ExamSession {
  id: string
  examId: string
  startedAt: Date
  submittedAt?: Date
  score?: number
  answers: Record<string, string>
}

// Embedding provider interface (adapter pattern)
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  health(): Promise<boolean>
}

// Search result combining chunk, score, source document, and optional graph data
export interface SearchResult {
  chunk: DocumentChunk
  score: number
  source: SourceDocument
  entities?: Entity[]
  relationships?: Relationship[]
}

// A study review session — cards due for review
export interface StudyReview {
  id: string
  documentId: string
  cards: StudyCard[]
  dueCount: number
  reviewedCount: number
  sessionStartedAt: Date
}
```

---

## Module: `src/extract/index.ts`

Text extraction orchestrator with paragraph/sentence-aware chunking.

### Exported Constants

| Name | Value | Description |
|------|-------|-------------|
| `CHARS_PER_TOKEN` | `4` | Character-to-token conversion ratio |

### Exported Functions

```typescript
/**
 * Split text into DocumentChunk[] using paragraph and sentence boundaries.
 * Strategy: split on double-newlines (paragraphs), then sentence punctuation,
 * then word boundaries (fallback).
 */
export function chunkText(
  text: string,
  documentId: string,
  maxTokens?: number,        // default: 1000
): DocumentChunk[]

/**
 * Detect document format from a source string.
 * Checks URL pattern first, then file extension.
 */
export function detectFormat(source: string): DocumentFormat | null

/**
 * Extract text from any supported source.
 * Auto-detects format unless explicit `format` provided in options.
 * Returns source document and paragraph/sentence-aware chunks.
 */
export async function extract(
  source: string,
  options?: ExtractOptions,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>
```

### Exported Types

```typescript
export interface ExtractOptions {
  /** Explicit document format override (bypasses auto-detection) */
  format?: DocumentFormat
  /** Target chunk size in tokens (default: 1000) */
  chunkSize?: number
  /** OCR language for image extraction (default: "eng") */
  ocrLang?: string
}
```

---

## Module: `src/extract/pdf.ts`

PDF text extraction via `pdftotext` CLI with `pdf-parse` fallback.

### Exported Functions

```typescript
/**
 * PDF text extraction.
 * Primary: spawnSync("pdftotext", ["-layout", path, "-"])
 * Fallback: pdf-parse npm package
 * Metadata: pdfinfo CLI tool for title/author/pageCount
 * Path sanitization via sanitizePath
 */
export async function extractPdf(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>

/**
 * Character-based chunking (simple fixed-size split).
 * NOTE: This is the pdf.ts-local version, NOT the paragraph-aware one in extract/index.ts.
 */
export function chunkText(
  text: string,
  documentId: string,
  maxTokens?: number,
): DocumentChunk[]

/**
 * Sanitize a file path for use in command-line tools.
 * - Resolves to absolute path (prevents path traversal)
 * - Rejects shell metacharacters and null bytes
 */
export function sanitizePath(path: string): string
```

---

## Module: `src/extract/markdown.ts`

Markdown text extraction with frontmatter parsing via `gray-matter`.

### Exported Functions

```typescript
/**
 * Read a .md/.mdx file, parse frontmatter (title, author, custom metadata),
 * and extract the markdown content body.
 */
export async function extractMarkdown(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>
```

---

## Module: `src/extract/docx.ts`

DOCX text extraction via `mammoth` with metadata from `docProps/core.xml`.

### Exported Functions

```typescript
/**
 * Extract text from a .docx file.
 * Content: mammoth.extractRawText()
 * Metadata: unzips docProps/core.xml and parses dc:title / dc:creator
 */
export async function extractDocx(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>
```

---

## Module: `src/extract/url.ts`

Web page extraction via `@mozilla/readability` with SSRF protection.

### Exported Constants

| Name | Value | Description |
|------|-------|-------------|
| `MAX_RESPONSE_BYTES` | `10 * 1024 * 1024` | 10 MB response body limit |
| `MAX_REDIRECTS` | `5` | Maximum HTTP redirects |

### Exported Functions

```typescript
/**
 * Fetch a URL, extract readable content via @mozilla/readability.
 * SSRF protection: DNS-level private IP rejection before fetch.
 * Content-type validation (text/html only).
 * Size-limited streaming body reader.
 */
export async function extractUrl(
  source: string,
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>
```

### Internal Helpers (not exported but notable)

- `rejectPrivateHost(url: URL): Promise<void>` — rejects RFC 1918, loopback, link-local, ULA
- `readBodyWithLimit(response: Response, maxBytes: number): Promise<string>` — streaming reader with size limit
- `isPrivateIpv4(ip: string): boolean`
- `isPrivateIpv6(ip: string): boolean`

---

## Module: `src/extract/image.ts`

Image OCR extraction via `tesseract.js`.

### Exported Constants

| Name | Value |
|------|-------|
| `SUPPORTED_EXTENSIONS` | `[".png", ".jpg", ".jpeg", ".webp"]` |

### Exported Functions

```typescript
/**
 * OCR text extraction from images using tesseract.js.
 * Supported formats: PNG, JPG, JPEG, WebP.
 * Metadata includes OCR confidence, block count, detected text.
 */
export async function extractImage(
  source: string,
  lang?: string,           // default: "eng"
): Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>
```

---

## Module: `src/extract/pdf-parse.d.ts`

Ambient type augmentation for `pdf-parse` (no runtime exports).

```typescript
// Augments the pdf-parse module with typed interfaces
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string
    numpages: number
    info: Record<string, unknown>
    metadata: Record<string, unknown>
    version: string
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>

  export default pdfParse
}
```

---

## Module: `src/embed/provider.ts`

Embedding provider factory — auto-detect between Ollama and LLM provider.

### Exported Types

```typescript
export interface EmbeddingConfig {
  /** Provider selection: "ollama", "llm", or "auto" (try Ollama first) */
  provider?: "auto" | "ollama" | "llm"
  /** Ollama-specific configuration */
  ollama?: OllamaConfig
  /** LLM-specific configuration (required when provider="llm") */
  llm?: LLMEmbeddingConfig
}
```

### Exported Functions

```typescript
/**
 * Create an EmbeddingProvider based on config.
 * - "ollama": wraps createOllamaProvider()
 * - "llm": wraps createLLMEmbeddingProvider() (requires apiKey)
 * - "auto" (default): tries Ollama first, falls back to LLM if configured
 */
export function createEmbeddingProvider(
  config?: EmbeddingConfig,
): EmbeddingProvider
```

---

## Module: `src/embed/llm-provider.ts`

OpenAI-compatible embedding provider (e.g. OpenAI, Together, OpenRouter).

### Exported Types

```typescript
export interface LLMEmbeddingConfig {
  apiUrl?: string       // default: "https://api.openai.com/v1"
  apiKey: string
  model?: string        // default: "text-embedding-3-small"
}
```

### Exported Functions

```typescript
/**
 * Create an EmbeddingProvider backed by an OpenAI-compatible API.
 * Calls POST {apiUrl}/embeddings with the configured model.
 */
export function createLLMEmbeddingProvider(
  config: LLMEmbeddingConfig,
): EmbeddingProvider
```

---

## Module: `src/embed/ollama.ts`

Local Ollama embedding provider.

### Exported Types

```typescript
export interface OllamaConfig {
  /** Ollama server URL (default: http://127.0.0.1:11434) */
  baseUrl?: string
  /** Model name (default: nomic-embed-text) */
  model?: string
}
```

### Exported Constants (module-scoped, not exported)

| Name | Value |
|------|-------|
| `DEFAULT_MODEL` | `"nomic-embed-text"` |
| `FALLBACK_MODELS` | `["all-minilm", "mxbai-embed-large"]` |

### Exported Functions

```typescript
/**
 * Create an EmbeddingProvider backed by a local Ollama server.
 * Uses the `ollama` npm package to call ollama.embed().
 * health() checks that the configured model (or a fallback) exists on the server.
 */
export function createOllamaProvider(
  config?: OllamaConfig,
): EmbeddingProvider
```

---

## Module: `src/store/database.ts`

SQLite database singleton manager with schema initialization and sqlite-vec extension.

### Exported Functions

```typescript
/**
 * Initialize the database at the given path.
 * Enables WAL mode, foreign keys, loads sqlite-vec, runs schema.
 * Returns the singleton Database instance.
 */
export function initDatabase(dbPath: string): Database.Database

/**
 * Get the initialized database singleton.
 * Throws if initDatabase() has not been called.
 */
export function getDatabase(): Database.Database

/**
 * Close the database connection and reset the singleton.
 */
export function closeDatabase(): void

/**
 * Get or initialize the database singleton.
 * Convenience wrapper that calls initDatabase() if needed.
 */
export function getOrInitDatabase(dbPath: string): Database.Database
```

### Database Schema (created automatically)

| Table | Type | Primary Purpose |
|-------|------|-----------------|
| `documents` | Row | Source documents |
| `chunks` | Row | Document chunks (FK → documents, ON DELETE CASCADE) |
| `entities` | Row | Extracted entities (FK → chunks, CASCADE) |
| `relationships` | Row | Entity relationships (FK → entities, chunks, CASCADE) |
| `study_cards` | Row | SM-2 study cards (FK → documents, chunks, CASCADE) |
| `quizzes` | Row | Generated quizzes |
| `exams` | Row | Exam sessions |
| `sessions` | Row | Study review sessions (FK → documents, CASCADE) |
| `vec_chunks` | Virtual (vec0) | ANN vector search, 768-dimension FLOAT embeddings |
| `chunks_fts` | Virtual (FTS5) | Full-text search on chunk content |

---

## Module: `src/store/documents.ts`

Document and chunk CRUD operations.

### Exported Functions

```typescript
/** Insert a single document into the store. */
export function insertDocument(doc: SourceDocument): void

/** Insert multiple document chunks in a transaction. */
export function insertChunks(chunks: DocumentChunk[]): void

/** Delete a document and its chunks (cascading via FK). */
export function deleteDocument(id: string): void

/** Find a document by filename. Returns null if not found. */
export function findDocumentByFilename(filename: string): SourceDocument | null

/** List all documents (without chunks), ordered by ingested_at DESC. */
export function listDocuments(): SourceDocument[]

/** Get a document by ID, including its chunks ordered by index ASC. Returns null if not found. */
export function getDocument(
  id: string,
): (SourceDocument & { chunks: DocumentChunk[] }) | null
```

---

## Module: `src/store/vectors.ts`

Vector embedding storage and ANN similarity search via sqlite-vec.

### Exported Types

```typescript
export interface VectorSearchFilters {
  documentId?: string
}
```

### Exported Constants (module-scoped, not exported)

| Name | Value |
|------|-------|
| `VEC_DIMENSION` | `768` |

### Exported Functions

```typescript
/**
 * Insert or update an embedding vector for a chunk.
 * Validates dimension matches VEC_DIMENSION (768).
 */
export function insertEmbedding(chunkId: string, vector: number[]): void

/**
 * Search for similar chunks using ANN via sqlite-vec.
 * Returns results ordered by distance (ascending, lower = more similar).
 * Results are joined with documents table in a second query.
 */
export function searchSimilar(
  query: number[],
  limit: number,
  filters?: VectorSearchFilters,
): SearchResult[]
```

---

## Module: `src/graph/index.ts`

Graph data persistence (entities + relationships to SQLite).

### Exported Functions

```typescript
/**
 * Store entities and relationships in the SQLite graph database.
 * Creates a stub document (__graph__) for FK constraints.
 * Uses a transaction for atomic insert.
 * INSERT OR REPLACE for deduplication.
 */
export function storeGraphData(
  entities: Entity[],
  relationships: Relationship[],
): void
```

---

## Module: `src/graph/extractor.ts`

Pattern-based entity and relationship extraction from document chunks.

### Exported Types

```typescript
export interface ExtractorOptions {
  /**
   * Optional LLM-based callback for more sophisticated extraction.
   * When provided, results are merged with pattern-based extraction.
   */
  llmCallback?: (
    chunks: DocumentChunk[],
  ) => Promise<{ entities: Entity[]; relationships: Relationship[] }>
}
```

### Exported Functions

```typescript
/**
 * Extract entities and relationships from document chunks using pattern matching.
 * For MVP, uses regex patterns and co-occurrence heuristics.
 * An optional llmCallback can be provided (merged with pattern-based results).
 *
 * Extraction passes:
 *   1. Definition patterns ("X is a Y", "X refers to Y", "X is defined as Y")
 *   2. Formula-like entities (lines containing "=", "+", "-", "*", "/", "^")
 *   3. Date entities (month + day + year patterns, standalone 4-digit years 1000-2099)
 *   4. Capitalized terms (multi-word, single-word, acronyms)
 * Relationship passes:
 *   1. Typed relationships: depends_on, part_of, example_of, defined_by (regex)
 *   2. Co-occurrence relationships (default depends_on, confidence 0.4)
 */
export async function extractEntitiesAndRelationships(
  chunks: DocumentChunk[],
  options?: ExtractorOptions,
): Promise<{ entities: Entity[]; relationships: Relationship[] }>
```

### Entity Detection Patterns (internal, for reference)

| Pattern | Matches | Entity Type |
|---------|---------|-------------|
| `X is a/an Y` | Definition sentences | `definition` |
| `X refers to Y` | Reference sentences | `definition` |
| `X is defined as Y` | Definition sentences | `definition` |
| Lines containing `=`, `+`, `-`, `*`, `/`, `^` | Formula-like strings | `formula` |
| Month name + day + optional year | Dates | `date` |
| 4-digit years 1000-2099 | Years | `date` |
| Multi-word capitalized terms | Named concepts | `concept` |
| Single capitalized words (length ≥ 2) | Proper nouns | `concept` |
| All-uppercase acronyms (length ≥ 2) | Acronyms | `concept` |

### Stop Words

A set of ~120 common English words (articles, pronouns, conjunctions, prepositions, auxiliary verbs, etc.) used to filter out spurious entity labels.

---

## Module: `src/graph/query.ts`

Graph traversal and query operations.

### Exported Functions

```typescript
/** Get a single entity by its ID. Returns null when not found. */
export function getEntity(id: string): Entity | null

/**
 * Find all entities connected to `entityId` within `depth` hops.
 * Uses breadth-first traversal over the relationships table.
 */
export function getNeighbors(entityId: string, depth: number): Entity[]

/**
 * Find the shortest path between two entities using BFS.
 * Returns an ordered array of entities from `fromId` to `toId`.
 * Returns an empty array when no path exists.
 */
export function findPath(fromId: string, toId: string): Entity[]

/** Return all entities of a given type. */
export function queryByType(type: EntityType): Entity[]

/** Search entities by label or description (case-insensitive LIKE). Returns all matches ordered by label. */
export function searchEntities(query: string): Entity[]
```

---

## Module: `src/study/cards.ts`

Study card creation (template-based) and SM-2 spaced repetition scheduling.

### Exported Functions

```typescript
/**
 * Create study cards from document chunks using template-based extraction.
 * Cards are persisted to the database with SM-2 defaults (easeFactor=2.5).
 *
 * Card generation patterns:
 *   1. Definition sentences ("X is/are ...") → "What is X?"
 *   2. Process sentences ("X occurs/happens/involves...") → "What does X involve?"
 *   3. Quoted-term definitions ("term" is ...) → "What is 'term'?"
 *   4. Fallback: fill-in-the-blank from first sentence
 */
export function createCards(
  documentId: string,
  chunks: DocumentChunk[],
): StudyCard[]

/**
 * SM-2 scheduling algorithm.
 * Updates a card's easeFactor, interval, repetitions and dueDate.
 *
 * @param cardId - The card to review
 * @param quality - Review quality 0-5 (0=complete blackout, 5=perfect response)
 *   - quality < 3: failed recall → reset repetitions, interval=1
 *   - quality >= 3: successful recall → SM-2 interval doubling
 */
export function scheduleReview(cardId: string, quality: number): void

/** Get cards that are due for review (due_date ≤ now), ordered by due_date ASC. */
export function getDueCards(limit?: number): StudyCard[]
```

---

## Module: `src/study/quiz.ts`

Quiz generation and grading from study cards.

### Exported Functions

```typescript
/**
 * Generate a quiz from study cards extracted from the given documents.
 *
 * @param documentIds - Documents to generate questions from
 * @param count - Number of questions (default: 5)
 * @param types - Allowed question types (default: all types)
 *
 * Question types cycle: multiple_choice → true_false → fill_blank
 * Persists the quiz to the database.
 */
export function generateQuiz(
  documentIds: string[],
  count?: number,
  types?: QuestionType[],
): Quiz

/**
 * Grade a quiz against stored answer keys.
 * Fill-blank: case-insensitive comparison.
 * Other types: exact string match.
 */
export function gradeQuiz(
  quizId: string,
  answers: Record<string, string>,
): {
  total: number
  correct: number
  score: number  // percentage 0-100
  details: Array<{
    questionId: string
    correct: boolean
    yourAnswer: string
    correctAnswer: string
  }>
}
```

### Question Generation Strategies

| Type | Strategy | Distractors |
|------|----------|-------------|
| `multiple_choice` | Correct answer + 3 distractors from other card answers | Shuffled, padded with "None of the above" |
| `true_false` | 50% true (card answer), 50% false (negated statement) | Negation via pattern replacement |
| `fill_blank` | First content word (length ≥ 4, non-stop-word) blanked | Case-insensitive comparison |

---

## Module: `src/study/exam.ts`

Timed exam mode — creates, starts, submits, and retrieves exam sessions.

### Exported Types

```typescript
export interface ExamConfig {
  questionCount: number
  durationMinutes: number
  types?: QuestionType[]
}

export interface Exam {
  id: string
  documentIds: string[]
  questions: Question[]
  answerKeys: Record<string, string>
  config: ExamConfig
  startedAt?: Date
  submittedAt?: Date
}

export interface ExamResult {
  id: string
  score: number         // percentage 0-100
  total: number
  correct: number
  timeTaken: number     // in seconds
  startedAt: Date
  submittedAt: Date
  details: Array<{
    questionId: string
    correct: boolean
    yourAnswer: string
    correctAnswer: string
  }>
}
```

### Exported Functions

```typescript
/**
 * Create an exam with questions and timer config.
 * Delegates question generation to generateQuiz().
 */
export function createExam(
  documentIds: string[],
  config: ExamConfig,
): Exam

/**
 * Start an exam — records the start time in the database.
 * Creates a new exam session if one doesn't exist.
 */
export function startExam(examId: string): { startedAt: Date }

/**
 * Submit an exam — auto-grade, compute score percentage, persist submission.
 * Requires the exam to have been started first.
 */
export function submitExam(
  examId: string,
  answers: Record<string, string>,
): {
  score: number
  total: number
  correct: number
  submittedAt: Date
}

/**
 * Get full exam result with score, time taken, and per-question results.
 * Requires the exam to have been submitted.
 */
export function getExamResult(examId: string): ExamResult
```

---

## Module: `src/mcp/server.ts`

**MCP server entry point** — creates a `@modelcontextprotocol/sdk` Server and registers three tools. No exported symbols (the module is the entry point executed by `src/index.ts`).

### Registered Tools

| Tool Name | Description | Required Inputs |
|-----------|-------------|-----------------|
| `ingest` | Ingest a document into the knowledge base | `source` (string) |
| `query` | Query the knowledge base for relevant content | `query` (string) |
| `generate` | Generate study materials (cards, quiz, exam, review) | `type` (string), `documentIds` (string[]) |

### Tool Input Schemas

**ingest:**
```json
{
  "source": "string (required) — path, URL, or text content",
  "format": "string? — 'pdf' | 'docx' | 'md' | 'image' | 'url'",
  "ocrLang": "string? — OCR language (default: 'eng')",
  "chunkSize": "number? — target tokens per chunk (default: 1000)",
  "mode": "string? — 'create' | 'replace' | 'append' (default: 'create')"
}
```

**query:**
```json
{
  "query": "string (required)",
  "filters": {
    "documentIds": "string[]?",
    "entityTypes": "string[]? — 'concept' | 'person' | 'date' | 'term' | 'formula' | 'definition'",
    "limit": "number?",
    "minScore": "number? — 0.0–1.0"
  }
}
```

**generate:**
```json
{
  "type": "string (required) — 'cards' | 'quiz' | 'exam' | 'review'",
  "documentIds": "string[] (required)",
  "questionCount": "number? (default: 10)",
  "durationMinutes": "number? (default: 30)",
  "limit": "number? (default: 20)"
}
```

---

## Module: `src/mcp/ingest.tool.ts`

Ingestion pipeline: extract → embed → store → graph.

### Exported Types

```typescript
export interface IngestInput {
  source: string
  format?: string
  ocrLang?: string
  chunkSize?: number
  mode?: "create" | "replace" | "append"
}

export interface IngestResult {
  documentId: string
  title: string
  format: string
  chunkCount: number
  entityCount: number
  relationshipCount: number
  ingestedAt: string
}

export interface IngestToolDeps {
  embedProvider?: EmbeddingProvider
  extractFn?: typeof import("../extract/index.js").extract
  graphExtractFn?: typeof import("../graph/extractor.js").extractEntitiesAndRelationships
}
```

### Exported Classes

```typescript
export class IngestTool {
  constructor(deps?: IngestToolDeps)

  /**
   * Execute the full ingestion pipeline:
   * 1. Resolve mode (create/replace/append)
   * 2. Mode-specific checks (delete existing / check duplicate)
   * 3. Extract document + chunks
   * 4. Embed all chunk texts in parallel
   * 5. Store document + chunks
   * 6. Store embeddings (graceful degradation on failure)
   * 7. Extract graph entities + relationships
   * 8. Store graph data (graceful degradation on failure)
   * 9. Return structured IngestResult
   */
  async execute(input: IngestInput): Promise<IngestResult>
}
```

### Graceful Degradation

- **Embedding failures** → document and chunks are still stored, embeddings skipped
- **Graph extraction failures** → document, chunks, and embeddings are still stored, graph skipped

---

## Module: `src/mcp/query.tool.ts`

Hybrid search query tool: vector similarity + graph enrichment + FTS5 full-text.

### Exported Types

```typescript
export interface QueryFilters {
  documentIds?: string[]
  entityTypes?: string[]
  limit?: number
  minScore?: number
}

export interface QueryInput {
  query: string
  filters?: QueryFilters
}
```

### Exported Constants (module-scoped, not exported)

| Name | Value | Description |
|------|-------|-------------|
| `DEFAULT_LIMIT` | `10` | Default result count |
| `DEFAULT_MIN_SCORE` | `0.0` | Default minimum score threshold |
| `VECTOR_WEIGHT` | `0.7` | Vector similarity weight in hybrid merge |
| `FTS_WEIGHT` | `0.3` | FTS5 similarity weight in hybrid merge |
| `GRAPH_DEPTH` | `1` | Neighbor traversal depth for graph enrichment |

### Exported Classes

```typescript
export class QueryTool {
  constructor(
    dbPath: string,
    embedConfig?: Record<string, unknown>,
    embedProvider?: EmbeddingProvider, // for test injection
  )

  /**
   * Execute a hybrid search across vector, graph, and full-text indexes.
   * 1. Vector similarity search (semantic)
   * 2. Graph-aware enrichment (entities + relationships)
   * 3. Full-text search (FTS5) fallback
   * 4. Merge with weighted ranking: vector * 0.7 + fts * 0.3
   */
  async execute(input: QueryInput): Promise<SearchResult[]>
}
```

### Hybrid Scoring

```
finalScore = vectorSimilarity * 0.7 + ftsNormalisedScore * 0.3
```

- Vector distance is converted to similarity: `1 / (1 + distance)`
- FTS BM25 scores are normalised to 0–1 range
- Results deduplicated by chunk ID, sorted by descending score
- FTS5 query uses `"term1" AND "term2"` for precision (stop words excluded)

---

## Complete File Index (24 files)

| # | File | Export Type | Symbol Count |
|---|------|-------------|-------------|
| 1 | `src/types.ts` | Types | 12 types, 5 type aliases, 8 interfaces |
| 2 | `src/index.ts` | Default export | 1 default export |
| 3 | `src/extract/index.ts` | Functions + Types | 3 functions, 1 interface |
| 4 | `src/extract/pdf.ts` | Functions | 3 exported functions |
| 5 | `src/extract/markdown.ts` | Functions | 1 exported function |
| 6 | `src/extract/docx.ts` | Functions | 1 exported function |
| 7 | `src/extract/url.ts` | Functions | 1 exported function |
| 8 | `src/extract/image.ts` | Functions | 1 exported function |
| 9 | `src/extract/pdf-parse.d.ts` | Ambient types | 1 module augmentation |
| 10 | `src/embed/provider.ts` | Types + Functions | 1 interface, 1 function |
| 11 | `src/embed/llm-provider.ts` | Types + Functions | 1 interface, 1 function |
| 12 | `src/embed/ollama.ts` | Types + Functions | 1 interface, 1 function |
| 13 | `src/store/database.ts` | Functions | 4 exported functions |
| 14 | `src/store/documents.ts` | Functions | 6 exported functions |
| 15 | `src/store/vectors.ts` | Types + Functions | 1 interface, 2 functions |
| 16 | `src/graph/index.ts` | Functions | 1 exported function |
| 17 | `src/graph/extractor.ts` | Types + Functions | 1 interface, 1 function |
| 18 | `src/graph/query.ts` | Functions | 5 exported functions |
| 19 | `src/study/cards.ts` | Functions | 3 exported functions |
| 20 | `src/study/quiz.ts` | Functions | 2 exported functions |
| 21 | `src/study/exam.ts` | Types + Functions | 3 interfaces, 4 functions |
| 22 | `src/mcp/server.ts` | — | 0 exports (entry point, 3 tools via SDK) |
| 23 | `src/mcp/ingest.tool.ts` | Types + Class | 3 interfaces, 1 class |
| 24 | `src/mcp/query.tool.ts` | Types + Class | 2 interfaces, 1 class |
