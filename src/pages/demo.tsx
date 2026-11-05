import { Button, Checkbox, Input, Spinner, Tag, Textarea } from "@/components/kit";
import { AddIcon, ArrowDownIcon, ArrowUpIcon, DownloadIcon, DragIcon, EyeIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, ConfirmDelete, Counter, Empty, Field, JobProgress, PageHeader, ReloadButton, StatusTag } from "@/components/ui";
import DemoRecorder, { useRecOptions } from "@/features/DemoRecorder";
import SprintPicker from "@/features/SprintPicker";
import { http } from "@/lib/client";
import { trackJob, useLatestOfKind } from "@/lib/jobTracker";
import { Select } from "@/components/Select";
import { useT } from "@/lib/i18n";
import { useSettings, useSprintPick, useSprints, useSprintTickets } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { BuildMeta, DemoDraft, DemoStory, JobState, TemplateMeta } from "@/lib/types";

const TAGS = ["IMPROVEMENT", "NEW FEATURE", "BUG FIX"];

function useDraft() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["draft"], queryFn: () => http.get<{ draft: DemoDraft; script: string }>("/api/demo/draft"), refetchOnMount: "always" });
  const [local, setLocal] = useState<DemoDraft | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (q.data && !dirty.current) setLocal(q.data.draft);
  }, [q.data]);

  const update = useCallback(
    (fn: (d: DemoDraft) => DemoDraft) => {
      setLocal((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        setSaving("saving");
        timer.current = setTimeout(() => {
          http
            .put<{ draft: DemoDraft; script: string }>("/api/demo/draft", next)
            .then((r) => {
              dirty.current = false;
              qc.setQueryData(["draft"], r);
              setSaving("saved");
            })
            .catch((e) => {
              setSaving("idle");
              toast.fromError("Save failed", e);
            });
        }, 700);
        return next;
      });
    },
    [qc],
  );
  const reload = () => {
    dirty.current = false;
    return qc.invalidateQueries({ queryKey: ["draft"] });
  };
  return { draft: local, script: q.data?.script ?? "", update, saving, reload, loading: q.isLoading };
}

