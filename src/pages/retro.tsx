import { Button, Input, Spinner, Tag, Textarea, Toggle } from "@/components/kit";
import { AddIcon, CheckIcon, CopyIcon, EditIcon } from "@/components/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { Card, ConfirmDelete, Empty, JobProgress, Kpi, PageHeader, ReloadButton } from "@/components/ui";
import SprintPicker from "@/features/SprintPicker";
import { download, http } from "@/lib/client";
import { type MessageKey, useT } from "@/lib/i18n";
import { trackJob, useLatestOfKind } from "@/lib/jobTracker";
import { useSettings, useSprintPick } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { JobState, Lang, RetroBoard, RetroCard, RetroColumn, RetroFacts, RetroItem } from "@/lib/types";

interface RetroView {
  facts: RetroFacts;
  board: RetroBoard | null;
  stale: boolean;
}

const COLUMNS: RetroColumn[] = ["well", "improve", "action"];
const COLUMN_STYLE: Record<RetroColumn, { head: string; edge: string; dot: string }> = {
  well: { head: "bg-ui-success-surface text-ui-success", edge: "border-l-ui-success", dot: "bg-ui-success" },
  improve: { head: "bg-ui-warning-surface text-ui-warning-dark", edge: "border-l-ui-warning", dot: "bg-ui-warning" },
  action: { head: "bg-ui-info-surface text-ui-info", edge: "border-l-ui-info", dot: "bg-ui-info" },
};

const text = (b: { en: string; vi: string }, lang: Lang) => (lang === "vi" ? b.vi || b.en : b.en || b.vi);

function cardLine(c: RetroCard, lang: Lang): string {
  const detail = text(c.detail, lang);
  return `${text(c.title, lang)}${detail ? ` — ${detail}` : ""}${c.evidence.length ? ` (${c.evidence.join(", ")})` : ""}`;
}

function copy(value: string, done: string) {
  void navigator.clipboard.writeText(value).then(() => toast.success(done));
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

function parseKeys(raw: string, project: string): string[] {
  return [
    ...new Set(
      raw
        .toUpperCase()
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((k) => (/^\d+$/.test(k) ? `${project}-${Number(k)}` : k))
        .filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k)),
    ),
  ];
}

// ---------------------------------------------------------------- facts

