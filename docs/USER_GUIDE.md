# Mind Forge User Guide

A practical guide to installing, configuring, and using Mind Forge for document-based knowledge management and study.

---

## 1. Installation

### System Requirements

- **Node.js** >= 18 (ES2022 module support)
- **Ollama** (optional) — for local embeddings. Install from [ollama.ai](https://ollama.ai) and pull an embedding model:
  ```bash
  ollama pull nomic-embed-text
  ```
- **poppler-utils** (optional, for PDF extraction via `pdftotext`):
  ```bash
  # Debian/Ubuntu
  sudo apt install poppler-utils
  # Arch Linux
  sudo pacman -S poppler
  # macOS
  brew install poppler
  ```
- **Tesseract** (optional, for image OCR — only if using `tesseract.js` without built-in WASM):
  ```bash
  sudo apt install tesseract-ocr
  sudo apt install tesseract-ocr-eng  # English language data
  ```

### Install the Plugin

```bash
cd /path/to/your/project
npm install @mind-forge/plugin
npm run build
```

Or, from a local checkout:

```bash
git clone <repo-url>
cd mind-forge
npm install
npm run build
```

### Register in OpenCode

Add to your `opencode.json`:

```json
{
  "plugins": {
    "mind-forge": {
      "enabled": true
    }
  }
}
```

That's it. The plugin registers an MCP server named `"mind-forge"` with three tools: `ingest`, `query`, and `generate`. The LLM calls them automatically when you ask study-related questions in chat.

---

## 2. Quick Start

### Step 1: Ingest a document

Say in chat:

> **You:** Ingest the PDF at ~/papers/attention-is-all-you-need.pdf

Mind Forge responds with a summary:

```
Ingested: Attention Is All You Need
  Document ID: a1b2c3d4-...
  Format: pdf
  Chunks: 15
  Entities: 42
  Relationships: 18
  Ingested at: 2026-06-28T12:00:00.000Z
```

### Step 2: Query your knowledge base

> **You:** How does multi-head attention work?

```
Found 3 result(s):

[1] Score: 92.1%
    Document: Attention Is All You Need (attention-is-all-you-need.pdf)
    Chunk: "Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions..."
    Entities: Multi-Head Attention (concept), Attention (concept)

[2] Score: 84.7%
    Document: Attention Is All You Need (attention-is-all-you-need.pdf)
    Chunk: "The Transformer uses multi-head attention, with 8 heads in the base model..."
    Entities: Transformer (concept)
```

### Step 3: Generate study cards

> **You:** Generate study cards from the attention paper

Mind Forge replies with cards. Review them:

> **You:** Review my due cards

### Step 4: Create a quiz

> **You:** Create a quiz about the attention paper

Answer the questions in chat. When done:

> **You:** Grade quiz 123e4567-e89b-12d3-a456-426614174000 with answers: {"q1": "8", "q2": "true"}

---

## 3. Document Ingestion

### Supported Formats

| Format | How to Use | Auto-Detection |
|--------|-----------|----------------|
| PDF | Provide a file path (e.g. `~/doc.pdf`) | `.pdf` extension |
| DOCX | Provide a file path (e.g. `~/doc.docx`) | `.docx` extension |
| Markdown | Provide a file path (e.g. `~/doc.md` or `~/doc.mdx`) | `.md` or `.mdx` extension |
| Image | Provide a file path (e.g. `~/screenshot.png`) | `.png`, `.jpg`, `.jpeg`, `.webp` extension |
| URL | Provide a URL (e.g. `https://en.wikipedia.org/wiki/Transformer`) | `http://` or `https://` prefix |

### File Paths

Use absolute paths for reliability:

```
Ingest the PDF at /home/user/papers/transformer-attention.pdf
```

### URLs

Web pages are extracted using Mozilla's Readability for clean article content:

```
Ingest https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)
```

SSRF protection is built in: private IPs (loopback, RFC 1918, link-local) are rejected before any connection is made.

### Raw Text

To ingest raw text content directly, use the `md` format override:

```
Ingest "Photosynthesis is the process by which plants convert sunlight into chemical energy." with format md
```

### Ingestion Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `create` (default) | Throws if document with same filename exists | Fresh imports |
| `replace` | Deletes existing document, re-ingests from scratch | Updating a document |
| `append` | Adds chunks to an existing document | Supplementary material |

```
Ingest the PDF at ~/paper-update.pdf with mode replace
```

### OCR Language Configuration

For images with non-English text:

```
Ingest the image at ~/scanned-article.png with ocrLang por
```

Supported language codes: `eng` (default), `por`, `spa`, `fra`, `deu`, `ita`, `jpn`, `chi_sim`, `chi_tra`, `kor`, `ara`, `hin` (and any language supported by your Tesseract installation).

### Chunk Size

Default chunk size is 1000 tokens (~4000 characters). Adjust for your content:

```
Ingest the PDF at ~/code-reference.pdf with chunkSize 500
```

Smaller chunks (500 tokens) are better for code or dense technical content. Larger chunks (2000 tokens) work for prose.

---

## 4. Searching Your Knowledge Base

### Natural Language Queries

Ask questions in plain English. The query tool uses hybrid search combining:

1. **Vector similarity** (70% weight) — semantic understanding
2. **Full-text search** (30% weight) — keyword matching via FTS5
3. **Graph enrichment** — entities and relationships matching your query

```
Query: explain the transformer architecture
```

### Filters

Refine results with optional filters:

```
Query: attention mechanisms
  filters: {
    "documentIds": ["a1b2c3d4-..."],
    "entityTypes": ["concept", "definition"],
    "limit": 5,
    "minScore": 0.5
  }
```

| Filter | Type | Description |
|--------|------|-------------|
| `documentIds` | string[] | Restrict to specific documents |
| `entityTypes` | string[] | Filter results by entity type (concept, person, date, term, formula, definition) |
| `limit` | number | Maximum results (default: 10) |
| `minScore` | number | Minimum relevance score 0.0–1.0 (default: 0.0) |

### Understanding Scores

Results are scored from 0.0 (low relevance) to 1.0 (high relevance). The score is a weighted hybrid:

```
finalScore = vectorSimilarity * 0.7 + ftsScore * 0.3
```

A score above 0.7 usually indicates a strong match. Results below 0.3 may be tangentially related.

---

## 5. Study Tools

### Creating Study Cards

Cards are generated automatically from document chunks using template patterns:

```
Generate type cards from documentIds ["a1b2c3d4-..."]
```

**Card generation patterns:**
- Definition sentences (`"X is..."`) → `"What is X?"`
- Process sentences (`"X involves..."`) → `"What does X involve?"`
- Quoted terms (`"'cat' is..."`) → `"What is 'cat'?"`
- Fallback: fill-in-the-blank from the first sentence

### SM-2 Spaced Repetition Review

Mind Forge implements the SM-2 algorithm (used by Anki and SuperMemo).

**Review flow:**

1. Get due cards:
   ```
   Generate type review from documentIds ["a1b2c3d4-..."]
   ```

2. Answer each card in your head (or out loud).

3. Schedule a card after review (quality 0–5):
   - **0**: Complete blackout — reset card to new
   - **1–2**: Failed recall — interval resets to 1 day
   - **3**: Recalled with difficulty — interval continues
   - **4**: Recalled after hesitation — interval continues
   - **5**: Perfect response — interval doubles

Cards with `quality < 3` are reset to a 1-day interval. Cards with `quality >= 3` follow the SM-2 doubling schedule (1 day, 6 days, then interval × ease factor).

### Generating Quizzes

Quizzes are generated from study cards. Three question types cycle through:

```
Generate type quiz from documentIds ["a1b2c3d4-..."] with questionCount 10
```

| Type | Format | Grading |
|------|--------|---------|
| multiple_choice | Question + 4 options (1 correct, 3 distractors) | Exact match |
| true_false | Statement that is either true or false | Exact match |
| fill_blank | Sentence with one word blanked | Case-insensitive |

To grade a quiz, send your answers:

```
Grade quiz 123e4567-e89b-12d3-a456-426614174000 with answers: {
  "q-id-1": "Transformer",
  "q-id-2": "true",
  "q-id-3": "attention"
}
```

You'll get back:
```
Score: 66% (2/3 correct)
```

### Taking Timed Exams

Create an exam with a time limit:

```
Generate type exam from documentIds ["a1b2c3d4-..."] with questionCount 20 and durationMinutes 30
```

Start the exam (records the start time):

```
Start exam 123e4567-e89b-12d3-a456-426614174000
```

When you're done, submit your answers:

```
Submit exam 123e4567-e89b-12d3-a456-426614174000 with answers: {...}
```

Check your results:

```
Get exam result 123e4567-e89b-12d3-a456-426614174000
```

**Note:** Exam duration tracking is informational. Mind Forge records time taken but does not auto-submit on timeout.

---

## 6. Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MIND_FORGE_DB_PATH` | `~/.mind-forge/store.db` | SQLite database file path |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |

### Embedding Provider

Mind Forge tries Ollama first (auto mode). Configure provider selection programmatically:

| Mode | Description | Requires |
|------|-------------|----------|
| `auto` (default) | Tries Ollama first, falls back to API provider | Ollama running OR API key configured |
| `ollama` | Use Ollama embeddings only | Ollama server running |
| `llm` | Use OpenAI-compatible API | `apiKey` in configuration |

**Ollama embedding models** (auto-fallback chain):
1. `nomic-embed-text` (default, recommended)
2. `all-minilm` (fallback)
3. `mxbai-embed-large` (second fallback)

**LLM provider defaults:**
- API URL: `https://api.openai.com/v1`
- Model: `text-embedding-3-small`

### Chunk Size

Default: **1000 tokens** (~4000 characters). Adjust per-ingestion via the `chunkSize` parameter.

The chunking algorithm is paragraph-aware:
1. Split on double-newlines (paragraphs)
2. If a paragraph exceeds the limit, split by sentence boundaries
3. Never break mid-sentence

### Default Database Path

The database is stored at `~/.mind-forge/store.db` by default. Change this by setting the `MIND_FORGE_DB_PATH` environment variable before starting OpenCode.

---

## 7. Troubleshooting

### "Could not detect document format"

Mind Forge could not determine the format from the file extension or URL pattern. Specify the format explicitly:

> Ingest the file at ~/myfile with format pdf

Supported formats: `pdf`, `docx`, `md`, `image`, `url`.

### "Document already exists"

The document with the same filename is already in the database. Use `mode: "replace"` to re-ingest or `mode: "append"` to add more chunks:

> Ingest the PDF at ~/paper.pdf with mode replace

### Ollama connection issues

If you see "Could not load embedding provider — check Ollama is running":

1. Verify Ollama is running: `ollama list`
2. Pull the embedding model: `ollama pull nomic-embed-text`
3. Check the Ollama host URL: `curl http://127.0.0.1:11434/api/tags`

If Ollama is not available, Mind Forge still ingests documents and creates chunks. You'll be able to search via FTS5 (keyword search) but semantic (vector) search will be unavailable. Study cards, quizzes, and exams still work.

### OCR not found / tesseract errors

Mind Forge uses `tesseract.js` which has a built-in WASM engine for English. For other languages, you need:

1. Install Tesseract (see Installation section above)
2. Install the language data pack: `sudo apt install tesseract-ocr-por` (for Portuguese)
3. The `tesseract.js` library finds system Tesseract automatically if installed

If OCR extraction fails:
- Check that the image format is supported (PNG, JPG, JPEG, WebP)
- Try a different OCR language (`ocrLang por`)
- For very large images, reduce resolution before extraction

### Large document handling

- **PDFs**: Large PDFs (>100 pages) are chunked efficiently. The chunking algorithm prevents memory issues.
- **URLs**: Response body is limited to 10 MB. Very large pages may be truncated.
- **Images**: OCR has no explicit size limit, but very large images (>10 MB) may be slow. Downsize before ingestion.
- **Embeddings**: All chunk texts are embedded in parallel. For very large documents with hundreds of chunks, embedding may take time depending on your Ollama/API provider.

### "No results found" for query queries

1. Make sure the document was ingested successfully (check the ingestion response for chunk count > 0)
2. Vector search requires embeddings. If Ollama/API was down during ingestion, embeddings were skipped. Re-ingest with `mode: replace` after fixing the embedding provider.
3. FTS5 fallback always works — try shorter query terms
4. Check that `minScore` is not set too high (default is 0.0)

### Database file location

The database is at `~/.mind-forge/store.db` by default. To see its size:

```bash
ls -lh ~/.mind-forge/store.db
```

To inspect contents (requires sqlite3 CLI):

```bash
sqlite3 ~/.mind-forge/store.db ".tables"
sqlite3 ~/.mind-forge/store.db "SELECT id, title, format FROM documents"
```

### Graceful Degradation Summary

Mind Forge is designed to degrade gracefully when components fail:

| Failure | What still works | What's degraded |
|---------|-----------------|-----------------|
| Ollama down | Ingestion, FTS5 search, study tools | Vector search |
| Graph extraction | Ingestion, search, study tools | Entity/relationship enrichment in search |
| Embedding API | Ingestion, FTS5 search, study tools | Vector search |
| OCR fails on one page | Other pages, other documents | That specific image |
| Extract fails on unsupported format | Error message with supported formats | That specific file |
