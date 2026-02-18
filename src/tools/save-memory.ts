import { z } from "zod";
import { insertMemory, updateMemory } from "../db.js";
import { detectRepoId } from "../repo.js";

export const saveMemoryShape = {
  title: z.string().describe("Memory title"),
  body: z.string().describe("Memory content"),
  memory_type: z
    .enum(["decision", "fix", "rule", "preference", "pattern", "architecture", "lesson", "custom"])
    .describe("Type of memory"),
  repo_id: z.string().optional().describe("Repo ID (auto-detected if omitted)"),
  importance: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Importance 1-5 (default 3)"),
  tags: z.array(z.string()).optional().describe("Tags for categorization"),
  source_obs_ids: z
    .array(z.number().int())
    .optional()
    .describe("Observation IDs that led to this memory"),
  pinned: z.boolean().optional().describe("Pin this memory (always included in context)"),
  update_id: z
    .number()
    .int()
    .optional()
    .describe("If provided, update existing memory instead of creating"),
} as const;

export type SaveMemoryInput = z.infer<z.ZodObject<typeof saveMemoryShape>>;

export function handleSaveMemory(input: SaveMemoryInput) {
  const repoId = input.repo_id ?? detectRepoId();

  if (input.update_id) {
    const updated = updateMemory(input.update_id, repoId, {
      title: input.title,
      body: input.body,
      importance: input.importance,
      tags: input.tags,
      pinned: input.pinned,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            memory_id: input.update_id,
            updated,
            updated_at: Date.now(),
          }),
        },
      ],
    };
  }

  const memoryId = insertMemory({
    repo_id: repoId,
    memory_type: input.memory_type,
    title: input.title,
    body: input.body,
    importance: input.importance,
    tags: input.tags,
    source_obs_ids: input.source_obs_ids,
    pinned: input.pinned,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          memory_id: memoryId,
          created_at: Date.now(),
        }),
      },
    ],
  };
}
