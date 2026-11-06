import { adfToMarkdown } from "@/lib/adf";
import type { Settings, Sprint, StatusCategory, Ticket } from "@/lib/types";
import { HttpError } from "./api";
import { getSecret } from "./secrets";
import { getSettings } from "./settings";

type Json = Record<string, unknown>;

async function jiraRequest<T>(
  method: "GET" | "PUT" | "POST",
  path: string,
  params: Record<string, string | number | undefined>,
  body: unknown,
  s?: Settings,
): Promise<T> {
  const settings = s ?? getSettings();
  const { baseUrl, email } = settings.jira;
  const token = await getSecret("jira.token");
  if (!baseUrl || !email || !token) throw new HttpError(400, "Jira is not configured (Settings → Jira).");
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${email}:${token}`).toString("base64"),
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
      detail = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join("; ");
    } catch {
      /* non-JSON error body */
    }
    const hint =
      res.status === 401 ? "Unauthorized — check email / API token" : res.status === 403 ? "Forbidden" : `HTTP ${res.status}`;
    throw new HttpError(res.status === 404 ? 404 : 502, `Jira: ${hint}${detail ? ` — ${detail}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Reads are GETs; the only writes go through jiraSend, which is off unless Settings → Features → Jira write is on.
async function jiraFetch<T = Json>(path: string, params: Record<string, string | number | undefined> = {}, s?: Settings) {
  return jiraRequest<T>("GET", path, params, undefined, s);
}

export async function jiraSend(method: "PUT" | "POST", path: string, body: unknown): Promise<void> {
  if (!getSettings().features.jiraWrite) throw new HttpError(403, "Writing to Jira is turned off (Settings → Features → Jira write).");
  await jiraRequest(method, path, {}, body);
}

export async function jiraMyself(s?: Settings) {
  const j = await jiraFetch<{ accountId: string; displayName: string; emailAddress?: string }>("/rest/api/3/myself", {}, s);
  return { accountId: j.accountId, displayName: j.displayName, email: j.emailAddress ?? "" };
}

/** Picks fields by how often they are actually filled in the active sprint, then by the standard Jira names. */
export async function detectFields() {
  const s = getSettings();
  const fields = await jiraFetch<{ id: string; name: string; custom: boolean }[]>("/rest/api/3/field", {}, s);
  const custom = fields.filter((f) => f.custom);
  const find = (re: RegExp) => custom.filter((f) => re.test(f.name)).map((f) => ({ id: f.id, name: f.name }));
  const sp = find(/story ?points?|story point estimate/i);
  const ac = find(/acceptance ?criteria/i);
  const flagged = find(/^flagged$/i);

  const filled: Record<string, number> = {};
  let sampled = 0;
  if (s.jira.boardId) {
    try {
      const sprints = await listSprints();
      const active = sprints.find((x) => x.state === "active") ?? sprints[0];
      if (active) {
        const j = await jiraFetch<{ issues: Json[] }>(`/rest/agile/1.0/sprint/${active.id}/issue`, {
          fields: [...sp, ...ac].map((f) => f.id).join(","),
          maxResults: 50,
        });
        sampled = j.issues.length;
        for (const issue of j.issues) {
          const f = (issue.fields ?? {}) as Json;
          for (const c of sp) if (typeof f[c.id] === "number") filled[c.id] = (filled[c.id] ?? 0) + 1;
          for (const c of ac) if (f[c.id] !== null && f[c.id] !== undefined && f[c.id] !== "") filled[c.id] = (filled[c.id] ?? 0) + 1;
        }
      }
    } catch {
      /* no sprint access: fall back to name ranking */
    }
  }
  const pref = (name: string) => (/^story points$/i.test(name) ? 2 : /^story point estimate$/i.test(name) ? 1 : 0);
  const rank = (list: { id: string; name: string }[]) =>
    list.map((x) => ({ ...x, filled: filled[x.id] ?? 0 })).sort((a, b) => b.filled - a.filled || pref(b.name) - pref(a.name));
  const spR = rank(sp);
  const acR = rank(ac);
  return {
    spField: spR[0]?.id ?? "",
    acField: acR[0]?.id ?? "",
    flaggedField: flagged[0]?.id ?? "",
    sampled,
    candidates: { sp: spR, ac: acR, flagged: flagged.map((x) => ({ ...x, filled: 0 })) },
  };
}

export async function listBoards(q: string) {
  const s = getSettings();
  const j = await jiraFetch<{ values: { id: number; name: string; type: string; location?: { projectKey?: string } }[] }>(
    "/rest/agile/1.0/board",
    { maxResults: 50, name: q || undefined, projectKeyOrId: s.jira.projectKey || undefined },
  );
  return j.values.map((b) => ({ id: b.id, name: b.name, type: b.type, projectKey: b.location?.projectKey ?? "" }));
}

export async function listSprints(): Promise<Sprint[]> {
  const s = getSettings();
  if (!s.jira.boardId) throw new HttpError(400, "Set the Jira board ID in Settings → Jira.");
  const all: Sprint[] = [];
  for (let startAt = 0; startAt < 2000; startAt += 50) {
    const j = await jiraFetch<{ isLast: boolean; values: Json[] }>(`/rest/agile/1.0/board/${encodeURIComponent(s.jira.boardId)}/sprint`, {
      state: "active,future,closed",
      startAt,
      maxResults: 50,
    });
    for (const v of j.values)
      all.push({
        id: Number(v.id),
        name: String(v.name),
        state: v.state as Sprint["state"],
        startDate: (v.startDate as string) ?? null,
        endDate: (v.endDate as string) ?? null,
        goal: String(v.goal ?? ""),
      });
    if (j.isLast || !j.values.length) break;
  }
  const newestFirst = (a: Sprint, b: Sprint) => (b.startDate ?? "").localeCompare(a.startDate ?? "");
  const soonestFirst = (a: Sprint, b: Sprint) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999");
  const active = all.filter((x) => x.state === "active");
  const closed = all.filter((x) => x.state === "closed").sort(newestFirst).slice(0, 12);
  const future = all.filter((x) => x.state === "future").sort(soonestFirst).slice(0, 3);
  // Previous sprints right under the current one — that's what people look back at; only the next few future ones.
  return [...active, ...closed, ...future];
}

function issueFields(s: Settings): string {
  return [
    "summary",
    "status",
    "assignee",
    "issuetype",
    "parent",
    "updated",
    "created",
    "description",
    "issuelinks",
    "attachment",
    "labels",
    s.jira.spField,
    s.jira.acField,
    s.jira.flaggedField,
  ]
    .filter(Boolean)
    .join(",");
}


export function mapIssue(raw: Json, s: Settings): Ticket {
  const f = (raw.fields ?? {}) as Json;
  const status = (f.status ?? {}) as { name?: string; statusCategory?: { key?: string } };
  const type = (f.issuetype ?? {}) as { name?: string; subtask?: boolean };
  const assignee = f.assignee as { accountId: string; displayName: string; avatarUrls?: Record<string, string> } | null;
  const parent = f.parent as { key: string; fields?: { summary?: string; issuetype?: { name?: string } } } | undefined;
  const acRaw = s.jira.acField ? f[s.jira.acField] : null;
  const pointsRaw = s.jira.spField ? f[s.jira.spField] : null;
  const flaggedRaw = s.jira.flaggedField ? f[s.jira.flaggedField] : null;
  const descriptionMd = adfToMarkdown(f.description);
  const acMd = adfToMarkdown(acRaw);
  const cat = status.statusCategory?.key;
  const statusCategory: StatusCategory = cat === "done" ? "done" : cat === "new" ? "new" : "indeterminate";
  const key = String(raw.key);

  return {
    key,
    id: String(raw.id),
    url: `${s.jira.baseUrl}/browse/${key}`,
    type: type.name ?? "",
    subtask: !!type.subtask,
    summary: String(f.summary ?? ""),
    status: status.name ?? "",
    statusCategory,
    assignee: assignee
      ? { accountId: assignee.accountId, name: assignee.displayName, avatar: assignee.avatarUrls?.["24x24"] ?? "" }
      : null,
    points: typeof pointsRaw === "number" ? pointsRaw : null,
    parentKey: parent?.key ?? null,
    parentSummary: parent?.fields?.summary ?? null,
    parentType: parent?.fields?.issuetype?.name ?? null,
    descriptionMd,
    acMd,
    links: ((f.issuelinks ?? []) as Json[]).map((l) => {
      const other = (l.outwardIssue ?? l.inwardIssue) as { key: string; fields?: { summary?: string; status?: { name?: string } } };
      const t = l.type as { inward?: string; outward?: string };
      return {
        type: (l.outwardIssue ? t.outward : t.inward) ?? "",
        key: other?.key ?? "",
        summary: other?.fields?.summary ?? "",
        status: other?.fields?.status?.name ?? "",
      };
    }),
    attachments: ((f.attachment ?? []) as Json[]).map((a) => ({
      filename: String(a.filename),
      mimeType: String(a.mimeType ?? ""),
      size: Number(a.size ?? 0),
      url: String(a.content ?? ""),
    })),
    labels: (f.labels as string[]) ?? [],
    flagged: Array.isArray(flaggedRaw) ? flaggedRaw.length > 0 : !!flaggedRaw,
    updated: String(f.updated ?? ""),
    created: String(f.created ?? ""),
  };
}

export async function sprintIssues(sprintId: number): Promise<Ticket[]> {
  const s = getSettings();
  const out: Ticket[] = [];
  for (let startAt = 0; ; startAt += 100) {
    const j = await jiraFetch<{ total: number; issues: Json[] }>(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
      fields: issueFields(s),
      startAt,
      maxResults: 100,
    });
    out.push(...j.issues.map((i) => mapIssue(i, s)));
    if (startAt + 100 >= j.total || !j.issues.length) break;
  }
  return out;
}

export async function getIssue(key: string): Promise<Ticket> {
  const s = getSettings();
  const j = await jiraFetch<Json>(`/rest/api/3/issue/${encodeURIComponent(key)}`, { fields: issueFields(s) });
  return mapIssue(j, s);
}

export interface RawIssue {
  key: string;
  fields: Json;
  changelog?: { histories: { author?: { accountId?: string }; created: string; items: { field: string; fieldId?: string; from?: string; to?: string; toString?: string; fromString?: string }[] }[] };
}

export async function searchJql(jql: string, fields: string[], expand?: string, limit = 300): Promise<RawIssue[]> {
  const out: RawIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const j = await jiraFetch<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>("/rest/api/3/search/jql", {
      jql,
      fields: fields.filter(Boolean).join(","),
      expand,
      maxResults: 100,
      nextPageToken,
    });
    out.push(...j.issues);
    nextPageToken = j.isLast ? undefined : j.nextPageToken;
  } while (nextPageToken && out.length < limit);
  return out;
}

export async function searchTickets(jql: string, limit = 100): Promise<Ticket[]> {
  const s = getSettings();
  const raw = await searchJql(jql, issueFields(s).split(","), undefined, limit);
  return raw.map((r) => mapIssue(r as unknown as Json, s));
}

export async function statusCategories(): Promise<Record<string, StatusCategory>> {
  const list = await jiraFetch<{ id: string; statusCategory?: { key?: string } }[]>("/rest/api/3/status");
  return Object.fromEntries(
    list.map((x) => [x.id, x.statusCategory?.key === "done" ? "done" : x.statusCategory?.key === "new" ? "new" : "indeterminate"]),
  ) as Record<string, StatusCategory>;
}

/** Field ids by name, for changelog items that only carry the display name (e.g. "Story Points", "Sprint"). */
export async function fieldIndex(): Promise<{ sprint: string; names: Record<string, string> }> {
  const fields = await jiraFetch<{ id: string; name: string; schema?: { custom?: string } }[]>("/rest/api/3/field");
  return {
    sprint: fields.find((f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint")?.id ?? "",
    names: Object.fromEntries(fields.map((f) => [f.id, f.name])),
  };
}

/** Read-only GET for modules outside this file. */
export function jiraGet<T = Json>(path: string, params: Record<string, string | number | undefined> = {}) {
  return jiraFetch<T>(path, params);
}
