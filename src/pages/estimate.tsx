import { Button, Input, Spinner, Tag, Toggle } from "@/components/kit";
import { ExternalIcon, RefreshIcon, SearchIcon } from "@/components/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/router";
import { type ReactNode, useState } from "react";
import { Card, ConfirmDelete, CopyButton, Empty, JobProgress, Loader, Md, PageHeader, ReloadButton, StaleBanner, StatusTag } from "@/components/ui";
import { http } from "@/lib/client";
import { type MessageKey, useT } from "@/lib/i18n";
import { useShallow } from "zustand/react/shallow";
import { startTracked, useJobTracker, useTrackedFor } from "@/lib/jobTracker";
import SprintEstimate from "@/features/SprintEstimate";
import { useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Bilingual, Severity, Staleness, StoredEstimate, TaskSize, Ticket } from "@/lib/types";

interface EstimateView {
  ticket: Ticket;
  estimate: StoredEstimate | null;
  stale: Staleness | null;
  hasReview: boolean;
}

interface HistoryRow {
  key: string;
  title: string;
  type: string;
  points: number;
  jiraPoints: number | null;
  confidence: Severity;
  estimatedAt: string;
  codeAware: boolean;
}

const KEY_RE = /[A-Z][A-Z0-9]+-\d+/g;
/** Full keys and Jira links as-is; a bare number (e.g. 8376) gets the project prefix (→ INTERNAL-8376). */
function parseKeys(text: string, project: string): string[] {
  const upper = text.toUpperCase();
  const keys = upper.match(KEY_RE) ?? [];
  // Bare numbers need the project key from Settings; without it only full keys count.
  const bare = project ? (upper.replace(KEY_RE, " ").match(/\b\d{1,7}\b/g) ?? []).map((n) => `${project}-${Number(n)}`) : [];
  return [...new Set([...keys, ...bare])].slice(0, 20);
}

const SIZE_COLOR: Record<TaskSize, "neutral" | "blue" | "secondary" | "orange" | "red"> = {
  XS: "neutral",
  S: "blue",
  M: "secondary",
  L: "orange",
  XL: "red",
};
const CONF_COLOR: Record<Severity, "green" | "orange" | "red"> = { high: "green", medium: "orange", low: "red" };

function estimateMarkdown(e: StoredEstimate, pick: (b: Bilingual) => string, t: (k: MessageKey, v?: Record<string, string | number>) => string) {
  const list = (title: string, items: string[]) => (items.length ? [`**${title}**`, ...items.map((i) => `- ${i}`), ""] : []);
  const effect = { up: "↑", down: "↓", neutral: "•" } as const;
  return [
    `**${e.key} — ${e.title}**`,
    `${t("estimate.ai")}: **${e.points} pts** (${t("estimate.range", { low: e.low, high: e.high })}) · ${t("estimate.confidence")}: ${t(`estimate.conf.${e.confidence}` as MessageKey)} · ${t("estimate.jira")}: ${e.jiraPoints ?? t("estimate.notEstimated")}`,
    "",
    ...(e.brief ? [`> ${pick(e.brief)}`, ""] : []),
    pick(e.summary),
    "",
    ...list(
      t("estimate.tasks", { n: e.tasks.length }),
      e.tasks.map((x) => `[${x.repo}] ${pick(x.title)} (${x.size}) — ${pick(x.detail)}`),
    ),
    ...list(t("estimate.reasons"), e.reasons.map((r) => `${effect[r.effect]} ${pick(r)}`)),
    ...list(t("estimate.references"), e.references.map((r) => `${r.key} (${r.points} pts) ${r.summary} — ${pick(r.why)}`)),
    ...list(t("estimate.split"), e.split.map(pick)),
    ...list(t("estimate.risks"), e.risks.map(pick)),
    ...list(t("estimate.questions"), e.questions.map(pick)),
  ].join("\n");
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ui-heading mb-2">{title}</h3>
      {children}
    </section>
  );
}

function BiList({ items }: { items: Bilingual[] }) {
  const { pick } = useT();
  return (
    <ul className="text-sm space-y-1 pl-5 m-0">
      {items.map((x, i) => (
        <li key={i}>{pick(x)}</li>
      ))}
    </ul>
  );
}

