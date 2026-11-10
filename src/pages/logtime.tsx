import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AddIcon, ChevronRightIcon, EditIcon, RefreshIcon, TrashIcon, WarningIcon } from "@/components/icons";
import { Button, Checkbox, Input, Tag } from "@/components/kit";
import { Select } from "@/components/Select";
import { Card, ConfirmDelete, Empty, Loader, PageHeader } from "@/components/ui";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { useSettings, useSprintPick, useSprints } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { slotHours, timeSlotsSchema } from "@/lib/timeSlots";
import type { LoggedTimeDay, TimeSlot } from "@/lib/types";

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
  const queryClient = useQueryClient();
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
  const canReadLogged = !!tt?.baseUrl && !!tt.loginName && !!settings.data?.secrets["timetracker.password"].set;
  const readiness = useQuery({
    queryKey: ["logtime-status", tt?.baseUrl, tt?.loginName, canReadLogged],
    queryFn: () => http.get<{ ready: boolean }>("/api/logtime/status"),
    enabled: enabled && canReadLogged,
    staleTime: 60_000,
    retry: false,
  });
  const logged = useQuery({
    queryKey: ["logtime-entries", from, to, tt?.baseUrl, tt?.loginName, tt?.userId],
    queryFn: () => http.get<{ days: Record<string, LoggedTimeDay> }>(`/api/logtime/entries?from=${from}&to=${to}`),
    enabled: enabled && canReadLogged && days.length > 0 && from <= to && !q.error,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const weeks = new Map<string, string[]>();
  for (const date of days) {
    const week = ymd(monday(new Date(`${date}T00:00:00`)));
    const group = weeks.get(week) ?? [];
    group.push(date);
    weeks.set(week, group);
  }
  const chosen = days.filter((d) => !skipped.has(d));
  const loggedSlotsFor = (date: string): TimeSlot[] | undefined => {
    const entries = logged.data?.days[date]?.entries;
    if (!tt || !entries?.length) return undefined;
    const slots: TimeSlot[] = [];
    for (const entry of entries) {
      const task = entry.workItemId === tt.mainTaskId ? "main" : entry.workItemId === tt.kaizenTaskId ? "kaizen" : null;
      if (!task) return undefined;
      slots.push({ start: entry.start, end: entry.end, task });
    }
    return slots;
  };
  const slotsFor = (date: string) => overrides[date] ?? loggedSlotsFor(date) ?? q.data?.slots ?? [];
  const plannedSlotsFor = (date: string) => overrides[date] ?? q.data?.slots ?? [];
  const hoursFor = (date: string) => timeSlotsSchema.safeParse(slotsFor(date)).success ? slotHours(slotsFor(date)) : 0;
  const plannedHoursFor = (date: string) => {
    const slots = plannedSlotsFor(date);
    return timeSlotsSchema.safeParse(slots).success ? slotHours(slots) : 0;
  };
  const invalid = chosen.some((date) => !timeSlotsSchema.safeParse(slotsFor(date)).success);
  const hours = Math.round(chosen.reduce((total, date) => total + hoursFor(date), 0) * 100) / 100;
  const setSlots = (date: string, slots: TimeSlot[]) => {
    setOverrides((current) => ({ ...current, [date]: slots }));
    setArmed(false);
  };
  const toggleEditing = (date: string) => setEditing((current) => current === date ? null : date);

  const submit = useMutation({
    mutationFn: () => http.post<{ days: number; entries: number; hours: number }>("/api/logtime/submit", {
      dates: chosen,
      overrides: Object.fromEntries(chosen.map((date) => [date, slotsFor(date)])),
    }),
    onSuccess: (res) => {
      setArmed(false);
      toast.success(t("logtime.done", { days: res.days, hours: res.hours }));
      void queryClient.invalidateQueries({ queryKey: ["logtime-entries"] });
    },
    onError: (e) => {
      setArmed(false);
      toast.fromError(t("logtime.failed"), e);
    },
  });
  const deleteEntries = useMutation({
    mutationFn: (ids: string[]) => http.del<{ deleted: number }>(`/api/logtime/entries?ids=${encodeURIComponent(ids.join(","))}`),
    onSuccess: ({ deleted }) => {
      toast.success(t("logtime.deleteDone", { n: deleted }));
    },
    onError: (e) => toast.fromError(t("logtime.deleteFailed"), e),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["logtime-entries"] });
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
  const ready = canReadLogged && !readiness.error && readiness.data?.ready === true;

  return (
    <>
      <PageHeader
        title={t("nav.logtime")}
        subtitle={t("logtime.subtitle")}
        actions={
          <>
            {!readiness.isFetching && (
            <span role="status" aria-live="polite" title={readiness.error?.message ?? (!canReadLogged ? t("logtime.notSetUp") : t("logtime.checkReady"))}>
              <Tag size="md" className="!h-9 !px-4 !text-base !font-semibold" color={ready ? "green" : "orange"}>
                {ready ? t("logtime.ready") : t("logtime.notConnected")}
              </Tag>
            </span>
            )}
            <Button size="sm" variant="ghost" color="neutral" title={t("logtime.checkReady")} aria-label={t("logtime.checkReady")} leftIcon={<RefreshIcon />} loading={readiness.isFetching} disabled={!canReadLogged} onClick={() => void readiness.refetch()} />
          </>
        }
      />
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
            <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ui-secondary">
              {tt.slots.map((s) => `${s.start}–${s.end} ${s.task === "main" ? t("logtime.taskMain") : t("logtime.taskKaizen")}`).join(" · ")}
            </span>
              <Button size="sm" variant="ghost" color="neutral" title={t("logtime.refreshLogged")} aria-label={t("logtime.refreshLogged")} loading={logged.isFetching} disabled={!canReadLogged || !days.length || from > to} onClick={() => void logged.refetch()}><RefreshIcon /></Button>
            </div>
          )
        }
      >
        {q.isLoading && <Loader />}
        {q.error && <p className="text-sm text-ui-error">{(q.error as Error).message}</p>}
        {logged.error && <p className="mb-3 text-sm text-ui-error" role="alert">{t("logtime.loggedFailed")}: {logged.error.message}</p>}
        {from > to && <p className="text-sm text-ui-error">{t("logtime.badRange")}</p>}
        {q.data && !days.length && <p className="text-sm text-ui-secondary">{t("logtime.noDays")}</p>}
        {days.length > 0 && (
          <div className="space-y-8">
            {[...weeks].map(([week, weekDays]) => {
              const selected = weekDays.filter((date) => !skipped.has(date));
              const weekHours = Math.round(selected.reduce((total, date) => total + plannedHoursFor(date), 0) * 100) / 100;
              const weekLoggedMinutes = !logged.error && weekDays.every((date) => logged.data?.days[date])
                ? weekDays.reduce((total, date) => total + (logged.data?.days[date]?.minutes ?? 0), 0)
                : null;
              const weekMatchesPlan = weekLoggedMinutes !== null
                && selected.every((date) => timeSlotsSchema.safeParse(plannedSlotsFor(date)).success)
                && Math.abs(weekLoggedMinutes - weekHours * 60) < 0.5;
              const formatDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
              const weekTitle = t("logtime.weekRange", { from: formatDate(weekDays[0]), to: formatDate(weekDays[weekDays.length - 1]) });
              return (
                <section key={week} aria-labelledby={`week-${week}`} className="border-t border-ui-border pt-6 first:border-t-0 first:pt-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-l-4 border-ui-brand bg-ui-surface px-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        size="sm"
                        aria-label={`${t("logtime.selectWeek")} ${weekTitle}`}
                        title={`${t("logtime.selectWeek")} ${weekTitle}`}
                        checked={selected.length === weekDays.length}
                        indeterminate={selected.length > 0 && selected.length < weekDays.length}
                        disabled={submit.isPending}
                        onChange={(event) => {
                          const next = new Set(skipped);
                          for (const date of weekDays) {
                            if (event.target.checked) next.delete(date);
                            else next.add(date);
                          }
                          setSkipped(next);
                          setArmed(false);
                        }}
                      />
                      <h3 id={`week-${week}`} className="text-sm font-semibold text-ui-heading">{weekTitle}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
                      <span className="font-medium text-ui-body">{t("logtime.planned")}: {t("logtime.total", { days: selected.length, hours: weekHours })}</span>
                      <span className={`font-semibold ${weekLoggedMinutes === null ? "text-ui-secondary" : weekMatchesPlan ? "text-ui-success-dark" : "text-ui-warning-dark"}`}>
                        {logged.isFetching && !logged.data
                          ? t("logtime.loadingLogged")
                          : weekLoggedMinutes === null
                            ? t("logtime.loggedUnavailable")
                            : t("logtime.loggedHours", { hours: (weekLoggedMinutes / 60).toFixed(2) })}
                      </span>
                    </div>
                  </div>
          <ul className="m-0 grid list-none items-start gap-2 p-0 lg:grid-cols-2">
            {weekDays.map((d) => {
              const on = !skipped.has(d);
              const slots = slotsFor(d);
              const valid = timeSlotsSchema.safeParse(slots).success;
              const loggedDay = logged.data?.days[d];
              const plannedSlots = plannedSlotsFor(d);
              const plannedValid = timeSlotsSchema.safeParse(plannedSlots).success;
              const configuredSlots = q.data?.slots ?? [];
              const configuredValid = timeSlotsSchema.safeParse(configuredSlots).success;
              const configuredMinutes = configuredValid ? Math.round(slotHours(configuredSlots) * 60) : 0;
              const coveredMinutes = overrides[d] && plannedValid ? Math.round(slotHours(plannedSlots) * 60) : loggedDay?.minutes;
              const difference = loggedDay && configuredValid && coveredMinutes !== undefined ? configuredMinutes - coveredMinutes : 0;
              const differenceHours = String(Math.round(Math.abs(difference) / 60 * 100) / 100);
              const needsAttention = on && configuredValid && plannedValid && !!loggedDay && !logged.error && Math.abs(difference) >= 0.5;
              return (
                <li key={d} className={`min-w-0 rounded-md border px-3 py-2 text-sm ${needsAttention ? "border-ui-warning bg-ui-warning-surface" : on ? "border-ui-brand-soft bg-ui-brand-surface" : "border-ui-border bg-ui-raised text-ui-secondary"}`}>
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
                      <Tag size="sm" color={!valid && slots.length > 0 ? "red" : needsAttention ? "orange" : "primary"}>
                        {slots.length === 0 ? "0h" : valid ? `${Math.round(slotHours(slots) * 100) / 100}h` : t("logtime.invalid")}
                      </Tag>
                    ) : (
                      <Tag size="sm" color="neutral">
                        {t("logtime.dayOff")}
                      </Tag>
                    )}
                    <Button size="sm" variant="ghost" color="neutral" title={t("logtime.editDay")} aria-label={`${t("logtime.editDay")} ${dayName(d)}`} aria-expanded={editing === d} disabled={!on || submit.isPending || (canReadLogged && logged.isFetching && !logged.data)} onClick={() => toggleEditing(d)}>
                      <EditIcon />
                    </Button>
                  </div>
                  {needsAttention && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-ui-warning-dark" role="status">
                      <WarningIcon size={14} className="shrink-0" />
                      {t(difference > 0 ? "logtime.loggedShort" : "logtime.loggedOver", { hours: differenceHours })}
                    </p>
                  )}
                  {on && editing !== d && <p className="mt-1 text-xs text-ui-secondary break-words"><span className="font-medium">{t("logtime.planned")}: </span>{slots.map((slot) => `${slot.start}–${slot.end} ${slot.task === "main" ? t("logtime.taskMain") : t("logtime.taskKaizen")}`).join(" · ")}</p>}
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
                          setOverrides((current) => ({ ...current, [d]: loggedSlotsFor(d) ?? q.data?.slots ?? [] }));
                          setArmed(false);
                        }}><RefreshIcon /></Button>
                      </div>
                    </fieldset>
                  )}
                  <div className="mt-2 border-t border-ui-border pt-2">
                    {logged.isFetching && !logged.data ? (
                      <p className="text-xs text-ui-secondary" role="status">{t("logtime.loadingLogged")}</p>
                    ) : logged.error || !loggedDay ? (
                      <p className="text-xs text-ui-secondary">{t("logtime.loggedUnavailable")}</p>
                    ) : loggedDay.entries.length === 0 ? (
                      <p className={`text-xs ${needsAttention ? "font-medium text-ui-warning-dark" : "text-ui-secondary"}`}>{t("logtime.notLogged")}</p>
                    ) : (
                      <div className="flex min-w-0 items-start gap-1">
                        <details className="group min-w-0 flex-1 border-l-2 border-ui-warning bg-ui-warning-surface px-3 py-2">
                          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5 text-xs text-ui-warning-dark [&::-webkit-details-marker]:hidden">
                            <ChevronRightIcon className="shrink-0 transition-transform group-open:rotate-90" />
                            <span className="font-semibold">{t("logtime.loggedHours", { hours: (loggedDay.minutes / 60).toFixed(2) })}</span>
                            <span className="text-ui-secondary">{t("logtime.loggedEntries", { n: loggedDay.entries.length })}</span>
                          </summary>
                          <ul className="mt-2 space-y-2">
                            {loggedDay.entries.map((entry) => (
                              <li key={entry.id} className="min-w-0 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-1 text-ui-body">
                                  <span className="font-medium tabular-nums">{entry.start} - {entry.end}</span>
                                  <span className="flex items-center gap-1">
                                    {t("logtime.entryHours", { hours: (entry.minutes / 60).toFixed(2) })}{entry.isLocked ? ` · ${t("logtime.locked")}` : ""}
                                    <ConfirmDelete iconOnly label={t("logtime.deleteEntry")} disabled={entry.isLocked || deleteEntries.isPending} onConfirm={() => deleteEntries.mutate([entry.id])} />
                                  </span>
                                </div>
                                <p className="break-words text-ui-body">{entry.workItemName} <span className="text-ui-secondary">#{entry.workItemId}</span></p>
                                <p className="break-words text-ui-secondary">{entry.projectName}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                        {!!loggedDay.entries.some((entry) => !entry.isLocked) && (
                          <ConfirmDelete iconOnly label={t("logtime.deleteDayEntries")} disabled={deleteEntries.isPending || submit.isPending} onConfirm={() => deleteEntries.mutate(loggedDay.entries.filter((entry) => !entry.isLocked).map((entry) => entry.id))} />
                        )}
                      </div>
                    )}
                  </div>
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
