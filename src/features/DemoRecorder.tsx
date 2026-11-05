import { Button, Checkbox, Drawer, DrawerBody, DrawerHeader, Input, Segmented, SegmentedItem, Spinner, Tag, Textarea, Toggle } from "@/components/kit";
import { DownloadIcon, RefreshIcon } from "@/components/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { create } from "zustand";
import { Card, ConfirmDelete, JobProgress } from "@/components/ui";
import FlowEditor from "@/features/FlowEditor";
import { http } from "@/lib/client";
import { useT } from "@/lib/i18n";
import { trackJob, useLatestOfKind, useTrackedFor } from "@/lib/jobTracker";
import { toast } from "@/lib/toast";
import type { DemoFlow, DemoStory, FlowAction, FlowFile, JobState, RecordingManifest } from "@/lib/types";

interface RecStatus {
  enabled: boolean;
  appUrl: string;
  browser: { kind: "chrome" | "chromium"; ready: boolean; chrome: boolean };
  ffmpeg: boolean;
  session: { saved: boolean; savedAt: string | null; loginOpen: boolean };
  tts: { provider: string; configured: boolean; effective: "openai" | "elevenlabs" | "macos" | null; fallback: boolean; macVoice: string };
  stories: Record<string, { flow: FlowFile | null; placeholders: string[]; recording: RecordingManifest | null }>;
}

interface RecOptions {
  shots: boolean;
  video: boolean;
  voice: boolean;
  set: (patch: Partial<Omit<RecOptions, "set">>) => void;
}

const STORE = "dd.recOptions";
function loadOptions(): Pick<RecOptions, "shots" | "video" | "voice"> {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { shots: true, video: true, voice: false, ...JSON.parse(raw) };
  } catch {
    /* private mode */
  }
  return { shots: true, video: true, voice: false };
}

/** The per-run toggles; the build step reads `shots` to decide whether screenshots go on the slides. */
export const useRecOptions = create<RecOptions>((set, get) => ({
  ...(typeof window === "undefined" ? { shots: true, video: true, voice: false } : loadOptions()),
  set: (patch) => {
    set(patch);
    const { shots, video, voice } = get();
    try {
      localStorage.setItem(STORE, JSON.stringify({ shots, video, voice }));
    } catch {
      /* private mode */
    }
  },
}));

export function useRecStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["rec"],
    queryFn: () => http.get<RecStatus>("/api/demo/rec"),
    enabled,
    refetchInterval: (q) => (q.state.data?.session.loginOpen ? 3000 : false),
  });
}

const fileUrl = (key: string, name: string, extra = "") => `/api/demo/rec/${key}/file?name=${encodeURIComponent(name)}${extra}`;

function describe(a: FlowAction): string {
  const tgt = a.target ? `${a.target.by}${a.target.by === "role" ? `:${a.target.value}` : ""} “${a.target.by === "role" ? a.target.name : a.target.value}”${a.target.nth ? ` #${a.target.nth + 1}` : ""}` : "";
  const val = a.value ? ` ${a.type === "fill" || a.type === "select" ? `= “${a.value}”` : a.value}` : "";
  return `${a.type} ${tgt}${val}`.replace(/\s+/g, " ").trim();
}

