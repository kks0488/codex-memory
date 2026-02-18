import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Codex home directory */
export const CODEX_HOME = join(homedir(), ".codex");

/** codex-memory data directory */
export const MEM_HOME = join(CODEX_HOME, "memory");

/** SQLite database file path */
export const DB_PATH = join(MEM_HOME, "codex-memory.db");

/** Ensure data directory exists */
export function ensureDirs(): void {
  mkdirSync(MEM_HOME, { recursive: true });
}
