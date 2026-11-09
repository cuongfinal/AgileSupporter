import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { WarningIcon } from "@/components/icons";
import { Button, Checkbox, Input, Tag } from "@/components/kit";
import { Card, Empty, Loader, PageHeader } from "@/components/ui";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { useSettings, useSprintPick, useSprints } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { TimeSlot } from "@/lib/types";

interface Preview {
  days: string[];
  slots: TimeSlot[];
  hoursPerDay: number;
  entries: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

function ranges() {
  const today = new Date();
  const mon = monday(today);
  return {
    thisWeek: [ymd(mon), ymd(addDays(mon, 4))],
    lastWeek: [ymd(addDays(mon, -7)), ymd(addDays(mon, -3))],
    thisMonth: [ymd(new Date(today.getFullYear(), today.getMonth(), 1)), ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0))],
  } as const;
}

export default function LogTimePage() {
  const { t, lang } = useT();
  const settings = useSettings();
  const sprints = useSprints();
  const { sprintId } = useSprintPick();
  const sprint = sprints.data?.find((s) => s.id === sprintId);
  const r = ranges();
  const [from, setFrom] = useState<string>(r.thisWeek[0]);
  const [to, setTo] = useState<string>(r.thisWeek[1]);
  // Days the person unticked (leave, holidays); everything else in the range gets logged.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const enabled = !!settings.data?.features.logTime;
  const tt = settings.data?.timeTracker;

  const q = useQuery({
    queryKey: ["logtime", from, to],
    queryFn: () => http.get<Preview>(`/api/logtime/preview?from=${from}&to=${to}`),
    enabled: enabled && !!from && !!to && from <= to,
  });
  const days = q.data?.days ?? [];
  const chosen = days.filter((d) => !skipped.has(d));
  const hours = chosen.length * (q.data?.hoursPerDay ?? 0);

  const submit = useMutation({
    mutationFn: () => http.post<{ days: number; entries: number; hours: number }>("/api/logtime/submit", { dates: chosen }),
    onSuccess: (res) => {
      setArmed(false);
      toast.success(t("logtime.done", { days: res.days, hours: res.hours }));
    },
    onError: (e) => {
      setArmed(false);
      toast.fromError(t("logtime.failed"), e);
    },
  });

  const setRange = (a: string, b: string) => {
    setFrom(a);
    setTo(b);
    setSkipped(new Set());
    setArmed(false);
  };
  const dayName = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

  if (settings.isLoading) return <Loader fill />;
  if (!enabled)
    return (
      <>
        <PageHeader title={t("nav.logtime")} subtitle={t("logtime.subtitle")} />
        <Empty>
          {t("logtime.off")} <Link href="/settings#features">{t("logtime.openSettings")}</Link>
        </Empty>
      </>
    );

  const missing = !tt?.baseUrl || !tt.loginName || !tt.mainTaskId || !tt.kaizenTaskId || !settings.data?.secrets["timetracker.password"].set;

  return (
    <>
      <PageHeader title={t("nav.logtime")} subtitle={t("logtime.subtitle")} />
      {missing && (
        <div className="mb-4 rounded-md border border-ui-warning bg-ui-warning-surface px-3 py-2 text-sm text-ui-warning-dark">
          <WarningIcon size={14} className="inline -mt-0.5 mr-1.5" />
          {t("logtime.notSetUp")} <Link href="/settings#features">{t("logtime.openSettings")}</Link>
        </div>
      )}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-label font-medium text-ui-body mb-1">{t("logtime.from")}</span>
            <Input size="sm" type="date" value={from} onChange={(e) => setRange(e.target.value, to)} />
          </label>
          <label className="block">
            <span className="block text-label font-medium text-ui-body mb-1">{t("logtime.to")}</span>
            <Input size="sm" type="date" value={to} onChange={(e) => setRange(from, e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            <Button size="sm" variant="outline" color="neutral" onClick={() => setRange(...r.thisWeek)}>
              {t("logtime.thisWeek")}
            </Button>
            <Button size="sm" variant="outline" color="neutral" onClick={() => setRange(...r.lastWeek)}>
              {t("logtime.lastWeek")}
            </Button>
            <Button size="sm" variant="outline" color="neutral" onClick={() => setRange(...r.thisMonth)}>
              {t("logtime.thisMonth")}
            </Button>
            {sprint?.startDate && sprint.endDate && (
              <Button size="sm" variant="outline" color="neutral" onClick={() => setRange(ymd(new Date(sprint.startDate!)), ymd(new Date(sprint.endDate!)))}>
                {sprint.name}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card
        title={t("logtime.days", { n: chosen.length, off: days.length - chosen.length })}
        actions={
          tt && (
            <span className="text-xs text-ui-secondary">
              {tt.slots.map((s) => `${s.start}–${s.end} ${s.task === "main" ? t("logtime.taskMain") : t("logtime.taskKaizen")}`).join(" · ")}
            </span>
          )
        }
      >
        {q.isLoading && <Loader />}
        {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
        {from > to && <p className="text-sm text-ui-error">{t("logtime.badRange")}</p>}
        {q.data && !days.length && <p className="text-sm text-ui-secondary">{t("logtime.noDays")}</p>}
        {days.length > 0 && (
          <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {days.map((d) => {
              const on = !skipped.has(d);
              return (
                <li key={d}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${on ? "border-ui-brand-soft bg-ui-brand-surface" : "border-ui-border bg-ui-raised text-ui-secondary"}`}>
                    <Checkbox
                      size="sm"
                      checked={on}
                      onChange={(e) => {
                        const next = new Set(skipped);
                        if (e.target.checked) next.delete(d);
                        else next.add(d);
                        setSkipped(next);
                        setArmed(false);
                      }}
                    />
                    <span className={`flex-1 ${on ? "" : "line-through"}`}>{dayName(d)}</span>
                    {on ? (
                      <Tag size="sm" color="primary">
                        {q.data?.hoursPerDay}h
                      </Tag>
                    ) : (
                      <Tag size="sm" color="neutral">
                        {t("logtime.dayOff")}
                      </Tag>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-ui-secondary">{t("logtime.noDupCheck")}</p>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm font-semibold text-ui-body">{t("logtime.total", { days: chosen.length, hours })}</span>
          <Button
            color={armed ? "danger" : "primary"}
            disabled={!chosen.length || missing}
            loading={submit.isPending}
            onClick={() => (armed ? submit.mutate() : setArmed(true))}
          >
            {armed ? t("logtime.confirm", { n: chosen.length }) : t("logtime.submit", { n: chosen.length })}
          </Button>
        </div>
      </Card>
    </>
  );
}
