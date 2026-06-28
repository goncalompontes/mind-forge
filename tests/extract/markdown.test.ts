import { describe, it, expect } from "vitest"
import { extractMarkdown } from "../../src/extract/markdown.js"
import { writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("extractMarkdown", () => {
  it("should extract plain markdown content", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const mdPath = join(tmpDir, "test.md")
    writeFileSync(mdPath, "# Hello\n\nThis is a **markdown** file.", "utf-8")

    try {
      const result = await extractMarkdown(mdPath)

      expect(result.document).toBeDefined()
      expect(result.document.format).toBe("md")
      expect(result.document.text).toContain("Hello")
      expect(result.document.text).toContain("**markdown**")
      expect(result.document.filename).toBe("test.md")
      // Chunking is handled by the orchestrator (src/extract/index.ts), not the individual extractor
      expect(result.chunks).toEqual([])
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should extract frontmatter metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const mdPath = join(tmpDir, "frontmatter.md")
    writeFileSync(
      mdPath,
      `---
title: My Document
author: Jane Doe
date: 2024-01-15
tags: [test, markdown]
---

# Content

This is the body.`,
      "utf-8",
    )

    try {
      const result = await extractMarkdown(mdPath)

      expect(result.document.title).toBe("My Document")
      expect(result.document.author).toBe("Jane Doe")
      expect(result.document.metadata).toMatchObject({
        date: "2024-01-15T00:00:00.000Z",
        tags: ["test", "markdown"],
      })
      expect(result.document.text).toContain("# Content")
      expect(result.document.text).toContain("This is the body.")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should use filename as title when no frontmatter", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-test-"))
    const mdPath = join(tmpDir, "no-frontmatter.md")
    writeFileSync(mdPath, "Just some text.", "utf-8")

    try {
      const result = await extractMarkdown(mdPath)
      expect(result.document.title).toBe("no-frontmatter")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("should throw on non-existent file", async () => {
    await expect(extractMarkdown("/nonexistent/file.md")).rejects.toThrow()
  })

  it("should throw on empty path", async () => {
    await expect(extractMarkdown("")).rejects.toThrow()
  })
})