function FlowDrawer({ story, file, onClose }: { story: DemoStory; file: FlowFile; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"view" | "edit" | "json">("view");
  const [flow, setFlow] = useState<DemoFlow>(file.flow);
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState("");
  const [approved, setApproved] = useState(file.approved);
  const [saving, setSaving] = useState(false);
  const readJson = (): DemoFlow | null => {
    try {
      const f = JSON.parse(text) as DemoFlow;
      setParseError("");
      return f;
    } catch (e) {
      setParseError((e as Error).message);
      return null;
    }
  };
  const switchTo = (next: "view" | "edit" | "json") => {
    if (next === mode) return;
    if (mode === "json") {
      const f = readJson();
      if (!f) return; // stay in JSON until it parses
      setFlow(f);
    }
    if (next === "json") setText(JSON.stringify(flow, null, 2));
    setMode(next);
  };
  const save = async () => {
    const toSave = mode === "json" ? readJson() : flow;
    if (!toSave) return;
    setSaving(true);
    try {
      await http.put(`/api/demo/rec/flow/${story.key}`, { flow: toSave, approved });
      await qc.invalidateQueries({ queryKey: ["rec"] });
      toast.success(t("rec.flowSaved"));
      onClose();
    } catch (e) {
      toast.fromError(t("common.failed"), e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} placement="right" className="!w-[760px] !max-w-full">
      <DrawerHeader>
        <div className="min-w-0 pr-6">
          <div className="text-xs font-semibold text-ui-brand">{story.key}</div>
          <h2 className="text-base font-semibold text-ui-primary m-0">{t("rec.flowTitle")}</h2>
          <div className="text-xs text-ui-secondary">{t("rec.flowGenerated", { at: new Date(file.generatedAt).toLocaleString() })}</div>
        </div>
      </DrawerHeader>
      <DrawerBody className="flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto pb-4 space-y-4">
          {flow.notes.length > 0 && (
            // Open while reviewing; folded while editing so the form stays in view.
            <details key={mode} open={mode === "view"} className="rounded-md bg-ui-warning-surface border border-ui-warning px-3 py-2 text-sm text-ui-warning-dark">
              <summary className="font-semibold cursor-pointer select-none">
                {t("rec.notes")} ({flow.notes.length})
              </summary>
              <ul className="m-0 mt-1 pl-5 space-y-0.5">
                {flow.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex justify-end">
            <Segmented size="sm" selectedIndex={mode === "view" ? 0 : mode === "edit" ? 1 : 2} onChange={(i) => switchTo(i === 0 ? "view" : i === 1 ? "edit" : "json")}>
              <SegmentedItem>{t("rec.viewSteps")}</SegmentedItem>
              <SegmentedItem>{t("flow.edit")}</SegmentedItem>
              <SegmentedItem>JSON</SegmentedItem>
            </Segmented>
          </div>
          {mode === "json" ? (
            <>
              <p className="text-xs text-ui-secondary m-0">{t("flow.jsonHint")}</p>
              <Textarea size="sm" fullWidth minRows={24} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
              {parseError && <p className="text-xs text-ui-error m-0">{parseError}</p>}
            </>
          ) : mode === "edit" ? (
            <FlowEditor flow={flow} onChange={setFlow} />
          ) : (
            flow.scenarios.map((sc, si) => (
              <section key={si} className="border border-ui-border rounded-md">
                <h3 className="text-sm font-semibold text-ui-heading m-0 px-3 py-2 bg-ui-surface border-b border-ui-border">
                  {si + 1}. {sc.name}
                </h3>
                <ol className="m-0 py-2 pl-8 pr-3 space-y-2 text-sm">
                  {sc.steps.map((st, ti) => (
                    <li key={ti}>
                      <div className="text-ui-body">
                        “{st.narration}” {st.screenshot && <Tag size="sm" color="blue" variant="light">📷</Tag>}
                      </div>
                      <ul className="list-none p-0 m-0 mt-0.5 space-y-0.5">
                        {st.actions.map((a, ai) => (
                          <li key={ai} className="text-[11px] font-mono text-ui-subtle">
                            → {describe(a)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </section>
            ))
          )}
        </div>
        <div className="border-t border-ui-border pt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-start gap-2 text-sm cursor-pointer max-w-md">
            <Checkbox size="sm" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            <span>{t("rec.approve")}</span>
          </label>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" loading={saving} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </span>
        </div>
      </DrawerBody>
    </Drawer>
  );
}

const humanize = (ph: string) =>
  ph
    .replace(/^TODO_/, "")
    .split("_")
    .map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");

/** IDs from the story's "Test data IDs" box, offered as one-click values. */
function testIdSuggestions(story: DemoStory): string[] {
  return story.testIds
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => /^(.+?):\s+(\S+)$/.exec(l)?.[2] ?? l)
    .filter((id) => !/^https?:/.test(id))
    .slice(0, 8);
}

function PlaceholderForm({ story, placeholders }: { story: DemoStory; placeholders: string[] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const suggestions = testIdSuggestions(story);
  const filled = placeholders.filter((p) => values[p]?.trim());
  const apply = async () => {
    setSaving(true);
    try {
      await http.post("/api/demo/rec/fill", { key: story.key, values });
      await qc.invalidateQueries({ queryKey: ["rec"] });
      setValues({});
      toast.success(t("rec.filled"));
    } catch (e) {
      toast.fromError(t("common.failed"), e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="mx-3 mb-2 rounded-md border border-ui-warning bg-ui-warning-surface px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled.length) void apply();
      }}
    >
      <div className="text-xs font-semibold text-ui-warning-dark mb-2">{t("rec.needData")}</div>
      <div className="flex flex-wrap items-end gap-3">
        {placeholders.map((p) => (
          <label key={p} className="block min-w-[200px] flex-1 max-w-[320px]">
            <span className="block text-xs text-ui-body mb-1">
              {humanize(p)} <code className="text-[10px] text-ui-secondary">{p}</code>
            </span>
            <Input size="sm" fullWidth value={values[p] ?? ""} placeholder={humanize(p)} onChange={(e) => setValues({ ...values, [p]: e.target.value })} />
            {suggestions.length > 0 && (
              <span className="flex flex-wrap gap-1 mt-1">
                {suggestions.map((sg) => (
                  <button
                    key={sg}
                    type="button"
                    onClick={() => setValues({ ...values, [p]: sg })}
                    className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-ui-border bg-white cursor-pointer hover:border-ui-brand"
                  >
                    {sg}
                  </button>
                ))}
              </span>
            )}
          </label>
        ))}
        <Button size="sm" type="submit" disabled={!filled.length} loading={saving}>
          {t("rec.fill", { n: filled.length })}
        </Button>
      </div>
      {!suggestions.length && <p className="text-[11px] text-ui-secondary mt-1.5 mb-0">{t("rec.fillHint")}</p>}
    </form>
  );
}

function StoryRow({ story, info, canRun, onRun }: { story: DemoStory; info: RecStatus["stories"][string] | undefined; canRun: boolean; onRun: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const flowJob = useTrackedFor("demo-flow", story.key);
  const recJob = useTrackedFor("demo-record", story.key);
  const flow = info?.flow ?? null;
  const rec = info?.recording ?? null;
  const missing = info?.placeholders ?? [];
  const steps = flow?.flow.scenarios.reduce((n, s) => n + s.steps.length, 0) ?? 0;
  const generate = () =>
    http
      .post<JobState>("/api/demo/rec/generate", { keys: [story.key] })
      .then((j) => trackJob("demo-flow", [story.key], j))
      .catch((e) => toast.fromError(t("rec.flowFailed"), e));
  const toggleShot = (file: string, on: boolean) => {
    if (!rec) return;
    const next = on ? [...rec.selected, file].slice(-3) : rec.selected.filter((f) => f !== file);
    http
      .put(`/api/demo/rec/${story.key}`, { selected: next })
      .then(() => qc.invalidateQueries({ queryKey: ["rec"] }))
      .catch((e) => toast.fromError(t("common.failed"), e));
  };
  const remove = () =>
    http
      .del(`/api/demo/rec/${story.key}`)
      .then(() => qc.invalidateQueries({ queryKey: ["rec"] }))
      .catch((e) => toast.fromError(t("common.failed"), e));
  const busy = flowJob.running || recJob.running;
  return (
    <li className="border border-ui-border rounded-md">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" className="w-5 bg-transparent border-0 cursor-pointer text-ui-subtle" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
        <span className="text-xs font-semibold text-ui-brand">{story.key}</span>
        <span className="text-sm text-ui-primary truncate flex-1 min-w-[120px]">{story.title}</span>
        {flow ? (
          <Tag size="sm" color={flow.approved ? "green" : "orange"} variant="light">
            {t(flow.approved ? "rec.approved" : "rec.notApproved")} · {t("rec.flowSize", { s: flow.flow.scenarios.length, n: steps })}
          </Tag>
        ) : (
          <Tag size="sm" color="neutral" variant="light">{t("rec.noFlow")}</Tag>
        )}
        {rec && (
          <Tag size="sm" color={rec.ok ? "green" : "red"} variant="light">
            {rec.ok ? t("rec.recorded", { n: rec.shots.length }) : t("rec.recordedErrors", { n: rec.errors.length })}
          </Tag>
        )}
        {busy && <Spinner size="sm" />}
        <span className="flex gap-1">
          {flow && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("rec.review")}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} leftIcon={flow ? <RefreshIcon /> : undefined} onClick={() => void generate()}>
            {flow ? t("rec.regenerate") : t("rec.generate")}
          </Button>
          <Button
            size="sm"
            disabled={busy || !canRun || !flow?.approved || missing.length > 0}
            title={missing.length ? t("rec.needData") : !flow?.approved ? t("rec.needApprove") : undefined}
            onClick={onRun}
          >
            {t("rec.run")}
          </Button>
        </span>
      </div>
      {flow && missing.length > 0 && !busy && <PlaceholderForm story={story} placeholders={missing} />}
      {(flowJob.running || recJob.running) && (
        <div className="px-3 pb-2">
          <JobProgress job={(recJob.running ? recJob.job : flowJob.job) ?? undefined} />
        </div>
      )}
      {open && (
        <div className="border-t border-ui-border p-3 space-y-3">
          {!rec && <p className="text-sm text-ui-secondary m-0">{t("rec.notRecorded")}</p>}
          {rec && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ui-secondary">
                <span>
                  {t("rec.recordedAt", { at: new Date(rec.recordedAt).toLocaleString(), s: Math.round(rec.durationMs / 1000) })}
                  {rec.voice && ` · ${t("rec.withVoice")}`}
                </span>
                <span className="flex gap-1">
                  {rec.video && (
                    <a href={fileUrl(story.key, rec.video, "&download=1")} className="no-underline">
                      <Button size="sm" variant="outline" leftIcon={<DownloadIcon />}>
                        MP4
                      </Button>
                    </a>
                  )}
                  <ConfirmDelete iconOnly label={t("rec.deleteRecording")} onConfirm={() => void remove()} />
                </span>
              </div>
              {rec.errors.length > 0 && (
                <ul className="list-none p-0 m-0 space-y-1">
                  {rec.errors.map((er, i) => (
                    <li key={i} className="text-xs text-ui-error">
                      {er.scenario >= 0 && (
                        <b>
                          {t("rec.scenario")} {er.scenario + 1}, {t("rec.step")} {er.step + 1}:{" "}
                        </b>
                      )}
                      {er.message}
                      {er.shot && (
                        <a href={fileUrl(story.key, er.shot)} target="_blank" rel="noreferrer" className="ml-1">
                          {t("rec.errorShot")}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {rec.video && (
                <video controls preload="metadata" className="w-full max-h-[420px] rounded-md bg-black" src={fileUrl(story.key, rec.video, `&v=${encodeURIComponent(rec.recordedAt)}`)} />
              )}
              {rec.shots.length > 0 && (
                <>
                  <p className="text-xs text-ui-secondary m-0">{t("rec.pickShots")}</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {rec.shots.map((s) => {
                      const on = rec.selected.includes(s.file);
                      return (
                        <label key={s.file} className={`block border rounded-md overflow-hidden cursor-pointer ${on ? "border-ui-brand ring-2 ring-ui-brand-soft" : "border-ui-border"}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={fileUrl(story.key, s.file, `&v=${encodeURIComponent(rec.recordedAt)}`)} alt={s.caption} className="w-full block" />
                          <span className="flex items-center gap-1.5 px-2 py-1 text-xs">
                            <Checkbox size="sm" checked={on} onChange={(e) => toggleShot(s.file, e.target.checked)} />
                            <span className="truncate">
                              {s.scenario + 1}. {s.caption}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
      {editing && flow && <FlowDrawer story={story} file={flow} onClose={() => setEditing(false)} />}
    </li>
  );
}

export default function DemoRecorder({ stories }: { stories: DemoStory[] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const status = useRecStatus(true);
  const opts = useRecOptions();
  const setupT = useLatestOfKind("demo-setup");
  const recordT = useLatestOfKind("demo-record");
  const s = status.data;
  const session = async (action: "open" | "save" | "close" | "clear") => {
    try {
      await http.post("/api/demo/rec/session", { action });
      await qc.invalidateQueries({ queryKey: ["rec"] });
      if (action === "save") toast.success(t("rec.sessionSaved"));
    } catch (e) {
      toast.fromError(t("common.failed"), e);
    }
  };
  const run = (keys: string[]) =>
    http
      .post<JobState>("/api/demo/rec/run", { keys, video: opts.video, voice: opts.video && opts.voice })
      .then((j) => trackJob("demo-record", keys, j))
      .catch((e) => toast.fromError(t("rec.recordFailed"), e));
  const generateAll = () => {
    const keys = stories.filter((x) => !s?.stories[x.key]?.flow).map((x) => x.key);
    if (!keys.length) return;
    http
      .post<JobState>("/api/demo/rec/generate", { keys })
      .then((j) => trackJob("demo-flow", keys, j))
      .catch((e) => toast.fromError(t("rec.flowFailed"), e));
  };
  const installBrowser = () =>
    http
      .post<JobState>("/api/demo/rec/setup")
      .then((j) => trackJob("demo-setup", ["chromium"], j))
      .catch((e) => toast.fromError(t("common.failed"), e));

  // Ready = approved and no test data left to fill in.
  const approved = stories.filter((x) => s?.stories[x.key]?.flow?.approved && !s.stories[x.key].placeholders.length).map((x) => x.key);
  // One recording at a time (the server enforces it too).
  const canRun = !!s && !recordT.running && s.browser.ready && s.ffmpeg && !!s.appUrl && (!opts.voice || !opts.video || s.tts.configured);
  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false, hint?: string) => (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`} title={hint}>
      <Toggle size="sm" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t("rec.title")} <Tag size="sm" color="secondary" variant="light">beta</Tag>
        </span>
      }
      actions={
        <>
          <Button size="sm" variant="outline" disabled={!stories.length} onClick={generateAll}>
            {t("rec.generateMissing")}
          </Button>
          <Button size="sm" disabled={!canRun || !approved.length} onClick={() => void run(approved)}>
            {t("rec.runApproved", { n: approved.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
        {toggle(t("rec.optShots"), opts.shots, (v) => opts.set({ shots: v }))}
        {toggle(t("rec.optVideo"), opts.video, (v) => opts.set({ video: v }))}
        {toggle(t("rec.optVoice"), opts.voice, (v) => opts.set({ voice: v }), !opts.video, !opts.video ? t("rec.voiceNeedsVideo") : undefined)}
      </div>
      {status.isLoading && <Spinner size="sm" />}
      {s && (
        <div className="rounded-md bg-ui-surface px-3 py-2 mb-3 text-xs text-ui-subtle flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>
            {t("rec.target")}: <code>{s.appUrl || "—"}</code>
          </span>
          <span className={s.session.saved ? "text-ui-success" : "text-ui-warning-dark"}>
            {s.session.saved ? t("rec.sessionOk", { at: new Date(s.session.savedAt ?? "").toLocaleString() }) : t("rec.sessionMissing")}
          </span>
          {s.session.loginOpen ? (
            <span className="flex gap-1">
              <Button size="sm" onClick={() => void session("save")}>
                {t("rec.saveSession")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void session("close")}>
                {t("common.cancel")}
              </Button>
            </span>
          ) : (
            <span className="flex gap-1">
              <Button size="sm" variant="outline" disabled={!s.appUrl || !s.browser.ready} onClick={() => void session("open")}>
                {s.session.saved ? t("rec.loginAgain") : t("rec.login")}
              </Button>
              {s.session.saved && <ConfirmDelete iconOnly label={t("rec.clearSession")} onConfirm={() => void session("clear")} />}
            </span>
          )}
          {s.browser.kind === "chrome" && !s.browser.chrome ? (
            <span className="text-ui-error">{t("rec.noChrome")}</span>
          ) : (
            !s.browser.ready && (
              <Button size="sm" variant="outline" loading={setupT.running} onClick={() => void installBrowser()}>
                {t("rec.installBrowser")}
              </Button>
            )
          )}
          {!s.ffmpeg && <span className="text-ui-error">{t("rec.noFfmpeg")}</span>}
          {opts.video && opts.voice && s.tts.effective && (
            <span>
              {t("rec.voiceUsed", { v: s.tts.effective === "macos" ? `macOS${s.tts.macVoice ? ` · ${s.tts.macVoice}` : ""}` : s.tts.effective === "openai" ? "OpenAI" : "ElevenLabs" })}
              {s.tts.fallback && ` (${t("rec.voiceFallback")})`}
            </span>
          )}
          {opts.video && opts.voice && !s.tts.configured && (
            <Link href="/settings#features" className="text-ui-warning-dark">
              {t("rec.noTts")}
            </Link>
          )}
        </div>
      )}
      {s?.session.loginOpen && <p className="text-xs text-ui-heading mb-3">{t("rec.loginHint")}</p>}
      {!stories.length ? (
        <p className="text-sm text-ui-secondary m-0">{t("rec.noStories")}</p>
      ) : (
        <ul className="list-none p-0 m-0 space-y-2">
          {stories.map((st) => (
            <StoryRow key={st.key} story={st} info={s?.stories[st.key]} canRun={canRun} onRun={() => void run([st.key])} />
          ))}
        </ul>
      )}
      <p className="text-xs text-ui-secondary mt-3 mb-0">{t("rec.footer")}</p>
    </Card>
  );
}

