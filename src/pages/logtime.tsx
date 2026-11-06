import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AddIcon, EditIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { Button, Checkbox, Input, Spinner, Tag } from "@/components/kit";
import { Select } from "@/components/Select";
import { Card, Empty, PageHeader } from "@/components/ui";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { useSettings, useSprintPick, useSprints } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { slotHours, timeSlotsSchema } from "@/lib/timeSlots";
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
  const [overrides, setOverrides] = useState<Record<string, TimeSlot[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const enabled = !!settings.data?.features.logTime;
  const tt = settings.data?.timeTracker;

  const q = useQuery({
    queryKey: ["logtime", from, to, tt?.slots],
    queryFn: () => http.get<Preview>(`/api/logtime/preview?from=${from}&to=${to}`),
    enabled: enabled && !!from && !!to && from <= to,
  });
  const days = q.data?.days ?? [];
  const weeks = new Map<string, string[]>();
  for (const date of days) {
    const week = ymd(monday(new Date(`${date}T00:00:00`)));
    const group = weeks.get(week) ?? [];
    group.push(date);
    weeks.set(week, group);
  }
  const chosen = days.filter((d) => !skipped.has(d));
  const slotsFor = (date: string) => overrides[date] ?? q.data?.slots ?? [];
  const hoursFor = (date: string) => timeSlotsSchema.safeParse(slotsFor(date)).success ? slotHours(slotsFor(date)) : 0;
  const invalid = chosen.some((date) => !timeSlotsSchema.safeParse(slotsFor(date)).success);
  const hours = Math.round(chosen.reduce((total, date) => total + hoursFor(date), 0) * 100) / 100;
  const setSlots = (date: string, slots: TimeSlot[]) => {
    setOverrides((current) => ({ ...current, [date]: slots }));
    setArmed(false);
  };

  const submit = useMutation({
    mutationFn: () => http.post<{ days: number; entries: number; hours: number }>("/api/logtime/submit", {
      dates: chosen,
      overrides: Object.fromEntries(chosen.filter((date) => overrides[date]).map((date) => [date, overrides[date]])),
    }),
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
    setOverrides({});
    setEditing(null);
    setArmed(false);
  };
  const dayName = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

  if (settings.isLoading) return <Spinner />;
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
          ⚠ {t("logtime.notSetUp")} <Link href="/settings#features">{t("logtime.openSettings")}</Link>
        </div>
      )}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-[13px] font-medium text-ui-body mb-1">{t("logtime.from")}</span>
            <Input size="sm" type="date" value={from} onChange={(e) => setRange(e.target.value, to)} />
          </label>
          <label className="block">
            <span className="block text-[13px] font-medium text-ui-body mb-1">{t("logtime.to")}</span>
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
        {q.isLoading && <Spinner />}
        {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
        {from > to && <p className="text-sm text-ui-error">{t("logtime.badRange")}</p>}
        {q.data && !days.length && <p className="text-sm text-ui-secondary">{t("logtime.noDays")}</p>}
        {days.length > 0 && (
          <div className="space-y-8">
            {[...weeks].map(([week, weekDays]) => {
              const selected = weekDays.filter((date) => !skipped.has(date));
              const weekHours = Math.round(selected.reduce((total, date) => total + hoursFor(date), 0) * 100) / 100;
              const formatDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
              const weekTitle = t("logtime.weekRange", { from: formatDate(weekDays[0]), to: formatDate(weekDays[weekDays.length - 1]) });
              return (
                <section key={week} aria-labelledby={weeks.size > 1 ? `week-${week}` : undefined} className="border-t border-ui-border pt-6 first:border-t-0 first:pt-0">
                  {weeks.size > 1 && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-ui-brand bg-ui-surface px-3 py-3">
                    <h3 id={`week-${week}`} className="text-sm font-semibold text-ui-heading">{weekTitle}</h3>
                    <span className="text-sm font-medium text-ui-body">{t("logtime.total", { days: selected.length, hours: weekHours })}</span>
                  </div>
                  )}
          <ul className="m-0 grid list-none items-start gap-2 p-0 lg:grid-cols-2">
            {weekDays.map((d) => {
              const on = !skipped.has(d);
              const slots = slotsFor(d);
              const valid = timeSlotsSchema.safeParse(slots).success;
              return (
                <li key={d} className={`min-w-0 rounded-md border px-3 py-2 text-sm ${on ? "border-ui-brand-soft bg-ui-brand-surface" : "border-ui-border bg-white text-ui-secondary"}`}>
                  <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                      size="sm"
                      checked={on}
                      disabled={submit.isPending}
                      onChange={(e) => {
                        const next = new Set(skipped);
                        if (e.target.checked) next.delete(d);
                        else next.add(d);
                        setSkipped(next);
                        setArmed(false);
                      }}
                    />
                    <span className={`flex-1 ${on ? "" : "line-through"}`}>{dayName(d)}</span>
                  </label>
                    {on ? (
                      <Tag size="sm" color={valid ? "primary" : "red"}>
                        {valid ? `${Math.round(slotHours(slots) * 100) / 100}h` : t("logtime.invalid")}
                      </Tag>
                    ) : (
                      <Tag size="sm" color="neutral">
                        {t("logtime.dayOff")}
                      </Tag>
                    )}
                    <Button size="sm" variant="ghost" color="neutral" title={t("logtime.editDay")} aria-label={`${t("logtime.editDay")} ${dayName(d)}`} aria-expanded={editing === d} disabled={!on || submit.isPending} onClick={() => setEditing(editing === d ? null : d)}>
                      <EditIcon />
                    </Button>
                  </div>
                  {on && editing !== d && <p className="mt-1 text-xs text-ui-secondary break-words">{slots.map((slot) => `${slot.start}–${slot.end} ${slot.task === "main" ? t("logtime.taskMain") : t("logtime.taskKaizen")}`).join(" · ")}</p>}
                  {editing === d && (
                    <fieldset disabled={!on || submit.isPending} className="mt-2 min-w-0 space-y-2 border-0 p-0">
                      {slots.map((slot, index) => {
                        const update = (patch: Partial<TimeSlot>) => setSlots(d, slots.map((current, position) => position === index ? { ...current, ...patch } : current));
                        return (
                          <div key={index} className="grid min-w-0 grid-cols-2 gap-2">
                            <label className="min-w-0 text-xs text-ui-secondary">{t("logtime.start")}
                              <Input className="w-full min-w-0" size="sm" type="time" value={slot.start} onChange={(event) => update({ start: event.target.value })} />
                            </label>
                            <label className="min-w-0 text-xs text-ui-secondary">{t("logtime.end")}
                              <Input className="w-full min-w-0" size="sm" type="time" value={slot.end} onChange={(event) => update({ end: event.target.value })} />
                            </label>
                            <div className="min-w-0">
                              <Select size="sm" aria-label={t("logtime.task")} disabled={!on || submit.isPending} items={[{ value: "main", label: t("logtime.taskMain") }, { value: "kaizen", label: t("logtime.taskKaizen") }]} value={[slot.task]} onValueChange={(value) => value[0] && update({ task: value[0] as TimeSlot["task"] })} />
                            </div>
                            <div className="flex justify-end">
                              <Button size="sm" variant="ghost" color="danger" title={t("common.remove")} aria-label={t("common.remove")} onClick={() => setSlots(d, slots.filter((_, position) => position !== index))}><TrashIcon /></Button>
                            </div>
                          </div>
                        );
                      })}
                      {!valid && <p className="text-xs text-ui-error" role="alert">{t("logtime.invalidSlots")}</p>}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button size="sm" variant="ghost" leftIcon={<AddIcon />} disabled={slots.length >= 24} onClick={() => setSlots(d, [...slots, { start: "17:00", end: "18:00", task: "main" }])}>{t("logtime.addSlot")}</Button>
                        <Button size="sm" variant="ghost" color="neutral" title={t("logtime.resetDay")} aria-label={t("logtime.resetDay")} disabled={!overrides[d]} onClick={() => {
                          setOverrides((current) => {
                            const next = { ...current };
                            delete next[d];
                            return next;
                          });
                          setArmed(false);
                        }}><RefreshIcon /></Button>
                      </div>
                    </fieldset>
                  )}
                </li>
              );
            })}
          </ul>
                </section>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-ui-secondary">{t("logtime.noDupCheck")}</p>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm font-semibold text-ui-body">{t("logtime.total", { days: chosen.length, hours })}</span>
          <Button
            color={armed ? "danger" : "primary"}
            disabled={!chosen.length || missing || invalid || q.isFetching || !!q.error || from > to}
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
