import { z } from "zod";
import type { LoggedTimeDay, TimeSlot, TimeTrackerSettings } from "@/lib/types";
import { slotHours, timeSlotsSchema } from "@/lib/timeSlots";
import { HttpError } from "./api";
import { getSecret } from "./secrets";
import { getSettings, updateSettings } from "./settings";

/** TimeTracker NX REST paths (the same ones its web app calls), relative to Settings → Log time → URL. */
const API = {
  login: "/api/auth/token",
  me: "/api/system/users/me",
  timeEntries: (userId: string) => `/api/system/users/${encodeURIComponent(userId)}/timeEntries`,
  timeEntriesBulk: (userId: string) => `/api/system/users/${encodeURIComponent(userId)}/timeEntries/bulk`,
  workItems: "/api/workitem/workItems",
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

export interface TimeEntry {
  workItemId: string;
  startTime: string;
  finishTime: string;
  userId: number;
  remainingTime: number;
  loginUserId: string;
}

const toYmd = (d: Date) => d.toISOString().slice(0, 10);
export { slotHours } from "@/lib/timeSlots";

/** Monday–Friday between two dates (inclusive), as YYYY-MM-DD. Dates are calendar days, so UTC math avoids timezone shifts. */
export function workdays(from: string, to: string): string[] {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new HttpError(400, "Dates must be YYYY-MM-DD");
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(toYmd(d));
    if (out.length > MAX_DAYS) throw new HttpError(400, `At most ${MAX_DAYS} working days at a time`);
  }
  return out;
}

/** The user ID is optional here: login fills it in. */
function config(needTasks = true): TimeTrackerSettings {
  const t = getSettings().timeTracker;
  const keys = needTasks ? (["baseUrl", "loginName", "mainTaskId", "kaizenTaskId"] as const) : (["baseUrl", "loginName"] as const);
  const missing = keys.filter((k) => !t[k]);
  if (missing.length) throw new HttpError(400, `Log time is not set up — fill ${missing.join(", ")} in Settings → Features → Log time.`);
  if (!t.slots.length) throw new HttpError(400, "No time slots in Settings → Features → Log time.");
  return t;
}

export function entriesFor(dates: string[], t: TimeTrackerSettings, overrides: Record<string, TimeSlot[]> = {}): TimeEntry[] {
  return dates.flatMap((date) =>
    (overrides[date] ?? t.slots).map((s) => ({
      workItemId: s.task === "main" ? t.mainTaskId : t.kaizenTaskId,
      startTime: `${date}T${s.start}:00`,
      finishTime: `${date}T${s.end}:00`,
      userId: Number(t.userId),
      remainingTime: 0,
      loginUserId: t.userId,
    })),
  );
}

type TtError = { code?: string; resource?: string; field?: string; id?: string; message?: string };

/** The time tracker answers errors as [{code, resource, field, id, message}] with Japanese messages; name the task and setting involved. */
function explain(text: string, t: TimeTrackerSettings): string {
  let list: TtError[];
  try {
    const j = JSON.parse(text) as TtError[] | TtError;
    list = Array.isArray(j) ? j : [j];
  } catch {
    return text.slice(0, 400);
  }
  const lines = list.map((e) => {
    const which = e.id === t.mainTaskId ? " (main task ID)" : e.id === t.kaizenTaskId ? " (kaizen task ID)" : "";
    if (e.code === "SecurityError" && e.resource === "WorkItem")
      return `No permission to log time on work item ${e.id}${which} — check the task ID in Settings → Features → Log time. [${e.message ?? ""}]`;
    if (e.resource === "WorkItem" && e.id) return `Work item ${e.id}${which}: ${e.code ?? ""} ${e.message ?? ""}`.trim();
    return [e.code, e.resource, e.field, e.id, e.message].filter(Boolean).join(" · ");
  });
  return lines.join("\n") || text.slice(0, 400);
}

