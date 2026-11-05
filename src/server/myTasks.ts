import type { StatusCategory } from "@/lib/types";
import { HttpError } from "./api";
import { jiraGet, jiraMyself, jiraSend, searchJql } from "./jira";
import { runPool, startJob } from "./jobs";
import { getSettings } from "./settings";


export interface MyTask {
  key: string;
  summary: string;
  type: string;
  status: string;
  category: StatusCategory;
  action: string[];
  score: string | null;
  assignee: { accountId: string; name: string } | null;
  /** Name of the transition into Done from the current status; null when there is none. */
  doneVia?: string | null;
  /** When Done is not reachable directly: the first status the move goes through. */
  nextStep?: string | null;
  /** Statuses reachable in one transition from the current one. */
  targets?: string[];
}

/** Jira ids of the AI tracking fields named in Settings; null when they aren't configured (moves then touch statuses only). */
type Ids = { action: string; score: string; value: string } | null;
type Option = { value?: string } | null;
type Account = { accountId: string; displayName: string } | null;

async function aiFieldIds(): Promise<Ids> {
  const { aiActionField, aiScoreField, aiActionValue } = getSettings().jira;
  if (!aiActionField || !aiScoreField || !aiActionValue) return null;
  const fields = await jiraGet<{ id: string; name: string }[]>("/rest/api/3/field");
  const action = fields.find((f) => f.name === aiActionField)?.id;
  const score = fields.find((f) => f.name === aiScoreField)?.id;
  if (!action || !score) throw new HttpError(400, `Jira fields "${aiActionField}" / "${aiScoreField}" not found — check Settings → Features → Jira write.`);
  return { action, score, value: aiActionValue };
}

const FIELDS = (ids: Ids) => ["summary", "status", "issuetype", "assignee", ...(ids ? [ids.action, ids.score] : [])];

const catOf = (key: string | undefined): StatusCategory => (key === "done" ? "done" : key === "new" ? "new" : "indeterminate");

function toTask(r: { key: string; fields: Record<string, unknown> }, ids: Ids): MyTask {
  const f = r.fields;
  const status = f.status as { name: string; statusCategory?: { key?: string } };
  const a = f.assignee as Account;
  return {
    key: r.key,
    summary: String(f.summary ?? ""),
    type: String((f.issuetype as { name?: string } | undefined)?.name ?? ""),
    status: status.name,
    category: catOf(status.statusCategory?.key),
    action: ids ? ((f[ids.action] as Option[] | null) ?? []).map((o) => o?.value ?? "").filter(Boolean) : [],
    score: ids ? ((f[ids.score] as Option)?.value ?? null) : null,
    assignee: a ? { accountId: a.accountId, name: a.displayName } : null,
  };
}

/**
 * Sub-tasks of the sprint for the picked members (null → only me, [] → everyone),
 * plus the members who have sub-tasks in the sprint for the filter.
 */
export async function myTasks(sprintId: number, assignees: string[] | null) {
  const ids = await aiFieldIds();
  const [all, perms, me] = await Promise.all([
    searchJql(`sprint = ${sprintId} AND issuetype in subTaskIssueTypes() ORDER BY key`, FIELDS(ids), undefined, 500),
    jiraGet<{ permissions: Record<string, { havePermission: boolean }> }>("/rest/api/3/mypermissions", {
      projectKey: getSettings().jira.projectKey || undefined,
      permissions: "EDIT_ISSUES,TRANSITION_ISSUES",
    }),
    jiraMyself(),
  ]);
  const members = new Map<string, { accountId: string; name: string; count: number }>();
  for (const r of all) {
    const a = r.fields.assignee as Account;
    if (!a) continue;
    const m = members.get(a.accountId) ?? { accountId: a.accountId, name: a.displayName, count: 0 };
    m.count++;
    members.set(a.accountId, m);
  }
  const wanted = assignees === null ? [me.accountId] : assignees;
  const raw = wanted.length ? all.filter((r) => wanted.includes((r.fields.assignee as Account)?.accountId ?? "")) : all;
  // One transitions call per sub-task; capped so "all members" doesn't hit Jira's rate limit.
  const tasks = raw.map((r) => toTask(r, ids));
  await runPool(tasks, 8, async (task) => {
    Object.assign(task, await previewRoute(task.key, task.status).catch(() => ({ doneVia: null, nextStep: null, targets: [] })));
  });
  return {
    tasks,
    me: { accountId: me.accountId, name: me.displayName },
    members: [...members.values()].sort((x, y) =>
      x.accountId === me.accountId ? -1 : y.accountId === me.accountId ? 1 : x.name.localeCompare(y.name),
    ),
    writeEnabled: !!getSettings().features.jiraWrite,
    permissions: {
      edit: !!perms.permissions.EDIT_ISSUES?.havePermission,
      transition: !!perms.permissions.TRANSITION_ISSUES?.havePermission,
    },
    fields: ids ? { action: getSettings().jira.aiActionField, score: getSettings().jira.aiScoreField, actionValue: ids.value } : null,
  };
}

// ---------------------------------------------------------------- transitions

type Transition = { id: string; name: string; to: { name: string; statusCategory?: { key?: string } } };

const SIDE_EXIT = /cancel|reject|won.?t|invalid|duplicate|block|hold/i;
const isDone = (name: string) => /^done$/i.test(name);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

