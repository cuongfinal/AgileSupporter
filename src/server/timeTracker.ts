import type { TimeSlot, TimeTrackerSettings } from "@/lib/types";
import { HttpError } from "./api";
import { getSecret } from "./secrets";
import { getSettings, updateSettings } from "./settings";

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
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const slotHours = (slots: TimeSlot[]) => slots.reduce((a, s) => a + Math.max(0, minutes(s.end) - minutes(s.start)), 0) / 60;

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

export function entriesFor(dates: string[], t: TimeTrackerSettings): TimeEntry[] {
  return dates.flatMap((date) =>
    t.slots.map((s) => ({
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

async function call(t: TimeTrackerSettings, path: string, body: unknown, token?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${t.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new HttpError(502, `Time tracker unreachable (${e instanceof Error ? e.message : String(e)}) — VPN / office network?`);
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status === 401 || res.status === 403 ? 401 : 502, `Time tracker HTTP ${res.status}: ${explain(text, t)}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

type Obj = Record<string, unknown>;

/** First numeric id among the fields the time tracker uses for the signed-in user (the web app keeps it as `loginId`). */
function userIdFrom(j: Obj | null): string | null {
  const scopes = [j, j?.user, j?.data, (j?.data as Obj | undefined)?.user, j?.loginUser].filter((x): x is Obj => !!x && typeof x === "object");
  for (const o of scopes)
    for (const k of ["loginId", "loginUserId", "userId", "id"]) {
      const v = o[k];
      if ((typeof v === "number" || typeof v === "string") && /^\d+$/.test(String(v))) return String(v);
    }
  return null;
}

/** Logs in with the saved name + password; the token is used for one request and never stored. */
async function login(t: TimeTrackerSettings): Promise<{ token: string; userId: string | null }> {
  const password = await getSecret("timetracker.password");
  if (!password) throw new HttpError(400, "Time tracker password is not saved (Settings → Features → Log time).");
  const raw = await call(t, "/api/auth/token", { loginName: t.loginName, password });
  const j = raw && typeof raw === "object" ? (raw as Obj) : null;
  const token = typeof raw === "string" ? raw : String(j?.token ?? j?.accessToken ?? j?.access_token ?? (j?.data as Obj | undefined)?.token ?? "");
  if (!token) throw new HttpError(502, "Time tracker login returned no token.");
  return { token, userId: userIdFrom(j) };
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

export function preview(from: string, to: string) {
  const t = getSettings().timeTracker;
  const days = workdays(from, to);
  return { days, slots: t.slots, hoursPerDay: slotHours(t.slots), entries: days.length * t.slots.length };
}

export async function logTime(dates: string[]) {
  const s = getSettings();
  if (!s.features.logTime) throw new HttpError(403, "Log time is turned off (Settings → Features).");
  const t = config();
  const days = [...new Set(dates)].sort();
  if (!days.length) throw new HttpError(400, "Pick at least one day.");
  if (days.length > MAX_DAYS || days.some((d) => !DATE_RE.test(d))) throw new HttpError(400, "Invalid days");
  const { token, userId } = await login(t);
  const id = rememberUserId(t, userId);
  const entries = entriesFor(days, { ...t, userId: id });
  // Same payload as the team's browser script: one "adds" list; slots that already exist are skipped by the time tracker.
  const response = await call(t, `/api/system/users/${encodeURIComponent(id)}/timeEntries/bulk`, { adds: entries }, token);
  return { days: days.length, entries: entries.length, hours: days.length * slotHours(t.slots), response };
}