async function call(t: TimeTrackerSettings, path: string, body: unknown, token?: string, method: "POST" | "GET" = "POST", expectedStatus?: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === "GET" ? { "X-Berkley-ApiClientId": "BerkleyWebClient" } : {}) },
      body: method === "GET" ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new HttpError(502, `Time tracker unreachable (${e instanceof Error ? e.message : String(e)}) — VPN / office network?`);
  }
  const text = await res.text();
  if (!res.ok || (expectedStatus !== undefined && res.status !== expectedStatus)) throw new HttpError(res.status === 401 || res.status === 403 ? 401 : 502, `Time tracker HTTP ${res.status}: ${explain(text, t)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

type Obj = Record<string, unknown>;

const ID_KEYS = ["loginId", "loginUserId", "userId", "user_id", "uid", "nameid", "id"];
const isId = (v: unknown): v is number | string => (typeof v === "number" || typeof v === "string") && /^\d+$/.test(String(v));

/** First numeric id among the fields the time tracker uses for the signed-in user (the web app keeps it as `loginId`). */
function userIdFrom(j: Obj | null): string | null {
  const scopes = [j, j?.user, j?.data, (j?.data as Obj | undefined)?.user, j?.loginUser].filter((x): x is Obj => !!x && typeof x === "object");
  for (const o of scopes) {
    for (const k of ID_KEYS) if (isId(o[k])) return String(o[k]);
    // .NET-style claim names, e.g. "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier".
    for (const [k, v] of Object.entries(o)) if (/nameidentifier$|\/userid$/i.test(k) && isId(v)) return String(v);
  }
  return null;
}

/** The login token is usually a JWT whose claims name the user; read them without verifying (we only need the id). */
function userIdFromToken(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return userIdFrom(JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Obj);
  } catch {
    return null;
  }
}

/** Login response → token claims → the "me" endpoint the web app calls; the first one that names a numeric id wins. */
async function findUserId(t: TimeTrackerSettings, token: string, fromLogin: string | null): Promise<string | null> {
  const id = fromLogin ?? userIdFromToken(token);
  if (id) return id;
  try {
    const me = await call(t, API.me, undefined, token, "GET");
    return me && typeof me === "object" ? userIdFrom(me as Obj) : null;
  } catch {
    return null;
  }
}

/** Logs in with the saved name + password; the token is used for one request and never stored. */
async function login(t: TimeTrackerSettings): Promise<{ token: string; userId: string | null }> {
  const password = await getSecret("timetracker.password");
  if (!password) throw new HttpError(400, "Time tracker password is not saved (Settings → Features → Log time).");
  const raw = await call(t, API.login, { loginName: t.loginName, password });
  const j = raw && typeof raw === "object" ? (raw as Obj) : null;
  const token = typeof raw === "string" ? raw : String(j?.token ?? j?.accessToken ?? j?.access_token ?? (j?.data as Obj | undefined)?.token ?? "");
  if (!token) throw new HttpError(502, "Time tracker login returned no token.");
  return { token, userId: await findUserId(t, token, userIdFrom(j)) };
}

/** Saves the user ID from the login response, so it never has to be looked up by hand. */
function rememberUserId(t: TimeTrackerSettings, userId: string | null): string {
  if (userId && userId !== t.userId) updateSettings({ timeTracker: { ...t, userId } });
  const id = userId ?? t.userId;
  if (!id) throw new HttpError(502, "Logged in, but the time tracker did not return a user ID — enter it in Settings → Features → Log time.");
  return id;
}

export async function testLogin(): Promise<{ ok: true; userId: string }> {
  const t = config(false);
  const { userId } = await login(t);
  return { ok: true, userId: rememberUserId(t, userId) };
}

export async function checkReady(): Promise<{ ready: true }> {
  const settings = getSettings();
  if (!settings.features.logTime) throw new HttpError(403, "Log time is turned off (Settings → Features).");
  const t = settings.timeTracker;
  if (!t.baseUrl || !t.loginName) throw new HttpError(400, "Set the time tracker URL and login name in Settings → Features → Log time.");
  const { token } = await login(t);
  await call(t, API.me, undefined, token, "GET", 200);
  return { ready: true };
}

export function preview(from: string, to: string) {
  const t = getSettings().timeTracker;
  const days = workdays(from, to);
  return { days, slots: t.slots, hoursPerDay: slotHours(t.slots), entries: days.length * t.slots.length };
}

const loggedEntriesSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  data: z.array(z.object({
    id: z.string(),
    userId: z.string(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
    startTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/),
    finishTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/),
    time: z.number().nonnegative(),
    workItemId: z.string(),
    workItemName: z.string(),
    projectName: z.string(),
    isLocked: z.boolean(),
    isDeleted: z.boolean(),
  })),
});

export async function loggedTime(from: string, to: string): Promise<{ days: Record<string, LoggedTimeDay> }> {
  if (!getSettings().features.logTime) throw new HttpError(403, "Log time is turned off (Settings → Features).");
  if (!z.iso.date().safeParse(from).success || !z.iso.date().safeParse(to).success || from > to) throw new HttpError(400, "Invalid date range");
  const dates = workdays(from, to);
  const t = config(false);
  const { token, userId } = await login(t);
  const id = rememberUserId(t, userId);
  const params = new URLSearchParams({ startDate: from.replaceAll("-", "/"), finishDate: to.replaceAll("-", "/") });
  const raw = await call(t, `${API.timeEntries(id)}?${params}`, undefined, token, "GET");
  const parsed = loggedEntriesSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "Time tracker returned an unexpected time-entry response.");
  if (parsed.data.totalCount > parsed.data.data.length) throw new HttpError(502, "Time tracker returned only part of the entries. Select a smaller date range.");
  const days: Record<string, LoggedTimeDay> = Object.fromEntries(dates.map((date) => [date, { minutes: 0, entries: [] }]));
  for (const entry of parsed.data.data) {
    const date = entry.workDate.slice(0, 10);
    if (entry.isDeleted || entry.userId !== id || !Object.hasOwn(days, date)) continue;
    days[date].entries.push({
      id: entry.id,
      start: entry.startTime.slice(11, 16),
      end: entry.finishTime.slice(11, 16),
      minutes: entry.time,
      workItemId: entry.workItemId,
      workItemName: entry.workItemName,
      projectName: entry.projectName,
      isLocked: entry.isLocked,
    });
  }
  for (const day of Object.values(days)) {
    day.entries.sort((first, second) => first.start.localeCompare(second.start));
    day.minutes = day.entries.reduce((total, entry) => total + entry.minutes, 0);
  }
  return { days };
}

export async function logTime(dates: string[], overrides: Record<string, TimeSlot[]> = {}) {
  const s = getSettings();
  if (!s.features.logTime) throw new HttpError(403, "Log time is turned off (Settings → Features).");
  const t = config();
  const days = [...new Set(dates)].sort();
  if (!days.length) throw new HttpError(400, "Pick at least one day.");
  if (days.length > MAX_DAYS || days.some((d) => !DATE_RE.test(d))) throw new HttpError(400, "Invalid days");
  if (Object.keys(overrides).some((date) => !days.includes(date))) throw new HttpError(400, "Time overrides must belong to selected days");
  for (const date of days) {
    const parsed = timeSlotsSchema.safeParse(overrides[date] ?? t.slots);
    if (!parsed.success) throw new HttpError(400, `${date}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const { token, userId } = await login(t);
  const id = rememberUserId(t, userId);
  const entries = entriesFor(days, { ...t, userId: id }, overrides);
  // Same payload as the team's browser script: one "adds" list; slots that already exist are skipped by the time tracker.
  const response = await call(t, API.timeEntriesBulk(id), { adds: entries }, token);
  return { days: days.length, entries: entries.length, hours: days.reduce((total, date) => total + slotHours(overrides[date] ?? t.slots), 0), response };
}

