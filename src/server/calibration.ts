import type { Ticket } from "@/lib/types";
import { searchTickets } from "./jira";
import { ESTIMATE_SCALE } from "./prompts";
import { getSettings } from "./settings";
import { readJson, safeName, writeJson } from "./store";

export interface CalibrationStory {
  key: string;
  summary: string;
  points: number;
  parentKey: string | null;
  labels: string[];
  excerpt: string;
  /** Lower-cased content words, precomputed for similarity ranking. */
  words: string[];
}

export interface Calibration {
  /** The stories most similar to the one being estimated, with an excerpt (the AI must pick references here). */
  similar: CalibrationStory[];
  /** The rest, summary only: shows the scale without costing many tokens. */
  others: CalibrationStory[];
  /** Share of done stories per point value, e.g. { 3: 0.38 }. */
  distribution: { points: number; share: number }[];
  median: number | null;
  total: number;
}

const TTL = 6 * 3600_000;
const FETCH = 150;
const SIMILAR = 12;
const FILE_VERSION = 2;

const STOP = new Set(
  "the and for with that this from into when then than have has are was were will shall should must can not but all any each its their they them user users able view show page field fields value values data new add update allow"
    .split(" "),
);

export function contentWords(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []) if (!STOP.has(w)) out.add(w);
  return [...out];
}

const text = (t: Pick<Ticket, "summary" | "acMd" | "descriptionMd">) => `${t.summary} ${t.acMd} ${t.descriptionMd}`.slice(0, 2500);

async function load(projectKey: string): Promise<CalibrationStory[]> {
  const sp = getSettings().jira.spField;
  if (!sp) return [];
  const file = `cache/calibration/${safeName(projectKey)}.json`;
  const hit = readJson<{ v?: number; at: number; sp: string; items: CalibrationStory[] } | null>(file, null);
  if (hit && hit.v === FILE_VERSION && hit.sp === sp && Date.now() - hit.at < TTL) return hit.items;
  const cf = sp.startsWith("customfield_") ? `cf[${sp.slice("customfield_".length)}]` : `"${sp}"`;
  const jql = `project = "${projectKey}" AND issuetype = Story AND statusCategory = Done AND ${cf} is not EMPTY ORDER BY resolved DESC`;
  try {
    const items = (await searchTickets(jql, FETCH))
      .filter((t) => t.points != null && t.points > 0)
      .slice(0, FETCH)
      .map((t) => ({
        key: t.key,
        summary: t.summary,
        points: t.points as number,
        parentKey: t.parentKey,
        labels: t.labels,
        excerpt: (t.acMd || t.descriptionMd).replace(/\s+/g, " ").slice(0, 320),
        words: contentWords(text(t)),
      }));
    writeJson(file, { v: FILE_VERSION, at: Date.now(), sp, items });
    return items;
  } catch {
    return hit?.v === FILE_VERSION ? hit.items : [];
  }
}

/** Word overlap (weighted to the target's own words) + a bonus for the same epic or a shared label. */
function similarity(target: Ticket, targetWords: Set<string>, c: CalibrationStory): number {
  if (!targetWords.size || !c.words.length) return 0;
  let shared = 0;
  for (const w of c.words) if (targetWords.has(w)) shared++;
  let score = shared / Math.sqrt(targetWords.size * c.words.length);
  if (target.parentKey && c.parentKey === target.parentKey) score += 0.15;
  if (c.labels.some((l) => target.labels.includes(l))) score += 0.05;
  return score;
}

export async function calibrationFor(t: Ticket): Promise<Calibration> {
  const all = (await load(t.key.split("-")[0])).filter((c) => c.key !== t.key);
  const targetWords = new Set(contentWords(text(t)));
  const ranked = all.map((c) => ({ c, s: similarity(t, targetWords, c) })).sort((a, b) => b.s - a.s);
  const similar = ranked.slice(0, SIMILAR).map((x) => x.c);
  const counts = new Map<number, number>();
  for (const c of all) counts.set(c.points, (counts.get(c.points) ?? 0) + 1);
  const sorted = all.map((c) => c.points).sort((a, b) => a - b);
  return {
    similar,
    others: all.filter((c) => !similar.includes(c)),
    distribution: ESTIMATE_SCALE.filter((p) => counts.has(p)).map((p) => ({ points: p, share: (counts.get(p) ?? 0) / all.length })),
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    total: all.length,
  };
}
