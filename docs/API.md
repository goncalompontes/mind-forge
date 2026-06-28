# Mind Forge API Reference

Generated from all 24 `.ts` source files. Every exported symbol is listed with its full type signature.

---

## Module: `src/types.ts`

Core domain types shared across all modules.

### Type Aliases

```typescript
export type DocumentFormat = "pdf" | "docx" | "md" | "image" | "url"
export type EntityType = "concept" | "person" | "date" | "term" | "formula" | "definition"
export type RelationshipType = "depends_on" | "part_of" | "defined_by" | "example_of"
export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "short_answer"
```

### Interfaces

```typescript
/** Source document with extracted text and metadata */
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

/** A single chunk of a source document after text splitting */
export interface DocumentChunk {
  id: string
  documentId: string
  index: number
  content: string
  tokenCount: number
  embedding?: number[]
}

/** An extracted entity from a document chunk */
export interface Entity {
  id: string
  label: string
  type: EntityType
  description: string
  chunkId: string
  metadata: Record<string, unknown>
}

/** A typed relationship between two entities */
export interface Relationship {
  id: string
  fromEntityId: string
  toEntityId: string
  type: RelationshipType
  chunkId: string
  confidence: number
}

/** SM-2 spaced repetition study card */
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

/** A single question within a quiz or exam */
export interface Question {
  id: string
  type: QuestionType
  prompt: string
  options?: string[]
  answer: string
}

/** A generated quiz */
export interface Quiz {
  id: string
  documentIds: string[]
  questions: Question[]
  answerKeys: Record<string, string>
  createdAt: Date
}

/** A timed exam session */
export interface ExamSession {
  id: string
  examId: string
  startedAt: Date
  submittedAt?: Date
  score?: number
  answers: Record<string, string>
}

/** Embedding provider interface (adapter pattern) */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  health(): Promise<boolean>
}

/** Search result combining chunk, score, source, and optional graph data */
export interface SearchResult {
  chunk: DocumentChunk
  score: number
  source: SourceDocument
  entities?: Entity[]
  relationships?: Relationship[]
}

/** A study review session — cards due for review */
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

## Module: `src/index.ts`

**Plugin entry point.** Default export returns an OpenCode-compatible plugin registration object.

### Exported Default

```typescript
export default plugin
// async function that returns Promise<PluginReturn>
// Registers one MCP server named "mind-forge" pointing to src/mcp/server.js
```

---

## Module: `src/extract/index.ts`

Text extraction orchestrator with paragraph/sentence-aware chunking.

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `CHARS_PER_TOKEN` | `4` | Character-to-token conversion ratio |

### Functions

#### `chunkText(text, documentId, maxTokens?)`

Split text into `DocumentChunk[]` using paragraph and sentence boundaries.

**Strategy:**
1. Split on double-newline boundaries (paragraphs).
2. If a paragraph fits in the current chunk, append it.
3. If a paragraph alone exceeds the limit, split it by sentence boundaries.
4. Never break mid-sentence.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| text | string | Yes | — | Raw text content |
| documentId | string | Yes | — | ID of the source document |
| maxTokens | number | No | 1000 | Token budget per chunk |

**Returns:** `DocumentChunk[]`

---

#### `detectFormat(source)`

Detect the document format from a source string.

Checks URL pattern first, then file extension.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | File path or URL |

**Returns:** `DocumentFormat | null` — `null` when format cannot be determined.

**Detection rules:**
- `http://` or `https://` prefix → `"url"`
- `.pdf` extension → `"pdf"`
- `.docx` extension → `"docx"`
- `.md` or `.mdx` extension → `"md"`
- `.png`, `.jpg`, `.jpeg`, `.webp` extension → `"image"`
- Anything else → `null`

---

#### `extract(source, options?)`

Extract text from any supported source. Auto-detects format unless explicit `format` is provided.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | File path, URL, or raw text |
| options | `ExtractOptions` | No | Extraction configuration |

**Returns:** `Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>`

**Throws:**
- If `source` is empty
- If format cannot be detected and no `format` override is provided
- If the file, URL, or image cannot be read

---

### Types

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

### `extractPdf(source)`

Extract text from a PDF file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | Path to the PDF file |

**Returns:** `Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>`

**Extraction strategy:**
1. Primary: `spawnSync("pdftotext", ["-layout", path, "-"])`
2. Fallback: `pdf-parse` npm package
3. Metadata: `pdfinfo` CLI tool (title, author, page count)

