import { z } from "zod";
import { getTimeline } from "../db.js";

export const timelineShape = {
  anchor_id: z.number().int().describe("ID of the anchor record"),
  anchor_table: z
    .enum(["observations", "memories"])
    .optional()
    .describe("Table of the anchor record (default: observations)"),
  window_min: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe("Time window in minutes (default 30)"),
  repo_id: z
    .string()
    .optional()
    .describe("Filter by repo ID (auto-detected from anchor if omitted)"),
} as const;

export type TimelineInput = z.infer<z.ZodObject<typeof timelineShape>>;

export function handleTimeline(input: TimelineInput) {
  const timeline = getTimeline({
    anchor_id: input.anchor_id,
    anchor_table: input.anchor_table,
    window_min: input.window_min,
    repo_id: input.repo_id,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ timeline, count: timeline.length }, null, 2),
      },
    ],
  };
}
