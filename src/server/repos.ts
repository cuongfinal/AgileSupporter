import fs from "node:fs";
import path from "node:path";
import type { RepoConfig, RepoStatus } from "@/lib/types";
import { HttpError } from "./api";
import { run } from "./exec";
import { getSettings } from "./settings";

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

function git(repoPath: string, args: string[], timeoutMs = 20000) {
  return run("git", ["-C", repoPath, ...args], { timeoutMs, env: GIT_ENV });
}

export function getRepo(key: string): RepoConfig {
  const repo = getSettings().repos.find((r) => r.key === key);
  if (!repo) throw new HttpError(404, `Unknown repo: ${key}`);
  return repo;
}

export async function validateRepoPath(p: string): Promise<{ ok: boolean; root: string; error?: string }> {
  if (!p || !path.isAbsolute(p)) return { ok: false, root: "", error: "Use an absolute path" };
  if (!fs.existsSync(p)) return { ok: false, root: "", error: "Path does not exist" };
  const r = await git(p, ["rev-parse", "--show-toplevel"]);
  if (r.code !== 0) return { ok: false, root: "", error: "Not a git repository" };
  return { ok: true, root: r.stdout.trim() };
}

export async function repoStatus(p: string): Promise<RepoStatus> {
  const empty: RepoStatus = { ok: false, branch: "", detached: false, head: "", dirty: false, ahead: null, behind: null, upstream: "" };
  const v = await validateRepoPath(p);
  if (!v.ok) return { ...empty, error: v.error };
  const [branch, head, porcelain, upstream] = await Promise.all([
    git(p, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(p, ["rev-parse", "--short", "HEAD"]),
    git(p, ["status", "--porcelain", "--untracked-files=no"]),
    git(p, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
  ]);
  const name = branch.stdout.trim();
  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstream.code === 0) {
    const c = await git(p, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    const [b, a] = c.stdout.trim().split(/\s+/).map(Number);
    if (c.code === 0) [ahead, behind] = [a, b];
  }
  return {
    ok: true,
    branch: name === "HEAD" ? head.stdout.trim() : name,
    detached: name === "HEAD",
    head: head.stdout.trim(),
    dirty: porcelain.stdout.trim().length > 0,
    ahead,
    behind,
    upstream: upstream.code === 0 ? upstream.stdout.trim() : "",
  };
}

export async function listBranches(p: string): Promise<{ current: string; local: string[]; remote: string[] }> {
  const r = await git(p, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
  if (r.code !== 0) throw new HttpError(400, r.stderr.trim() || "Could not list branches");
  const refs = r.stdout.split("\n").filter(Boolean);
  const local = refs.filter((x) => x.startsWith("refs/heads/")).map((x) => x.slice("refs/heads/".length));
  const remote = refs
    .filter((x) => x.startsWith("refs/remotes/") && !x.endsWith("/HEAD"))
    .map((x) => x.slice("refs/remotes/".length))
    .filter((x) => !local.includes(x.slice(x.indexOf("/") + 1)));
  const cur = await git(p, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return { current: cur.stdout.trim(), local: local.sort(), remote: remote.sort() };
}

export async function switchBranch(p: string, branch: string): Promise<{ ok: boolean; message: string }> {
  const { local, remote } = await listBranches(p);
  if (branch.startsWith("-")) throw new HttpError(400, "Invalid branch name");
  let args: string[];
  if (local.includes(branch)) args = ["switch", branch];
  else if (remote.includes(branch)) args = ["switch", "--track", branch];
  else throw new HttpError(400, `Branch not found: ${branch}`);
  const r = await git(p, args, 60000);
  const message = (r.stderr || r.stdout).trim();
  return r.code === 0 ? { ok: true, message } : { ok: false, message: message || `git exited with ${r.code}` };
}

export async function fetchRepo(p: string): Promise<{ ok: boolean; message: string }> {
  const r = await git(p, ["fetch"], 120000);
  const message = (r.stderr || r.stdout).trim();
  if (r.timedOut) return { ok: false, message: "git fetch timed out" };
  return r.code === 0 ? { ok: true, message } : { ok: false, message: message || `git exited with ${r.code}` };
}

export function suggestPath(dir: string): string {
  const root = getSettings().workspaceRoot;
  const guess = root ? path.join(root, dir) : "";
  return guess && fs.existsSync(path.join(guess, ".git")) ? guess : "";
}

/** Enabled repos with a valid path, plus their current checkout — what Review reads. */
export async function activeRepos() {
  const repos = getSettings().repos.filter((r) => r.enabled && r.path);
  const out = [];
  for (const r of repos) {
    const st = await repoStatus(r.path);
    if (st.ok) out.push({ ...r, status: st });
  }
  return out;
}
