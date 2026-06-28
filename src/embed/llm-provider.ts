import type { EmbeddingProvider } from "../types.js"

// ── Config ───────────────────────────────────────────────────────────────

export interface LLMEmbeddingConfig {
  apiUrl?: string
  apiKey: string
  model?: string
}

const DEFAULT_API_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "text-embedding-3-small"

// ── Provider ─────────────────────────────────────────────────────────────

export function createLLMEmbeddingProvider(config: LLMEmbeddingConfig): EmbeddingProvider {
  const baseUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")
  const model = config.model ?? DEFAULT_MODEL

  async function embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Embedding API returned ${response.status}: ${response.statusText}`,
      )
    }

    const json = (await response.json()) as {
      data: { embedding: number[]; index: number }[]
    }

    // Sort by index to preserve input order
    const sorted = [...json.data].sort((a, b) => a.index - b.index)
    return sorted.map((d) => d.embedding)
  }

  async function health(): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: ["health check"],
        }),
      })

      return response.ok
    } catch {
      return false
    }
  }

  return { embed, health }
}
