import { Tag } from "@/components/kit";
import { useQuery } from "@tanstack/react-query";
import { Card, Empty, Kpi, Loader, PageHeader } from "@/components/ui";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import type { UsageEntry } from "@/lib/types";

interface Usage {
  days: { day: string; runs: number; cacheHits: number; failures: number; ms: number; costUsd: number }[];
  recent: UsageEntry[];
}

export default function UsagePage() {
  const { t } = useT();
  const q = useQuery({ queryKey: ["usage"], queryFn: () => http.get<Usage>("/api/usage"), staleTime: 0, refetchOnMount: "always", refetchInterval: 10_000 });
  const d = q.data;
  const totals = d?.days.reduce(
    (a, x) => ({ runs: a.runs + x.runs, hits: a.hits + x.cacheHits, fail: a.fail + x.failures, cost: a.cost + x.costUsd }),
    { runs: 0, hits: 0, fail: 0, cost: 0 },
  );
  const hitRate = totals && totals.runs + totals.hits ? Math.round((totals.hits / (totals.runs + totals.hits)) * 100) : 0;
  return (
    <>
      <PageHeader title={t("nav.usage")} subtitle={t("usage.subtitle")} />
      {q.isLoading && <Loader fill />}
      {d && totals && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={t("usage.runs")} value={totals.runs} hint={t("usage.last30")} />
            <Kpi label={t("usage.cacheRate")} value={`${hitRate}%`} hint={t("usage.cacheHits", { n: totals.hits })} />
            <Kpi label={t("usage.failures")} value={totals.fail} />
            <Kpi label={t("usage.cost")} value={`$${totals.cost.toFixed(2)}`} hint={t("usage.costHint")} />
          </div>
          <Card title={t("usage.byDay")}>
            {!d.days.length ? (
              <Empty>{t("usage.empty")}</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ui-subtle border-b border-ui-border">
                    <th className="py-2">{t("insights.date")}</th>
                    <th className="py-2 text-right">{t("usage.runs")}</th>
                    <th className="py-2 text-right">{t("usage.cacheHitsCol")}</th>
                    <th className="py-2 text-right">{t("usage.failures")}</th>
                    <th className="py-2 text-right">{t("usage.time")}</th>
                    <th className="py-2 text-right">{t("usage.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.days.map((x) => (
                    <tr key={x.day} className="border-b border-ui-border">
                      <td className="py-1.5">{x.day}</td>
                      <td className="py-1.5 text-right">{x.runs}</td>
                      <td className="py-1.5 text-right">{x.cacheHits}</td>
                      <td className="py-1.5 text-right">{x.failures}</td>
                      <td className="py-1.5 text-right">{Math.round(x.ms / 1000)}s</td>
                      <td className="py-1.5 text-right">${x.costUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={t("usage.recent")}>
            <ul className="list-none p-0 divide-y divide-ui-border">
              {d.recent.map((e, i) => (
                <li key={i} className="py-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-ui-secondary w-40">{new Date(e.ts).toLocaleString()}</span>
                  <Tag size="sm" color="neutral" variant="light">{e.task}</Tag>
                  <Tag size="sm" color={e.provider === "cache" ? "blue" : "secondary"} variant="light">{e.provider}</Tag>
                  <span className="text-xs">{(e.ms / 1000).toFixed(1)}s</span>
                  {!e.ok && <span className="text-xs text-ui-error truncate flex-1">{e.error}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