function Detail({ ticketKey, code, canCode }: { ticketKey: string; code: boolean; canCode: boolean }) {
  const { t, pick } = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["estimate", ticketKey],
    queryFn: () => http.get<EstimateView>(`/api/estimate/${ticketKey}`),
    staleTime: 0,
  });
  const { job, running } = useTrackedFor("estimate", ticketKey);
  const start = (force: boolean) => void startTracked("estimate", [ticketKey], force, { code: code && canCode });

  if (q.isLoading) return <Loader fill />;
  if (q.error) return <p className="text-sm text-ui-error">{(q.error as Error).message}</p>;
  if (!q.data) return null;
  const { ticket, estimate: e, stale } = q.data;
  const diff = e && e.jiraPoints != null ? e.points - e.jiraPoints : null;
  const jiraBase = ticket.url.slice(0, ticket.url.lastIndexOf("/") + 1);

  const remove = () =>
    http
      .del(`/api/estimate/${ticketKey}`)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["estimates"] });
        void qc.invalidateQueries({ queryKey: ["estimate", ticketKey] });
      })
      .catch((err: Error) => toast.fromError(t("common.failed"), err));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ui-brand">{ticket.key}</span>
              <Tag size="sm" color="neutral" variant="light">{ticket.type}</Tag>
              <StatusTag status={ticket.status} category={ticket.statusCategory} />
              <a href={ticket.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 no-underline [&_svg]:w-3.5 [&_svg]:h-3.5">
                Jira <ExternalIcon />
              </a>
              <button
                type="button"
                className="text-xs bg-transparent border-0 p-0 text-ui-heading underline cursor-pointer"
                onClick={() => void router.push(`/sprint?src=jql&jql=${encodeURIComponent(`key = ${ticket.key}`)}&open=${ticket.key}`)}
              >
                {t("estimate.openTicket")}
              </button>
            </div>
            <h2 className="text-base font-semibold text-ui-primary mt-1">{ticket.summary}</h2>
            <div className="text-xs text-ui-secondary mt-0.5">{ticket.assignee?.name ?? t("ticket.unassigned")}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {e && <CopyButton text={estimateMarkdown(e, pick, t)} label={t("common.copyMarkdown")} />}
            {e && <ConfirmDelete onConfirm={remove} iconOnly />}
            <Button size="sm" loading={running} leftIcon={e ? <RefreshIcon /> : undefined} onClick={() => start(!!e)}>
              {e ? t("estimate.rerun") : t("estimate.run")}
            </Button>
          </div>
        </div>
        {q.data.hasReview && !e && <p className="text-xs text-ui-secondary mt-2">{t("estimate.reviewHint")}</p>}
        {running && (
          <div className="mt-3">
            <JobProgress job={job} />
          </div>
        )}
        <details className="mt-3 group">
          <summary className="text-sm text-ui-heading cursor-pointer select-none">{t("estimate.ticket")}</summary>
          <div className="mt-2 space-y-3 border-t border-ui-border pt-3">
            {ticket.descriptionMd ? <Md>{ticket.descriptionMd}</Md> : <p className="text-sm text-ui-secondary">—</p>}
            {ticket.acMd && (
              <>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ui-heading m-0">{t("ticket.ac")}</h4>
                <Md>{ticket.acMd}</Md>
              </>
            )}
          </div>
        </details>
      </Card>

      {!e && !running && (
        <Card>
          <Empty>{t("estimate.none")}</Empty>
        </Card>
      )}

      {e && (
        <>
          {!running && <StaleBanner stale={stale} onRerun={() => start(true)} />}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="glass border border-l-4 border-l-ui-brand rounded-lg px-4 py-3">
              <div className="text-xs text-ui-brand font-semibold">{t("estimate.ai")}</div>
              <div className="text-3xl font-bold text-ui-brand mt-1">
                {e.points} <span className="text-sm font-semibold">pts</span>
              </div>
              <div className="text-xs text-ui-subtle mt-0.5">{t("estimate.range", { low: e.low, high: e.high })}</div>
              {e.anchor != null && <div className="text-xs text-ui-subtle">{t("estimate.anchor", { n: e.anchor })}</div>}
            </div>
            <div className="glass border rounded-lg px-4 py-3">
              <div className="text-xs text-ui-secondary">{t("estimate.jira")}</div>
              <div className="text-2xl font-semibold text-ui-primary mt-1">{e.jiraPoints ?? "—"}</div>
              <div className="text-xs text-ui-secondary mt-0.5">
                {e.jiraPoints == null ? t("estimate.notEstimated") : diff ? t("estimate.diff", { n: diff > 0 ? `+${diff}` : diff }) : "✓"}
              </div>
            </div>
            <div className="glass border rounded-lg px-4 py-3">
              <div className="text-xs text-ui-secondary">{t("estimate.confidence")}</div>
              <div className="mt-2">
                <Tag color={CONF_COLOR[e.confidence]} variant="light">{t(`estimate.conf.${e.confidence}` as MessageKey)}</Tag>
              </div>
              <div className="text-xs text-ui-secondary mt-1">{e.codeAware ? t("estimate.codeAware") : t("estimate.ticketOnly")}</div>
            </div>
            <div className="glass border rounded-lg px-4 py-3">
              <div className="text-xs text-ui-secondary">{t("estimate.tasks", { n: e.tasks.length })}</div>
              <div className="flex flex-wrap gap-1 mt-2">
                {e.inScope.map((k) => (
                  <Tag key={k} size="sm" color="secondary" variant="light">{k}</Tag>
                ))}
              </div>
            </div>
          </div>

          {e.aiPoints != null && e.aiPoints !== e.points && (
            <p className="text-xs text-ui-subtle m-0 -mt-1">{t("estimate.adjusted", { ai: e.aiPoints, final: e.points, anchor: e.anchor ?? "—" })}</p>
          )}
          {e.brief && (
            <Card
              title={t("estimate.brief")}
              actions={<CopyButton text={`${e.key}: ${e.points} pts — ${pick(e.brief)}`} label={t("common.copy")} />}
            >
              <p className="text-title leading-relaxed font-medium text-ui-primary m-0 border-l-[3px] border-ui-brand pl-3">{pick(e.brief)}</p>
            </Card>
          )}

          <Card title={t("estimate.analysis")}>
            <p className="text-sm leading-relaxed text-ui-body m-0">{pick(e.summary)}</p>
            <p className="text-xs text-ui-secondary mt-3 mb-0">
              {t("estimate.at", { at: new Date(e.estimatedAt).toLocaleString() })} ·{" "}
              {e.calibrationCount ? t("estimate.calibration", { n: e.calibrationCount }) : t("estimate.noCalibration")}
              {e.teamMedian != null && ` · ${t("estimate.teamMedian", { n: e.teamMedian })}`}
              {Object.keys(e.repos).length > 0 &&
                ` · ${Object.entries(e.repos)
                  .map(([k, v]) => `${k}@${v.branch}${v.dirty ? "*" : ""}`)
                  .join(", ")}`}
            </p>
          </Card>

          <Card title={t("estimate.tasks", { n: e.tasks.length })}>
            <ul className="list-none p-0 m-0 divide-y divide-ui-border">
              {e.tasks.map((x, i) => (
                <li key={i} className="py-2 grid grid-cols-[92px_minmax(0,1fr)_44px] gap-3 items-start">
                  <span>
                    <Tag size="sm" color="neutral" variant="light">{x.repo}</Tag>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-ui-primary">{pick(x.title)}</span>
                    {pick(x.detail) && <span className="block text-ui-subtle text-label mt-0.5">{pick(x.detail)}</span>}
                  </span>
                  <span className="text-right">
                    <Tag size="sm" color={SIZE_COLOR[x.size]} variant="light">{x.size}</Tag>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title={t("estimate.reasons")}>
              <ul className="list-none p-0 m-0 space-y-1.5 text-sm">
                {e.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span
                      aria-hidden
                      className={`w-4 shrink-0 font-bold ${r.effect === "up" ? "text-ui-error" : r.effect === "down" ? "text-ui-success" : "text-ui-secondary"}`}
                    >
                      {r.effect === "up" ? "↑" : r.effect === "down" ? "↓" : "•"}
                    </span>
                    <span>{pick(r)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t("estimate.references")}>
              {e.references.length === 0 ? (
                <p className="text-sm text-ui-secondary m-0">{e.calibrationCount ? "—" : t("estimate.noCalibration")}</p>
              ) : (
                <ul className="list-none p-0 m-0 space-y-2.5 text-sm">
                  {e.references.map((r) => (
                    <li key={r.key}>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={jiraBase + r.key} target="_blank" rel="noreferrer" className="font-semibold no-underline">
                          {r.key}
                        </a>
                        <Tag size="sm" color="primary" variant="light">{r.points} pts</Tag>
                        <span className="text-ui-subtle truncate min-w-0 flex-1">{r.summary}</span>
                      </div>
                      <div className="text-label text-ui-body mt-0.5">{pick(r.why)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {(e.split.length > 0 || e.risks.length > 0 || e.assumptions.length > 0 || e.questions.length > 0) && (
            <Card>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {e.split.length > 0 && (
                  <Block title={t("estimate.split")}>
                    <BiList items={e.split} />
                  </Block>
                )}
                {e.questions.length > 0 && (
                  <Block title={t("estimate.questions")}>
                    <BiList items={e.questions} />
                  </Block>
                )}
                {e.risks.length > 0 && (
                  <Block title={t("estimate.risks")}>
                    <BiList items={e.risks} />
                  </Block>
                )}
                {e.assumptions.length > 0 && (
                  <Block title={t("estimate.assumptions")}>
                    <BiList items={e.assumptions} />
                  </Block>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** A story whose first estimate is still running: not in history yet, but must stay visible. */
function RunningItem({ ticketKey, active, onPick }: { ticketKey: string; active: boolean; onPick: () => void }) {
  const { t } = useT();
  const { job } = useTrackedFor("estimate", ticketKey);
  const status = job?.items[ticketKey]?.status;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className={`w-full text-left px-3 py-2 border-0 border-l-[3px] cursor-pointer ${
          active ? "bg-ui-brand-surface border-ui-brand" : "bg-transparent border-transparent hover:bg-ui-surface"
        }`}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-ui-brand">{ticketKey}</span>
          <Spinner size="sm" />
          <span className="ml-auto text-ui-secondary">{status === "pending" ? t("estimate.queued") : t("estimate.running")}</span>
        </div>
      </button>
    </li>
  );
}

function HistoryItem({ row, active, onPick, onDelete }: { row: HistoryRow; active: boolean; onPick: () => void; onDelete: () => void }) {
  const { t } = useT();
  const { running } = useTrackedFor("estimate", row.key);
  return (
    <li
      className={`group flex items-center border-l-[3px] ${
        active ? "bg-ui-brand-surface border-ui-brand" : "border-transparent hover:bg-ui-surface"
      }`}
    >
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className="flex-1 min-w-0 text-left pl-3 pr-1 py-2 border-0 bg-transparent cursor-pointer"
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-ui-brand">{row.key}</span>
          {running && <Spinner size="sm" />}
          <span className="ml-auto font-semibold text-ui-primary">{row.points} pts</span>
          <span className="text-ui-secondary">/ {row.jiraPoints ?? "—"}</span>
        </div>
        <div className="text-label text-ui-body truncate mt-0.5">{row.title}</div>
      </button>
      <span className="pr-1 shrink-0">
        <ConfirmDelete iconOnly label={t("estimate.delete")} disabled={running} onConfirm={onDelete} />
      </span>
    </li>
  );
}

export default function EstimatePage() {
  const { t } = useT();
  const router = useRouter();
  const settings = useSettings();
  const canCode = !!settings.data?.repos.some((r) => r.enabled && r.path);
  const [code, setCode] = useState(true);
  const history = useQuery({ queryKey: ["estimates"], queryFn: () => http.get<HistoryRow[]>("/api/estimate"), staleTime: 0 });
  const runningKeys = useJobTracker(
    useShallow((s) => [...new Set(s.jobs.filter((j) => j.kind === "estimate" && !j.finished).flatMap((j) => j.keys))]),
  );
  const newRunning = runningKeys.filter((k) => !history.data?.some((r) => r.key === k));
  const aiPoints = new Map((history.data ?? []).map((r) => [r.key, r.points]));
  const qc = useQueryClient();
  const refresh = (key?: string) => {
    void qc.invalidateQueries({ queryKey: ["estimates"] });
    void qc.invalidateQueries({ queryKey: key ? ["estimate", key] : ["estimate"] });
  };
  const removeOne = (key: string) =>
    http
      .del(`/api/estimate/${key}`)
      .then(() => refresh(key))
      .catch((err: Error) => toast.fromError(t("common.failed"), err));
  const removeAll = () =>
    http
      .del("/api/estimate")
      .then(() => refresh())
      .catch((err: Error) => toast.fromError(t("common.failed"), err));

  const project = (settings.data?.jira.projectKey ?? "").toUpperCase();
  const loaded = parseKeys(String(router.query.keys ?? ""), project);
  const selected = typeof router.query.key === "string" ? router.query.key : loaded[0];
  const go = (q: Record<string, string>) => void router.replace({ pathname: "/estimate", query: q }, undefined, { shallow: true });

  const load = (text: string) => {
    const keys = parseKeys(text, project);
    if (!keys.length) {
      toast.error(t("estimate.invalid"));
      return;
    }
    go({ keys: keys.join(","), key: keys[0] });
  };
  const pick = (key: string) => go({ ...(loaded.length ? { keys: loaded.join(",") } : {}), key });
  const queue = loaded.length ? loaded : selected ? [selected] : [];

  return (
    <>
      <PageHeader
        title={t("nav.estimate")}
        subtitle={t("estimate.subtitle")}
        actions={<ReloadButton keys={["sprints", "sprint", "estimates", "estimate", "settings"]} />}
      />
      <Card className="mb-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            load(new FormData(ev.currentTarget).get("keys") as string);
          }}
        >
          <label className="flex-1 min-w-[260px] max-w-[560px]">
            <span className="block text-label font-medium text-ui-body mb-1">{t("estimate.input")}</span>
            <Input
              key={loaded.join(",")}
              name="keys"
              size="sm"
              fullWidth
              leftContent={<SearchIcon />}
              placeholder={`8377 · ${project || "INTERNAL"}-8377`}
              defaultValue={loaded.join(", ")}
            />
            <span className="block text-xs text-ui-secondary mt-1">{t("estimate.inputHint")}</span>
          </label>
          <div className="pb-5">
            <Button size="sm" variant="outline" type="submit">
              {t("estimate.load")}
            </Button>
          </div>
          <label
            className={`flex items-center gap-3 mb-5 px-3 py-2 rounded-md border cursor-pointer ${
              code && canCode ? "border-ui-brand bg-ui-brand-surface" : "border-ui-border bg-ui-raised"
            }`}
            title={canCode ? undefined : t("review.noRepos")}
          >
            <Toggle size="md" checked={code && canCode} disabled={!canCode} onChange={(ev) => setCode(ev.target.checked)} />
            <span>
              <span className="block text-sm font-semibold text-ui-primary">{t("estimate.code")}</span>
              <span className="block text-xs text-ui-secondary">{t("estimate.codeHint")}</span>
            </span>
          </label>
          {queue.length > 1 && (
            <div className="pb-5 ml-auto">
              <Button size="sm" onClick={() => void startTracked("estimate", queue, false, { code: code && canCode })}>
                {t("estimate.runAll", { n: queue.length })}
              </Button>
            </div>
          )}
        </form>
        {queue.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-t border-ui-border pt-3">
            {queue.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                aria-pressed={k === selected}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                  k === selected ? "bg-ui-brand text-ui-on-solid border-ui-brand" : "bg-ui-raised text-ui-body border-ui-border hover:border-ui-brand"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </Card>

      <SprintEstimate aiPoints={aiPoints} selectedKey={selected} code={code && canCode} onPick={pick} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        <div className="min-w-0">
          {selected ? (
            <Detail key={selected} ticketKey={selected} code={code} canCode={canCode} />
          ) : (
            <Card>
              <Empty>{t("estimate.pick")}</Empty>
            </Card>
          )}
        </div>
        <Card
          title={t("estimate.history")}
          className="lg:sticky lg:top-20 [&>div]:p-0"
          actions={history.data?.length ? <ConfirmDelete label={t("estimate.deleteAll")} onConfirm={removeAll} /> : undefined}
        >
          {history.isLoading && (
            <div className="p-4">
              <Spinner size="sm" />
            </div>
          )}
          {history.data?.length === 0 && !newRunning.length && <Empty>{t("estimate.historyEmpty")}</Empty>}
          <ul className="list-none m-0 p-0 py-1 max-h-[70vh] overflow-y-auto">
            {newRunning.map((k) => (
              <RunningItem key={k} ticketKey={k} active={k === selected} onPick={() => pick(k)} />
            ))}
            {history.data?.map((row) => (
              <HistoryItem key={row.key} row={row} active={row.key === selected} onPick={() => pick(row.key)} onDelete={() => removeOne(row.key)} />
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