**Throws:** If file doesn't exist or path contains shell metacharacters.

---

### `chunkText(text, documentId, maxTokens?)`

Character-based chunking (simple fixed-size split).

**Note:** This is the `pdf.ts`-local version, NOT the paragraph-aware one in `extract/index.ts`.

**Parameters:**
| Name | Type | Required | Default |
|------|------|----------|---------|
| text | string | Yes | — |
| documentId | string | Yes | — |
| maxTokens | number | No | 1000 |

**Returns:** `DocumentChunk[]`

---

### `sanitizePath(path)`

Sanitize a file path for use in command-line tools.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| path | string | Yes | File path to sanitize |

**Returns:** `string` — resolved absolute path

**Throws:** If path contains shell metacharacters (`;`, `$`, `` ` ``, `|`, `&`, `>`, `<`, `(`, `)`, `\n`, `\0`)

---

## Module: `src/extract/docx.ts`

DOCX text extraction via `mammoth` with metadata from `docProps/core.xml`.

### `extractDocx(source)`

Extract text from a `.docx` file.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | Path to the .docx file |

**Returns:** `Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>`

**Metadata:** Unzips `docProps/core.xml` and parses `<dc:title>` / `<dc:creator>`.

**Throws:** If file doesn't exist.

---

## Module: `src/extract/markdown.ts`

Markdown text extraction with frontmatter parsing via `gray-matter`.

### `extractMarkdown(source)`

Read a `.md`/`.mdx` file, parse frontmatter, and extract the markdown content body.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | Path to the .md or .mdx file |

**Returns:** `Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>`

**Frontmatter handling:**
- `title` field → `document.title`
- `author` field → `document.author`
- All other frontmatter fields → `document.metadata`
- Date values in frontmatter are serialized to ISO strings

**Throws:** If file doesn't exist.

---

## Module: `src/extract/image.ts`

Image OCR extraction via `tesseract.js`.

### Constants

| Name | Value |
|------|-------|
| `SUPPORTED_EXTENSIONS` | `[".png", ".jpg", ".jpeg", ".webp"]` |

### `extractImage(source, lang?)`

OCR text extraction from images using tesseract.js.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| source | string | Yes | — | Path to the image file |
| lang | string | No | `"eng"` | OCR language code |

**Returns:** `Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>`

**Metadata includes:** OCR confidence, block count, detected text fragments.

**Throws:** If file doesn't exist or format is unsupported.

---

## Module: `src/extract/url.ts`

Web page extraction via `@mozilla/readability` with SSRF protection.

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `MAX_RESPONSE_BYTES` | `10 * 1024 * 1024` | 10 MB response body limit |
| `MAX_REDIRECTS` | `5` | Maximum HTTP redirects |

### `extractUrl(source)`

Fetch a URL, extract readable content via @mozilla/readability.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | HTTP or HTTPS URL |

**Returns:** `Promise<{ document: SourceDocument; chunks: DocumentChunk[] }>`

**Security:**
- SSRF protection: DNS-level private IP rejection before fetch (RFC 1918, loopback, link-local, ULA)
- Content-type validation (text/html only)
- Size-limited streaming body reader (10 MB cap)
- 30-second timeout via `AbortSignal.timeout`
- Custom User-Agent header

**Throws:**
- Invalid URL format
- Private/resolved IP addresses
- Non-HTML content type
- Response exceeds size limit
- No readable content found

---

## Module: `src/extract/pdf-parse.d.ts`

Ambient type augmentation for `pdf-parse` (no runtime exports).

```typescript
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

### Types

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

### `createEmbeddingProvider(config?)`

Create an `EmbeddingProvider` based on config.

| Mode | Behavior |
|------|----------|
| `"ollama"` | Wraps `createOllamaProvider()` |
| `"llm"` | Wraps `createLLMEmbeddingProvider()` (requires `apiKey`) |
| `"auto"` (default) | Tries Ollama first; falls back to LLM if configured |

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | `EmbeddingConfig` | No | Provider selection and credentials |

**Returns:** `EmbeddingProvider`

**Throws:** If mode is `"llm"` and no `apiKey` is provided.

---

## Module: `src/embed/llm-provider.ts`

OpenAI-compatible embedding provider (OpenAI, Together, OpenRouter, etc.).

### Types

```typescript
export interface LLMEmbeddingConfig {
  apiUrl?: string       // default: "https://api.openai.com/v1"
  apiKey: string
  model?: string        // default: "text-embedding-3-small"
}
```

### `createLLMEmbeddingProvider(config)`

Create an EmbeddingProvider backed by an OpenAI-compatible API.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | `LLMEmbeddingConfig` | Yes | API endpoint, key, and model |

**Returns:** `EmbeddingProvider`

**API:** Calls `POST {apiUrl}/embeddings` with the configured model. Sorts results by `index` to preserve input order.

---

## Module: `src/embed/ollama.ts`

Local Ollama embedding provider.

### Types

```typescript
export interface OllamaConfig {
  /** Ollama server URL (default: http://127.0.0.1:11434) */
  baseUrl?: string
  /** Model name (default: nomic-embed-text) */
  model?: string
}
```

### Constants

| Name | Value |
|------|-------|
| `DEFAULT_MODEL` | `"nomic-embed-text"` |
| `FALLBACK_MODELS` | `["all-minilm", "mxbai-embed-large"]` |

### `createOllamaProvider(config?)`

Create an EmbeddingProvider backed by a local Ollama server.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| config | `OllamaConfig` | No | Server URL and model selection |

**Returns:** `EmbeddingProvider`

**Behavior:**
- Uses the `ollama` npm package to call `ollama.embed()`
- `health()` checks that the configured model (or a fallback) exists on the server

---

## Module: `src/store/database.ts`

SQLite database singleton manager with schema initialization and sqlite-vec extension.

### `initDatabase(dbPath)`

Initialize the database at the given path.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| dbPath | string | Yes | Path to the SQLite database file |

**Returns:** `Database.Database` — the singleton instance

**Initialization:**
- Enables WAL journal mode
- Enables foreign keys
- Loads the sqlite-vec extension (silently continues if unavailable)
- Creates all schema tables

---

### `getDatabase()`

Get the initialized database singleton.

**Returns:** `Database.Database`

**Throws:** If `initDatabase()` has not been called yet.

---

### `closeDatabase()`

Close the database connection and reset the singleton.

---

### `getOrInitDatabase(dbPath)`

Get or initialize the database singleton. Convenience wrapper that calls `initDatabase()` if needed.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| dbPath | string | Yes | Path to the SQLite database file |

**Returns:** `Database.Database`

---

### Database Schema

| Table | Type | Purpose | Key Constraints |
|-------|------|---------|-----------------|
| `documents` | Row | Source documents | `id TEXT PRIMARY KEY` |
| `chunks` | Row | Document chunks | FK → `documents(id) ON DELETE CASCADE` |
| `entities` | Row | Extracted entities | FK → `chunks(id) ON DELETE CASCADE` |
| `relationships` | Row | Entity relationships | FK → `entities(id)`, `chunks(id)`, CASCADE |
| `study_cards` | Row | SM-2 study cards | FK → `documents(id)`, `chunks(id)`, CASCADE |
| `quizzes` | Row | Generated quizzes | — |
| `exams` | Row | Exam sessions | — |
| `sessions` | Row | Study review sessions | FK → `documents(id)`, CASCADE |
| `vec_chunks` | Virtual (vec0) | ANN vector search | 768-dimension FLOAT embeddings |
| `chunks_fts` | Virtual (FTS5) | Full-text search | Content column, chunk_id UNINDEXED |

---

## Module: `src/store/documents.ts`

Document and chunk CRUD operations.

### `insertDocument(doc)`

Insert a single document into the store.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| doc | `SourceDocument` | Yes |

---

### `insertChunks(chunks)`

Insert multiple document chunks in a transaction.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| chunks | `DocumentChunk[]` | Yes |

---

### `deleteDocument(id)`

Delete a document and its chunks (cascading via foreign key).

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| id | string | Yes |

---

### `findDocumentByFilename(filename)`

Find a document by its filename (source path).

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| filename | string | Yes |

**Returns:** `SourceDocument | null`

---

### `listDocuments()`

List all documents (without chunks), ordered by `ingested_at DESC`.

**Returns:** `SourceDocument[]`

---

### `getDocument(id)`

Get a document by ID, including its chunks ordered by `chunk_index ASC`.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| id | string | Yes |

**Returns:** `(SourceDocument & { chunks: DocumentChunk[] }) | null`

---

## Module: `src/store/vectors.ts`

Vector embedding storage and ANN similarity search via sqlite-vec.

### Types

```typescript
export interface VectorSearchFilters {
  documentId?: string
}
```

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `VEC_DIMENSION` | `768` | Fixed embedding dimension |

### `insertEmbedding(chunkId, vector)`

Insert or update an embedding vector for a chunk.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| chunkId | string | Yes | Matching chunk ID |
| vector | number[] | Yes | 768-dimension embedding |

**Throws:** If `vector.length` does not match `VEC_DIMENSION` (768).

---

### `searchSimilar(query, limit, filters?)`

Search for similar chunks using ANN via sqlite-vec.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | number[] | Yes | — | Query embedding vector |
| limit | number | Yes | — | Maximum results to return |
| filters | `VectorSearchFilters` | No | — | Optional document filter |

**Returns:** `SearchResult[]` — ordered by distance (ascending, lower = more similar). Distance is raw from sqlite-vec, not yet normalized to similarity.

**Throws:** If `query.length` does not match `VEC_DIMENSION` (768).

**Implementation:**
1. ANN search via `vec_chunks` virtual table (`WHERE embedding MATCH ?`)
2. Join with `chunks` and `documents` tables for full result data
3. Optional document-level filter applied after ANN join

---

## Module: `src/graph/index.ts`

Graph data persistence (entities + relationships to SQLite).

### `storeGraphData(entities, relationships)`

Store entities and relationships in the SQLite graph database.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| entities | `Entity[]` | Yes |
| relationships | `Relationship[]` | Yes |

**Behavior:**
- Creates a stub document (`__graph__`) for FK constraints if entities reference chunks not yet in the database
- Uses a transaction for atomic insert
- `INSERT OR REPLACE` for deduplication
- Inserts chunk stubs automatically to satisfy FK constraints

---

## Module: `src/graph/extractor.ts`

Pattern-based entity and relationship extraction from document chunks.

### Types

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

### `extractEntitiesAndRelationships(chunks, options?)`

Extract entities and relationships from document chunks using pattern matching.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| chunks | `DocumentChunk[]` | Yes | Chunks to analyze |
| options | `ExtractorOptions` | No | Optional LLM callback |

**Returns:** `Promise<{ entities: Entity[]; relationships: Relationship[] }>`

**Entity extraction passes:**

| Pass | Pattern | Entity Type |
|------|---------|-------------|
| 1. Definition | `"X is a Y"`, `"X refers to Y"`, `"X is defined as Y"` | `definition` |
| 2. Formula | Lines containing `=`, `+`, `-`, `*`, `/`, `^` | `formula` |
| 3. Dates | Month name + day + optional year, standalone years 1000–2099 | `date` |
| 4. Capitalized | Multi-word terms, single proper nouns, all-uppercase acronyms | `concept` |

**Relationship extraction passes:**

| Pass | Pattern | Relationship Type | Confidence |
|------|---------|-------------------|------------|
| 1a. Depends on | `"X depends on Y"`, `"X requires Y"`, `"X uses Y"` | `depends_on` | 0.7 |
| 1b. Part of | `"X is part of Y"`, `"X belongs to Y"` | `part_of` | 0.8 |
| 1c. Example of | `"X is an example of Y"` | `example_of` | 0.75 |
| 1d. Defined by | Definition patterns where description contains a known entity | `defined_by` | 0.85 |
| 2. Co-occurrence | Entities appearing in same chunk (fallback) | `depends_on` | 0.4 |

**Stop words:** ~120 common English words (articles, pronouns, conjunctions, prepositions, auxiliary verbs, etc.) used to filter out spurious entity labels.

---

## Module: `src/graph/query.ts`

Graph traversal and query operations.

### `getEntity(id)`

Get a single entity by its ID.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| id | string | Yes |

**Returns:** `Entity | null` — `null` when not found.

---

### `getNeighbors(entityId, depth)`

Find all entities connected to `entityId` within `depth` hops via BFS.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| entityId | string | Yes | Starting entity ID |
| depth | number | Yes | Maximum traversal depth |

**Returns:** `Entity[]`

**Implementation:** Breadth-first traversal over the `relationships` table, deduplicating visited entities.

---

### `findPath(fromId, toId)`

Find the shortest path between two entities using BFS.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| fromId | string | Yes |
| toId | string | Yes |

**Returns:** `Entity[]` — ordered array from `fromId` to `toId`. Empty array when no path exists.

---

### `queryByType(type)`

Return all entities of a given type.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| type | `EntityType` | Yes |

**Returns:** `Entity[]`

---

### `searchEntities(query)`

Search entities by label or description (case-insensitive LIKE).

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| query | string | Yes |

**Returns:** `Entity[]` — ordered by label.

---

## Module: `src/study/cards.ts`

Study card creation (template-based) and SM-2 spaced repetition scheduling.

### `createCards(documentId, chunks)`

Create study cards from document chunks using template-based extraction. Cards are persisted to the database.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| documentId | string | Yes | Source document ID |
| chunks | `DocumentChunk[]` | Yes | Chunks to generate cards from |

**Returns:** `StudyCard[]` — cards with default SM-2 values (easeFactor=2.5, interval=0, repetitions=0, dueDate=now).

**Card generation patterns:**

| Pattern | Example | Generated Question |
|---------|---------|-------------------|
| Definition (`"X is/are ..."`) | `"Photosynthesis is the process..."` | `"What is Photosynthesis?"` |
| Process (`"X occurs/happens/involves..."`) | `"The CPU fetches instructions..."` | `"What does CPU involve?"` |
| Quoted-term | `"cat" is a command that...` | `"What is 'cat'?"` |
| Fallback | First sentence with a content word blanked | `"Fill in the blank: The ______ is..."` |

---

### `scheduleReview(cardId, quality)`

SM-2 scheduling algorithm. Updates a card's easeFactor, interval, repetitions, and dueDate.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| cardId | string | Yes | The card to review |
| quality | number | Yes | Review quality 0–5 |

**Quality scale:**
- `0` = Complete blackout
- `1–2` = Failed recall
- `3` = Recalled with difficulty
- `4` = Recalled after hesitation
- `5` = Perfect response

**Algorithm:**
- `quality < 3`: Failed recall → reset `repetitions=0`, `interval=1`
- `quality >= 3`: Successful recall → SM-2 interval doubling (1, 6, interval * easeFactor)
- Ease factor update: `EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))`
- Ease factor clamped to minimum 1.3

**Throws:** If `cardId` is not found.

---

### `getDueCards(limit?)`

Get cards that are due for review (`due_date <= now`), ordered by `due_date ASC`.

**Parameters:**
| Name | Type | Required | Default |
|------|------|----------|---------|
| limit | number | No | All due cards |

**Returns:** `StudyCard[]`

---

## Module: `src/study/quiz.ts`

Quiz generation and grading from study cards.

### `generateQuiz(documentIds, count?, types?)`

Generate a quiz from study cards extracted from the given documents.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| documentIds | string[] | Yes | — | Documents to generate questions from |
| count | number | No | 5 | Number of questions |
| types | `QuestionType[]` | No | All types | Allowed question types |

**Returns:** `Quiz` — persisted to the database.

**Question type cycling:** Questions cycle through `multiple_choice → true_false → fill_blank` (or the subset specified in `types`).

**Question generation strategies:**

| Type | Strategy | Distractors |
|------|----------|-------------|
| `multiple_choice` | Correct answer + 3 distractors from other card answers | Shuffled, padded with "None of the above" |
| `true_false` | 50% true (card answer), 50% false (negated statement) | Negation via pattern replacement |
| `fill_blank` | First content word (length ≥ 4, non-stop-word) blanked | Case-insensitive comparison |

**Throws:** If no study cards exist for the specified documents.

---

### `gradeQuiz(quizId, answers)`

Grade a quiz against stored answer keys.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| quizId | string | Yes | ID of the quiz to grade |
| answers | `Record<string, string>` | Yes | Map of questionId → user's answer |

**Returns:**
```typescript
{
  total: number
  correct: number
  score: number          // percentage 0–100
  details: Array<{
    questionId: string
    correct: boolean
    yourAnswer: string
    correctAnswer: string
  }>
}
```

**Grading rules:**
- `fill_blank`: case-insensitive comparison
- All other types: exact string match

**Throws:** If `quizId` is not found.

---

## Module: `src/study/exam.ts`

Timed exam mode — creates, starts, submits, and retrieves exam sessions.

### Types

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
  score: number            // percentage 0–100
  total: number
  correct: number
  timeTaken: number        // in seconds
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

### `createExam(documentIds, config)`

Create an exam with questions and timer config. Delegates question generation to `generateQuiz()`.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| documentIds | string[] | Yes |
| config | `ExamConfig` | Yes |

**Returns:** `Exam` — reuses the quiz ID as the exam ID.

---

### `startExam(examId)`

Start an exam — records the start time in the database. Creates a new exam session if one doesn't exist.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| examId | string | Yes |

**Returns:** `{ startedAt: Date }`

**Throws:** If the exam (quiz) doesn't exist in the database.

---

### `submitExam(examId, answers)`

Submit an exam — auto-grade, compute score percentage, persist submission.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| examId | string | Yes | Exam to submit |
| answers | `Record<string, string>` | Yes | Map of questionId → user's answer |

**Returns:**
```typescript
{
  score: number     // percentage 0–100
  total: number
  correct: number
  submittedAt: Date
}
```

**Throws:** If exam not found or has not been started.

---

### `getExamResult(examId)`

Get full exam result with score, time taken, and per-question results.

**Parameters:**
| Name | Type | Required |
|------|------|----------|
| examId | string | Yes |

**Returns:** `ExamResult`

**Throws:** If exam not found or has not been submitted.

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

### Lazy Singletons

The server initializes `QueryTool` and `IngestTool` lazily on first use. Database path resolves from `MIND_FORGE_DB_PATH` env var, defaulting to `~/.mind-forge/store.db`.

---

## Module: `src/mcp/ingest.tool.ts`

Ingestion pipeline: extract → embed → store → graph.

### Types

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
  extractFn?: typeof defaultExtract
  graphExtractFn?: typeof defaultGraphExtract
}
```

### `IngestTool`

```typescript
export class IngestTool {
  constructor(deps?: IngestToolDeps)