function TicketChip({ k, note }: { k: string; note?: string }) {
  const s = useSettings();
  const base = s.data?.jira.baseUrl;
  const label = (
    <>
      {k}
      {note ? <span className="text-ui-secondary font-normal"> · {note}</span> : null}
    </>
  );
  return base ? (
    <a
      href={`${base}/browse/${k}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded border border-ui-border bg-white px-1.5 py-0.5 text-xs font-semibold text-ui-brand no-underline hover:border-ui-brand"
    >
      {label}
    </a>
  ) : (
    <span className="inline-flex rounded border border-ui-border px-1.5 py-0.5 text-xs font-semibold">{label}</span>
  );
}

function FactGroup({ label, items }: { label: string; items: RetroItem[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-ui-subtle mb-1.5">
        {label} <span className="text-ui-secondary font-normal">({items.length})</span>
      </div>
      <ul className="list-none p-0 m-0 space-y-1">
        {items.slice(0, 8).map((i) => (
          <li key={i.key} className="flex items-start gap-2 text-sm">
            <TicketChip k={i.key} note={i.note} />
            <span className="min-w-0 truncate text-ui-body" title={i.summary}>
              {i.summary}
            </span>
          </li>
        ))}
        {items.length > 8 && <li className="text-xs text-ui-secondary">+{items.length - 8}</li>}
      </ul>
    </div>
  );
}

function FactsView({ f }: { f: RetroFacts }) {
  const { t } = useT();
  const amount = (x: { items: number; points: number }) => (f.unit === "points" ? x.points : x.items);
  const groups: [MessageKey, RetroItem[]][] = [
    ["retro.f.added", f.added],
    [f.ended ? "retro.f.carriedOut" : "retro.f.notDone", f.notDone],
    ["retro.f.carriedIn", f.carriedIn],
    ["retro.f.reopened", f.reopened],
    ["retro.f.reestimated", f.reestimated],
    ["retro.f.reqChanged", f.reqChanged],
    ["retro.f.flagged", f.flagged],
    ["retro.f.bugs", f.bugs.createdInSprint],
    ["retro.f.slowest", f.cycle.slowest],
    ["retro.f.specRisks", f.specRisks],
    ["retro.f.unpointed", f.unpointed],
  ];
  return (
    <div className="space-y-4">
      {!f.ended && <div className="rounded-md bg-ui-info-surface px-4 py-2 text-sm text-ui-body">{t("retro.running")}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi
          label={t("retro.kpiDone")}
          value={`${amount(f.completed)}/${amount(f.total)}`}
          hint={`${f.unit === "points" ? "pts · " : ""}${t("retro.kpiDoneHint", { c: amount(f.committed) })}`}
        />
        <Kpi label={t("retro.kpiAdded")} value={f.added.length} hint={f.unit === "points" ? `${f.added.reduce((a, i) => a + (i.points ?? 0), 0)} pts` : undefined} />
        <Kpi label={t(f.ended ? "retro.kpiCarriedOut" : "retro.kpiNotDone")} value={f.notDone.length} />
        <Kpi
          label={t("retro.kpiCycle")}
          value={f.cycle.medianDays === null ? "—" : t("retro.days", { n: f.cycle.medianDays })}
          hint={t("retro.kpiCycleHint")}
        />
        <Kpi label={t("retro.kpiReq")} value={f.reqChanged.length} hint={`${t("retro.kpiReqHint")} · ${t("retro.kpiReopened")}: ${f.reopened.length}`} />
      </div>
      {f.velocity.length > 0 && (
        <p className="text-xs text-ui-secondary">
          {t("retro.velocity", { list: f.velocity.map((v) => `${v.name} ${v.done}`).join(" · ") })} · {f.sprint.name} {amount(f.completed)}
        </p>
      )}
      <details className="bg-white border border-ui-border rounded-lg">
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-ui-heading">
          {t("retro.facts")} <span className="text-xs font-normal text-ui-secondary ml-2">{t("retro.factsHint")}</span>
        </summary>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 px-4 pb-4 pt-1">
          {groups.map(([label, items]) => (
            <FactGroup key={label} label={t(label)} items={items} />
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- cards

function CardEditor({ initial, onSave, onCancel }: { initial: RetroCard; onSave: (c: RetroCard) => void; onCancel: () => void }) {
  const { t, lang } = useT();
  const s = useSettings();
  const [column, setColumn] = useState<RetroColumn>(initial.column);
  const [title, setTitle] = useState(text(initial.title, lang));
  const [detail, setDetail] = useState(text(initial.detail, lang));
  const [metric, setMetric] = useState(text(initial.metric, lang));
  const [evidence, setEvidence] = useState(initial.evidence.join(", "));
  const save = () => {
    if (!title.trim()) return;
    // The person's wording replaces both languages: it is what goes on the board.
    onSave({
      ...initial,
      column,
      title: { en: title.trim(), vi: title.trim() },
      detail: { en: detail.trim(), vi: detail.trim() },
      metric: { en: metric.trim(), vi: metric.trim() },
      evidence: parseKeys(evidence, s.data?.jira.projectKey ?? ""),
      edited: initial.source === "ai" ? true : initial.edited,
    });
  };
  return (
    <div className="space-y-2">
      <Select
        size="sm"
        aria-label={t("retro.column")}
        items={COLUMNS.map((c) => ({ value: c, label: t(`retro.col.${c}` as MessageKey) }))}
        value={[column]}
        onValueChange={(v) => v[0] && setColumn(v[0] as RetroColumn)}
      />
      <Input size="sm" fullWidth autoFocus placeholder={t("retro.title")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea size="sm" fullWidth minRows={2} placeholder={t("retro.detail")} value={detail} onChange={(e) => setDetail(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input size="sm" fullWidth placeholder={t("retro.metric")} value={metric} onChange={(e) => setMetric(e.target.value)} />
        <Input size="sm" fullWidth placeholder={t("retro.evidence")} title={t("retro.evidenceHint")} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!title.trim()} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function RetroCardView({
  card,
  onChange,
  onDelete,
}: {
  card: RetroCard;
  onChange: (c: RetroCard) => void;
  onDelete: () => void;
}) {
  const { t, lang } = useT();
  const [editing, setEditing] = useState(!text(card.title, lang));
  const style = COLUMN_STYLE[card.column];
  if (editing)
    return (
      <div className={`bg-white border border-ui-border border-l-4 ${style.edge} rounded-md p-3 shadow-sm`}>
        <CardEditor
          initial={card}
          onSave={(c) => {
            setEditing(false);
            onChange(c);
          }}
          onCancel={() => (text(card.title, lang) ? setEditing(false) : onDelete())}
        />
      </div>
    );
  return (
    <article className={`group bg-white border border-ui-border border-l-4 ${style.edge} rounded-md p-3 shadow-sm ${card.pushed ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ui-primary leading-snug">{text(card.title, lang)}</h3>
        {card.pushed && (
          <Tag size="sm" color="green" variant="light">
            ✓ {t("retro.pushed")}
          </Tag>
        )}
      </div>
      {text(card.detail, lang) && <p className="text-sm text-ui-body mt-1 leading-relaxed">{text(card.detail, lang)}</p>}
      {(text(card.metric, lang) || card.evidence.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {text(card.metric, lang) && (
            <Tag size="sm" color="secondary" variant="light">
              {text(card.metric, lang)}
            </Tag>
          )}
          {card.evidence.map((k) => (
            <TicketChip key={k} k={k} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 mt-2 pt-2 border-t border-ui-border">
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<CopyIcon />}
          onClick={() => {
            copy(cardLine(card, lang), t("common.copied"));
            if (!card.pushed) onChange({ ...card, pushed: true });
          }}
        >
          {t("common.copy")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          color="neutral"
          aria-label={card.pushed ? t("retro.unmarkPushed") : t("retro.markPushed")}
          title={card.pushed ? t("retro.unmarkPushed") : t("retro.markPushed")}
          onClick={() => onChange({ ...card, pushed: !card.pushed })}
        >
          <CheckIcon />
        </Button>
        <Button size="sm" variant="ghost" color="neutral" aria-label={t("retro.edit")} title={t("retro.edit")} onClick={() => setEditing(true)}>
          <EditIcon />
        </Button>
        <span className="flex-1" />
        {card.source === "manual" ? (
          <span className="text-[11px] text-ui-secondary">{t("retro.manual")}</span>
        ) : card.edited ? (
          <span className="text-[11px] text-ui-secondary">{t("retro.edited")}</span>
        ) : null}
        <ConfirmDelete iconOnly onConfirm={onDelete} />
      </div>
    </article>
  );
}

function Board({ sprintId, view }: { sprintId: number; view: RetroView }) {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const [hidePushed, setHidePushed] = useState(false);
  const cards = view.board?.cards ?? [];

  const save = (next: RetroCard[]) => {
    const key = ["retro", sprintId];
    const prev = qc.getQueryData<RetroView>(key);
    qc.setQueryData<RetroView>(key, (v) =>
      v
        ? {
            ...v,
            board: {
              ...(v.board ?? { sprintId, sprintName: v.facts.sprint.name, generatedAt: null, factsHash: null, headline: null, notes: "" }),
              cards: next,
            },
          }
        : v,
    );
    http.put("/api/retro", { sprintId, sprintName: view.facts.sprint.name, cards: next }).catch((e: unknown) => {
      qc.setQueryData(key, prev);
      toast.fromError(t("common.failed"), e);
    });
  };
  const update = (c: RetroCard) => save(cards.map((x) => (x.id === c.id ? c : x)));
  const remove = (id: string) => save(cards.filter((x) => x.id !== id));
  const add = (column: RetroColumn) =>
    save([
      ...cards,
      {
        id: `m-${Date.now().toString(36)}`,
        column,
        title: { en: "", vi: "" },
        detail: { en: "", vi: "" },
        evidence: [],
        metric: { en: "", vi: "" },
        source: "manual",
      },
    ]);
  const written = (c: RetroCard) => !!text(c.title, lang);

  const markdown = () =>
    [
      `# ${view.facts.sprint.name} — Retro`,
      view.board?.headline ? `\n_${text(view.board.headline, lang)}_` : "",
      ...COLUMNS.map((col) => {
        const list = cards.filter((c) => c.column === col && written(c));
        return [
          `\n## ${t(`retro.col.${col}` as MessageKey)}`,
          ...list.map(
            (c) =>
              `- **${text(c.title, lang)}** — ${text(c.detail, lang)}${text(c.metric, lang) || c.evidence.length ? ` _(${[text(c.metric, lang), ...c.evidence].filter(Boolean).join(" · ")})_` : ""}`,
          ),
        ].join("\n");
      }),
    ].join("\n");
  const csv = () =>
    "﻿" +
    [
      ["Column", "Title", "Detail", "Metric", "Tickets", "Pushed"].join(","),
      ...cards
        .filter(written)
        .map((c) =>
          [t(`retro.col.${c.column}` as MessageKey), text(c.title, lang), text(c.detail, lang), text(c.metric, lang), c.evidence.join(" "), c.pushed ? "yes" : ""]
            .map(csvCell)
            .join(","),
        ),
    ].join("\n");

  const total = cards.filter(written).length;
  const pushed = cards.filter((c) => written(c) && c.pushed).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ui-secondary">
          {total > 0 && <span className="font-semibold text-ui-body">{t("retro.progress", { n: pushed, t: total })}</span>}
          <span>{t("retro.pushHint")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-ui-body">
            <Toggle size="sm" checked={hidePushed} onChange={(e) => setHidePushed(e.target.checked)} />
            {t("retro.hidePushed")}
          </label>
          <Button size="sm" variant="outline" color="neutral" leftIcon={<CopyIcon />} disabled={!total} onClick={() => copy(markdown(), t("common.copied"))}>
            {t("retro.copyAll")}
          </Button>
          <Button size="sm" variant="outline" color="neutral" disabled={!total} onClick={() => download(`retro-${view.facts.sprint.name.replace(/\s+/g, "-")}.csv`, csv(), "text/csv;charset=utf-8")}>
            {t("retro.csv")}
          </Button>
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4 items-start">
        {COLUMNS.map((col) => {
          const list = cards.filter((c) => c.column === col);
          const shown = list.filter((c) => !hidePushed || !c.pushed || !written(c));
          const style = COLUMN_STYLE[col];
          const lines = list.filter(written).map((c) => cardLine(c, lang));
          return (
            <section key={col} className="bg-ui-surface rounded-lg border border-ui-border">
              <header className={`flex items-center justify-between gap-2 rounded-t-lg px-3 py-2 ${style.head}`}>
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${style.dot}`} aria-hidden />
                  {t(`retro.col.${col}` as MessageKey)}
                  <span className="font-normal opacity-80">({lines.length})</span>
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  color="neutral"
                  disabled={!lines.length}
                  title={t("retro.copyColumn")}
                  onClick={() => {
                    copy(lines.join("\n"), t("common.copied"));
                    save(cards.map((c) => (c.column === col && written(c) ? { ...c, pushed: true } : c)));
                  }}
                >
                  {t("retro.copyColumn")}
                </Button>
              </header>
              <div className="p-3 space-y-3">
                {shown.map((c) => (
                  <RetroCardView key={c.id} card={c} onChange={update} onDelete={() => remove(c.id)} />
                ))}
                {!shown.length && <p className="text-xs text-ui-secondary text-center py-3">{t("retro.emptyColumn")}</p>}
                <Button size="sm" variant="ghost" fullWidth leftIcon={<AddIcon />} onClick={() => add(col)}>
                  {t("retro.addCard")}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

function Generate({ sprintId, view }: { sprintId: number; view: RetroView }) {
  const { t, lang } = useT();
  const qc = useQueryClient();
  const board = view.board;
  const [notes, setNotes] = useState(board?.notes ?? "");
  const name = view.facts.sprint.name;
  const { tracked, job, running } = useLatestOfKind("retro");
  const mine = tracked?.keys.includes(name);
  const busy = !!mine && running;
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      const j = await http.post<JobState>("/api/retro/run", { sprintId, notes });
      trackJob("retro", [name], j);
    } catch (e) {
      toast.fromError(t("retro.failed"), e);
    } finally {
      setStarting(false);
    }
  };
  const clear = async () => {
    await http.del(`/api/retro?sprintId=${sprintId}`).catch((e: unknown) => toast.fromError(t("common.failed"), e));
    void qc.invalidateQueries({ queryKey: ["retro", sprintId] });
  };

  return (
    <Card
      title={board?.headline ? text(board.headline, lang) : t("retro.generate")}
      actions={
        board && (
          <>
            {board.generatedAt && (
              <span className="text-xs text-ui-secondary">{t("retro.generatedAt", { at: new Date(board.generatedAt).toLocaleString() })}</span>
            )}
            <ConfirmDelete label={t("retro.clear")} onConfirm={() => void clear()} />
          </>
        )
      }
    >
      {view.stale && !busy && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 mb-3 text-sm border bg-ui-warning-surface border-ui-warning text-ui-warning-dark">
          <span>⚠ {t("retro.stale")}</span>
        </div>
      )}
      <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
        <label className="block">
          <span className="block text-[13px] font-medium text-ui-body mb-1">{t("retro.notes")}</span>
          <Textarea size="sm" fullWidth minRows={2} value={notes} placeholder={t("retro.notesHint")} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex flex-col items-end gap-1">
          <Button loading={busy || starting} onClick={() => void start()}>
            {board?.generatedAt ? t("retro.regenerate") : t("retro.generate")}
          </Button>
          {board?.generatedAt && <span className="text-[11px] text-ui-secondary">{t("retro.regenHint")}</span>}
        </div>
      </div>
      {mine && job && (job.status === "running" || job.status === "error") && (
        <div className="mt-3">
          <JobProgress job={job} />
        </div>
      )}
    </Card>
  );
}

export default function RetroPage() {
  const { t } = useT();
  const { sprintId } = useSprintPick();
  const q = useQuery({
    queryKey: ["retro", sprintId],
    queryFn: () => http.get<RetroView>(`/api/retro?sprintId=${sprintId}`),
    enabled: sprintId !== null,
  });
  const view = q.data;
  const hasCards = useMemo(() => !!view?.board?.cards.length, [view]);

  return (
    <>
      <PageHeader
        title={t("nav.retro")}
        subtitle={t("retro.subtitle")}
        actions={
          <>
            <ReloadButton keys={["retro"]} />
            <SprintPicker />
          </>
        }
      />
      {q.isLoading && <Spinner />}
      {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
      {view && sprintId !== null && (
        <div className="space-y-5">
          <FactsView f={view.facts} />
          <Generate key={sprintId} sprintId={sprintId} view={view} />
          {!hasCards && <Empty>{t("retro.empty")}</Empty>}
          <Board key={sprintId} sprintId={sprintId} view={view} />
        </div>
      )}
    </>
  );
}
