import { Button, Checkbox, Spinner, Tag, Toggle } from "@/components/kit";
import { useState } from "react";
import { Select } from "@/components/Select";
import { Card, Empty, StatusTag } from "@/components/ui";
import { type MessageKey, useT } from "@/lib/i18n";
import { startTracked, useTrackedFor } from "@/lib/jobTracker";
import { useSprints, useSprintTickets } from "@/lib/queries";
import type { SprintTicket } from "@/lib/types";

const MAX_PER_JOB = 20; // matches the /api/estimate/run limit

function Row({
  ticket,
  aiPoints,
  checked,
  active,
  onCheck,
  onPick,
}: {
  ticket: SprintTicket;
  aiPoints: number | undefined;
  checked: boolean;
  active: boolean;
  onCheck: (v: boolean) => void;
  onPick: () => void;
}) {
  const { t } = useT();
  const { job, running } = useTrackedFor("estimate", ticket.key);
  const status = job?.items[ticket.key]?.status;
  return (
    <div
      role="row"
      onClick={onPick}
      className={`grid grid-cols-[28px_minmax(0,1fr)_130px_56px_64px] gap-2 items-center px-3 py-1.5 text-sm border-b border-ui-border cursor-pointer ${
        active ? "bg-ui-brand-surface" : "hover:bg-ui-surface"
      }`}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox size="sm" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={ticket.key} />
      </span>
      <span className="min-w-0 flex items-center gap-2">
        <Tag size="sm" color={ticket.type === "Bug" ? "red" : "secondary"} variant="light">
          {ticket.type}
        </Tag>
        <span className="font-semibold text-ui-brand shrink-0">{ticket.key}</span>
        <span className="truncate text-ui-primary">{ticket.summary}</span>
      </span>
      <span className="truncate">
        <StatusTag status={ticket.status} category={ticket.statusCategory} />
      </span>
      <span className="text-right text-ui-subtle">{ticket.points ?? "—"}</span>
      <span className="text-right font-semibold text-ui-brand">
        {running ? (
          <span title={status === "pending" ? t("estimate.queued") : t("estimate.running")}>
            <Spinner size="sm" />
          </span>
        ) : (
          (aiPoints ?? <span className="font-normal text-ui-secondary">—</span>)
        )}
      </span>
    </div>
  );
}

/** Next sprint's backlog with multi-select, so refinement can estimate everything in one go. */
export default function SprintEstimate({
  aiPoints,
  selectedKey,
  code,
  onPick,
}: {
  aiPoints: Map<string, number>;
  selectedKey: string | undefined;
  code: boolean;
  onPick: (key: string) => void;
}) {
  const { t } = useT();
  const sprints = useSprints();
  const options = (sprints.data ?? []).filter((s) => s.state !== "closed");
  const next = options.find((s) => s.state === "future") ?? options[0];
  const [picked, setPicked] = useState<number | null>(null);
  const sprintId = picked ?? next?.id ?? null;
  const tickets = useSprintTickets(sprintId);
  const [storiesOnly, setStoriesOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = (tickets.data ?? []).filter((x) => !x.subtask && (!storiesOnly || x.type === "Story"));
  const chosen = rows.filter((r) => selected.has(r.key)).map((r) => r.key);
  const all = rows.length > 0 && chosen.length === rows.length;
  const toggle = (key: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(key);
      else n.delete(key);
      return n;
    });
  const run = () => {
    for (let i = 0; i < chosen.length; i += MAX_PER_JOB) void startTracked("estimate", chosen.slice(i, i + MAX_PER_JOB), false, { code });
    setSelected(new Set());
  };
  const minutes = code ? [chosen.length * 3, chosen.length * 5] : [chosen.length, chosen.length * 2];

  return (
    <Card
      className="mb-4"
      title={t("estimate.sprintTitle")}
      actions={
        <>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Toggle size="sm" checked={storiesOnly} onChange={(e) => setStoriesOnly(e.target.checked)} />
            {t("estimate.storiesOnly")}
          </label>
          <div className="w-64">
            <Select
              size="sm"
              loading={sprints.isLoading}
              placeholder={t("sprint.pick")}
              items={options.map((s) => ({ value: String(s.id), label: `${s.name} · ${t(`sprintState.${s.state}` as MessageKey)}` }))}
              value={sprintId !== null ? [String(sprintId)] : []}
              onValueChange={(v) => {
                if (!v[0]) return;
                setPicked(Number(v[0]));
                setSelected(new Set());
              }}
            />
          </div>
        </>
      }
    >
      {sprints.error && <p className="text-sm text-ui-error m-0">{(sprints.error as Error).message}</p>}
      {tickets.isLoading && <Spinner size="sm" />}
      {tickets.error && <p className="text-sm text-ui-error m-0">{(tickets.error as Error).message}</p>}
      {tickets.data && !rows.length && <Empty>{t("sprint.empty")}</Empty>}
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set(rows.filter((r) => !aiPoints.has(r.key)).map((r) => r.key)))}>
              {t("estimate.selectUnestimated")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(rows.filter((r) => r.points == null).map((r) => r.key)))}>
              {t("estimate.selectNoJiraPoints")}
            </Button>
            <span className="ml-auto text-xs text-ui-secondary">
              {chosen.length > 0 && t("estimate.batchTime", { n: chosen.length, min: minutes[0], max: minutes[1] })}
            </span>
            <Button size="sm" disabled={!chosen.length} onClick={run}>
              {t("estimate.runSelected", { n: chosen.length })}
            </Button>
          </div>
          <div className="border border-ui-border rounded-md overflow-hidden" role="table">
            <div
              role="row"
              className="grid grid-cols-[28px_minmax(0,1fr)_130px_56px_64px] gap-2 px-3 py-2 bg-ui-surface text-xs font-semibold text-ui-subtle border-b border-ui-border"
            >
              <span>
                <Checkbox
                  size="sm"
                  checked={all}
                  indeterminate={!all && chosen.length > 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())}
                  aria-label={t("sprint.selectAll")}
                />
              </span>
              <span>{t("sprint.ticket")} ({rows.length})</span>
              <span>{t("sprint.status")}</span>
              <span className="text-right">{t("estimate.jira")}</span>
              <span className="text-right">AI</span>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              {rows.map((r) => (
                <Row
                  key={r.key}
                  ticket={r}
                  aiPoints={aiPoints.get(r.key)}
                  checked={selected.has(r.key)}
                  active={r.key === selectedKey}
                  onCheck={(v) => toggle(r.key, v)}
                  onPick={() => onPick(r.key)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
