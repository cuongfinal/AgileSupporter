import fs from "node:fs";
import path from "node:path";
import type { Staleness, StoredReview, StoredSpec, StoredTests, Ticket, TicketSummary } from "@/lib/types";
import { cacheGet, cacheSet, latestGet, latestSet, runAi } from "./ai";
import { HttpError } from "./api";
import { getIssue } from "./jira";
import { getSettings } from "./settings";
import { readSkillFile } from "./skills";
import { activeRepos } from "./repos";
import {
  PROMPT_VERSION,
  reviewPrompt,
  reviewSchema,
  specPrompt,
  specSchema,
  summaryPrompt,
  summarySchema,
  testsPrompt,
  testsSchema,
} from "./prompts";
import { logUsage } from "./ai";
import { runPool, startJob } from "./jobs";
import { hashKey, safeName } from "./store";

export function latestSummary(key: string): TicketSummary | null {
  return latestGet<TicketSummary>("summary", safeName(key));
}

export function latestReview(key: string): StoredReview | null {
  return latestGet<StoredReview>("review", safeName(key));
}

/** Only what the AI reads; status/assignee changes don't make a result stale. */
export function contentHash(t: Ticket): string {
  return hashKey(t.summary, t.descriptionMd, t.acMd);
}

export function staleness(t: Ticket, rec: { ticketHash?: string } | null, at: string | undefined): Staleness | null {
  if (!rec) return null;
  if (rec.ticketHash) return rec.ticketHash === contentHash(t) ? null : { state: "stale", reason: "content" };
  return at && new Date(t.updated) > new Date(at) ? { state: "maybe", reason: "updated" } : null;
}

export function specStaleness(t: Ticket, s: StoredSpec | null): Staleness | null {
  const own = staleness(t, s, s?.generatedAt);
  if (own || !s) return own;
  const r = latestReview(t.key);
  if (r && s.reviewedAt !== undefined && r.reviewedAt !== s.reviewedAt) return { state: "stale", reason: "review" };
  return null;
}

export function latestTests(key: string): StoredTests | null {
  return latestGet<StoredTests>("tests", safeName(key));
}

export async function tests(t: Ticket, force = false): Promise<{ tests: StoredTests; cached: boolean }> {
  const review = latestReview(t.key);
  const cacheKey = [t.key, contentHash(t), PROMPT_VERSION.tests, review?.reviewedAt ?? null, getSettings().glossary];
  if (!force) {
    const hit = cacheGet<StoredTests>("tests", ...cacheKey);
    if (hit) {
      latestSet("tests", t.key, hit);
      logUsage({ ts: new Date().toISOString(), task: "tests", provider: "cache", ms: 0, ok: true });
      return { tests: hit, cached: true };
    }
  }
  const { data } = await runAi({
    task: "tests",
    prompt: testsPrompt(t, latestSummary(t.key), review, getSettings().glossary),
    schema: testsSchema,
    timeoutMs: 5 * 60 * 1000,
  });
  const stored: StoredTests = { ...data, generatedAt: new Date().toISOString(), ticketHash: contentHash(t), usedReview: !!review };
  cacheSet("tests", stored, ...cacheKey);
  latestSet("tests", t.key, stored);
  return { tests: stored, cached: false };
}

export function latestSpec(key: string): StoredSpec | null {
  return latestGet<StoredSpec>("spec", safeName(key));
}

export async function spec(t: Ticket, force = false): Promise<{ spec: StoredSpec; cached: boolean }> {
  const repos = await activeRepos();
  if (!repos.length) throw new HttpError(400, "No source repo is configured (Settings → Source repos).");
  const review = latestReview(t.key);
  const cacheKey = [
    t.key,
    t.updated,
    PROMPT_VERSION.spec,
    repos.map((r) => [r.key, r.status.branch, r.status.head, r.status.dirty]),
    review?.reviewedAt ?? null,
  ];
  if (!force) {
    const hit = cacheGet<StoredSpec>("spec", ...cacheKey);
    if (hit) {
      latestSet("spec", t.key, hit);
      logUsage({ ts: new Date().toISOString(), task: "spec", provider: "cache", ms: 0, ok: true });
      return { spec: hit, cached: true };
    }
  }
  const { data } = await runAi({
    task: "spec",
    prompt: specPrompt(
      t,
      latestSummary(t.key),
      review,
      repos.map((r) => ({ key: r.key, dir: r.dir, path: r.path, branch: r.status.branch })),
      readSkillFile("references", "architecture.md"),
      getSettings().glossary,
    ),
    schema: specSchema,
    readDirs: repos.map((r) => r.path),
    timeoutMs: 15 * 60 * 1000,
  });
  const stored: StoredSpec = {
    markdown: data.markdown.trim() + "\n",
    inScope: data.inScope,
    generatedAt: new Date().toISOString(),
    ticketHash: contentHash(t),
    reviewedAt: review?.reviewedAt ?? null,
    repos: Object.fromEntries(repos.map((r) => [r.key, { branch: r.status.branch, head: r.status.head, dirty: r.status.dirty }])),
  };
  cacheSet("spec", stored, ...cacheKey);
  latestSet("spec", t.key, stored);
  return { spec: stored, cached: false };
}

