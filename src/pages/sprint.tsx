import { Button, Checkbox, Input, Segmented, SegmentedItem, Spinner, Tag, Toggle } from "@/components/kit";
import { ChevronDownIcon, ChevronRightIcon, DownloadIcon, SearchIcon } from "@/components/icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { Card, Empty, JobProgress, PageHeader, ReloadButton, ReviewCounts, StaleTag, StatusTag } from "@/components/ui";
import RepoBadges from "@/features/RepoBadges";
import SprintPicker from "@/features/SprintPicker";
import TicketDrawer from "@/features/TicketDrawer";
import { download, http } from "@/lib/client";
import { startTracked, useJobTracker, useLatestTracked } from "@/lib/jobTracker";
import { Select } from "@/components/Select";
import { type MessageKey, useT } from "@/lib/i18n";
import { useSprintPick, useSprintTickets, useSprints } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { SprintTicket } from "@/lib/types";

type Group = "none" | "status" | "assignee";

function useFilters() {
  const router = useRouter();
  const q = router.query;
  const list = (k: string) => (typeof q[k] === "string" && q[k] ? (q[k] as string).split(",") : []);
  const filters = {
    text: typeof q.q === "string" ? q.q : "",
    status: list("status"),
    assignee: list("assignee"),
    type: list("type"),
    mine: q.mine === "1",
    group: (["none", "status", "assignee"].includes(String(q.group)) ? q.group : "none") as Group,
    src: (q.src === "jql" ? "jql" : "sprint") as "sprint" | "jql",
    jql: typeof q.jql === "string" ? q.jql : "",
  };
  const set = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    const query: Record<string, string> = {};
    if (next.text) query.q = next.text;
    if (next.status.length) query.status = next.status.join(",");
    if (next.assignee.length) query.assignee = next.assignee.join(",");
    if (next.type.length) query.type = next.type.join(",");
    if (next.mine) query.mine = "1";
    if (next.group !== "none") query.group = next.group;
    if (next.src === "jql") query.src = "jql";
    if (next.src === "jql" && next.jql) query.jql = next.jql;
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  return { filters, set };
}

function TicketRow({
  t: ticket,
  depth,
  hasChildren,
  expanded,
  onToggle,
  selected,
  onSelect,
  onOpen,
  jobStatus,
}: {
  t: SprintTicket;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onOpen: () => void;
  jobStatus?: string;
}) {
  const { t } = useT();
  return (
    <div
      role="row"
      className="grid grid-cols-[28px_24px_minmax(0,1fr)_150px_150px_48px] items-center gap-2 px-3 py-2 border-b border-ui-border hover:bg-ui-brand-surface/40 cursor-pointer text-sm"
      onClick={onOpen}
    >
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox size="sm" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={ticket.key} />
      </span>
      <span>
        {hasChildren && (
          <button
            type="button"
            aria-label={expanded ? t("sprint.collapse") : t("sprint.expand")}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="w-6 h-6 grid place-items-center bg-transparent border-0 cursor-pointer text-ui-subtle hover:text-ui-brand [&_svg]:w-4 [&_svg]:h-4"
          >
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </button>
        )}
      </span>
      <div className="min-w-0 flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>
        <Tag size="sm" color={ticket.type === "Bug" ? "red" : ticket.subtask ? "neutral" : "secondary"} variant="light">
          {ticket.type}
        </Tag>
        <span className="font-semibold text-ui-brand shrink-0">{ticket.key}</span>
        <span className="truncate text-ui-primary">{ticket.summary}</span>
        {ticket.unseenChange && <span title={t("sprint.changed")} className="w-2 h-2 rounded-full bg-ui-brand shrink-0" aria-label={t("sprint.changed")} />}
        {ticket.hasSummary && (
          <Tag size="sm" color="blue" variant="light">
            {t("sprint.summarized")}
          </Tag>
        )}
        <ReviewCounts counts={ticket.review} />
        <StaleTag stale={ticket.reviewStale} />
        {jobStatus && jobStatus !== "pending" && (
          <span className="text-xs text-ui-secondary">{jobStatus === "running" ? <Spinner size="sm" /> : t(`itemStatus.${jobStatus}` as MessageKey)}</span>
        )}
      </div>
      <span className="truncate">
        <StatusTag status={ticket.status} category={ticket.statusCategory} />
      </span>
      <span className="truncate text-ui-subtle text-xs">{ticket.assignee?.name ?? t("ticket.unassigned")}</span>
      <span className="text-right text-ui-subtle">{ticket.points ?? ""}</span>
    </div>
  );
}