/** Project → folders (work items) → tasks (sub items), as the time tracker's own picker shows them. */
export interface TaskNode {
  id: string;
  name: string;
  kind: "project" | "folder" | "task";
  children?: TaskNode[];
  /** Tasks only: time you logged on it in the last RECENT_DAYS days, and the last day you did ("" if none). */
  minutes?: number;
  lastDate?: string;
}

const RECENT_DAYS = 120;
const ITEM_FIELDS = "Id,ProjectId,Name,ParentId,ItemTypeId,TreePath,IsTimeEntryLocked";
const itemList = z.object({
  totalCount: z.number(),
  data: z.array(z.object({ fields: z.record(z.string(), z.unknown()) })),
});
const projectFields = z.object({ projectId: z.string(), projectName: z.string(), isProjectFinished: z.boolean(), islocked: z.boolean() });
const itemFields = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  parentId: z.string().nullable().optional(),
  itemTypeId: z.string(),
  treePath: z.string(),
  isTimeEntryLocked: z.boolean().optional(),
});

/** GET a work-item list; the time tracker caps it at `limit`, so a full page means we may be missing items. */
async function workItems<T>(t: TimeTrackerSettings, token: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T[]> {
  const raw = await call(t, `${API.workItems}?${new URLSearchParams({ limit: "2000", ...params })}`, undefined, token, "GET");
  const parsed = itemList.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "Time tracker returned an unexpected work-item response.");
  return parsed.data.data.flatMap((x) => {
    const f = schema.safeParse(x.fields);
    return f.success ? [f.data] : [];
  });
}

