import type { StatusCategory } from "@/lib/types";
import { HttpError } from "./api";
import { listSprints, searchJql, statusCategories } from "./jira";
import { getSettings } from "./settings";

interface SprintIssueLite {
  key: string;
  summary: string;
  status: string;
  category: StatusCategory;
  subtask: boolean;
  points: number | null;
  assignee: string;
  parentKey: string | null;
  parentSummary: string | null;
  parentType: string | null;
  flagged: boolean;
}

async function sprintData(sprintId: number) {
  const s = getSettings();
  const sprint = (await listSprints()).find((x) => x.id === sprintId);
  if (!sprint) throw new HttpError(404, "Sprint not found on this board");
  const cats = await statusCategories();
  const raw = await searchJql(
    `sprint = ${sprintId}`,
    ["summary", "status", "issuetype", "parent", "assignee", s.jira.spField, s.jira.flaggedField],
    undefined,
    500,
  );
  const issues: SprintIssueLite[] = raw.map((r) => {
    const f = r.fields;
    const status = f.status as { id: string; name: string };
    const category = cats[status.id] ?? "indeterminate";
    const parent = f.parent as { key: string; fields?: { summary?: string; issuetype?: { name?: string } } } | undefined;
    const flaggedRaw = s.jira.flaggedField ? f[s.jira.flaggedField] : null;
    const pts = s.jira.spField ? f[s.jira.spField] : null;
    return {
      key: r.key,
      summary: String(f.summary ?? ""),
      status: status.name,
      category,
      subtask: !!(f.issuetype as { subtask?: boolean })?.subtask,
      points: typeof pts === "number" ? pts : null,
      assignee: String((f.assignee as { displayName?: string } | null)?.displayName ?? ""),
      parentKey: parent?.key ?? null,
      parentSummary: parent?.fields?.summary ?? null,
      parentType: parent?.fields?.issuetype?.name ?? null,
      flagged: Array.isArray(flaggedRaw) ? flaggedRaw.length > 0 : !!flaggedRaw,
    };
  });
  return { sprint, issues };
}

export async function sprintHealth(sprintId: number) {
  const { sprint, issues } = await sprintData(sprintId);
  const items = issues.filter((i) => !i.subtask);
  const pointsTotal = items.reduce((a, i) => a + (i.points ?? 0), 0);
  // No story points on the board (or field not mapped): count items so "done" still means something.
  const unit: "points" | "items" = pointsTotal > 0 ? "points" : "items";
  const weight = (i: SprintIssueLite) => (unit === "points" ? (i.points ?? 0) : 1);
  const totalPoints = items.reduce((a, i) => a + weight(i), 0);
  const donePoints = items.filter((i) => i.category === "done").reduce((a, i) => a + weight(i), 0);

  const start = sprint.startDate ? new Date(sprint.startDate) : null;
  const end = sprint.endDate ? new Date(sprint.endDate) : null;
  const now = new Date();
  const daysLeft = end ? Math.ceil((end.getTime() - now.getTime()) / 86400000) : null;
  const elapsed = start && end ? (now.getTime() - start.getTime()) / (end.getTime() - start.getTime()) : null;
  const carryOver = items
    .filter((i) => i.category !== "done")
    .map((i) => {
      const reasons: string[] = [];
      if (daysLeft !== null && daysLeft <= 2) reasons.push("ending");
      if (elapsed !== null && elapsed > 0.5 && i.category === "new") reasons.push("not_started");
      return { ...i, reasons };
    })
    .filter((i) => i.reasons.length);
  const blocked = issues.filter((i) => i.category !== "done" && (i.flagged || /block/i.test(i.status)));

  return {
    sprint,
    unit,
    pointsField: getSettings().jira.spField,
    totalPoints,
    donePoints,
    unpointed: items.filter((i) => i.points === null).length,
    counts: {
      new: items.filter((i) => i.category === "new").length,
      indeterminate: items.filter((i) => i.category === "indeterminate").length,
      done: items.filter((i) => i.category === "done").length,
    },
    daysLeft,
    carryOver,
    blocked,
  };
}

export async function sprintReport(sprintId: number): Promise<string> {
  const { sprint, issues } = await sprintData(sprintId);
  const base = getSettings().jira.baseUrl;
  const done = issues.filter((i) => !i.subtask && i.category === "done");
  const groups = new Map<string, typeof done>();
  for (const i of done) {
    const g = i.parentType === "Epic" && i.parentKey ? `${i.parentKey} — ${i.parentSummary ?? ""}` : "No epic";
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  const lines = [
    `# ${sprint.name} — Sprint report`,
    "",
    sprint.goal ? `**Goal:** ${sprint.goal}` : "",
    `**Dates:** ${sprint.startDate?.slice(0, 10) ?? "?"} → ${sprint.endDate?.slice(0, 10) ?? "?"}`,
    `**Done:** ${done.length} items · ${done.reduce((a, i) => a + (i.points ?? 0), 0)} points`,
    "",
  ].filter((l, idx) => l !== "" || idx > 0);
  for (const [g, list] of groups) {
    lines.push(`## ${g}`, "");
    for (const i of list) lines.push(`- [${i.key}](${base}/browse/${i.key}) ${i.summary}${i.points != null ? ` _(${i.points} pts)_` : ""}`);
    lines.push("");
  }
  if (!done.length) lines.push("_No done items yet._");
  return lines.join("\n");
}
