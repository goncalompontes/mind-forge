# Contributing to Mind Forge

## Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/goncalompontes/mind-forge.git
cd mind-forge

# 2. Install dependencies
npm install

# 3. Build the project
npm run build
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npx vitest run --coverage
```

## Type Checking

```bash
npm run typecheck
```

Run type checking before committing to catch type errors early.

## Code Style

Mind Forge follows these conventions:

### TypeScript Strict Mode

The project uses TypeScript strict mode. No implicit `any` types, no unchecked index access, no `null` without explicit checking.

### Branded IDs

Domain IDs (`DocumentId`, `ChunkId`, `EntityId`, `RelationshipId`, `CardId`, `QuizId`, `ExamId`) are branded string types to prevent mixing IDs at the type level:

```typescript
export type DocumentId = string & { readonly __brand: "DocumentId" }
```

Use the corresponding `createXxxId()` helper function when constructing IDs:
```typescript
import { createDocumentId } from "../lib/branded-ids.js"
const id = createDocumentId(raw)
```

### Zod Validation

All MCP tool inputs are validated at runtime via Zod schemas defined in `src/lib/schemas.ts`. When adding a new tool or modifying an existing one:

1. Add or update the corresponding Zod schema
2. Export the inferred type (`z.infer<typeof Schema>`)
3. Validate inputs in the tool handler before execution

### Error Handling

All domain errors extend `MindForgeError` (defined in `src/lib/errors.ts`):

| Error Class | When to Use |
|-------------|-------------|
| `ValidationError` | Invalid input from the user or LLM |
| `DatabaseError` | Database failures |
| `EmbeddingError` | Embedding provider failures |
| `ExtractionError` | Document extraction failures |

Embedding and graph extraction failures should degrade gracefully — log the warning and continue rather than aborting the entire ingestion pipeline.

### Imports

Use explicit `.js` extensions in import paths (required for ESM):

```typescript
import { getDatabase } from "./database.js"
```

### Commit Messages

Use conventional commit format:

```
type(scope): description

feat(ingest): add tags parameter to ingest tool
fix(query): correct FTS5 score normalization
refactor(store): split queries into domain modules
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.

## Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes with atomic commits
3. Run `npm run typecheck` and `npm test` — all must pass
4. Push your branch and open a pull request
5. Describe what your change does and why

## Project Structure

```
src/
├── lib/           # Shared utilities (config, errors, logger, schemas, branded-ids)
├── embed/         # Embedding providers (Ollama, API)
├── extract/       # Document extractors (PDF, DOCX, Markdown, Image, URL)
├── store/         # SQLite persistence (query modules by domain)
├── graph/         # Knowledge graph (extraction, storage, traversal)
├── study/         # Study tools (cards, quiz, exam)
├── mcp/           # MCP server and tool handlers
├── types.ts       # Shared domain types
└── index.ts       # Plugin entry point
```

See [AGENTS.md](AGENTS.md) for full architecture decisions and implementation notes.
