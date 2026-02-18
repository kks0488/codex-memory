#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { searchShape, handleSearch } from "./tools/search.js";
import { timelineShape, handleTimeline } from "./tools/timeline.js";
import { getObservationsShape, handleGetObservations } from "./tools/get-observations.js";
import { saveMemoryShape, handleSaveMemory } from "./tools/save-memory.js";
import { importantShape, handleImportant } from "./tools/important.js";

const server = new McpServer(
  {
    name: "codex-memory",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ── Tool: search ──
server.tool(
  "search",
  "Search observations and memories by keyword using FTS5. Returns progressive disclosure Layer 1 (titles + snippets + scores).",
  searchShape,
  async (args) => handleSearch(args),
);

// ── Tool: timeline ──
server.tool(
  "timeline",
  "View observations and memories around a specific record in time. Use after search to understand context.",
  timelineShape,
  async (args) => handleTimeline(args),
);

// ── Tool: get_observations ──
server.tool(
  "get_observations",
  "Fetch full details of specific observations by ID. Use for progressive disclosure Layer 3 (full content).",
  getObservationsShape,
  async (args) => handleGetObservations(args),
);

// ── Tool: save_memory ──
server.tool(
  "save_memory",
  "Save or update a curated memory. Use for decisions, lessons, patterns, rules, fixes.",
  saveMemoryShape,
  async (args) => handleSaveMemory(args),
);

// ── Tool: __IMPORTANT ──
server.tool(
  "__IMPORTANT",
  "Show usage guide and pinned memories. Call at session start to load persistent context.",
  importantShape,
  async (args) => handleImportant(args),
);

// ── Start server ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("codex-memory server failed:", err);
  process.exit(1);
});
