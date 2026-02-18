/** Observation kinds */
export type ObservationKind =
  | "turn_summary"
  | "file_change"
  | "tool_use"
  | "error"
  | "decision"
  | "custom";

/** Observation scope */
export type ObservationScope = "global" | "repo" | "thread";

/** Raw observation record */
export interface Observation {
  id: number;
  created_at: number;
  repo_id: string;
  thread_id: string | null;
  turn_id: string | null;
  scope: ObservationScope;
  cwd: string | null;
  kind: ObservationKind;
  title: string | null;
  content: string;
  meta_json: string | null;
}

/** Memory types */
export type MemoryType =
  | "decision"
  | "fix"
  | "rule"
  | "preference"
  | "pattern"
  | "architecture"
  | "lesson"
  | "custom";

/** Memory status */
export type MemoryStatus = "active" | "draft" | "superseded" | "quarantined";

/** Curated memory record */
export interface Memory {
  id: number;
  created_at: number;
  updated_at: number;
  repo_id: string;
  memory_type: MemoryType;
  title: string;
  body: string;
  importance: number;
  tags_json: string;
  source_obs_ids: string;
  pinned: number;
  expires_at: number | null;
  status: MemoryStatus;
}

/** Search result from FTS5 */
export interface SearchResult {
  id: number;
  table: "observations" | "memories";
  title: string | null;
  snippet: string;
  score: number;
  created_at: number;
  kind?: string;
  memory_type?: string;
}

/** Timeline entry */
export interface TimelineEntry {
  id: number;
  table: "observations" | "memories";
  title: string | null;
  created_at: number;
  kind?: string;
  memory_type?: string;
}

