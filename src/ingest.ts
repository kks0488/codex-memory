import { insertObservation } from "./db.js";
import { detectRepoId } from "./repo.js";
import type { ObservationKind } from "./types.js";

/** Validated notify payload (from Zod in cli.ts) */
export interface ValidatedPayload {
  type: string;
  "thread-id"?: string;
  "turn-id"?: string;
  cwd?: string;
  "last-assistant-message"?: string;
  "input-messages"?: unknown[];
}

/**
 * Process a notify hook payload from Codex CLI.
 * Extracts relevant information and stores as observation(s).
 */
export function processNotify(payload: ValidatedPayload, repoId?: string): number[] {
  const repo = repoId ?? detectRepoId();
  const threadId = payload["thread-id"] ?? null;
  const ids: number[] = [];

  const turnId = payload["turn-id"] ?? null;
  const cwd = payload.cwd ?? null;
  const scope = threadId ? "thread" as const : "repo" as const;

  if (payload.type === "agent-turn-complete") {
    const lastMsg = payload["last-assistant-message"];
    if (lastMsg && lastMsg.trim().length > 0) {
      const title = extractTitle(lastMsg);
      const inputMessages = payload["input-messages"];
      const id = insertObservation({
        repo_id: repo,
        thread_id: threadId,
        turn_id: turnId,
        scope,
        cwd,
        kind: "turn_summary",
        title,
        content: lastMsg,
        meta_json: JSON.stringify({
          type: payload.type,
          ...(inputMessages?.length && { input_messages: inputMessages }),
        }),
      });
      ids.push(id);
    }
  } else {
    // Generic observation for other event types
    const content =
      payload["last-assistant-message"] ??
      JSON.stringify(payload);

    const id = insertObservation({
      repo_id: repo,
      thread_id: threadId,
      turn_id: turnId,
      scope,
      cwd,
      kind: mapEventKind(payload.type ?? ""),
      title: payload.type ?? "unknown",
      content,
      meta_json: JSON.stringify({ type: payload.type }),
    });
    ids.push(id);
  }

  return ids;
}

/** Extract a short title from the first line of content */
function extractTitle(content: string): string {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 77) + "...";
}

/** Map Codex event type to observation kind */
function mapEventKind(eventType: string): ObservationKind {
  if (eventType.includes("error")) return "error";
  if (eventType.includes("tool")) return "tool_use";
  if (eventType.includes("file")) return "file_change";
  if (eventType.includes("decision")) return "decision";
  return "custom";
}
