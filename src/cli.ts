#!/usr/bin/env node

import { z } from "zod";
import { processNotify } from "./ingest.js";

const notifyPayloadSchema = z.object({
  type: z.string(),
  "thread-id": z.string().optional(),
  "turn-id": z.string().optional(),
  cwd: z.string().optional(),
  "last-assistant-message": z.string().optional(),
  "input-messages": z.array(z.unknown()).optional(),
});

const args = process.argv.slice(2);
const command = args[0];

if (command === "notify") {
  const jsonStr = args[1];
  if (!jsonStr) {
    console.error("Usage: codex-memory notify '<json payload>'");
    process.exit(1);
  }

  try {
    const raw = JSON.parse(jsonStr);
    const parsed = notifyPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("Invalid notify payload:", parsed.error.format());
      process.exit(1);
    }
    const ids = processNotify(parsed.data);
    console.log(JSON.stringify({ ok: true, observation_ids: ids }));
  } catch (err) {
    console.error("Failed to process notify payload:", (err as Error).message);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Available commands: notify");
  process.exit(1);
}
