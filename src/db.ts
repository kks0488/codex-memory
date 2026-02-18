import Database from "better-sqlite3";
import { DB_PATH, ensureDirs } from "./paths.js";
import type {
  Observation,
  ObservationKind,
  ObservationScope,
  Memory,
  MemoryType,
  MemoryStatus,
  SearchResult,
  TimelineEntry,
} from "./types.js";

let _db: Database.Database | null = null;

/** Get or create the singleton database connection */
export function getDb(): Database.Database {
  if (_db) return _db;

  ensureDirs();
  _db = new Database(DB_PATH);

  // Performance pragmas
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  return _db;
}

/** Initialize schema + FTS5 tables */
function initSchema(db: Database.Database): void {
  // Note: db.exec() here is better-sqlite3's method for running SQL statements,
  // NOT child_process.exec(). All SQL is hardcoded schema definition.
  db.exec(`
    -- observations
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      repo_id TEXT NOT NULL,
      thread_id TEXT,
      turn_id TEXT,
      scope TEXT NOT NULL DEFAULT 'repo',
      cwd TEXT,
      kind TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_obs_repo ON observations(repo_id);
    CREATE INDEX IF NOT EXISTS idx_obs_created ON observations(created_at);
    CREATE INDEX IF NOT EXISTS idx_obs_thread ON observations(thread_id);

    -- memories
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      repo_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_obs_ids TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_mem_repo ON memories(repo_id);
    CREATE INDEX IF NOT EXISTS idx_mem_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_mem_pinned ON memories(pinned, status, repo_id, importance DESC);
    CREATE INDEX IF NOT EXISTS idx_obs_scope ON observations(scope);

    -- FTS5 for observations (repo_id UNINDEXED for filtering without indexing)
    CREATE VIRTUAL TABLE IF NOT EXISTS obs_fts USING fts5(
      title, content, repo_id UNINDEXED, content='observations', content_rowid='id'
    );

    -- FTS5 for memories (repo_id + memory_type UNINDEXED for filtering)
    CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(
      title, body, repo_id UNINDEXED, memory_type UNINDEXED, content='memories', content_rowid='id'
    );
  `);

  // FTS sync triggers — DROP + CREATE for idempotency
  // Note: db.exec() here is better-sqlite3's SQL method, NOT child_process.exec()
  db.exec(`
    -- observations FTS sync triggers
    DROP TRIGGER IF EXISTS obs_ai;
    CREATE TRIGGER obs_ai AFTER INSERT ON observations BEGIN
      INSERT INTO obs_fts(rowid, title, content, repo_id)
      VALUES (new.id, COALESCE(new.title, ''), new.content, new.repo_id);
    END;

    DROP TRIGGER IF EXISTS obs_au;
    CREATE TRIGGER obs_au AFTER UPDATE ON observations BEGIN
      INSERT INTO obs_fts(obs_fts, rowid, title, content, repo_id)
      VALUES ('delete', old.id, COALESCE(old.title, ''), old.content, old.repo_id);
      INSERT INTO obs_fts(rowid, title, content, repo_id)
      VALUES (new.id, COALESCE(new.title, ''), new.content, new.repo_id);
    END;

    DROP TRIGGER IF EXISTS obs_ad;
    CREATE TRIGGER obs_ad AFTER DELETE ON observations BEGIN
      INSERT INTO obs_fts(obs_fts, rowid, title, content, repo_id)
      VALUES ('delete', old.id, COALESCE(old.title, ''), old.content, old.repo_id);
    END;

    -- memories FTS sync triggers
    DROP TRIGGER IF EXISTS mem_ai;
    CREATE TRIGGER mem_ai AFTER INSERT ON memories BEGIN
      INSERT INTO mem_fts(rowid, title, body, repo_id, memory_type)
      VALUES (new.id, new.title, new.body, new.repo_id, new.memory_type);
    END;

    DROP TRIGGER IF EXISTS mem_au;
    CREATE TRIGGER mem_au AFTER UPDATE ON memories BEGIN
      INSERT INTO mem_fts(mem_fts, rowid, title, body, repo_id, memory_type)
      VALUES ('delete', old.id, old.title, old.body, old.repo_id, old.memory_type);
      INSERT INTO mem_fts(rowid, title, body, repo_id, memory_type)
      VALUES (new.id, new.title, new.body, new.repo_id, new.memory_type);
    END;

    DROP TRIGGER IF EXISTS mem_ad;
    CREATE TRIGGER mem_ad AFTER DELETE ON memories BEGIN
      INSERT INTO mem_fts(mem_fts, rowid, title, body, repo_id, memory_type)
      VALUES ('delete', old.id, old.title, old.body, old.repo_id, old.memory_type);
    END;
  `);
}

