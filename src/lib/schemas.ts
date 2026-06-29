import { z } from "zod"

export const IngestInputSchema = z.object({
  sources: z.array(z.string().min(1)).min(1).optional(),
  pattern: z.string().min(1).optional(),
  format: z.enum(["pdf", "docx", "md", "image", "url"]).optional(),
  ocrLang: z.string().min(1).optional(),
  chunkSize: z.number().int().positive().max(10000).optional().default(1000),
  mode: z.enum(["create", "replace", "append"]).optional().default("create"),
  tags: z.array(z.string().min(1).max(255)).optional(),
}).refine(data => data.sources !== undefined || data.pattern !== undefined, {
  message: "Either sources[] or pattern must be provided",
}).refine(data => !(data.sources !== undefined && data.pattern !== undefined), {
  message: "Provide either sources[] or pattern, not both",
})

export const QueryInputSchema = z.object({
  query: z.string().min(1, "query is required"),
  filters: z.object({
    documentIds: z.array(z.string()).optional(),
    entityTypes: z.array(z.string()).optional(),
    limit: z.number().int().positive().max(100).optional().default(10),
    minScore: z.number().min(0).max(1).optional().default(0),
    tags: z.array(z.string().min(1).max(255)).optional(),
  }).optional(),
})

export const GenerateInputSchema = z.object({
  type: z.enum(["cards", "quiz", "exam", "review"]),
  documentIds: z.array(z.string()).min(1, "at least one document ID is required"),
  count: z.number().int().positive().max(50).optional(),
  durationMinutes: z.number().int().positive().max(180).optional(),
})

export const SummarizeInputSchema = z.object({
  documentIds: z.array(z.string()).min(1).optional(),
  tags: z.array(z.string().min(1).max(255)).min(1).optional(),
  format: z.enum(["structured", "narrative", "both"]).optional().default("both"),
  maxLength: z.number().int().positive().max(10000).optional().default(2000),
}).refine(data => data.documentIds !== undefined || data.tags !== undefined, {
  message: "Either documentIds[] or tags must be provided",
}).refine(data => !(data.documentIds !== undefined && data.tags !== undefined), {
  message: "Provide either documentIds[] or tags, not both",
})

export type IngestInput = z.infer<typeof IngestInputSchema>
export type QueryInput = z.infer<typeof QueryInputSchema>
export type GenerateInput = z.infer<typeof GenerateInputSchema>
export type SummarizeInput = z.infer<typeof SummarizeInputSchema>