/** Your time per work item over the last RECENT_DAYS days — only used to put the tasks you actually use first. */
async function recentUse(t: TimeTrackerSettings, token: string, id: string): Promise<Map<string, { minutes: number; lastDate: string }>> {
  const out = new Map<string, { minutes: number; lastDate: string }>();
  const to = new Date();
  const from = new Date(to.getTime() - RECENT_DAYS * 86_400_000);
  const params = new URLSearchParams({ startDate: toYmd(from).replaceAll("-", "/"), finishDate: toYmd(to).replaceAll("-", "/") });
  const parsed = loggedEntriesSchema.safeParse(await call(t, `${API.timeEntries(id)}?${params}`, undefined, token, "GET"));
  if (!parsed.success) return out;
  for (const e of parsed.data.data) {
    if (e.isDeleted || e.userId !== id) continue;
    const date = e.workDate.slice(0, 10);
    const cur = out.get(e.workItemId) ?? { minutes: 0, lastDate: date };
    cur.minutes += e.time;
    if (date > cur.lastDate) cur.lastDate = date;
    out.set(e.workItemId, cur);
  }
  return out;
}

/**
 * The tasks assigned to you in your open projects, as the tree the time tracker's own "add time" picker shows:
 * projects you have assignments in (minus finished / locked ones) → their folders → tasks assigned to you (minus
 * time-locked ones). Folders with none of your tasks are dropped. `recent` lists the task ids you logged time on lately.
 */
export async function myTasks(): Promise<{ tree: TaskNode[]; recent: string[] }> {
  const t = config(false);
  const { token, userId } = await login(t);
  const id = rememberUserId(t, userId);
  const projects = (
    await workItems(t, token, { groupBy: "Project", hasSubItem: "false", itemTypeIds: "3", assignedUserIds: id }, projectFields)
  ).filter((p) => !p.isProjectFinished && !p.islocked);
  if (!projects.length) return { tree: [], recent: [] };
  const projectIds = projects.map((p) => p.projectId).join(",");
  const [tasks, folders, used] = await Promise.all([
    workItems(t, token, { projectIds, itemTypeIds: "3", hasSubItem: "false", assignedUserIds: id, fields: ITEM_FIELDS }, itemFields),
    workItems(t, token, { projectIds, itemTypeIds: "1,4", fields: ITEM_FIELDS }, itemFields),
    recentUse(t, token, id).catch(() => new Map<string, { minutes: number; lastDate: string }>()),
  ]);
  // Tree paths are "0/3/10/11/": compare their numbers, not the strings, so 10 sorts after 9.
  const treeKey = (p: string) => p.split("/").filter(Boolean).map((n) => n.padStart(6, "0")).join("/");
  const items = [...folders, ...tasks.filter((x) => !x.isTimeEntryLocked)].sort((a, b) => treeKey(a.treePath).localeCompare(treeKey(b.treePath)));
  const kids = new Map<string, typeof items>();
  for (const x of items) if (x.parentId) kids.set(x.parentId, [...(kids.get(x.parentId) ?? []), x]);
  const build = (x: (typeof items)[number], depth: number): TaskNode | null => {
    if (x.itemTypeId === "3") {
      const u = used.get(x.id);
      return { id: x.id, name: x.name, kind: "task", minutes: u?.minutes ?? 0, lastDate: u?.lastDate ?? "" };
    }
    const children = depth > 12 ? [] : (kids.get(x.id) ?? []).map((c) => build(c, depth + 1)).filter((c): c is TaskNode => !!c);
    return children.length ? { id: x.id, name: x.name, kind: x.itemTypeId === "1" ? "project" : "folder", children } : null;
  };
  const tree = projects.flatMap((p) => {
    const root = folders.find((f) => f.projectId === p.projectId && f.itemTypeId === "1");
    const node = root ? build(root, 0) : null;
    return node ? [{ ...node, name: p.projectName || node.name }] : [];
  });
  const recent = [...used.entries()]
    .filter(([taskId]) => tasks.some((x) => x.id === taskId && !x.isTimeEntryLocked))
    .sort((a, b) => b[1].lastDate.localeCompare(a[1].lastDate) || b[1].minutes - a[1].minutes)
    .map(([taskId]) => taskId);
  return { tree, recent };
}
