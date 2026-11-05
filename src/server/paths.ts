import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DATA_HOME = process.env.DEV_DASHBOARD_HOME || path.join(os.homedir(), ".dev-dashboard");

export function dataPath(...parts: string[]): string {
  return path.join(DATA_HOME, ...parts);
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Empty working dir for AI runs so no project CLAUDE.md / instructions leak into prompts. */
export function aiWorkDir(): string {
  return ensureDir(dataPath("work"));
}

/** First ancestor of the app that holds one of the given repo folders (a git checkout). */
export function detectWorkspaceRoot(repoDirs: string[]): string {
  if (!repoDirs.length) return "";
  let dir = path.dirname(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (repoDirs.some((r) => fs.existsSync(path.join(dir, r, ".git")))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}