// ── Observation CRUD ──

export interface InsertObservationParams {
  repo_id: string;
  thread_id?: string | null;
  turn_id?: string | null;
  scope?: ObservationScope;
  cwd?: string | null;
  kind: ObservationKind;
  title?: string | null;
  content: string;
  meta_json?: string | null;
}

export function insertObservation(params: InsertObservationParams): number {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO observations (created_at, repo_id, thread_id, turn_id, scope, cwd, kind, title, content, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    now,
    params.repo_id,
    params.thread_id ?? null,
    params.turn_id ?? null,
    params.scope ?? "repo",
    params.cwd ?? null,
    params.kind,
    params.title ?? null,
    params.content,
    params.meta_json ?? null,
  );
  return Number(result.lastInsertRowid);
}

export function getObservationsByIds(ids: number[]): Observation[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM observations WHERE id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...ids) as Observation[];
}

// ── Memory CRUD ──

export interface InsertMemoryParams {
  repo_id: string;
  memory_type: MemoryType;
  title: string;
  body: string;
  importance?: number;
  tags?: string[];
  source_obs_ids?: number[];
  pinned?: boolean;
}

export function insertMemory(params: InsertMemoryParams): number {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO memories (created_at, updated_at, repo_id, memory_type, title, body, importance, tags_json, source_obs_ids, pinned, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `);
  const result = stmt.run(
    now,
    now,
    params.repo_id,
    params.memory_type,
    params.title,
    params.body,
    params.importance ?? 3,
    JSON.stringify(params.tags ?? []),
    JSON.stringify(params.source_obs_ids ?? []),
    params.pinned ? 1 : 0,
  );
  return Number(result.lastInsertRowid);
}

export function updateMemory(
  id: number,
  repo_id: string,
  updates: Partial<{
    title: string;
    body: string;
    importance: number;
    tags: string[];
    pinned: boolean;
    status: MemoryStatus;
  }>,
): boolean {
  const db = getDb();
  const sets: string[] = ["updated_at = ?"];
  const values: unknown[] = [Date.now()];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    values.push(updates.title);
  }
  if (updates.body !== undefined) {
    sets.push("body = ?");
    values.push(updates.body);
  }
  if (updates.importance !== undefined) {
    sets.push("importance = ?");
    values.push(updates.importance);
  }
  if (updates.tags !== undefined) {
    sets.push("tags_json = ?");
    values.push(JSON.stringify(updates.tags));
  }
  if (updates.pinned !== undefined) {
    sets.push("pinned = ?");
    values.push(updates.pinned ? 1 : 0);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }

  values.push(id, repo_id);
  const result = db
    .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ? AND repo_id = ?`)
    .run(...values);
  return result.changes > 0;
}

// ── FTS5 Search ──

export interface SearchParams {
  query: string;
  repo_id?: string;
  type?: "observations" | "memories";
  limit?: number;
}

