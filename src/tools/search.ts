import { z } from "zod";
import { search } from "../db.js";

export const searchShape = {
  query: z.string().describe("Search query (keywords)"),
  repo_id: z.string().optional().describe("Filter by repo ID"),
  type: z
    .enum(["observations", "memories"])
    .optional()
    .describe("Filter by table type"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max results (default 20)"),
} as const;

export type SearchInput = z.infer<z.ZodObject<typeof searchShape>>;

export function handleSearch(input: SearchInput) {
  const results = search({
    query: input.query,
    repo_id: input.repo_id,
    type: input.type,
    limit: input.limit,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ results, count: results.length }, null, 2),
      },
    ],
  };
}