export default function SprintPage() {
  const { sprintId } = useSprintPick();
  const { filters } = useFilters();
  const scope = filters.src === "jql" ? `jql:${filters.jql}` : `sprint:${sprintId ?? "none"}`;
  return <SprintBody key={scope} sprintId={sprintId} />;
}

function SprintBody({ sprintId }: { sprintId: number | null }) {
  const { t } = useT();
  const router = useRouter();
  const sprints = useSprints();
  const { filters, set } = useFilters();
  const byJql = filters.src === "jql";
  const sprintTickets = useSprintTickets(byJql ? null : sprintId);
  const search = useQuery({
    queryKey: ["search", filters.jql],
    queryFn: () => http.get<SprintTicket[]>(`/api/jira/search?jql=${encodeURIComponent(filters.jql)}`),
    enabled: byJql && !!filters.jql,
  });
  const tickets = byJql ? search : sprintTickets;
  const me = useQuery({ queryKey: ["me"], queryFn: () => http.get<{ accountId: string }>("/api/jira/me"), staleTime: Infinity });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedKey, setOpenKey] = useState<string | null>(null);
  // `?open=KEY` (e.g. from the Estimation page) opens that ticket's drawer.
  const linkedKey = typeof router.query.open === "string" ? router.query.open : null;
  const openKey = pickedKey ?? linkedKey;
  const closeDrawer = () => {
    setOpenKey(null);
    if (linkedKey) {
      const { open: _open, ...rest } = router.query;
      void _open;
      void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  };
  const latest = useLatestTracked();
  const dismissJob = useJobTracker((s) => s.dismiss);
  const job = { data: latest.job };

  const all = useMemo(() => tickets.data ?? [], [tickets.data]);
  const byKey = useMemo(() => new Set(all.map((x) => x.key)), [all]);
  const children = useMemo(() => {
    const m = new Map<string, SprintTicket[]>();
    for (const x of all) if (x.subtask && x.parentKey && byKey.has(x.parentKey)) m.set(x.parentKey, [...(m.get(x.parentKey) ?? []), x]);
    return m;
  }, [all, byKey]);
  const roots = useMemo(() => all.filter((x) => !(x.subtask && x.parentKey && byKey.has(x.parentKey))), [all, byKey]);

  const matches = (x: SprintTicket) => {
    const text = filters.text.toLowerCase();
    if (text && !`${x.key} ${x.summary}`.toLowerCase().includes(text)) return false;
    if (filters.status.length && !filters.status.includes(x.status)) return false;
    if (filters.type.length && !filters.type.includes(x.type)) return false;
    const who = x.assignee?.name ?? "—";
    if (filters.assignee.length && !filters.assignee.includes(who)) return false;
    if (filters.mine && x.assignee?.accountId !== me.data?.accountId) return false;
    return true;
  };
  const visible = roots
    .map((r) => ({ root: r, kids: (children.get(r.key) ?? []).filter(matches), rootMatch: matches(r) }))
    .filter((v) => v.rootMatch || v.kids.length)
    .map((v) => ({ root: v.root, kids: v.rootMatch && !v.kids.length ? [] : v.kids, allKids: children.get(v.root.key) ?? [] }));

  const groups = useMemo(() => {
    if (filters.group === "none") return [{ name: "", items: visible }];
    const m = new Map<string, typeof visible>();
    for (const v of visible) {
      const k = filters.group === "status" ? v.root.status : (v.root.assignee?.name ?? t("ticket.unassigned"));
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return [...m.entries()].map(([name, items]) => ({ name, items }));
  }, [visible, filters.group, t]);

  const opts = (vals: string[]) => [...new Set(vals)].sort().map((v) => ({ label: v, value: v }));
  const visibleKeys = visible.flatMap((v) => [v.root.key, ...(v.kids.length ? v.kids : expanded.has(v.root.key) ? v.allKids : []).map((k) => k.key)]);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));

  const run = (kind: "summary" | "review") => {
    const keys = [...selected];
    if (keys.length) void startTracked(kind, keys);
  };

  const checklist = () => {
    const keys = selected.size ? [...selected] : visibleKeys;
    http
      .post<{ markdown: string }>("/api/review/checklist", { keys })
      .then((r) => download(`refinement-checklist-${new Date().toISOString().slice(0, 10)}.md`, r.markdown))
      .catch((e) => toast.fromError(t("common.failed"), e));
  };

  const sprint = byJql ? undefined : sprints.data?.find((s) => s.id === sprintId);
  const points = roots.reduce((a, r) => a + (r.points ?? 0), 0);

  return (
    <>
      <PageHeader
        title={t("nav.sprint")}
        subtitle={
          sprint
            ? `${sprint.startDate?.slice(0, 10) ?? "?"} → ${sprint.endDate?.slice(0, 10) ?? "?"} · ${t("sprint.counts", { n: roots.length, pts: points })}${sprint.goal ? ` · ${sprint.goal}` : ""}`
            : undefined
        }
        actions={
          <>
            <Segmented size="sm" selectedIndex={byJql ? 1 : 0} onChange={(i) => set({ src: i === 1 ? "jql" : "sprint" })}>
              <SegmentedItem>Sprint</SegmentedItem>
              <SegmentedItem>JQL</SegmentedItem>
            </Segmented>
            {byJql ? (
              <div className="w-[420px] max-w-full">
                <Input
                  key={filters.jql}
                  size="sm"
                  fullWidth
                  placeholder="project = INTERNAL AND sprint in futureSprints() ORDER BY rank"
                  defaultValue={filters.jql}
                  onKeyDown={(e) => e.key === "Enter" && set({ jql: (e.target as HTMLInputElement).value.trim() })}
                  onBlur={(e) => e.target.value.trim() !== filters.jql && set({ jql: e.target.value.trim() })}
                />
              </div>
            ) : (
              <SprintPicker />
            )}
            <ReloadButton keys={["sprints", "sprint", "search", "ticket", "me", "repo-status"]} />
          </>
        }
      />
      <Card className="mb-3">
        <RepoBadges />
      </Card>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Input
              key={filters.text}
              size="sm"
              fullWidth
              leftContent={<SearchIcon />}
              placeholder={t("sprint.search")}
              defaultValue={filters.text}
              onBlur={(e) => e.target.value !== filters.text && set({ text: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && set({ text: (e.target as HTMLInputElement).value })}
            />
          </div>
          {(
            [
              ["status", "sprint.status", all.map((x) => x.status)],
              ["assignee", "sprint.assignee", all.map((x) => x.assignee?.name ?? "—")],
              ["type", "sprint.type", all.map((x) => x.type)],
            ] as const
          ).map(([k, label, vals]) => (
            <div key={k} className="w-48">
              <Select
                size="sm"
                multiple
                clearable
                limitTags={1}
                placeholder={t(label)}
                items={opts([...vals])}
                value={filters[k]}
                onValueChange={(v) => set({ [k]: v })}
              />
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm pb-1.5">
            <Toggle size="sm" checked={filters.mine} onChange={(e) => set({ mine: e.target.checked })} />
            {t("sprint.mine")}
          </label>
          <div className="flex items-center gap-2 pb-0.5">
            <span className="text-xs text-ui-secondary">{t("sprint.groupBy")}</span>
            <Segmented size="sm" selectedIndex={["none", "status", "assignee"].indexOf(filters.group)} onChange={(i) => set({ group: (["none", "status", "assignee"] as Group[])[i] })}>
              <SegmentedItem>{t("sprint.groupNone")}</SegmentedItem>
              <SegmentedItem>{t("sprint.status")}</SegmentedItem>
              <SegmentedItem>{t("sprint.assignee")}</SegmentedItem>
            </Segmented>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(children.keys()))}>
            {t("sprint.expandAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>
            {t("sprint.collapseAll")}
          </Button>
          {selected.size > 0 && <span className="text-sm text-ui-secondary">{t("sprint.selected", { n: selected.size })}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" leftIcon={<DownloadIcon />} disabled={!visibleKeys.length} onClick={checklist}>
            {t("review.downloadChecklist")}
          </Button>
          <Button size="sm" variant="outline" disabled={!selected.size || job.data?.status === "running"} onClick={() => run("summary")}>
            {t("sprint.summarizeSelected")}
          </Button>
          <Button size="sm" disabled={!selected.size || job.data?.status === "running"} onClick={() => run("review")}>
            {t("sprint.reviewSelected")}
          </Button>
        </div>
      </div>
      {latest.tracked && job.data && (latest.tracked.keys.length > 1 || job.data.status === "running") && (
        <Card className="mb-3">
          <JobProgress job={job.data} showItems />
          {job.data.kind === "review" && job.data.status === "running" && <p className="text-xs text-ui-secondary mt-1">{t("review.slowHint")}</p>}
          {job.data.status !== "running" && (
            <div className="text-right mt-2">
              <Button size="sm" variant="ghost" onClick={() => latest.tracked && dismissJob(latest.tracked.id)}>
                {t("common.dismiss")}
              </Button>
            </div>
          )}
        </Card>
      )}

      <div className="bg-white border border-ui-border rounded-lg overflow-hidden" role="table">
        <div role="row" className="grid grid-cols-[28px_24px_minmax(0,1fr)_150px_150px_48px] gap-2 px-3 py-2 bg-ui-surface text-xs font-semibold text-ui-subtle border-b border-ui-border">
          <span>
            <Checkbox
              size="sm"
              checked={allSelected}
              indeterminate={!allSelected && visibleKeys.some((k) => selected.has(k))}
              onChange={(e) => setSelected(e.target.checked ? new Set(visibleKeys) : new Set())}
              aria-label={t("sprint.selectAll")}
            />
          </span>
          <span />
          <span>{t("sprint.ticket")}</span>
          <span>{t("sprint.status")}</span>
          <span>{t("sprint.assignee")}</span>
          <span className="text-right">{t("sprint.pts")}</span>
        </div>
        {tickets.isLoading && (
          <div className="p-6 grid place-items-center">
            <Spinner />
          </div>
        )}
        {tickets.error && <p className="p-4 text-sm text-ui-error">{(tickets.error as Error).message}</p>}
        {!tickets.isLoading && !tickets.error && !visible.length && <Empty>{byJql && !filters.jql ? t("review.enterJql") : sprintId || byJql ? t("sprint.empty") : t("sprint.noSprint")}</Empty>}
        {groups.map((g) => (
          <div key={g.name || "_"}>
            {g.name && (
              <div className="px-3 py-1.5 bg-ui-secondary-surface text-xs font-semibold text-ui-heading-strong border-b border-ui-border">
                {g.name} <span className="font-normal text-ui-secondary">({g.items.length})</span>
              </div>
            )}
            {g.items.map(({ root, kids, allKids }) => {
              const isOpen = expanded.has(root.key) || (kids.length > 0 && kids.length < allKids.length);
              const shown = kids.length && kids.length < allKids.length ? kids : allKids;
              const toggleSel = (key: string, v: boolean) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (v) n.add(key);
                  else n.delete(key);
                  return n;
                });
              return (
                <div key={root.key}>
                  <TicketRow
                    t={root}
                    depth={0}
                    hasChildren={allKids.length > 0}
                    expanded={isOpen}
                    onToggle={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        if (n.has(root.key)) n.delete(root.key);
                        else n.add(root.key);
                        return n;
                      })
                    }
                    selected={selected.has(root.key)}
                    onSelect={(v) => toggleSel(root.key, v)}
                    onOpen={() => setOpenKey(root.key)}
                    jobStatus={job.data?.items[root.key]?.status}
                  />
                  {isOpen &&
                    shown.map((c) => (
                      <TicketRow
                        key={c.key}
                        t={c}
                        depth={1}
                        hasChildren={false}
                        expanded={false}
                        onToggle={() => undefined}
                        selected={selected.has(c.key)}
                        onSelect={(v) => toggleSel(c.key, v)}
                        onOpen={() => setOpenKey(c.key)}
                        jobStatus={job.data?.items[c.key]?.status}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <TicketDrawer ticketKey={openKey} onClose={closeDrawer} />
    </>
  );
}