export function search(params: SearchParams): SearchResult[] {
  const db = getDb();
  const limit = Math.min(params.limit ?? 20, 100);
  const results: SearchResult[] = [];

  // Escape FTS5 special characters in query
  const ftsQuery = params.query
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w}"`)
    .join(" OR ");

  if (!ftsQuery) return [];

  if (!params.type || params.type === "memories") {
    const repoFilter = params.repo_id ? "AND m.repo_id = ?" : "";
    const repoValues = params.repo_id ? [params.repo_id] : [];

    const memRows = db
      .prepare(
        `SELECT m.id, m.title, m.created_at, m.memory_type,
                snippet(mem_fts, 1, '>>>', '<<<', '...', 40) as snippet,
                rank as score
         FROM mem_fts
         JOIN memories m ON m.id = mem_fts.rowid
         WHERE mem_fts MATCH ? AND m.status = 'active' ${repoFilter}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, ...repoValues, limit) as Array<{
      id: number;
      title: string;
      created_at: number;
      memory_type: string;
      snippet: string;
      score: number;
    }>;

    for (const row of memRows) {
      results.push({
        id: row.id,
        table: "memories",
        title: row.title,
        snippet: row.snippet,
        score: Math.abs(row.score),
        created_at: row.created_at,
        memory_type: row.memory_type,
      });
    }
  }

  if (!params.type || params.type === "observations") {
    const repoFilter = params.repo_id ? "AND o.repo_id = ?" : "";
    const repoValues = params.repo_id ? [params.repo_id] : [];

    const obsRows = db
      .prepare(
        `SELECT o.id, o.title, o.created_at, o.kind,
                snippet(obs_fts, 1, '>>>', '<<<', '...', 40) as snippet,
                rank as score
         FROM obs_fts
         JOIN observations o ON o.id = obs_fts.rowid
         WHERE obs_fts MATCH ? ${repoFilter}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, ...repoValues, limit) as Array<{
      id: number;
      title: string | null;
      created_at: number;
      kind: string;
      snippet: string;
      score: number;
    }>;

    for (const row of obsRows) {
      results.push({
        id: row.id,
        table: "observations",
        title: row.title,
        snippet: row.snippet,
        score: Math.abs(row.score),
        created_at: row.created_at,
        kind: row.kind,
      });
    }
  }

  // Sort by score descending (higher = more relevant)
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Timeline ──

export interface TimelineParams {
  anchor_id: number;
  anchor_table?: "observations" | "memories";
  window_min?: number;
  repo_id?: string;
}

export function getTimeline(params: TimelineParams): TimelineEntry[] {
  const db = getDb();
  const windowMs = (params.window_min ?? 30) * 60 * 1000;
  const anchorTable = params.anchor_table === "memories" ? "memories" : "observations";

  // Get anchor timestamp and repo_id
  const anchor = db
    .prepare(`SELECT created_at, repo_id FROM ${anchorTable} WHERE id = ?`)
    .get(params.anchor_id) as { created_at: number; repo_id: string } | undefined;

  if (!anchor) return [];

  const repoId = params.repo_id ?? anchor.repo_id;
  const tMin = anchor.created_at - windowMs;
  const tMax = anchor.created_at + windowMs;

  const obsRows = db
    .prepare(
      `SELECT id, title, created_at, kind FROM observations
       WHERE created_at BETWEEN ? AND ? AND repo_id = ? ORDER BY created_at ASC`,
    )
    .all(tMin, tMax, repoId) as Array<{
    id: number;
    title: string | null;
    created_at: number;
    kind: string;
  }>;

  const memRows = db
    .prepare(
      `SELECT id, title, created_at, memory_type FROM memories
       WHERE created_at BETWEEN ? AND ? AND repo_id = ? AND status = 'active'
       ORDER BY created_at ASC`,
    )
    .all(tMin, tMax, repoId) as Array<{
    id: number;
    title: string;
    created_at: number;
    memory_type: string;
  }>;

  const entries: TimelineEntry[] = [
    ...obsRows.map((r) => ({
      id: r.id,
      table: "observations" as const,
      title: r.title,
      created_at: r.created_at,
      kind: r.kind,
    })),
    ...memRows.map((r) => ({
      id: r.id,
      table: "memories" as const,
      title: r.title,
      created_at: r.created_at,
      memory_type: r.memory_type,
    })),
  ];

  entries.sort((a, b) => a.created_at - b.created_at);
  return entries;
}

/** Get pinned memories for a repo (or global) */
export function getPinnedMemories(repo_id?: string): Memory[] {
  const db = getDb();
  if (repo_id) {
    return db
      .prepare(
        `SELECT * FROM memories WHERE pinned = 1 AND status = 'active'
         AND (repo_id = ? OR repo_id = '_global') ORDER BY importance DESC`,
      )
      .all(repo_id) as Memory[];
  }
  return db
    .prepare(
      `SELECT * FROM memories WHERE pinned = 1 AND status = 'active' ORDER BY importance DESC`,
    )
    .all() as Memory[];
}