  /** Execute the full ingestion pipeline */
  async execute(input: IngestInput): Promise<IngestResult>
}
```

**Pipeline steps:**
1. Resolve mode (default: `"create"`)
2. Mode-specific checks (delete existing on `"replace"`, throw on duplicate `"create"`)
3. Extract document + chunks via `extract()`
4. Embed all chunk texts in parallel via `embedProvider.embed()`
5. Store document + chunks via `insertDocument()` / `insertChunks()`
6. Store embeddings (graceful degradation on failure)
7. Extract graph entities + relationships via `extractEntitiesAndRelationships()`
8. Store graph data (graceful degradation on failure)
9. Return structured `IngestResult`

**Mode behavior:**

| Mode | Behavior |
|------|----------|
| `"create"` (default) | Throws if document with same filename already exists |
| `"replace"` | Deletes existing document (cascading) before re-ingesting |
| `"append"` | Skips document insert (document already exists), adds new chunks |

**Graceful degradation:**
- Embedding failures → document and chunks are still stored, embeddings skipped
- Graph extraction failures → document, chunks, and embeddings still stored, graph skipped

---

## Module: `src/mcp/query.tool.ts`

Hybrid search query tool: vector similarity + graph enrichment + FTS5 full-text.

### Types

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

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `DEFAULT_LIMIT` | `10` | Default result count |
| `DEFAULT_MIN_SCORE` | `0.0` | Default minimum score threshold |
| `VECTOR_WEIGHT` | `0.7` | Vector similarity weight in hybrid merge |
| `FTS_WEIGHT` | `0.3` | FTS5 similarity weight in hybrid merge |
| `GRAPH_DEPTH` | `1` | Neighbor traversal depth for graph enrichment |

### `QueryTool`

```typescript
export class QueryTool {
  constructor(
    dbPath: string,
    embedConfig?: Record<string, unknown>,
    embedProvider?: EmbeddingProvider, // for test injection
  )

