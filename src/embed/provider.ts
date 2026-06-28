import type { EmbeddingProvider } from "../types.js"
import { createOllamaProvider, type OllamaConfig } from "./ollama.js"
import {
  createLLMEmbeddingProvider,
  type LLMEmbeddingConfig,
} from "./llm-provider.js"

// ── Config ───────────────────────────────────────────────────────────────

export interface EmbeddingConfig {
  /** Provider selection: "ollama", "llm", or "auto" (try Ollama first) */
  provider?: "auto" | "ollama" | "llm"
  /** Ollama-specific configuration */
  ollama?: OllamaConfig
  /** LLM-specific configuration (required when provider="llm") */
  llm?: LLMEmbeddingConfig
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider {
  const mode = config?.provider ?? "auto"

  if (mode === "ollama") {
    return createOllamaProvider(config?.ollama)
  }

  if (mode === "llm") {
    if (!config?.llm?.apiKey) {
      throw new Error(
        "LLM embedding provider requires an apiKey in config.llm",
      )
    }
    return createLLMEmbeddingProvider(config.llm)
  }

  // Auto mode: try Ollama first, fallback to LLM
  const ollamaProvider = createOllamaProvider(config?.ollama)

  // If LLM config has an apiKey, create a fallback provider
  const llmConfig = config?.llm
  const llmProvider =
    llmConfig?.apiKey
      ? createLLMEmbeddingProvider(llmConfig)
      : null

  // If no LLM fallback configured, just return Ollama
  if (!llmProvider) {
    return ollamaProvider
  }

  // Return a composite provider that tries Ollama first
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return ollamaProvider.embed(texts)
    },

    async health(): Promise<boolean> {
      const ollamaOk = await ollamaProvider.health()
      if (ollamaOk) return true

      return llmProvider.health()
    },
  }
}
