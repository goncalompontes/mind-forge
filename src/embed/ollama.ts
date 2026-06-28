import { Ollama } from "ollama"
import type { EmbeddingProvider } from "../types.js"

// ── Config ───────────────────────────────────────────────────────────────

export interface OllamaConfig {
  /** Ollama server URL (default: http://127.0.0.1:11434) */
  baseUrl?: string
  /** Model name (default: nomic-embed-text) */
  model?: string
}

const DEFAULT_MODEL = "nomic-embed-text"
const FALLBACK_MODELS = ["all-minilm", "mxbai-embed-large"]

// ── Provider ─────────────────────────────────────────────────────────────

export function createOllamaProvider(config?: OllamaConfig): EmbeddingProvider {
  const model = config?.model ?? DEFAULT_MODEL
  const fallbacks = FALLBACK_MODELS.filter((m) => m !== model)

  // Build the full list of models to try (primary + fallbacks)
  const modelChain = [model, ...fallbacks]

  const client = new Ollama({ host: config?.baseUrl })

  async function embed(texts: string[]): Promise<number[][]> {
    const response = await client.embed({
      model,
      input: texts,
    })
    return response.embeddings
  }

  async function health(): Promise<boolean> {
    try {
      const { models } = await client.list()
      const modelNames = new Set(models.map((m) => m.name))

      // Check if any model in our chain is available
      for (const m of modelChain) {
        // Model names can include tags like "nomic-embed-text:latest"
        if (modelNames.has(m) || modelNames.has(`${m}:latest`)) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  return { embed, health }
}
