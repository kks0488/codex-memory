import { execFileSync } from "node:child_process";

/**
 * Detect repo_id from git remote origin URL.
 * Falls back to current directory basename if not in a git repo.
 */
export function detectRepoId(cwd?: string): string {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: cwd ?? process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Normalize: git@github.com:user/repo.git → user/repo
    // https://github.com/user/repo.git → user/repo
    const cleaned = remote
      .replace(/\.git$/, "")
      .replace(/^git@[^:]+:/, "")
      .replace(/^https?:\/\/[^/]+\//, "");

    return cleaned || "_unknown";
  } catch {
    // Not a git repo — use directory name
    const dir = cwd ?? process.cwd();
    return `_local/${dir.split("/").pop() ?? "unknown"}`;
  }
}
