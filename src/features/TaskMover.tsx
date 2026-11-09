import { WarningIcon } from "@/components/icons";
import { Button, Checkbox, Spinner } from "@/components/kit";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { JobProgress, Loader, StatusTag } from "@/components/ui";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { trackJob, useLatestOfKind } from "@/lib/jobTracker";
import { useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { JobState, StatusCategory } from "@/lib/types";

interface MyTask {
  key: string;
  summary: string;
  type: string;
  status: string;
  category: StatusCategory;
  action: string[];
  score: string | null;
  doneVia?: string | null;
  nextStep?: string | null;
  targets?: string[];
  assignee: { accountId: string; name: string } | null;
}

interface Member {
  accountId: string;
  name: string;
  count: number;
}

interface MyTasksResponse {
  tasks: MyTask[];
  me: { accountId: string; name: string };
  members: Member[];
  permissions: { edit: boolean; transition: boolean };
  fields: { action: string; score: string; actionValue: string } | null;
}

/** Random 4 or 5 per sub-task, stable for one seed so the preview matches what gets written. */
function roll(key: string, seed: number): 4 | 5 {
  let h = Math.floor(seed * 2 ** 31);
  for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return (h >>> 0) % 2 ? 5 : 4;
}

function Body({ sprintId }: { sprintId: number }) {
  const { t } = useT();
  const settings = useSettings();
  const base = settings.data?.jira.baseUrl;
  const writeOn = !!settings.data?.features.jiraWrite;
  // null → only me (default); [] → every member; else the picked account ids.
  const [assignees, setAssignees] = useState<string[] | null>(null);
  const param = assignees === null ? "" : assignees.length ? assignees.join(",") : "all";
  const q = useQuery({
    queryKey: ["my-tasks", sprintId, param],
    queryFn: () => http.get<MyTasksResponse>(`/api/jira/my-tasks?sprintId=${sprintId}${param ? `&assignees=${encodeURIComponent(param)}` : ""}`),
    placeholderData: (prev) => prev,
  });
  const tasks = useMemo(() => q.data?.tasks ?? [], [q.data]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // Default pick: everything not Done yet; any row can be picked (a Done sub-task can still move elsewhere).
  const selected = picked ?? new Set<string>();
  const [targetOf, setTargetOf] = useState<Record<string, string>>({});
  // Default is the current status (no change); the person picks where each row goes.
  const target = (x: MyTask) => targetOf[x.key] ?? x.status;
  const noop = (x: MyTask) => target(x).toLowerCase() === x.status.toLowerCase();
  const [seed, setSeed] = useState(() => Math.random());
  const scoreOf = (key: string) => roll(key, seed);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(id);
  }, [armed]);
  const { tracked, job, running } = useLatestOfKind("my-done");
  const [starting, setStarting] = useState(false);

  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setPicked(next);
  };
  const pickTarget = (x: MyTask, to: string) => {
    setTargetOf({ ...targetOf, [x.key]: to });
    if (to.toLowerCase() !== x.status.toLowerCase() && !selected.has(x.key)) toggle(x.key, true);
  };
  const chosen = tasks.filter((x) => selected.has(x.key) && !noop(x));
  const run = async () => {
    setArmed(false);
    setStarting(true);
    try {
      const items = chosen.map((x) => ({ key: x.key, score: scoreOf(x.key), to: target(x) }));
      const j = await http.post<JobState>("/api/jira/my-tasks/done", { sprintId, items });
      trackJob("my-done", items.map((i) => i.key), j);
      setPicked(null);
      setTargetOf({});
    } catch (e) {
      toast.fromError(t("myDone.failed"), e);
    } finally {
      setStarting(false);
    }
  };

  if (q.isLoading) return <Loader />;
  if (q.error) return <p className="text-sm text-ui-error">{(q.error as Error).message}</p>;
  const d = q.data;
  if (!d) return null;
  const perm = (ok: boolean) => (ok ? "✓" : "✗");

  return (
    <div className="space-y-3">
      <ul className="text-xs text-ui-secondary list-disc pl-5 space-y-0.5">
        {d.fields ? (
          <>
            <li>{t("myDone.ruleDone", { action: d.fields.action, value: d.fields.actionValue, score: d.fields.score })}</li>
            <li>{t("myDone.ruleOther")}</li>
          </>
        ) : (
          <li>
            {t("myDone.noAiFields")} <Link href="/settings#features">{t("myDone.openSettings")}</Link>
          </li>
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-80">
          <Select
            size="sm"
            multiple
            clearable
            limitTags={2}
            aria-label={t("myDone.members")}
            placeholder={t("myDone.allMembers")}
            items={d.members.map((m) => ({
              value: m.accountId,
              label: `${m.accountId === d.me.accountId ? t("myDone.meLabel", { name: m.name }) : m.name} (${m.count})`,
            }))}
            value={assignees ?? [d.me.accountId]}
            onValueChange={(v) => {
              setAssignees(v);
              setPicked(null);
              setTargetOf({});
            }}
          />
        </div>
        {q.isFetching && <Spinner size="sm" />}
        <span className="text-xs text-ui-secondary">{t("myDone.count", { n: tasks.length })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={d.permissions.edit && d.permissions.transition ? "text-ui-success" : "text-ui-error"}>
          {t("myDone.perms", { edit: perm(d.permissions.edit), transition: perm(d.permissions.transition) })}
        </span>
        {!writeOn && (
          <span className="rounded bg-ui-warning-surface px-2 py-1 text-ui-warning-dark">
            <WarningIcon size={14} className="inline -mt-0.5 mr-1.5" />
            {t("myDone.writeOff")} <Link href="/settings#features">{t("myDone.openSettings")}</Link>
          </span>
        )}
      </div>
      {!tasks.length ? (
        <p className="text-sm text-ui-secondary">{t("myDone.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ui-secondary border-b border-ui-border">
                <th className="py-2 pr-2 w-8">
                  <Checkbox
                    size="sm"
                    aria-label={t("myDone.selectAll")}
                    title={t("myDone.selectAll")}
                    checked={tasks.length > 0 && tasks.every((x) => selected.has(x.key))}
                    indeterminate={tasks.some((x) => selected.has(x.key)) && !tasks.every((x) => selected.has(x.key))}
                    disabled={running}
                    onChange={(e) => setPicked(new Set(e.target.checked ? tasks.map((x) => x.key) : []))}
                  />
                </th>
                <th className="py-2 pr-3">{t("myDone.colTask")}</th>
                <th className="py-2 pr-3">{t("myDone.colAssignee")}</th>
                <th className="py-2 pr-3">{t("myDone.colStatus")}</th>
                {d.fields && <th className="py-2 pr-3">{t("myDone.colFields")}</th>}
                <th className="py-2 pr-3 whitespace-nowrap">{t("myDone.colTarget")}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((x) => {
                return (
                  <tr key={x.key} className="border-b border-ui-border last:border-0 align-top">
                    <td className="py-2 pr-2">
                      <Checkbox
                        size="sm"
                        aria-label={x.key}
                        checked={selected.has(x.key)}
                        disabled={running}
                        onChange={(e) => toggle(x.key, e.target.checked)}
                      />
                    </td>
                    <td className="py-2 pr-3 min-w-[260px]">
                      {base ? (
                        <a href={`${base}/browse/${x.key}`} target="_blank" rel="noreferrer" className="font-semibold text-ui-brand no-underline">
                          {x.key}
                        </a>
                      ) : (
                        <b>{x.key}</b>
                      )}{" "}
                      <span className="text-ui-body">{x.summary}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-ui-subtle whitespace-nowrap">{x.assignee?.name ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <StatusTag status={x.status} category={x.category} />
                    </td>
                    {d.fields && (
                      <td className="py-2 pr-3 text-xs text-ui-subtle">
                        <div>{x.action.length ? x.action.join(", ") : "—"}</div>
                        <div>
                          {t("myDone.score")}: {x.score ?? "—"}
                        </div>
                      </td>
                    )}
                    <td className="py-2 pr-3 w-44">
                      <Select
                        size="sm"
                        aria-label={`${x.key} → ${target(x)}`}
                        disabled={running}
                        items={[...new Set([x.status, "Done", ...(x.targets ?? [])])].map((n) => ({
                          value: n,
                          label: n === x.status ? t("myDone.current", { status: n }) : n,
                        }))}
                        value={[target(x)]}
                        onValueChange={(v) => v[0] && pickTarget(x, v[0])}
                      />
                      {d.fields && target(x) === "Done" && !noop(x) && (
                        <div className="text-2xs text-ui-secondary mt-1">{t("myDone.scoreHint", { score: scoreOf(x.key) })}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-ui-secondary">{t("myDone.bulk", { n: selected.size })}</span>
        <div className="w-48">
          <Select
            size="sm"
            aria-label={t("myDone.bulk", { n: selected.size })}
            placeholder={t("myDone.bulkPick")}
            disabled={!selected.size || running}
            items={[...new Set(["Done", ...tasks.filter((x) => selected.has(x.key)).flatMap((x) => x.targets ?? [])])].map((n) => ({ value: n, label: n }))}
            value={[]}
            onValueChange={(v) => {
              const to = v[0];
              if (!to) return;
              const next = { ...targetOf };
              // Only rows that can actually reach it (Done is always reachable by walking forward).
              for (const x of tasks) if (selected.has(x.key) && (to === "Done" || (x.targets ?? []).includes(to))) next[x.key] = to;
              setTargetOf(next);
            }}
          />
        </div>
        {d.fields && (
          <Button size="sm" variant="ghost" color="neutral" disabled={running} onClick={() => setSeed(Math.random())}>
            {t("myDone.reroll")}
          </Button>
        )}
        <Button
          size="sm"
          color={armed ? "danger" : "primary"}
          loading={starting || running}
          disabled={!writeOn || !chosen.length || !d.permissions.transition}
          onClick={() => (armed ? void run() : setArmed(true))}
        >
          {armed ? t("myDone.confirm", { n: chosen.length }) : t("myDone.run", { n: chosen.length })}
        </Button>
      </div>
      {tracked && job && <JobProgress job={job} showItems />}
    </div>
  );
}

/** Moves sprint sub-tasks (mine by default, or any member's) to Done or any reachable status, filling or clearing the AI fields. */
export default function TaskMover({ sprintId }: { sprintId: number }) {
  return (
    <section className="glass border rounded-lg p-4">
      <Body key={sprintId} sprintId={sprintId} />
    </section>
  );
}
