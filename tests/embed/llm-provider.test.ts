import { describe, it, expect, vi, beforeEach } from "vitest"
import { createLLMEmbeddingProvider } from "../../src/embed/llm-provider.js"

// ── Mocks ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// ── Tests ────────────────────────────────────────────────────────────────

describe("createLLMEmbeddingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should embed a single text via OpenAI-compatible API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          model: "text-embedding-3-small",
          usage: { total_tokens: 4 },
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "text-embedding-3-small",
    })

    const result = await provider.embed(["hello world"])

    expect(result).toEqual([[0.1, 0.2, 0.3]])
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const callUrl = mockFetch.mock.calls[0][0]
    const callOpts = mockFetch.mock.calls[0][1]
    expect(callUrl).toContain("embeddings")
    expect(callOpts.method).toBe("POST")
    expect(callOpts.headers["Authorization"]).toBe("Bearer sk-test")
  })

  it("should embed multiple texts in batch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
          ],
          model: "text-embedding-3-small",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    })

    const result = await provider.embed(["text a", "text b"])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2])
    expect(result[1]).toEqual([0.3, 0.4])
  })

  it("should return empty array for empty input", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [],
          model: "text-embedding-3-small",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    })

    const result = await provider.embed([])
    expect(result).toEqual([])
  })

  it("should return true from health() when API is reachable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1] }],
          model: "test",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    })

    const result = await provider.health()
    expect(result).toBe(true)
  })

  it("should return false from health() when API unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    })

    const result = await provider.health()
    expect(result).toBe(false)
  })

  it("should return false from health() when API returns error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-invalid",
    })

    const result = await provider.health()
    expect(result).toBe(false)
  })

  it("should handle responses with embeddings in any order by index", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { embedding: [0.5, 0.6], index: 1 },
            { embedding: [0.1, 0.2], index: 0 },
          ],
          model: "text-embedding-3-small",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    })

    const result = await provider.embed(["first", "second"])

    // Results should be in input order (sorted by index)
    expect(result[0]).toEqual([0.1, 0.2])
    expect(result[1]).toEqual([0.5, 0.6])
  })

  it("should use default OpenAI endpoint when no apiUrl provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1] }],
          model: "text-embedding-3-small",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiKey: "sk-test",
    })

    await provider.embed(["test"])

    const callUrl = mockFetch.mock.calls[0][0]
    expect(callUrl).toBe("https://api.openai.com/v1/embeddings")
  })

  it("should use custom apiUrl with embeddings endpoint appended", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1] }],
          model: "test",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiUrl: "https://custom-llm.example.com/v1",
      apiKey: "sk-test",
    })

    await provider.embed(["test"])

    const callUrl = mockFetch.mock.calls[0][0]
    expect(callUrl).toBe("https://custom-llm.example.com/v1/embeddings")
  })

  it("should use default model when not specified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: [0.1] }],
          model: "text-embedding-3-small",
        }),
    })

    const provider = createLLMEmbeddingProvider({
      apiKey: "sk-test",
    })

    await provider.embed(["test"])

    const callOpts = mockFetch.mock.calls[0][1]
    const body = JSON.parse(callOpts.body)
    expect(body.model).toBe("text-embedding-3-small")
  })
})
