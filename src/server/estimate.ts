import fs from "node:fs";
import type { StoredEstimate, Ticket } from "@/lib/types";
import { cacheGet, cacheSet, latestGet, latestSet, logUsage, runAi } from "./ai";
import { contentHash, latestReview, latestSummary, staleness } from "./analysis";
import { HttpError } from "./api";
import { getIssue } from "./jira";
import { runPool, startJob } from "./jobs";
import { dataPath } from "./paths";
import { calibrationFor } from "./calibration";
import { ESTIMATE_SCALE, PROMPT_VERSION, estimatePrompt, estimateSchema } from "./prompts";
import { activeRepos } from "./repos";
import { getSettings } from "./settings";
import { readSkillFile } from "./skills";
import { removeFile, safeName } from "./store";

const snap = (n: number) => ESTIMATE_SCALE.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), ESTIMATE_SCALE[0]);
const step = (p: number, by: number) => ESTIMATE_SCALE[Math.max(0, Math.min(ESTIMATE_SCALE.length - 1, ESTIMATE_SCALE.indexOf(p) + by))];

/** Median of the chosen reference stories' real Jira points — the number the estimate is anchored to. */
function anchorOf(points: number[]): number | null {
  if (!points.length) return null;
  const s = [...points].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return snap(s.length % 2 ? s[mid] : Math.min(s[mid - 1], s[mid]));
}

export function latestEstimate(key: string): StoredEstimate | null {
  return latestGet<StoredEstimate>("estimate", safeName(key));
}

export function listEstimates(): StoredEstimate[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dataPath("latest", "estimate")).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => latestGet<StoredEstimate>("estimate", f.slice(0, -5)))
    .filter((x): x is StoredEstimate => !!x)
    .sort((a, b) => b.estimatedAt.localeCompare(a.estimatedAt));
}

export function deleteEstimate(key: string): void {
  removeFile(`latest/estimate/${safeName(key)}.json`);
}

/** Clears the history list; the AI cache stays, so re-estimating an unchanged story is instant. */
export function deleteAllEstimates(): number {
  const all = listEstimates();
  for (const e of all) deleteEstimate(e.key);
  return all.length;
}

export async function estimate(t: Ticket, force: boolean, code: boolean): Promise<{ estimate: StoredEstimate; cached: boolean }> {
  const repos = code ? await activeRepos() : [];
  if (code && !repos.length) throw new HttpError(400, "No source repo is configured (Settings → Source repos). Turn off 'Read source code' or add repos.");
  const review = latestReview(t.key);
  const cal = await calibrationFor(t);
  const cacheKey = [
    t.key,
    contentHash(t),
    PROMPT_VERSION.estimate,
    repos.map((r) => [r.key, r.status.branch, r.status.head, r.status.dirty]),
    review?.reviewedAt ?? null,
    [...cal.similar, ...cal.others].map((c) => [c.key, c.points]),
  ];
  if (!force) {
    const hit = cacheGet<StoredEstimate>("estimate", ...cacheKey);
    if (hit) {
      const fresh = { ...hit, jiraPoints: t.points };
      latestSet("estimate", t.key, fresh);
      logUsage({ ts: new Date().toISOString(), task: "estimate", provider: "cache", ms: 0, ok: true });
      return { estimate: fresh, cached: true };
    }
  }
  const { data } = await runAi({
    task: "estimate",
    prompt: estimatePrompt(
      t,
      latestSummary(t.key),
      review,
      repos.map((r) => ({ key: r.key, dir: r.dir, path: r.path, branch: r.status.branch })),
      code ? readSkillFile("references", "architecture.md") : "",
      cal,
      getSettings().glossary,
    ),
    schema: estimateSchema,
    readDirs: repos.map((r) => r.path),
    timeoutMs: (code ? 15 : 5) * 60 * 1000,
  });
  const known = new Map([...cal.similar, ...cal.others].map((c) => [c.key, c]));
  // Drop references the model made up: only stories from the calibration list are real, with their real points.
  const references = data.references
    .filter((r) => known.has(r.key))
    .map((r) => ({ ...r, points: known.get(r.key)!.points, summary: known.get(r.key)!.summary }));
  const aiPoints = snap(data.points);
  // Guard against the usual LLM inflation: stay within one step of the references the model itself picked.
  const anchor = anchorOf(references.map((r) => r.points));
  const points = anchor == null ? aiPoints : Math.min(Math.max(aiPoints, step(anchor, -1)), step(anchor, 1));
  const stored: StoredEstimate = {
    ...data,
    key: t.key,
    title: t.summary,
    type: t.type,
    jiraPoints: t.points,
    points,
    aiPoints,
    anchor,
    low: Math.min(Math.max(snap(data.low), step(points, -1)), points),
    high: Math.max(Math.min(snap(data.high), step(points, 1)), points),
    references,
    calibrationCount: cal.total,
    teamMedian: cal.median,
    codeAware: code,
    repos: Object.fromEntries(repos.map((r) => [r.key, { branch: r.status.branch, head: r.status.head, dirty: r.status.dirty }])),
    estimatedAt: new Date().toISOString(),
    ticketHash: contentHash(t),
  };
  cacheSet("estimate", stored, ...cacheKey);
  latestSet("estimate", t.key, stored);
  return { estimate: stored, cached: false };
}

export function startEstimateBatch(keys: string[], force: boolean, code: boolean) {
  keys.forEach(safeName);
  return startJob("estimate", keys.length, async (ctx) => {
    for (const k of keys) ctx.item(k, "pending");
    let failed = 0;
    await runPool(keys, code ? 1 : getSettings().ai.concurrency, async (key) => {
      ctx.item(key, "running");
      ctx.label(key);
      try {
        const r = await estimate(await getIssue(key), force, code);
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

export async function estimateView(key: string) {
  const ticket = await getIssue(safeName(key));
  const est = latestEstimate(key);
  return {
    ticket,
    estimate: est ? { ...est, jiraPoints: ticket.points } : null,
    stale: staleness(ticket, est, est?.estimatedAt),
    hasReview: !!latestReview(key),
  };
}