  /** Execute a hybrid search across vector, graph, and full-text indexes */
  async execute(input: QueryInput): Promise<SearchResult[]>
}
```

**Hybrid search steps:**

1. **Vector similarity search** — embed the query, ANN search via sqlite-vec, convert distance to similarity (`1 / (1 + distance)`)
2. **Graph-aware enrichment** — search entities matching query terms, fetch neighbors (depth 1), attach matching entities/relationships to vector results
3. **Full-text search (FTS5)** — build AND-joined keyword query from significant terms (stop words excluded), normalize BM25 scores to 0–1
4. **Hybrid merge** — weighted ranking: `finalScore = vectorSimilarity * 0.7 + ftsScore * 0.3`, dedup by chunk ID, filter by `minScore`, sort descending

**Graph enrichment details:**
- Query words are used to search entities by label/description
- Matched entities are enriched with 1-hop neighbors
- Entity type filter is applied during matching
- Relationships for matched entities are fetched and attached to results

**FTS5 query construction:**
- Stop words excluded (static list of ~30 common English words)
- Tokens are cleaned of special characters and joined with `AND` for precision
- FTS table is automatically synchronized with chunks table when counts differ

**Filtering:**
- `documentIds`: applied to both vector and FTS searches (vector uses first documentId only)
- `entityTypes`: applied during graph enrichment
- `minScore`: applied as a final filter on the merged score
