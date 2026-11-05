import type { RetroBoard, RetroCard, RetroFacts, RetroItem, Sprint, StatusCategory } from "@/lib/types";
import { runAi } from "./ai";
import { latestReview } from "./analysis";
import { HttpError } from "./api";
import { fieldIndex, listSprints, searchJql, statusCategories } from "./jira";
import { startJob } from "./jobs";
import { PROMPT_VERSION, retroPrompt, retroSchema } from "./prompts";
import { getSettings } from "./settings";
import { hashKey, newId, readJson, removeFile, writeJson } from "./store";

const DAY = 86_400_000;
// Planning usually finishes a few hours after the sprint is started in Jira.
const GRACE = 12 * 3_600_000;

const boardFile = (sprintId: number) => `retro/${sprintId}.json`;

export function getBoard(sprintId: number): RetroBoard | null {
  return readJson<RetroBoard | null>(boardFile(sprintId), null);
}

function saveBoard(b: RetroBoard): RetroBoard {
  writeJson(boardFile(b.sprintId), b);
  return b;
}

export function deleteBoard(sprintId: number): void {
  removeFile(boardFile(sprintId));
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
const ids = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function findSprint(sprintId: number): Promise<{ sprint: Sprint; all: Sprint[] }> {
  const all = await listSprints();
  const sprint = all.find((x) => x.id === sprintId);
  if (!sprint) throw new HttpError(404, "Sprint not found on this board");
  return { sprint, all };
}

/** Done points of the sprints right before this one, counting only work resolved before each sprint ended. */
async function velocity(sprint: Sprint, all: Sprint[], spField: string) {
  const before = all
    .filter((x) => x.state === "closed" && x.id !== sprint.id && (x.startDate ?? "") < (sprint.startDate ?? "9999"))
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
    .slice(0, 3);
  const rows = await Promise.all(
    before.map(async (s) => {
      const raw = await searchJql(`sprint = ${s.id} AND statusCategory = Done`, ["issuetype", "resolutiondate", spField], undefined, 500);
      const end = ms(s.endDate) + GRACE;
      const done = raw.filter((r) => {
        const sub = !!(r.fields.issuetype as { subtask?: boolean } | undefined)?.subtask;
        const at = ms(r.fields.resolutiondate as string | null);
        return !sub && (Number.isNaN(at) || Number.isNaN(end) || at <= end);
      });
      const pts = done.reduce((a, r) => a + (typeof r.fields[spField] === "number" ? (r.fields[spField] as number) : 0), 0);
      return { name: s.name, done: pts || done.length, unit: pts ? "points" : "items" };
    }),
  );
  return rows.reverse();
}

export async function retroFacts(sprintId: number): Promise<RetroFacts> {
  const s = getSettings();
  const { spField, flaggedField, acField } = s.jira;
  const { sprint, all } = await findSprint(sprintId);
  const [cats, fx] = await Promise.all([statusCategories(), fieldIndex()]);
  const raw = await searchJql(
    `sprint = ${sprintId}`,
    ["summary", "status", "issuetype", "created", "resolutiondate", spField, flaggedField, fx.sprint],
    "changelog",
    500,
  );

  const start = ms(sprint.startDate);
  const endPlan = ms(sprint.endDate);
  const now = Date.now();
  const ended = sprint.state === "closed" || (!Number.isNaN(endPlan) && endPlan < now);
  const windowEnd = Number.isNaN(endPlan) ? now : Math.min(now, endPlan + GRACE);
  const inWindow = (t: number) => !Number.isNaN(t) && (Number.isNaN(start) || t >= start + GRACE) && t <= windowEnd;
  const spName = fx.names[spField] ?? "Story Points";
  const acName = fx.names[acField] ?? "";
  const cat = (statusId: string | undefined): StatusCategory => (statusId ? (cats[statusId] ?? "indeterminate") : "indeterminate");

  const items = raw.filter((r) => !(r.fields.issuetype as { subtask?: boolean } | undefined)?.subtask);
  const facts = {
    added: [] as RetroItem[],
    notDone: [] as RetroItem[],
    carriedIn: [] as RetroItem[],
    reopened: [] as RetroItem[],
    reestimated: [] as RetroItem[],
    reqChanged: [] as RetroItem[],
    flagged: [] as RetroItem[],
    bugsNew: [] as RetroItem[],
    unpointed: [] as RetroItem[],
    specRisks: [] as RetroItem[],
  };
  const total = { items: 0, points: 0 };
  const committed = { items: 0, points: 0 };
  const completed = { items: 0, points: 0 };
  const cycles: { item: RetroItem; days: number }[] = [];
  let bugs = 0;

  for (const r of items) {
    const f = r.fields;
    const status = f.status as { id: string; name: string };
    const type = String((f.issuetype as { name?: string } | undefined)?.name ?? "");
    const points = typeof f[spField] === "number" ? (f[spField] as number) : null;
    const item: RetroItem = { key: r.key, summary: String(f.summary ?? ""), type, status: status.name, points };
    const with_ = (note: string): RetroItem => ({ ...item, note });
    const histories = [...(r.changelog?.histories ?? [])].sort((a, b) => a.created.localeCompare(b.created));
    const changes = histories.flatMap((h) => h.items.map((it) => ({ ...it, at: ms(h.created) })));

    total.items++;
    total.points += points ?? 0;
    if (points === null) facts.unpointed.push(item);
    if (/bug/i.test(type)) {
      bugs++;
      if (inWindow(ms(f.created as string))) facts.bugsNew.push(item);
    }

    const sprintChanges = changes.filter((c) => c.fieldId === fx.sprint || c.field === "Sprint");
    const joined = sprintChanges.filter((c) => ids(c.to).includes(String(sprintId)) && !ids(c.from).includes(String(sprintId))).pop();
    const addedAt = joined?.at ?? ms(f.created as string);
    const late = !Number.isNaN(start) && addedAt > start + GRACE;
    if (late) facts.added.push(with_(new Date(addedAt).toISOString().slice(0, 10)));
    else {
      committed.items++;
      committed.points += points ?? 0;
    }

    const earlier = ((f[fx.sprint] as { id: number; startDate?: string }[] | null) ?? []).filter(
      (x) => x.id !== sprintId && x.startDate && ms(x.startDate) < start,
    );
    if (earlier.length || ids(joined?.from).length) facts.carriedIn.push(item);

    const statusChanges = changes.filter((c) => c.field === "status");
    // Start of the final done streak: Done → Closed / PO Accepted after the sprint must not push it out of the sprint.
    let doneSince: number | undefined;
    for (const c of statusChanges)
      if (cat(c.to) === "done") doneSince ??= c.at;
      else doneSince = undefined;
    const doneAt = doneSince ?? (cats[status.id] === "done" ? ms(f.resolutiondate as string) : NaN);
    const isDone = cats[status.id] === "done" && !Number.isNaN(doneAt) && doneAt <= windowEnd;
    if (isDone) {
      completed.items++;
      completed.points += points ?? 0;
      const startedAt = statusChanges.find((c) => cat(c.to) === "indeterminate")?.at;
      if (startedAt !== undefined && doneAt > startedAt) cycles.push({ item, days: Math.round(((doneAt - startedAt) / DAY) * 10) / 10 });
    } else facts.notDone.push(item);

    const reopens = statusChanges.filter((c) => inWindow(c.at) && cat(c.from) === "done" && cat(c.to) !== "done").length;
    if (reopens) facts.reopened.push(with_(reopens > 1 ? `${reopens}×` : ""));

    const pts = changes.filter((c) => inWindow(c.at) && (c.fieldId === spField || c.field === spName));
    if (pts.length) facts.reestimated.push(with_(`${pts[0].fromString || "—"} → ${pts[pts.length - 1].toString || "—"}`));

    const reqEdits = new Set(
      changes
        .filter((c) => inWindow(c.at) && (c.field === "description" || c.field === "summary" || (acName && c.field === acName) || (acField && c.fieldId === acField)))
        .map((c) => c.at),
    ).size;
    if (reqEdits) facts.reqChanged.push(with_(`${reqEdits} edit${reqEdits > 1 ? "s" : ""}`));

    const flaggedNow = flaggedField && (Array.isArray(f[flaggedField]) ? (f[flaggedField] as unknown[]).length > 0 : !!f[flaggedField]);
    const flaggedThen = changes.some((c) => inWindow(c.at) && c.field === "Flagged" && !!c.toString);
    if (flaggedNow || flaggedThen || /block/i.test(status.name)) facts.flagged.push(item);

    const review = latestReview(r.key);
    const high = review?.findings.filter((x) => x.severity === "high").length ?? 0;
    if (high) facts.specRisks.push(with_(`${high} high`));
  }

  const med = median(cycles.map((c) => c.days));
  const slowest = cycles
    .filter((c) => med !== null && c.days >= Math.max(3, med * 1.5))
    .sort((a, b) => b.days - a.days)
    .slice(0, 5)
    .map((c) => ({ ...c.item, note: `${c.days} d` }));
  const unit: RetroFacts["unit"] = total.points > 0 ? "points" : "items";

  return {
    sprint,
    ended,
    unit,
    total,
    committed,
    completed,
    added: facts.added,
    notDone: facts.notDone,
    carriedIn: facts.carriedIn,
    reopened: facts.reopened,
    reestimated: facts.reestimated,
    reqChanged: facts.reqChanged,
    flagged: facts.flagged,
    bugs: { total: bugs, createdInSprint: facts.bugsNew },
    cycle: { medianDays: med, slowest },
    unpointed: facts.unpointed,
    velocity: (await velocity(sprint, all, spField)).filter((v) => v.unit === unit).map(({ name, done }) => ({ name, done })),
    specRisks: facts.specRisks,
  };
}

/** What the cards were based on; status-name changes alone don't make them stale. */
export function factsHash(f: RetroFacts): string {
  const keys = (xs: RetroItem[]) => xs.map((x) => x.key).sort();
  return hashKey(
    f.ended,
    f.total,
    f.completed,
    keys(f.added),
    keys(f.notDone),
    keys(f.reopened),
    keys(f.reestimated),
    keys(f.reqChanged),
    keys(f.flagged),
    keys(f.bugs.createdInSprint),
  );
}

export async function retroView(sprintId: number) {
  const facts = await retroFacts(sprintId);
  const board = getBoard(sprintId);
  const stale = !!board?.factsHash && board.factsHash !== factsHash(facts);
  return { facts, board, stale };
}

export function startRetroJob(sprintId: number, notes: string) {
  return startJob("retro", 1, async (ctx) => {
    ctx.item(String(sprintId), "running");
    ctx.label("Reading the sprint from Jira");
    const facts = await retroFacts(sprintId);
    ctx.label("Writing the retro cards");
    const { data } = await runAi({
      task: "retro",
      prompt: retroPrompt(facts, notes, getSettings().glossary),
      schema: retroSchema,
      timeoutMs: 5 * 60_000,
    });
    const known = new Set([
      ...[facts.added, facts.notDone, facts.carriedIn, facts.reopened, facts.reestimated, facts.reqChanged, facts.flagged]
        .flat()
        .map((x) => x.key),
      ...[facts.bugs.createdInSprint, facts.cycle.slowest, facts.unpointed, facts.specRisks].flat().map((x) => x.key),
    ]);
    const cur = getBoard(sprintId);
    // Cards a person touched survive a regeneration; untouched AI cards are replaced.
    const kept = (cur?.cards ?? []).filter((c) => c.source === "manual" || c.edited || c.pushed);
    const fresh: RetroCard[] = data.cards.map((c) => ({
      ...c,
      id: newId(),
      evidence: [...new Set(c.evidence.filter((k) => known.has(k)))],
      source: "ai",
    }));
    const board = saveBoard({
      sprintId,
      sprintName: facts.sprint.name,
      generatedAt: new Date().toISOString(),
      factsHash: factsHash(facts),
      headline: data.headline,
      notes,
      cards: [...kept, ...fresh],
    });
    ctx.item(String(sprintId), "done");
    ctx.step("Done");
    return { cards: board.cards.length, prompt: PROMPT_VERSION.retro };
  });
}

/** Saves the cards as edited on the page (order, text, pushed marks, manual cards). */
export function saveCards(sprintId: number, sprintName: string, cards: RetroCard[], notes?: string): RetroBoard {
  const cur = getBoard(sprintId);
  return saveBoard({
    sprintId,
    sprintName: cur?.sprintName ?? sprintName,
    generatedAt: cur?.generatedAt ?? null,
    factsHash: cur?.factsHash ?? null,
    headline: cur?.headline ?? null,
    notes: notes ?? cur?.notes ?? "",
    cards,
  });
}
