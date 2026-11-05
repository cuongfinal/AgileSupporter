import {
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  Spinner,
  TabHeader,
  TabList,
  TabListItem,
  Tabs,
  Tag,
} from "@/components/kit";
import { DownloadIcon, ExternalIcon, RefreshIcon } from "@/components/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { diffWords } from "diff";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CopyButton, Empty, JobProgress, Md, SeverityTag, StaleBanner, StatusTag } from "@/components/ui";
import { download, http, vscodeLink } from "@/lib/client";
import { toast } from "@/lib/toast";
import { type TicketJobKind, startTracked, useTrackedFor } from "@/lib/jobTracker";
import { type MessageKey, useT } from "@/lib/i18n";
import { useSettings } from "@/lib/queries";
import type {
  Bilingual,
  CodeRef,
  Snapshot,
  Staleness,
  StoredReview,
  StoredSpec,
  StoredTests,
  TestScenario,
  TestType,
  Ticket,
  TicketSummary,
} from "@/lib/types";

interface TicketPayload {
  ticket: Ticket;
  summary: TicketSummary | null;
  review: StoredReview | null;
  spec: StoredSpec | null;
  tests: StoredTests | null;
  stale: { review: Staleness | null; spec: Staleness | null; tests: Staleness | null };
  specTarget: { path: string; exists: boolean } | null;
  snapshot: { current: Snapshot; previous: Snapshot | null };
}