/** Writes the spec where the workspace workflow (CLAUDE.md, workspace-dashboard) picks feature specs up. */
export function saveSpecToWorkspace(key: string, overwrite: boolean): { path: string } {
  const s = latestSpec(key);
  if (!s) throw new HttpError(404, "Generate the spec first.");
  const root = getSettings().workspaceRoot;
  const dir = root ? path.join(root, ".claude", "docs", "features") : "";
  if (!dir || !fs.existsSync(path.dirname(dir))) throw new HttpError(400, `Workspace .claude/docs not found under ${root || "(no workspace root)"}.`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeName(key)}.md`);
  if (fs.existsSync(file) && !overwrite) throw new HttpError(409, `exists:${file}`);
  fs.writeFileSync(file, s.markdown);
  return { path: file };
}

export function workspaceSpecPath(key: string): { path: string; exists: boolean } | null {
  const root = getSettings().workspaceRoot;
  if (!root || !fs.existsSync(path.join(root, ".claude"))) return null;
  const file = path.join(root, ".claude", "docs", "features", `${safeName(key)}.md`);
  return { path: file, exists: fs.existsSync(file) };
}

function summaryCacheKey(t: Ticket) {
  return [t.key, t.updated, PROMPT_VERSION.summary, getSettings().glossary];
}

export async function summarize(t: Ticket, force = false): Promise<{ summary: TicketSummary; cached: boolean }> {
  if (!force) {
    const hit = cacheGet<TicketSummary>("summary", ...summaryCacheKey(t));
    if (hit) {
      latestSet("summary", t.key, hit);
      logUsage({ ts: new Date().toISOString(), task: "summary", provider: "cache", ms: 0, ok: true });
      return { summary: hit, cached: true };
    }
  }
  const { data } = await runAi({ task: "summary", prompt: summaryPrompt(t, getSettings().glossary), schema: summarySchema, timeoutMs: 180000 });
  cacheSet("summary", data, ...summaryCacheKey(t));
  latestSet("summary", t.key, data);
  return { summary: data, cached: false };
}

export async function review(t: Ticket, force = false): Promise<{ review: StoredReview; cached: boolean }> {
  const repos = await activeRepos();
  if (!repos.length) throw new HttpError(400, "No source repo is configured (Settings → Source repos).");
  const cacheKey = [
    t.key,
    t.updated,
    PROMPT_VERSION.review,
    repos.map((r) => [r.key, r.status.branch, r.status.head, r.status.dirty]),
    getSettings().glossary,
  ];
  if (!force) {
    const hit = cacheGet<StoredReview>("review", ...cacheKey);
    if (hit) {
      latestSet("review", t.key, hit);
      logUsage({ ts: new Date().toISOString(), task: "review", provider: "cache", ms: 0, ok: true });
      return { review: hit, cached: true };
    }
  }
  const prompt = reviewPrompt(
    t,
    latestSummary(t.key),
    repos.map((r) => ({ key: r.key, label: r.label, path: r.path, branch: r.status.branch })),
    readSkillFile("references", "architecture.md"),
    getSettings().glossary,
  );
  const { data } = await runAi({
    task: "review",
    prompt,
    schema: reviewSchema,
    readDirs: repos.map((r) => r.path),
    timeoutMs: 15 * 60 * 1000,
  });
  const stored: StoredReview = {
    ...data,
    reviewedAt: new Date().toISOString(),
    ticketHash: contentHash(t),
    repos: Object.fromEntries(
      repos.map((r) => [r.key, { branch: r.status.branch, head: r.status.head, dirty: r.status.dirty, path: r.path }]),
    ),
  };
  cacheSet("review", stored, ...cacheKey);
  latestSet("review", t.key, stored);
  return { review: stored, cached: false };
}

export function startBatch(kind: "summary" | "review" | "spec" | "tests", keys: string[], force: boolean) {
  keys.forEach(safeName);
  const concurrency = kind === "summary" || kind === "tests" ? getSettings().ai.concurrency : 1;
  return startJob(kind, keys.length, async (ctx) => {
    for (const k of keys) ctx.item(k, "pending");
    let failed = 0;
    await runPool(keys, concurrency, async (key) => {
      ctx.item(key, "running");
      ctx.label(key);
      try {
        const t = await getIssue(key);
        const r =
          kind === "summary"
            ? await summarize(t, force)
            : kind === "review"
              ? await review(t, force)
              : kind === "spec"
                ? await spec(t, force)
                : await tests(t, force);
        ctx.item(key, r.cached ? "cached" : "done");
      } catch (e) {
        failed++;
        ctx.item(key, "error", e instanceof Error ? e.message : String(e));
      }
      ctx.step();
    });
    return { failed };
  });
}

export function refinementChecklist(tickets: Ticket[]): string {
  const lines = ["# Refinement checklist", "", `_Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}_`, ""];
  for (const t of tickets) {
    const r = latestReview(t.key);
    lines.push(`## ${t.key} — ${t.summary}`, "", `Status: ${t.status} · ${t.url}`, "");
    if (!r) {
      lines.push("_Not reviewed yet._", "");
      continue;
    }
    if (r.findings.length) {
      lines.push("### Findings");
      for (const f of r.findings) lines.push(`- [ ] **${f.severity.toUpperCase()}** (${f.kind}) ${f.en}${f.quote ? ` — _"${f.quote}"_` : ""}`);
      lines.push("");
    }
    if (r.questions.length) {
      lines.push("### Questions for PO/BA");
      for (const q of r.questions) lines.push(`- [ ] ${q.en}`);
      lines.push("");
    }
    const repos = Object.entries(r.repos).map(([k, v]) => `${k}@${v.branch} ${v.head}${v.dirty ? " (dirty)" : ""}`);
    lines.push(`_Reviewed against ${repos.join(", ")}_`, "");
  }
  return lines.join("\n");
}