async function transitions(key: string): Promise<Transition[]> {
  return (await jiraGet<{ transitions: Transition[] }>(`${issuePath(key)}/transitions`)).transitions;
}

/** The transition into the "Done" status itself — never Cancelled / Rejected, which are also in the done category. */
function pickDone(list: Transition[]): Transition | null {
  return list.find((t) => isDone(t.to.name)) ?? list.find((t) => t.to.statusCategory?.key === "done" && !SIDE_EXIT.test(t.to.name)) ?? null;
}

function pickForward(list: Transition[], seen: Set<string>): Transition | null {
  return list.find((t) => t.to.statusCategory?.key === "indeterminate" && !seen.has(t.to.name.toLowerCase()) && !SIDE_EXIT.test(t.to.name)) ?? null;
}

async function previewRoute(key: string, current: string) {
  const list = await transitions(key);
  const done = pickDone(list);
  return {
    doneVia: done?.name ?? null,
    nextStep: done ? null : (pickForward(list, new Set([current.toLowerCase()]))?.to.name ?? null),
    targets: [...new Set(list.map((t) => t.to.name).filter((n) => !same(n, current) && !isDone(n)))],
  };
}

const transition = (key: string, id: string) => jiraSend("POST", `${issuePath(key)}/transitions`, { transition: { id } });

/** Walks forward (at most 6 steps, never back to a status it already passed) until the Done transition is available. */
async function walkToDone(key: string, from: string): Promise<string[]> {
  const path = [from];
  const seen = new Set([from.toLowerCase()]);
  for (let hop = 0; hop < 6; hop++) {
    const list = await transitions(key);
    const next = pickDone(list) ?? pickForward(list, seen);
    if (!next) throw new Error(`Stuck at "${path[path.length - 1]}" — no way forward to Done (path: ${path.join(" → ")}). Move it in Jira.`);
    await transition(key, next.id);
    path.push(next.to.name);
    if (next.to.statusCategory?.key === "done") return path;
    seen.add(next.to.name.toLowerCase());
  }
  throw new Error(`Gave up after 6 steps (path: ${path.join(" → ")}).`);
}

// ---------------------------------------------------------------- move job

export interface MoveItem {
  key: string;
  score: 4 | 5;
  /** Target status name; "Done" fills the AI fields and walks there, anything else is one transition. */
  to: string;
}

export function startMoveToDone(sprintId: number, items: MoveItem[]) {
  if (!getSettings().features.jiraWrite) throw new HttpError(403, "Writing to Jira is turned off (Settings → Features → Jira write).");
  return startJob("my-done", items.length, async (ctx) => {
    const ids = await aiFieldIds();
    for (const it of items) ctx.item(it.key, "pending");
    let failed = 0;
    for (const it of items) {
      ctx.item(it.key, "running");
      ctx.label(it.key);
      try {
        // Re-read: the move starts from Jira's current state, not from what the page showed.
        const [r] = await searchJql(`key = ${it.key} AND sprint = ${sprintId} AND issuetype in subTaskIssueTypes()`, FIELDS(ids));
        if (!r) throw new Error("Not a sub-task of this sprint");
        const task = toTask(r, ids);
        if (same(task.status, it.to)) ctx.item(it.key, "done", `Already ${task.status} — skipped`);
        else ctx.item(it.key, "done", isDone(it.to) ? await toDone(task, it, ids) : await toOther(task, it, ids));
      } catch (e) {
        failed++;
        ctx.item(it.key, "error", e instanceof Error ? e.message : String(e));
      }
      ctx.step();
    }
    return { failed };
  });
}

type AiIds = NonNullable<Ids>;
const setAi = (key: string, score: 4 | 5, ids: AiIds) =>
  jiraSend("PUT", issuePath(key), { fields: { [ids.action]: [{ value: ids.value }], [ids.score]: { value: String(score) } } });
const clearAi = (key: string, ids: AiIds) => jiraSend("PUT", issuePath(key), { fields: { [ids.action]: null, [ids.score]: null } });

/** When AI fields are configured (a Done validator may require them): set the action value + 4 or 5, then move. */
async function toDone(task: MyTask, it: MoveItem, ids: Ids): Promise<string> {
  if (ids) await setAi(it.key, it.score, ids);
  return `${(await walkToDone(it.key, task.status)).join(" → ")}${ids ? ` · AI ${it.score}` : ""}`;
}

/** Any other status is one transition. Cancelled drops the AI fields; if a validator asks for them they are filled just for the move. */
async function toOther(task: MyTask, it: MoveItem, ids: Ids): Promise<string> {
  const t = (await transitions(it.key)).find((x) => same(x.to.name, it.to));
  if (!t) throw new Error(`No transition from "${task.status}" to "${it.to}" — move it in Jira.`);
  const cancel = /cancel/i.test(t.to.name);
  let filled = false;
  try {
    await transition(it.key, t.id);
  } catch (e) {
    if (!ids || !(e instanceof Error) || !/AI/i.test(e.message)) throw e;
    await setAi(it.key, it.score, ids);
    filled = true;
    await transition(it.key, t.id);
  }
  const hadAi = task.action.length > 0 || !!task.score;
  if (ids && (cancel || (filled && !hadAi))) await clearAi(it.key, ids).catch(() => undefined);
  return `${task.status} → ${t.to.name}${ids && cancel ? " · AI fields cleared" : ""}`;
}