export function summaryMarkdown(s: TicketSummary["en"], t: (k: MessageKey) => string): string {
  const list = (title: string, items: string[]) => (items.length ? `\n**${title}**\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  return [
    s.summary,
    list(t("summary.ac"), s.ac),
    list(t("summary.areas"), s.areas),
    list(t("summary.rules"), s.rules),
    list(t("summary.edgeCases"), s.edgeCases),
  ].join("\n");
}

function useTicketJob(key: string, kind: TicketJobKind) {
  const { job, running } = useTrackedFor(kind, key);
  return { start: (force: boolean) => void startTracked(kind, [key], force), job, running };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ui-heading mb-2">{title}</h3>
      {children}
    </section>
  );
}

function DetailsTab({ ticket }: { ticket: Ticket }) {
  const { t } = useT();
  return (
    <>
      <Section title={t("ticket.description")}>
        {ticket.descriptionMd ? <Md>{ticket.descriptionMd}</Md> : <p className="text-sm text-ui-secondary">—</p>}
      </Section>
      <Section title={t("ticket.ac")}>
        {ticket.acMd ? <Md>{ticket.acMd}</Md> : <p className="text-sm text-ui-secondary">{t("ticket.noAcField")}</p>}
      </Section>
      {ticket.links.length > 0 && (
        <Section title={t("ticket.links")}>
          <ul className="text-sm space-y-1 pl-4">
            {ticket.links.map((l, i) => (
              <li key={i}>
                <span className="text-ui-secondary">{l.type}</span> <b>{l.key}</b> {l.summary}{" "}
                <span className="text-xs text-ui-secondary">({l.status})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {ticket.attachments.length > 0 && (
        <Section title={t("ticket.attachments")}>
          <ul className="text-sm space-y-1 pl-4">
            {ticket.attachments.map((a) => (
              <li key={a.url}>
                {a.filename} <span className="text-xs text-ui-secondary">({Math.round(a.size / 1024)} KB)</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ui-secondary mt-1">{t("ticket.attachmentsHint")}</p>
        </Section>
      )}
      {ticket.labels.length > 0 && (
        <Section title={t("ticket.labels")}>
          <div className="flex flex-wrap gap-1">
            {ticket.labels.map((l) => (
              <Tag key={l} size="sm" color="neutral" variant="light">{l}</Tag>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function SummaryTab({ data }: { data: TicketPayload }) {
  const { t, pick } = useT();
  const { start, job, running } = useTicketJob(data.ticket.key, "summary");
  const s = data.summary ? pick(data.summary) : null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        {s && <CopyButton text={summaryMarkdown(s, t)} label={t("common.copyMarkdown")} />}
        <Button size="sm" leftIcon={s ? <RefreshIcon /> : undefined} loading={running} onClick={() => start(!!s)}>
          {s ? t("summary.regenerate") : t("summary.generate")}
        </Button>
      </div>
      {running && <JobProgress job={job} />}
      {!s && !running && <Empty>{t("summary.none")}</Empty>}
      {s && (
        <>
          <p className="text-sm leading-relaxed text-ui-body">{s.summary}</p>
          {(
            [
              ["summary.ac", s.ac, true],
              ["summary.areas", s.areas, false],
              ["summary.rules", s.rules, false],
              ["summary.edgeCases", s.edgeCases, false],
            ] as const
          ).map(([k, items, checklist]) =>
            items.length ? (
              <Section key={k} title={t(k)}>
                <ul className={`text-sm space-y-1.5 ${checklist ? "list-none pl-0" : "pl-5"}`}>
                  {items.map((it, i) => (
                    <li key={i} className={checklist ? "flex gap-2" : ""}>
                      {checklist && <span className="text-ui-brand" aria-hidden>☐</span>}
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null,
          )}
        </>
      )}
    </>
  );
}

function Refs({ refs, review }: { refs: CodeRef[]; review: StoredReview }) {
  if (!refs.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {refs.map((r, i) => {
        const base = review.repos[r.repo]?.path;
        const label = `${r.repo}:${r.path}${r.line ? `:${r.line}` : ""}`;
        return base ? (
          <a
            key={i}
            href={vscodeLink(`${base}/${r.path}`, r.line)}
            className="text-[11px] font-mono no-underline bg-ui-secondary-surface text-ui-heading-strong px-1.5 py-0.5 rounded hover:underline"
            title="Open in VS Code"
          >
            {label}
          </a>
        ) : (
          <span key={i} className="text-[11px] font-mono bg-ui-surface px-1.5 py-0.5 rounded">{label}</span>
        );
      })}
    </div>
  );
}

function ReviewTab({ data }: { data: TicketPayload }) {
  const { t, pick, lang } = useT();
  const settings = useSettings();
  const { start, job, running } = useTicketJob(data.ticket.key, "review");
  const r = data.review;
  const hasRepos = !!settings.data?.repos.some((x) => x.enabled && x.path);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {r &&
            Object.entries(r.repos).map(([k, v]) => (
              <Tag key={k} size="sm" color="primary" variant="light">
                {k}@{v.branch} {v.head}
                {v.dirty ? " *" : ""}
              </Tag>
            ))}
        </div>
        <div className="flex gap-2">
          {r && <CopyButton text={r.questions.map((q) => `- ${q.en}`).join("\n")} label={t("review.copyQuestionsEn")} />}
          <Button size="sm" disabled={!hasRepos} loading={running} leftIcon={r ? <RefreshIcon /> : undefined} onClick={() => start(!!r)}>
            {r ? t("review.rerun") : t("review.run")}
          </Button>
        </div>
      </div>
      {!hasRepos && <p className="text-sm text-ui-warning-dark mb-3">{t("review.noRepos")}</p>}
      {running && (
        <div className="mb-3">
          <JobProgress job={job} />
          <p className="text-xs text-ui-secondary mt-1">{t("review.slowHint")}</p>
        </div>
      )}
      {!r && !running && <Empty>{t("review.none")}</Empty>}
      {r && !running && <StaleBanner stale={data.stale.review} onRerun={() => start(true)} />}
      {r && (
        <>
          <p className="text-xs text-ui-secondary">{t("review.reviewedAt", { at: new Date(r.reviewedAt).toLocaleString() })}</p>
          <Section title={t("review.findings", { n: r.findings.length })}>
            {r.findings.length === 0 && <p className="text-sm text-ui-success">{t("review.noFindings")}</p>}
            <ul className="list-none p-0 space-y-3">
              {r.findings.map((f, i) => (
                <li key={i} className="border border-ui-border rounded-md p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <SeverityTag severity={f.severity} />
                    <Tag size="sm" color="neutral" variant="light">{t(`kind.${f.kind}` as MessageKey)}</Tag>
                  </div>
                  {f.quote && <blockquote className="text-xs italic text-ui-subtle border-l-2 border-ui-brand-soft pl-2 my-1.5">“{f.quote}”</blockquote>}
                  <p className="text-sm">{pick(f)}</p>
                  <p className="text-sm text-ui-heading mt-1">→ {pick(f.suggestion)}</p>
                  <Refs refs={f.refs} review={r} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t("review.questions")}>
            <ol className="text-sm space-y-2 pl-5">
              {r.questions.map((q, i) => (
                <li key={i}>
                  {pick(q)}
                  {lang === "vi" && <div className="text-xs text-ui-secondary mt-0.5">EN: {q.en}</div>}
                </li>
              ))}
            </ol>
          </Section>
          <Section title={t("review.currentBehavior")}>
            <ul className="list-none p-0 space-y-2">
              {r.currentBehavior.map((c, i) => (
                <li key={i} className="text-sm">
                  {pick(c)}
                  <Refs refs={c.refs} review={r} />
                </li>
              ))}
            </ul>
          </Section>
          {r.impact.length > 0 && (
            <Section title={t("review.impact")}>
              <div className="flex flex-wrap gap-1">
                {r.impact.map((x, i) => (
                  <Tag key={i} size="sm" color="secondary" variant="light">
                    {x.repo}: {x.area}
                  </Tag>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function SpecTab({ data }: { data: TicketPayload }) {
  const { t } = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const { start, job, running } = useTicketJob(data.ticket.key, "spec");
  const [raw, setRaw] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const s = data.spec;
  const hasRepos = !!settings.data?.repos.some((x) => x.enabled && x.path);
  const save = (overwrite: boolean) =>
    http
      .post<{ path: string }>("/api/spec/save", { key: data.ticket.key, overwrite })
      .then((r) => {
        setConfirmOverwrite(false);
        toast.success(t("spec.saved"), r.path);
        void qc.invalidateQueries({ queryKey: ["ticket", data.ticket.key] });
      })
      .catch((e: Error) => {
        if (e.message.startsWith("exists:")) setConfirmOverwrite(true);
        else toast.fromError(t("common.failed"), e);
      });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {s?.inScope.map((k) => (
            <Tag key={k} size="sm" color="secondary" variant="light">{k}</Tag>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {s && (
            <>
              <CopyButton text={s.markdown} label={t("common.copyMarkdown")} />
              <Button size="sm" variant="outline" leftIcon={<DownloadIcon />} onClick={() => download(`${data.ticket.key}.md`, s.markdown)}>
                {t("common.download")}
              </Button>
            </>
          )}
          <Button size="sm" disabled={!hasRepos} loading={running} leftIcon={s ? <RefreshIcon /> : undefined} onClick={() => start(!!s)}>
            {s ? t("spec.regenerate") : t("spec.generate")}
          </Button>
        </div>
      </div>
      {!hasRepos && <p className="text-sm text-ui-warning-dark mb-3">{t("review.noRepos")}</p>}
      {!data.review && !s && <p className="text-xs text-ui-secondary mb-3">{t("spec.reviewFirst")}</p>}
      {running && (
        <div className="mb-3">
          <JobProgress job={job} />
          <p className="text-xs text-ui-secondary mt-1">{t("review.slowHint")}</p>
        </div>
      )}
      {!s && !running && <Empty>{t("spec.none")}</Empty>}
      {s && !running && <StaleBanner stale={data.stale.spec} onRerun={() => start(true)} />}
      {s && (
        <>
          {data.specTarget && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-ui-surface px-3 py-2 mb-3">
              <span className="text-xs text-ui-subtle min-w-0 break-all">
                {t("spec.target")} <code>{data.specTarget.path.replace(/^.*\/(\.claude\/)/, "$1")}</code>
                {data.specTarget.exists && <span className="text-ui-warning-dark"> · {t("spec.exists")}</span>}
              </span>
              {confirmOverwrite ? (
                <span className="flex gap-1">
                  <Button size="sm" color="danger" onClick={() => save(true)}>
                    {t("spec.overwrite")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOverwrite(false)}>
                    {t("common.cancel")}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => save(false)}>
                  {t("spec.saveToWorkspace")}
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-ui-secondary">
              {t("spec.generatedAt", { at: new Date(s.generatedAt).toLocaleString() })} ·{" "}
              {Object.entries(s.repos)
                .map(([k, v]) => `${k}@${v.branch}${v.dirty ? "*" : ""}`)
                .join(", ")}
            </p>
            <button type="button" className="text-xs bg-transparent border-0 text-ui-heading underline cursor-pointer" onClick={() => setRaw(!raw)}>
              {raw ? t("spec.rendered") : t("spec.raw")}
            </button>
          </div>
          {raw ? (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-ui-surface rounded-md p-3 max-h-[60vh] overflow-auto">{s.markdown}</pre>
          ) : (
            <div className="border border-ui-border rounded-md p-4 bg-white">
              <Md>{s.markdown}</Md>
            </div>
          )}
        </>
      )}
    </>
  );
}

const TYPE_COLOR: Record<TestType, "green" | "blue" | "red" | "secondary" | "neutral"> = {
  happy: "green",
  edge: "blue",
  negative: "red",
  permission: "secondary",
  regression: "neutral",
};
const TEST_TYPES: TestType[] = ["happy", "edge", "negative", "permission", "regression"];

type TFn = (k: MessageKey, v?: Record<string, string | number>) => string;

const coveredBy = (x: StoredTests, acIndex: number) => x.scenarios.filter((s) => s.ac.includes(acIndex + 1)).map((s) => s.id);

function testsMarkdown(key: string, x: StoredTests, pick: (b: Bilingual) => string, t: TFn): string {
  const lines = [`# ${key} — ${t("ticket.tabTests")}`, "", `## ${t("tests.coverage")}`, ""];
  x.acList.forEach((ac, i) => {
    const ids = coveredBy(x, i);
    lines.push(`- **AC${i + 1}** ${pick(ac)} → ${ids.length ? ids.join(", ") : `_${t("tests.uncovered")}_`}`);
  });
  lines.push("");
  for (const s of x.scenarios) {
    const meta = [t(`tests.type.${s.type}` as MessageKey), t(`severity.${s.priority}` as MessageKey)];
    if (s.ac.length) meta.push(`${t("tests.covers")} ${s.ac.map((n) => `AC${n}`).join(", ")}`);
    lines.push(`## ${s.id} · ${pick(s.title)}`, "", `_${meta.join(" · ")}_`, "");
    const step = (kw: string, items: Bilingual[]) => items.forEach((it, i) => lines.push(`- **${i === 0 ? kw : "And"}** ${pick(it)}`));
    step("Given", s.given);
    step("When", s.when);
    step("Then", s.then);
    if (s.data) lines.push("", `${t("tests.data")}: ${s.data}`);
    lines.push("");
  }
  if (x.gaps.length) lines.push(`## ${t("tests.gaps")}`, "", ...x.gaps.map((g) => `- ${pick(g)}`), "");
  return lines.join("\n");
}

function testsCsv(x: StoredTests, pick: (b: Bilingual) => string): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const steps = (items: Bilingual[]) => items.map(pick).join("\n");
  const rows = [["ID", "Title", "Type", "Priority", "AC", "Given", "When", "Then", "Test data"]];
  for (const s of x.scenarios)
    rows.push([s.id, pick(s.title), s.type, s.priority, s.ac.map((n) => `AC${n}`).join(" "), steps(s.given), steps(s.when), steps(s.then), s.data]);
  // BOM so Excel opens Vietnamese text correctly.
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function ScenarioCard({ s }: { s: TestScenario }) {
  const { t, pick } = useT();
  const steps = (kw: string, items: Bilingual[]) =>
    items.map((it, i) => (
      <li key={kw + i} className="flex gap-2">
        <span className="w-12 shrink-0 text-xs font-semibold text-ui-heading pt-px">{i === 0 ? kw : "And"}</span>
        <span>{pick(it)}</span>
      </li>
    ));
  return (
    <li className="border border-ui-border rounded-md p-3">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-xs font-mono font-semibold text-ui-brand">{s.id}</span>
        <span className="text-sm font-medium text-ui-primary flex-1 min-w-0">{pick(s.title)}</span>
        <Tag size="sm" color={TYPE_COLOR[s.type]} variant="light">{t(`tests.type.${s.type}` as MessageKey)}</Tag>
        <SeverityTag severity={s.priority} />
      </div>
      <ul className="list-none p-0 m-0 text-sm space-y-1">
        {steps("Given", s.given)}
        {steps("When", s.when)}
        {steps("Then", s.then)}
      </ul>
      {(s.data || s.ac.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ui-secondary">
          {s.ac.length > 0 && (
            <span>
              {t("tests.covers")}: {s.ac.map((n) => `AC${n}`).join(", ")}
            </span>
          )}
          {s.data && (
            <span>
              {t("tests.data")}: <span className="font-mono text-ui-body">{s.data}</span>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function TestsTab({ data }: { data: TicketPayload }) {
  const { t, pick, lang } = useT();
  const { start, job, running } = useTicketJob(data.ticket.key, "tests");
  const [filter, setFilter] = useState<TestType | "all">("all");
  const x = data.tests;
  const types = x ? TEST_TYPES.filter((k) => x.scenarios.some((s) => s.type === k)) : [];
  const shown = x ? x.scenarios.filter((s) => filter === "all" || s.type === filter) : [];
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
        {x && (
          <>
            <CopyButton text={testsMarkdown(data.ticket.key, x, pick, t)} label={t("common.copyMarkdown")} />
            <Button
              size="sm"
              variant="outline"
              leftIcon={<DownloadIcon />}
              onClick={() => download(`${data.ticket.key}-tests-${lang}.csv`, testsCsv(x, pick), "text/csv;charset=utf-8")}
            >
              {t("tests.csv")}
            </Button>
          </>
        )}
        <Button size="sm" loading={running} leftIcon={x ? <RefreshIcon /> : undefined} onClick={() => start(!!x)}>
          {x ? t("tests.regenerate") : t("tests.generate")}
        </Button>
      </div>
      {!data.review && <p className="text-xs text-ui-secondary mb-3">{t("tests.reviewHint")}</p>}
      {running && (
        <div className="mb-3">
          <JobProgress job={job} />
        </div>
      )}
      {!x && !running && <Empty>{t("tests.none")}</Empty>}
      {x && !running && <StaleBanner stale={data.stale.tests} onRerun={() => start(true)} />}
      {x && (
        <>
          <p className="text-xs text-ui-secondary">
            {t("tests.generatedAt", { at: new Date(x.generatedAt).toLocaleString() })}
            {x.usedReview && ` · ${t("tests.usedReview")}`}
          </p>
          <Section title={t("tests.coverage")}>
            <ul className="list-none p-0 m-0 text-sm space-y-1.5">
              {x.acList.map((ac, i) => {
                const ids = coveredBy(x, i);
                return (
                  <li key={i} className="flex gap-2">
                    <span className="w-10 shrink-0 text-xs font-semibold text-ui-heading pt-px">AC{i + 1}</span>
                    <span className="flex-1">{pick(ac)}</span>
                    <span className={`text-xs shrink-0 ${ids.length ? "text-ui-secondary font-mono" : "text-ui-error font-semibold"}`}>
                      {ids.length ? ids.join(", ") : t("tests.uncovered")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
          <Section title={t("tests.scenarios", { n: x.scenarios.length })}>
            {types.length > 1 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {(["all", ...types] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                    className={`text-xs px-2 py-0.5 rounded-full border cursor-pointer ${
                      filter === k ? "bg-ui-brand text-white border-ui-brand" : "bg-white text-ui-body border-ui-border hover:border-ui-brand"
                    }`}
                  >
                    {k === "all" ? t("tests.all") : t(`tests.type.${k}` as MessageKey)} (
                    {k === "all" ? x.scenarios.length : x.scenarios.filter((s) => s.type === k).length})
                  </button>
                ))}
              </div>
            )}
            <ul className="list-none p-0 m-0 space-y-2">
              {shown.map((s) => (
                <ScenarioCard key={s.id} s={s} />
              ))}
            </ul>
          </Section>
          {x.gaps.length > 0 && (
            <Section title={t("tests.gaps")}>
              <ul className="text-sm space-y-1 pl-5">
                {x.gaps.map((g, i) => (
                  <li key={i}>{pick(g)}</li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const { t } = useT();
  if (before === after) return <p className="text-sm text-ui-secondary">{t("changes.same")}</p>;
  return (
    <div className="text-sm whitespace-pre-wrap leading-relaxed border border-ui-border rounded-md p-3 bg-white">
      {diffWords(before, after).map((p, i) =>
        p.added ? (
          <ins key={i} className="bg-ui-success-surface text-ui-primary no-underline">{p.value}</ins>
        ) : p.removed ? (
          <del key={i} className="bg-ui-error-surface text-ui-error">{p.value}</del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </div>
  );
}

function ChangesTab({ data }: { data: TicketPayload }) {
  const { t } = useT();
  const { previous, current } = data.snapshot;
  if (!previous) return <Empty>{t("changes.none", { at: new Date(current.viewedAt).toLocaleString() })}</Empty>;
  return (
    <>
      <p className="text-xs text-ui-secondary mb-3">
        {t("changes.between", { from: new Date(previous.updated).toLocaleString(), to: new Date(current.updated).toLocaleString() })}
      </p>
      <Section title={t("changes.summary")}>
        <Diff before={previous.summary} after={current.summary} />
      </Section>
      <Section title={t("ticket.description")}>
        <Diff before={previous.descriptionMd} after={current.descriptionMd} />
      </Section>
      <Section title={t("ticket.ac")}>
        <Diff before={previous.acMd} after={current.acMd} />
      </Section>
    </>
  );
}

function FigmaTab({ ticketKey }: { ticketKey: string }) {
  const { t } = useT();
  const q = useQuery({
    queryKey: ["figma", ticketKey],
    queryFn: () => http.get<{ url: string; image: string | null; error?: string }[]>(`/api/figma/${ticketKey}`),
  });
  if (q.isLoading) return <Spinner size="sm" />;
  if (q.error) return <p className="text-sm text-ui-error">{String((q.error as Error).message)}</p>;
  return (
    <div className="grid gap-3">
      {q.data?.map((f) => (
        <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="block border border-ui-border rounded-md overflow-hidden no-underline">
          {f.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.image} alt={t("figma.preview")} className="w-full max-h-96 object-contain bg-ui-surface" />
          ) : (
            <div className="p-4 text-sm text-ui-error">{f.error ?? t("figma.noImage")}</div>
          )}
          <div className="px-3 py-2 text-xs text-ui-heading truncate">{f.url}</div>
        </a>
      ))}
    </div>
  );
}

export default function TicketDrawer({ ticketKey, onClose }: { ticketKey: string | null; onClose: () => void }) {
  const { t } = useT();
  const settings = useSettings();
  const [tab, setTab] = useState(0);
  const q = useQuery({
    queryKey: ["ticket", ticketKey],
    queryFn: () => http.get<TicketPayload>(`/api/jira/ticket/${ticketKey}`),
    enabled: !!ticketKey,
    staleTime: 0,
  });
  const qc = useQueryClient();
  useEffect(() => {
    if (q.data) void qc.invalidateQueries({ queryKey: ["sprint"], refetchType: "none" });
  }, [q.data, qc]);

  const figma = settings.data?.features.figma !== false && (q.data?.ticket.figmaLinks.length ?? 0) > 0;
  const tabs: { id: string; label: string }[] = [
    { id: "details", label: t("ticket.tabDetails") },
    { id: "summary", label: t("ticket.tabSummary") },
    { id: "review", label: q.data?.stale.review ? `${t("ticket.tabReview")} ⚠` : t("ticket.tabReview") },
    { id: "spec", label: q.data?.stale.spec ? `${t("ticket.tabSpec")} ⚠` : t("ticket.tabSpec") },
    { id: "tests", label: q.data?.stale.tests ? `${t("ticket.tabTests")} ⚠` : t("ticket.tabTests") },
    { id: "changes", label: q.data?.snapshot.previous ? `${t("ticket.tabChanges")} •` : t("ticket.tabChanges") },
    ...(figma ? [{ id: "figma", label: "Figma" }] : []),
  ];
  const current = tabs[Math.min(tab, tabs.length - 1)]?.id;

  return (
    <Drawer open={!!ticketKey} onOpenChange={(o) => !o && onClose()} placement="right" className="!w-[760px] !max-w-full">
      <DrawerHeader>
        {q.data ? (
          <div className="min-w-0 pr-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-ui-brand">{q.data.ticket.key}</span>
              <Tag size="sm" color="neutral" variant="light">{q.data.ticket.type}</Tag>
              <StatusTag status={q.data.ticket.status} category={q.data.ticket.statusCategory} />
              {q.data.ticket.points !== null && <span className="text-ui-secondary">{q.data.ticket.points} pts</span>}
              <a href={q.data.ticket.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 no-underline [&_svg]:w-3.5 [&_svg]:h-3.5">
                Jira <ExternalIcon />
              </a>
              <Link href={`/estimate?key=${q.data.ticket.key}`} className="no-underline" onClick={onClose}>
                {t("ticket.estimate")} →
              </Link>
            </div>
            <h2 className="text-base font-semibold text-ui-primary mt-1">{q.data.ticket.summary}</h2>
            <div className="text-xs text-ui-secondary mt-0.5">
              {q.data.ticket.assignee?.name ?? t("ticket.unassigned")}
              {q.data.ticket.parentKey && ` · ${q.data.ticket.parentKey} ${q.data.ticket.parentSummary ?? ""}`}
            </div>
          </div>
        ) : (
          <span className="text-sm">{ticketKey}</span>
        )}
      </DrawerHeader>
      <DrawerBody className="flex flex-col min-h-0">
        {q.isLoading && <Spinner />}
        {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
        {q.data && (
          <>
            <Tabs selectedIndex={Math.min(tab, tabs.length - 1)} onChange={setTab} className="!shadow-none !bg-transparent">
              <TabHeader>
                <TabList>
                  {tabs.map((x) => (
                    <TabListItem key={x.id}>{x.label}</TabListItem>
                  ))}
                </TabList>
              </TabHeader>
            </Tabs>
            <div className="flex-1 overflow-y-auto pt-4 px-1 pb-8">
              {current === "details" && <DetailsTab ticket={q.data.ticket} />}
              {current === "summary" && <SummaryTab data={q.data} />}
              {current === "review" && <ReviewTab data={q.data} />}
              {current === "spec" && <SpecTab data={q.data} />}
              {current === "tests" && <TestsTab data={q.data} />}
              {current === "changes" && <ChangesTab data={q.data} />}
              {current === "figma" && <FigmaTab ticketKey={q.data.ticket.key} />}
            </div>
          </>
        )}
      </DrawerBody>
    </Drawer>
  );
}