function StoryCard({
  story,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  onRedraft,
  onBuildOne,
  busy,
  dragProps,
}: {
  story: DemoStory;
  index: number;
  total: number;
  onChange: (s: DemoStory) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onRedraft: () => void;
  onBuildOne: () => void;
  busy: boolean;
  dragProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(index === 0);
  const set = (p: Partial<DemoStory>) => onChange({ ...story, ...p });
  const sc = story.scenarios;
  const setScenario = (i: number, p: Partial<DemoStory["scenarios"][number]>) => set({ scenarios: sc.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const issues = [
    story.title.length > 70 && t("demo.issueTitle"),
    story.why.trim().split(/\s+/).filter(Boolean).length > 45 && t("demo.issueWhy"),
    (sc.length < 2 || sc.length > 6) && t("demo.issueScenarios"),
    sc.some((x) => x.name.length > 60) && t("demo.issueScenarioName"),
  ].filter(Boolean) as string[];

  return (
    <div className="bg-white border border-ui-border rounded-lg" {...dragProps}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ui-border">
        <span className="cursor-grab text-ui-muted [&_svg]:w-4 [&_svg]:h-4" title={t("demo.drag")} aria-hidden>
          <DragIcon />
        </span>
        <span className="text-xs font-semibold text-ui-secondary w-5">{index + 1}</span>
        <button type="button" className="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="font-semibold text-ui-brand mr-2">{story.key}</span>
          <span className="text-sm">{story.title}</span>
        </button>
        {issues.length > 0 && <Tag size="sm" color="orange" variant="light">{t("demo.issues", { n: issues.length })}</Tag>}
        <Tag size="sm" color="neutral" variant="light">{story.status}</Tag>
        <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t("demo.moveUp")}>
          <ArrowUpIcon />
        </Button>
        <Button size="sm" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={t("demo.moveDown")}>
          <ArrowDownIcon />
        </Button>
        <ConfirmDelete iconOnly label={t("demo.removeStory")} onConfirm={onRemove} />
      </div>
      {open && (
        <div className="p-4 space-y-4">
          {issues.length > 0 && (
            <ul className="text-xs text-ui-warning-dark bg-ui-warning-surface/50 rounded-md px-3 py-2 pl-6">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <div className="grid md:grid-cols-[1fr_180px_180px] gap-3">
            <Field label={t("demo.title")} hint={<Counter value={story.title} max={70} />}>
              <Input size="sm" fullWidth value={story.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label={t("demo.tag")}>
              <Select size="sm" items={[...new Set([...TAGS, story.tag])].map((v) => ({ label: v, value: v }))} value={[story.tag]} onValueChange={(v) => v[0] && set({ tag: v[0] })} />
            </Field>
            <Field label={t("demo.badge")} hint={t("demo.badgeHint")}>
              <Input size="sm" fullWidth value={story.status} onChange={(e) => set({ status: e.target.value })} />
            </Field>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label={t("demo.headlineLead")}>
              <Input size="sm" fullWidth value={story.headline[0]} onChange={(e) => set({ headline: [e.target.value, story.headline[1]] })} />
            </Field>
            <Field label={t("demo.headlineRest")}>
              <Input size="sm" fullWidth value={story.headline[1]} onChange={(e) => set({ headline: [story.headline[0], e.target.value] })} />
            </Field>
          </div>
          <Field label={t("demo.purpose")}>
            <Textarea size="sm" fullWidth minRows={2} value={story.purpose} onChange={(e) => set({ purpose: e.target.value })} />
          </Field>
          <Field label={t("demo.why")} hint={<Counter value={story.why} max={45} unit="words" />}>
            <Textarea size="sm" fullWidth minRows={3} value={story.why} onChange={(e) => set({ why: e.target.value })} />
          </Field>
          <Field label={t("demo.improving")}>
            <Textarea size="sm" fullWidth minRows={2} value={story.improving} onChange={(e) => set({ improving: e.target.value })} />
          </Field>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium">{t("demo.scenarios", { n: sc.length })}</span>
              <Button size="sm" variant="ghost" leftIcon={<AddIcon />} disabled={sc.length >= 6} onClick={() => set({ scenarios: [...sc, { name: "", steps: [] }] })}>
                {t("demo.addScenario")}
              </Button>
            </div>
            <div className="space-y-3">
              {sc.map((x, i) => (
                <div key={i} className="border border-ui-border rounded-md p-3 bg-ui-surface/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ui-secondary shrink-0">{t("demo.scenarioN", { n: i + 1 })}</span>
                    <Input size="sm" fullWidth value={x.name} onChange={(e) => setScenario(i, { name: e.target.value })} />
                    <Counter value={x.name} max={60} />
                    <Button size="sm" variant="ghost" color="danger" disabled={sc.length <= 2} onClick={() => set({ scenarios: sc.filter((_, j) => j !== i) })} aria-label={t("common.remove")}>
                      <TrashIcon />
                    </Button>
                  </div>
                  <Textarea
                    size="sm"
                    fullWidth
                    minRows={3}
                    className="mt-2"
                    placeholder={t("demo.stepsPlaceholder")}
                    value={x.steps.join("\n")}
                    onChange={(e) => setScenario(i, { steps: e.target.value.split("\n") })}
                    onBlur={(e) => setScenario(i, { steps: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              ))}
            </div>
          </div>
          <Field label={t("demo.testIds")} hint={t("demo.testIdsHint")}>
            <Textarea size="sm" fullWidth minRows={2} value={story.testIds} onChange={(e) => set({ testIds: e.target.value })} />
          </Field>
          <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-ui-border">
            <ConfirmDelete label={t("demo.removeStory")} onConfirm={onRemove} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" leftIcon={<RefreshIcon />} disabled={busy} onClick={onRedraft}>
                {t("demo.redraft")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={onBuildOne}>
                {t("demo.buildOne")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BuildResult({ meta, onPdf, pdfJob }: { meta: BuildMeta; onPdf: () => void; pdfJob: JobState | undefined }) {
  const { t } = useT();
  const file = (name: string, inline = false) => `/api/demo/builds/${meta.id}/file?name=${name}${inline ? "&inline=1" : ""}`;
  return (
    <div className="space-y-3">
      <div className={`rounded-md px-3 py-2 text-sm ${meta.check.ok ? "bg-ui-success-surface text-ui-primary" : "bg-ui-warning-surface/60 text-ui-warning-dark"}`}>
        {meta.check.ok ? `✓ ${t("demo.checkOk", { n: meta.storyKeys.length })}` : t("demo.checkIssues")}
        {!meta.check.ok && (
          <ul className="pl-5 mt-1">
            {meta.check.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" component="a" href={file("deck.pptx")} leftIcon={<DownloadIcon />}>
          {t("demo.downloadDeck")}
        </Button>
        <Button size="sm" variant="outline" component="a" href={file("script.md")} leftIcon={<DownloadIcon />}>
          {t("demo.downloadScript")}
        </Button>
        {!meta.hasPdf && (
          <Button size="sm" variant="outline" leftIcon={<EyeIcon />} loading={pdfJob?.status === "running"} onClick={onPdf}>
            {t("demo.previewPdf")}
          </Button>
        )}
      </div>
      {pdfJob?.status === "error" && <p className="text-xs text-ui-error whitespace-pre-wrap">{pdfJob.error}</p>}
      {meta.hasPdf && <iframe title={t("demo.previewPdf")} src={file("deck.pdf", true)} className="w-full h-[640px] border border-ui-border rounded-md bg-white" />}
      <p className="text-xs text-ui-secondary">{t("demo.screenshotsReminder")}</p>
    </div>
  );
}

export default function DemoPage() {
  const { t } = useT();
  const qc = useQueryClient();
  const { sprintId } = useSprintPick();
  const sprints = useSprints();
  const sprint = sprints.data?.find((s) => s.id === sprintId);
  const tickets = useSprintTickets(sprintId);
  const tpls = useQuery({ queryKey: ["templates"], queryFn: () => http.get<{ templates: TemplateMeta[]; activeId: string }>("/api/demo/templates") });
  const py = useQuery({ queryKey: ["python"], queryFn: () => http.get<{ ready: boolean; message: string }>("/api/demo/python") });
  const builds = useQuery({ queryKey: ["builds"], queryFn: () => http.get<BuildMeta[]>("/api/demo/builds"), refetchOnMount: "always" });
  const { draft, script, update, saving, reload, loading } = useDraft();
  const settings = useSettings();
  const recording = !!settings.data?.features.recording;
  const recShots = useRecOptions((o) => o.shots);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<BuildMeta | null>(null);
  const [showScript, setShowScript] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const draftT = useLatestOfKind("demo-draft");
  const buildT = useLatestOfKind<BuildMeta>("demo-build");
  const pdfT = useLatestOfKind("demo-pdf");
  const draftJob = { data: draftT.job };
  const buildJob = { data: buildT.job };
  const pdfJob = { data: pdfT.job };
  const pdfFor = pdfT.tracked?.keys[0] ?? null;

  const active = tpls.data?.templates.find((x) => x.id === tpls.data?.activeId);
  const storyTickets = (tickets.data ?? []).filter((x) => !x.subtask && /^(user )?story$/i.test(x.type));
  const inDraft = new Set(draft?.sprintId === sprintId ? draft.stories.map((s) => s.key) : []);

  // JobWatcher refreshes the queries and toasts; the draft editor also drops its local copy so new stories show up.
  useEffect(() => {
    if (draftJob.data && draftJob.data.status !== "running") void reload();
  }, [draftJob.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const built = buildJob.data?.status === "done" ? buildJob.data.result : undefined;
  const base = picked ?? built ?? null;
  const current = base && pdfFor === base.id && pdfJob.data?.status === "done" ? { ...base, hasPdf: true } : base;

  const runDraft = (keys: string[]) =>
    http
      .post<JobState>("/api/demo/draft/run", { keys, sprintId, sprintName: sprint?.name ?? "" })
      .then((j) => trackJob("demo-draft", keys, j))
      .catch((e) => toast.fromError(t("demo.draftFailed"), e));
  const runBuild = (keys: string[] | null) => {
    setPicked(null);
    http
      .post<JobState>("/api/demo/build", { keys, screenshots: recording && recShots })
      .then((j) => trackJob("demo-build", keys ?? stories.map((s) => s.key), j))
      .catch((e) => toast.fromError(t("demo.buildFailed"), e));
  };
  const runPdf = (id: string) =>
    http
      .post<JobState>(`/api/demo/builds/${id}/pdf`)
      .then((j) => trackJob("demo-pdf", [id], j))
      .catch((e) => toast.fromError(t("common.failed"), e));

  const removeBuild = (id: string) =>
    http
      .del<BuildMeta[]>(`/api/demo/builds/${id}`)
      .then((list) => {
        qc.setQueryData(["builds"], list);
        if (current?.id === id) setPicked(null);
        toast.success(t("demo.buildDeleted"));
      })
      .catch((e) => toast.fromError(t("common.failed"), e));

  const busy = draftJob.data?.status === "running" || buildJob.data?.status === "running";
  const stories = draft?.stories ?? [];
  const otherSprint = draft && draft.sprintId !== null && draft.sprintId !== sprintId && stories.length > 0;

  return (
    <>
      <PageHeader
        title={t("nav.demo")}
        subtitle={t("demo.subtitle")}
        actions={
          <>
            <SprintPicker />
            <ReloadButton keys={["sprints", "sprint", "draft", "templates", "python", "builds"]} />
          </>
        }
      />

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card title={t("demo.template")} actions={<Link href="/settings#template" className="text-xs">{t("demo.manage")}</Link>}>
          {active ? (
            <div className="text-sm">
              <div className="font-semibold">{active.name}</div>
              <div className="text-xs text-ui-secondary mt-1">
                {active.inspect.ok ? t("demo.templateOk", { p: active.inspect.purposeTemplate ?? "?", d: active.inspect.demoTemplate ?? "?" }) : active.inspect.error}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ui-warning-dark">{t("demo.noTemplate")}</p>
          )}
          {py.data && !py.data.ready && <p className="text-xs text-ui-warning-dark mt-2">{t("tpl.pythonMissing", { msg: py.data.message })}</p>}
        </Card>
        <Card title={t("demo.glanceTitle")}>
          <Input
            size="sm"
            fullWidth
            disabled={!draft}
            value={draft?.glanceTitle ?? ""}
            placeholder={sprint ? `${sprint.name} at a glance` : ""}
            onChange={(e) => update((d) => ({ ...d, glanceTitle: e.target.value }))}
          />
          <p className="text-xs text-ui-secondary mt-2">{t("demo.glanceHint")}</p>
        </Card>
      </div>

      <Card
        className="mb-4"
        title={t("demo.pickTickets")}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={busy || !storyTickets.length} onClick={() => runDraft(storyTickets.map((x) => x.key))}>
              {t("demo.draftAll")}
            </Button>
            <Button size="sm" disabled={busy || !pick.size} onClick={() => runDraft([...pick])}>
              {t("demo.draftSelected", { n: pick.size })}
            </Button>
          </>
        }
      >
        {tickets.isLoading && <Spinner size="sm" />}
        {!tickets.isLoading && !storyTickets.length && <Empty>{t("sprint.empty")}</Empty>}
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 max-h-72 overflow-auto">
          {storyTickets.map((x) => (
            <label key={x.key} className="flex items-center gap-2 text-sm py-1 cursor-pointer min-w-0">
              <Checkbox
                size="sm"
                checked={pick.has(x.key)}
                onChange={(e) =>
                  setPick((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(x.key);
                    else n.delete(x.key);
                    return n;
                  })
                }
              />
              <span className="font-semibold text-ui-brand shrink-0">{x.key}</span>
              <span className="truncate">{x.summary}</span>
              <span className="shrink-0">
                <StatusTag status={x.status} category={x.statusCategory} />
              </span>
              {inDraft.has(x.key) && <span className="shrink-0 whitespace-nowrap"><Tag size="sm" color="primary" variant="light">{t("demo.inDraft")}</Tag></span>}
            </label>
          ))}
        </div>
        {draftT.tracked && draftJob.data && (
          <div className="mt-3">
            <JobProgress job={draftJob.data} showItems />
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[15px] font-semibold text-ui-heading">
          {t("demo.draft", { n: stories.length })}{" "}
          <span className="text-xs font-normal text-ui-secondary">{saving === "saving" ? t("demo.saving") : saving === "saved" ? t("demo.saved") : ""}</span>
        </h2>
        <div className="flex gap-2">
          {stories.length > 0 && (
            <ConfirmDelete label={t("demo.clearDraft")} disabled={busy} onConfirm={() => update((d) => ({ ...d, stories: [] }))} />
          )}
          <Button size="sm" variant="outline" disabled={!stories.length} onClick={() => setShowScript(!showScript)}>
            {showScript ? t("demo.hideScript") : t("demo.showScript")}
          </Button>
          <Button size="sm" disabled={busy || !stories.length || !active?.inspect.ok} onClick={() => runBuild(null)}>
            {t("demo.buildAll")}
          </Button>
        </div>
      </div>
      {otherSprint && <p className="text-xs text-ui-warning-dark mb-2">{t("demo.otherSprint", { name: draft.sprintName })}</p>}
      {recording && stories.length > 0 && (
        <div className="mb-4">
          <DemoRecorder stories={stories} />
        </div>
      )}
      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
        <div className="space-y-3 min-w-0">
          {loading && <Spinner />}
          {!loading && !stories.length && (
            <Card>
              <Empty>{t("demo.noDraft")}</Empty>
            </Card>
          )}
          {stories.map((s, i) => (
            <StoryCard
              key={s.key}
              story={s}
              index={i}
              total={stories.length}
              busy={busy}
              onChange={(ns) => update((d) => ({ ...d, stories: d.stories.map((x) => (x.key === ns.key ? ns : x)) }))}
              onMove={(dir) =>
                update((d) => {
                  const arr = [...d.stories];
                  [arr[i], arr[i + dir]] = [arr[i + dir], arr[i]];
                  return { ...d, stories: arr };
                })
              }
              onRemove={() => update((d) => ({ ...d, stories: d.stories.filter((x) => x.key !== s.key) }))}
              onRedraft={() => runDraft([s.key])}
              onBuildOne={() => runBuild([s.key])}
              dragProps={{
                draggable: true,
                onDragStart: () => (dragFrom.current = i),
                onDragOver: (e) => e.preventDefault(),
                onDrop: () => {
                  const from = dragFrom.current;
                  dragFrom.current = null;
                  if (from === null || from === i) return;
                  update((d) => {
                    const arr = [...d.stories];
                    const [m] = arr.splice(from, 1);
                    arr.splice(i, 0, m);
                    return { ...d, stories: arr };
                  });
                },
              }}
            />
          ))}
        </div>
        <div className="space-y-4">
          {(buildT.tracked || current) && (
            <Card title={t("demo.build")}>
              {buildJob.data?.status === "running" && <JobProgress job={buildJob.data} />}
              {current && <BuildResult meta={current} onPdf={() => runPdf(current.id)} pdfJob={pdfJob.data} />}
            </Card>
          )}
          {showScript && (
            <Card title={t("demo.scriptPreview")}>
              <pre className="text-xs whitespace-pre-wrap font-mono max-h-[560px] overflow-auto text-ui-body">{script}</pre>
            </Card>
          )}
          <Card title={t("demo.history")}>
            {!builds.data?.length && <p className="text-sm text-ui-secondary">{t("demo.noBuilds")}</p>}
            <ul className="list-none p-0 space-y-2">
              {builds.data?.slice(0, 10).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                  <button type="button" className="text-left bg-transparent border-0 p-0 cursor-pointer min-w-0" onClick={() => setPicked(b)}>
                    <div className="font-medium truncate">
                      {b.sprintName || "—"} · {b.storyKeys.length} {t("demo.stories")}
                    </div>
                    <div className="text-xs text-ui-secondary">
                      {new Date(b.createdAt).toLocaleString()} · {b.templateName}
                    </div>
                  </button>
                  <span className="flex items-center gap-1 shrink-0">
                    {b.check.ok ? <Tag size="sm" color="green" variant="light">OK</Tag> : <Tag size="sm" color="orange" variant="light">{b.check.issues.length}</Tag>}
                    <ConfirmDelete iconOnly label={t("demo.deleteBuild")} onConfirm={() => removeBuild(b.id)} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
