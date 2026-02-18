import { z } from "zod";
import { getPinnedMemories } from "../db.js";
import { detectRepoId } from "../repo.js";

export const importantShape = {
  repo_id: z.string().optional().describe("Repo ID (auto-detected if omitted)"),
} as const;

export type ImportantInput = z.infer<z.ZodObject<typeof importantShape>>;

function safeParseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const USAGE_GUIDE = `# codex-memory Usage Guide

## Available Tools

### search
Search observations and memories by keyword.
- Use when starting a new task to find relevant context
- Use when encountering unfamiliar code or patterns

### timeline
View events around a specific observation/memory in time.
- Use after search to understand context around a result
- Great for understanding "what happened before/after"

### get_observations
Fetch full details of specific observations by ID.
- Use after search/timeline to get full content (progressive disclosure)

### save_memory
Save a curated memory for future reference.
- Save decisions, lessons learned, bug fixes, patterns
- Set importance 4-5 for critical knowledge
- Pin memories that should always be in context

### __IMPORTANT (this tool)
Shows this guide + pinned memories.
- Call at session start to load persistent context

## Best Practices
1. Search before you start — check what you already know
2. Save decisions — not just what, but WHY
3. Pin sparingly — only truly essential knowledge
4. Tag consistently — helps future retrieval
`;

export function handleImportant(input: ImportantInput) {
  const repoId = input.repo_id ?? detectRepoId();
  const pinned = getPinnedMemories(repoId);

  const parts = [USAGE_GUIDE];

  if (pinned.length > 0) {
    parts.push("\n## Pinned Memories\n");
    for (const mem of pinned) {
      const tags = safeParseTags(mem.tags_json);
      parts.push(`### [${mem.id}] ${mem.title} (importance: ${mem.importance})`);
      parts.push(mem.body);
      parts.push(`_type: ${mem.memory_type} | repo: ${mem.repo_id} | tags: ${tags.join(", ")}_\n`);
    }
  } else {
    parts.push("\n_No pinned memories yet._");
  }

  return {
    content: [
      {
        type: "text" as const,
        text: parts.join("\n"),
      },
    ],
  };
}
