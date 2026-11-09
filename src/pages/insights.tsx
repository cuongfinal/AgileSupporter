import { Button, TabHeader, TabList, TabListItem, Tabs, Tag } from "@/components/kit";
import { DownloadIcon } from "@/components/icons";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Card, CopyButton, Kpi, Loader, Md, PageHeader, StatusTag } from "@/components/ui";
import SprintPicker from "@/features/SprintPicker";
import { download, http } from "@/lib/client";
import { type MessageKey, useT } from "@/lib/i18n";
import { useSprintPick } from "@/lib/queries";
import type { Sprint, StatusCategory } from "@/lib/types";

interface IssueLite {
  key: string;
  summary: string;
  status: string;
  category: StatusCategory;
  points: number | null;
  assignee: string;
  reasons?: string[];
}

interface Health {
  sprint: Sprint;
  unit: "points" | "items";
  pointsField: string;
  totalPoints: number;
  donePoints: number;
  unpointed: number;
  counts: Record<StatusCategory, number>;
  daysLeft: number | null;
  carryOver: IssueLite[];
  blocked: IssueLite[];
}

function IssueList({ items, reasons }: { items: IssueLite[]; reasons?: boolean }) {
  const { t } = useT();
  if (!items.length) return <p className="text-sm text-ui-success">{t("insights.noneHere")}</p>;
  return (
    <ul className="list-none p-0 divide-y divide-ui-border">
      {items.map((i) => (
        <li key={i.key} className="py-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-ui-brand">{i.key}</span>
          <span className="flex-1 min-w-0 truncate">{i.summary}</span>
          <StatusTag status={i.status} category={i.category} />
          <span className="text-xs text-ui-secondary w-32 truncate">{i.assignee || t("ticket.unassigned")}</span>
          {reasons &&
            i.reasons?.map((r) => (
              <Tag key={r} size="sm" color="orange" variant="light">{t(`risk.${r}` as MessageKey)}</Tag>
            ))}
        </li>
      ))}
    </ul>
  );
}

function HealthView() {
  const { t } = useT();
  const { sprintId } = useSprintPick();
  const q = useQuery({ queryKey: ["health", sprintId], queryFn: () => http.get<Health>(`/api/insights/health?sprintId=${sprintId}`), enabled: sprintId !== null });
  if (q.isLoading) return <Loader fill />;
  if (q.error) return <p className="text-sm text-ui-error">{(q.error as Error).message}</p>;
  const h = q.data;
  if (!h) return null;
  const pct = h.totalPoints ? Math.round((h.donePoints / h.totalPoints) * 100) : 0;
  const byItems = h.unit === "items";
  return (
    <div className="space-y-4">
      {byItems && (
        <div className="rounded-md bg-ui-info-surface px-4 py-2 text-sm text-ui-body">
          {h.pointsField ? t("insights.noPoints") : t("insights.noPointsField")}{" "}
          <Link href="/settings#jira">{t("insights.mapField")}</Link>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label={byItems ? t("insights.itemsDone") : t("insights.pointsDone")}
          value={`${h.donePoints}/${h.totalPoints}`}
          hint={`${pct}%${!byItems && h.unpointed ? ` · ${t("insights.unpointed", { n: h.unpointed })}` : ""}`}
        />
        <Kpi label={t("insights.daysLeft")} value={h.daysLeft ?? "—"} hint={h.sprint.endDate?.slice(0, 10)} />
        <Kpi label={t("insights.items")} value={h.counts.new + h.counts.indeterminate + h.counts.done} hint={t("insights.itemsHint", { todo: h.counts.new, doing: h.counts.indeterminate, done: h.counts.done })} />
        <Kpi label={t("insights.atRisk")} value={h.carryOver.length + h.blocked.length} hint={t("insights.atRiskHint", { c: h.carryOver.length, b: h.blocked.length })} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={t("insights.carryOver", { n: h.carryOver.length })}>
          <IssueList items={h.carryOver} reasons />
        </Card>
        <Card title={t("insights.blocked", { n: h.blocked.length })}>
          <IssueList items={h.blocked} />
        </Card>
      </div>
    </div>
  );
}

function Report() {
  const { t } = useT();
  const { sprintId } = useSprintPick();
  const q = useQuery({
    queryKey: ["report", sprintId],
    queryFn: () => http.get<{ markdown: string }>(`/api/insights/report?sprintId=${sprintId}`),
    enabled: sprintId !== null,
  });
  return (
    <Card
      title={t("report.title")}
      actions={
        q.data && (
          <>
            <CopyButton text={q.data.markdown} label={t("common.copyMarkdown")} />
            <Button size="sm" leftIcon={<DownloadIcon />} onClick={() => download(`sprint-report-${sprintId}.md`, q.data.markdown)}>
              {t("common.download")}
            </Button>
          </>
        )
      }
    >
      <p className="text-xs text-ui-secondary mb-3">{t("report.hint")}</p>
      {q.isLoading && <Loader />}
      {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
      {q.data && <Md>{q.data.markdown}</Md>}
    </Card>
  );
}

export default function InsightsPage() {
  const { t } = useT();
  const [tab, setTab] = useState(0);
  return (
    <>
      <PageHeader title={t("nav.insights")} subtitle={t("insights.subtitle")} actions={<SprintPicker />} />
      <Tabs selectedIndex={tab} onChange={setTab} className="!shadow-none !bg-transparent mb-4">
        <TabHeader>
          <TabList>
            <TabListItem>{t("insights.tabHealth")}</TabListItem>
            <TabListItem>{t("insights.tabReport")}</TabListItem>
          </TabList>
        </TabHeader>
      </Tabs>
      {tab === 0 && <HealthView />}
      {tab === 1 && <Report />}
    </>
  );
}
