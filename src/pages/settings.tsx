import { Button, Input, Segmented, SegmentedItem, Spinner, Tag, Toggle } from "@/components/kit";
import { AddIcon, CheckCircleIcon, DownloadIcon, RefreshIcon, SearchIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Card, Field, JobProgress, Loader, PageHeader } from "@/components/ui";
import { http, useJob } from "@/lib/client";
import { Select } from "@/components/Select";
import { useT } from "@/lib/i18n";
import { type CliStatus, useAiStatus, useRepoStatus, useSettings } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { GlossaryEntry, JobState, PublicSettings, RepoConfig, Settings, TemplateMeta, TimeSlot } from "@/lib/types";
import type { SecretName } from "@/server/secrets";

function useSave() {
  const qc = useQueryClient();
  const { t } = useT();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => http.put<PublicSettings>("/api/settings", patch),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      toast.success(t("settings.saved"));
    },
    onError: (e) => toast.fromError(t("settings.saveFailed"), e),
  });
}

function SecretInput({
  name,
  label,
  s,
  value: controlled,
  onValueChange,
}: {
  name: SecretName;
  label: string;
  s: PublicSettings;
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  const { t } = useT();
  const qc = useQueryClient();
  const [own, setOwn] = useState("");
  const value = controlled ?? own;
  const setValue = onValueChange ?? setOwn;
  const st = s.secrets[name];
  const save = useMutation({
    mutationFn: () => http.put<PublicSettings>("/api/settings/secret", { name, value }),
    onSuccess: (d) => {
      qc.setQueryData(["settings"], d);
      setValue("");
      toast.success(t("settings.secretSaved"));
    },
    onError: (e) => toast.fromError(t("settings.saveFailed"), e),
  });
  const clear = useMutation({
    mutationFn: () => http.del<PublicSettings>(`/api/settings/secret?name=${name}`),
    onSuccess: (d) => qc.setQueryData(["settings"], d),
  });
  return (
    <Field label={label} hint={st.set ? t("settings.secretSet", { last4: st.last4 }) : t("settings.secretUnset")}>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          fullWidth
          size="sm"
          value={value}
          placeholder={st.set ? `••••••••${st.last4}` : ""}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" disabled={!value.trim()} loading={save.isPending} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
        {st.set && (
          <Button size="sm" variant="ghost" color="danger" onClick={() => clear.mutate()}>
            {t("common.remove")}
          </Button>
        )}
      </div>
    </Field>
  );
}

function JiraSection({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const [jira, setJira] = useState(s.jira);
  const [boards, setBoards] = useState<{ id: number; name: string; type: string; projectKey: string }[] | null>(null);
  const [candidates, setCandidates] = useState<Record<string, { id: string; name: string; filled: number }[]> | null>(null);
  const [token, setToken] = useState("");
  const qc = useQueryClient();
  const set = (k: keyof Settings["jira"], v: string) => setJira((j) => ({ ...j, [k]: v }));

  // Every Jira button saves the form and any typed-but-unsaved token first, so calls never run on stale settings.
  const persist = async (patch: Partial<Settings["jira"]> = {}) => {
    let next = await http.put<PublicSettings>("/api/settings", { jira: { ...jira, ...patch } });
    if (token.trim()) {
      next = await http.put<PublicSettings>("/api/settings/secret", { name: "jira.token", value: token.trim() });
      setToken("");
    }
    qc.setQueryData(["settings"], next);
  };

  const test = useMutation({
    mutationFn: async () => {
      await persist();
      return http.post<{ displayName: string; email: string }>("/api/settings/test-jira");
    },
    onSuccess: (me) => toast.success(t("settings.jiraConnected"), `${me.displayName} ${me.email}`),
    onError: (e) => toast.fromError(t("settings.jiraFailed"), e),
  });
  const findBoards = useMutation({
    mutationFn: async () => {
      await persist();
      return http.get<typeof boards>(`/api/settings/boards`);
    },
    onSuccess: (b) => setBoards(b ?? []),
    onError: (e) => toast.fromError(t("settings.jiraFailed"), e),
  });
  const detect = useMutation({
    mutationFn: async () => {
      await persist();
      const r = await http.post<{
        spField: string;
        acField: string;
        flaggedField: string;
        sampled: number;
        candidates: Record<string, { id: string; name: string; filled: number }[]>;
      }>("/api/settings/detect-fields");
      const fields = { spField: r.spField || jira.spField, acField: r.acField || jira.acField, flaggedField: r.flaggedField || jira.flaggedField };
      await persist(fields);
      return { r, fields };
    },
    onSuccess: ({ r, fields }) => {
      setJira((j) => ({ ...j, ...fields }));
      setCandidates(r.candidates);
      void qc.invalidateQueries({ queryKey: ["health"] });
      toast.success(t("settings.fieldsDetected"), r.sampled ? t("settings.fieldsSampled", { n: r.sampled }) : undefined);
    },
    onError: (e) => toast.fromError(t("settings.jiraFailed"), e),
  });

  return (
    <Card
      id="jira"
      title="Jira"
      actions={
        <>
          <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
            {t("settings.testConnection")}
          </Button>
          <Button size="sm" loading={save.isPending} onClick={() => persist().then(() => toast.success(t("settings.saved")), (e) => toast.fromError(t("settings.saveFailed"), e))}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <p className="text-xs text-ui-secondary mb-4">{t("settings.jiraReadOnly")}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("settings.baseUrl")}>
          <Input size="sm" fullWidth value={jira.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
        </Field>
        <Field label={t("settings.email")}>
          <Input size="sm" fullWidth value={jira.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <SecretInput name="jira.token" label={t("settings.apiToken")} s={s} value={token} onValueChange={setToken} />
        </div>
        <Field label={t("settings.projectKey")} hint={t("settings.projectKeyHint")}>
          <Input size="sm" fullWidth value={jira.projectKey} onChange={(e) => set("projectKey", e.target.value.toUpperCase())} />
        </Field>
        <Field label={t("settings.boardId")} hint={t("settings.boardIdHint")}>
          <div className="flex gap-2">
            <Input size="sm" fullWidth inputMode="numeric" value={jira.boardId} onChange={(e) => set("boardId", e.target.value.replace(/\D/g, ""))} />
            <Button size="sm" variant="outline" loading={findBoards.isPending} onClick={() => findBoards.mutate()}>
              {t("settings.findBoards")}
            </Button>
          </div>
        </Field>
      </div>
      {boards && (
        <div className="mt-3 border border-ui-border rounded-md max-h-56 overflow-auto">
          {boards.length === 0 && <p className="text-xs text-ui-secondary p-3">{t("settings.noBoards")}</p>}
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                set("boardId", String(b.id));
                setBoards(null);
              }}
              className="w-full text-left px-3 py-2 text-sm bg-ui-raised hover:bg-ui-brand-surface border-0 border-b border-ui-border cursor-pointer flex justify-between"
            >
              <span>
                <b>{b.id}</b> · {b.name}
              </span>
              <span className="text-xs text-ui-secondary">
                {b.type} {b.projectKey}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ui-body">{t("settings.fieldMapping")}</h3>
        <Button size="sm" variant="ghost" loading={detect.isPending} leftIcon={<RefreshIcon />} onClick={() => detect.mutate()}>
          {t("settings.detectFields")}
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
        {(
          [
            ["spField", "settings.spField", "sp"],
            ["acField", "settings.acField", "ac"],
            ["flaggedField", "settings.flaggedField", "flagged"],
          ] as const
        ).map(([k, label, c]) => (
          <Field
            key={k}
            label={t(label)}
            hint={
              candidates?.[c]?.length
                ? candidates[c]
                    .slice(0, 4)
                    .map((x) => `${x.id} (${x.name}${x.filled ? ` · ${x.filled}` : ""})`)
                    .join(", ")
                : undefined
            }
          >
            <Input size="sm" fullWidth value={jira[k]} onChange={(e) => set(k, e.target.value.trim())} />
          </Field>
        ))}
      </div>
    </Card>
  );
}

function CliRow({ c, active }: { c: CliStatus | undefined; active: boolean }) {
  const { t } = useT();
  const test = useMutation({
    mutationFn: () => http.post<{ greeting: string; ms: number }>("/api/ai/test", { provider: c?.provider }),
    onSuccess: (r) => toast.success(t("settings.aiWorks"), `“${r.greeting}” · ${(r.ms / 1000).toFixed(1)}s`),
    onError: (e) => toast.fromError(t("settings.aiFailed"), e),
  });
  if (!c) return null;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${active ? "border-ui-brand bg-ui-brand-surface" : "border-ui-border"}`}>
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {c.provider === "claude" ? "Claude Code" : "GitHub Copilot CLI"}{" "}
          {c.found ? (
            <Tag size="sm" color="green" variant="light">{c.version}</Tag>
          ) : (
            <Tag size="sm" color="red" variant="light">{t("settings.notFound")}</Tag>
          )}
        </div>
        <div className="text-xs text-ui-secondary truncate">{c.bin || "—"}</div>
      </div>
      <Button size="sm" variant="outline" disabled={!c.found} loading={test.isPending} onClick={() => test.mutate()}>
        {t("settings.testPrompt")}
      </Button>
    </div>
  );
}

function AiSection({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const qc = useQueryClient();
  const status = useAiStatus();
  const [ai, setAi] = useState(s.ai);
  const find = (p: "claude" | "copilot") => status.data?.find((x) => x.provider === p);
  return (
    <Card
      id="ai"
      title="AI"
      actions={
        <>
          <Button size="sm" variant="ghost" leftIcon={<RefreshIcon />} onClick={() => qc.invalidateQueries({ queryKey: ["ai-status"] })}>
            {t("settings.redetect")}
          </Button>
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() => save.mutate({ ai }, { onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-status"] }) })}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <p className="text-xs text-ui-secondary mb-3">{t("settings.aiHint")}</p>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium">{t("settings.defaultProvider")}</span>
        <Segmented size="sm" selectedIndex={ai.provider === "claude" ? 0 : 1} onChange={(i) => setAi({ ...ai, provider: i === 0 ? "claude" : "copilot" })}>
          <SegmentedItem>Claude</SegmentedItem>
          <SegmentedItem>Copilot</SegmentedItem>
        </Segmented>
      </div>
      {status.isLoading ? (
        <Spinner size="sm" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <CliRow c={find("claude")} active={ai.provider === "claude"} />
          <CliRow c={find("copilot")} active={ai.provider === "copilot"} />
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <Field label={t("settings.claudeBin")} hint={t("settings.binHint")}>
          <Input size="sm" fullWidth value={ai.claudeBin} onChange={(e) => setAi({ ...ai, claudeBin: e.target.value })} />
        </Field>
        <Field label={t("settings.copilotBin")} hint={t("settings.binHint")}>
          <Input size="sm" fullWidth value={ai.copilotBin} onChange={(e) => setAi({ ...ai, copilotBin: e.target.value })} />
        </Field>
        <Field label={t("settings.claudeModel")} hint={t("settings.modelHint")}>
          <Input size="sm" fullWidth value={ai.claudeModel} onChange={(e) => setAi({ ...ai, claudeModel: e.target.value })} />
        </Field>
        <Field label={t("settings.copilotModel")} hint={t("settings.modelHint")}>
          <Input size="sm" fullWidth value={ai.copilotModel} onChange={(e) => setAi({ ...ai, copilotModel: e.target.value })} />
        </Field>
        <Field label={t("settings.concurrency")} hint={t("settings.concurrencyHint")}>
          <Select
            size="sm"
            items={["1", "2", "3", "4"].map((v) => ({ label: v, value: v }))}
            value={[String(ai.concurrency)]}
            onValueChange={(v) => v[0] && setAi({ ...ai, concurrency: Number(v[0]) })}
          />
        </Field>
      </div>
    </Card>
  );
}

function BranchBadge({ branch, detached, dirty }: { branch: string; detached: boolean; dirty: boolean }) {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-md bg-ui-brand text-ui-on-solid px-2.5 py-0.5 text-label font-semibold font-mono">
        <span aria-hidden>⎇</span>
        {branch}
      </span>
      {detached && <Tag size="sm" color="orange" variant="light">{t("repos.detached")}</Tag>}
      {dirty && <Tag size="sm" color="orange" variant="light">{t("repos.dirty")}</Tag>}
    </span>
  );
}

function RepoRow({ repo, onChange }: { repo: RepoConfig; onChange: (r: RepoConfig) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const status = useRepoStatus(repo.key, !!repo.path);
  const [draftPath, setDraftPath] = useState(repo.path);
  const [branchQuery, setBranchQuery] = useState("");

  const branches = useQuery({
    queryKey: ["branches", repo.key],
    queryFn: () => http.get<{ current: string; local: string[]; remote: string[] }>(`/api/repos/${repo.key}/branches`),
    enabled: !!repo.path && !!status.data?.ok,
    staleTime: 60_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["repo-status", repo.key] });
    void qc.invalidateQueries({ queryKey: ["branches", repo.key] });
  };
  const validate = useMutation({
    mutationFn: () => http.post<{ ok: boolean; root: string; error?: string }>("/api/repos/validate", { path: draftPath }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(t("repos.invalidPath"), r.error);
      onChange({ ...repo, path: r.root });
      toast.success(t("repos.pathOk"), r.root);
    },
    onError: (e) => toast.fromError(t("repos.invalidPath"), e),
  });
  const sw = useMutation({
    mutationFn: (branch: string) => http.post<{ message: string }>(`/api/repos/${repo.key}/switch`, { branch }),
    onSuccess: (_r, branch) => toast.success(t("repos.switched", { branch })),
    onError: (e) => toast.fromError(t("repos.switchFailed"), e),
    onSettled: refresh,
  });
  const fetchR = useMutation({
    mutationFn: () => http.post(`/api/repos/${repo.key}/fetch`),
    onSuccess: () => toast.success(t("repos.fetched")),
    onError: (e) => toast.fromError(t("repos.fetchFailed"), e),
    onSettled: refresh,
  });

  const st = status.data;
  const allBranches = [
    ...(branches.data?.local ?? []).map((b) => ({ label: b, value: b, helperText: b === st?.branch ? t("repos.current") : undefined })),
    ...(branches.data?.remote ?? []).map((b) => ({ label: b, value: b, helperText: t("repos.remote") })),
  ];
  const q = branchQuery.trim().toLowerCase();
  // FE has ~170 local + ~630 remote branches: the open list shows local ones; typing searches both.
  const items = q
    ? allBranches.filter((b) => b.value.toLowerCase().includes(q)).slice(0, 100)
    : allBranches.filter((b) => !b.helperText || b.helperText === t("repos.current"));

  return (
    <div className={`border rounded-lg p-3 ${repo.enabled ? "border-ui-border" : "border-dashed border-ui-outline opacity-80"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <Toggle size="sm" checked={repo.enabled} onChange={(e) => onChange({ ...repo, enabled: e.target.checked })} />
          {repo.label} <span className="text-xs font-normal text-ui-secondary">{repo.dir}</span>
        </label>
        {repo.path && st?.ok && <BranchBadge branch={st.branch} detached={st.detached} dirty={st.dirty} />}
        {repo.path && status.isLoading && <Spinner size="sm" />}
        {repo.path && st && !st.ok && <Tag size="sm" color="red" variant="light">{st.error ?? t("repos.invalidPath")}</Tag>}
      </div>
      <div className="flex gap-2 mt-3">
        <Input size="sm" fullWidth value={draftPath} onChange={(e) => setDraftPath(e.target.value)} />
        <Button size="sm" variant="outline" className="!whitespace-nowrap shrink-0" disabled={!draftPath.trim() || draftPath === repo.path} loading={validate.isPending} onClick={() => validate.mutate()}>
          {t("repos.usePath")}
        </Button>
      </div>
      {!repo.path && st?.suggestion && (
        <button type="button" className="mt-2 text-xs text-ui-brand bg-transparent border-0 p-0 cursor-pointer underline" onClick={() => setDraftPath(st.suggestion ?? "")}>
          {t("repos.suggested", { path: st.suggestion })}
        </button>
      )}
      {repo.path && st?.ok && (
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div className="min-w-0 sm:min-w-[260px] flex-1">
            <div className="text-label font-medium text-ui-body mb-1">{t("repos.switchTo", { n: allBranches.length })}</div>
            <div className="flex flex-wrap gap-2">
              <div className="w-full sm:w-56 shrink-0">
                <Input
                  size="sm"
                  fullWidth
                  leftContent={<SearchIcon />}
                  placeholder={t("repos.filterBranch")}
                  value={branchQuery}
                  onChange={(e) => setBranchQuery(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <Select
                  size="sm"
                  fullWidth
                  placeholder={q ? t("repos.matches", { n: items.length }) : t("repos.pickBranch", { n: items.length })}
                  items={items}
                  value={[]}
                  loading={branches.isFetching || sw.isPending}
                  disabled={sw.isPending || !items.length}
                  onValueChange={(v) => {
                    if (!v[0] || v[0] === st.branch) return;
                    setBranchQuery("");
                    sw.mutate(v[0]);
                  }}
                />
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" leftIcon={<DownloadIcon />} loading={fetchR.isPending} onClick={() => fetchR.mutate()}>
            {t("repos.fetch")}
          </Button>
          <span className="text-xs text-ui-secondary pb-1.5">
            HEAD <code>{st.head}</code>
            {st.upstream && ` · ${st.upstream}`}
            {st.ahead !== null && ` · ↑${st.ahead} ↓${st.behind}`}
          </span>
        </div>
      )}
    </div>
  );
}

function ReposSection({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const qc = useQueryClient();
  const change = (r: RepoConfig) => {
    const repos = s.repos.map((x) => (x.key === r.key ? r : x));
    save.mutate({ repos }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ["repo-status", r.key] }) });
  };
  return (
    <Card id="repos" title={t("settings.repos")}>
      <p className="text-xs text-ui-secondary mb-3">{t("settings.reposHint")}</p>
      <div className="space-y-3">
        {s.repos.map((r) => (
          <RepoRow key={`${r.key}:${r.path}`} repo={r} onChange={change} />
        ))}
      </div>
    </Card>
  );
}

function TemplateSection({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const qc = useQueryClient();
  const save = useSave();
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [linkTpl, setLinkTpl] = useState(s.demo.testLinkTemplate);
  const job = useJob(jobId);
  const py = useQuery({
    queryKey: ["python"],
    queryFn: () => http.get<{ ready: boolean; systemPython: string; message: string }>("/api/demo/python"),
  });
  const tpls = useQuery({ queryKey: ["templates"], queryFn: () => http.get<{ templates: TemplateMeta[]; activeId: string }>("/api/demo/templates") });

  useEffect(() => {
    if (job.data?.status === "done") void qc.invalidateQueries({ queryKey: ["python"] });
  }, [job.data?.status, qc]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch("/api/demo/templates", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
        body: file,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      return j as TemplateMeta;
    },
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
      if (m.inspect.ok) toast.success(t("tpl.uploaded"), m.name);
      else toast.error(t("tpl.uploadedInvalid"), m.inspect.error);
    },
    onError: (e) => toast.fromError(t("tpl.uploadFailed"), e),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "inspect" | "delete" }) =>
      action === "delete" ? http.del(`/api/demo/templates/${id}`) : http.put(`/api/demo/templates/${id}`, { action }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["templates"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.fromError(t("common.failed"), e),
  });

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!/\.pptx$/i.test(f.name)) return toast.error(t("tpl.onlyPptx"));
    upload.mutate(f);
  };

  return (
    <Card id="template" title={t("settings.template")}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 rounded-md bg-ui-surface px-3 py-2">
        <span className="text-sm">
          {py.data?.ready ? (
            <span className="inline-flex items-center gap-1 text-ui-success font-medium">
              <CheckCircleIcon size={14} />
              {t("tpl.pythonReady", { msg: py.data.message })}
            </span>
          ) : (
            <span className="text-ui-warning-dark">{t("tpl.pythonMissing", { msg: py.data?.message ?? "…" })}</span>
          )}
        </span>
        {!py.data?.ready && (
          <Button size="sm" loading={job.data?.status === "running"} onClick={() => http.post<JobState>("/api/demo/python").then((j) => setJobId(j.id))}>
            {t("tpl.installPython")}
          </Button>
        )}
      </div>
      {jobId && job.data?.status !== "done" && (
        <div className="mb-4">
          <JobProgress job={job.data} />
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${drag ? "border-ui-brand bg-ui-brand-surface" : "border-ui-outline"}`}
      >
        <div className="w-8 h-8 mx-auto text-ui-brand [&_svg]:w-8 [&_svg]:h-8">
          <UploadIcon />
        </div>
        <p className="text-sm mt-2">{t("tpl.drop")}</p>
        <div className="mt-3">
          <Button size="sm" variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
            {t("tpl.choose")}
          </Button>
          <input ref={fileRef} type="file" accept=".pptx" hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
      </div>
      <ul className="list-none p-0 mt-4 space-y-2">
        {tpls.data?.templates.map((tp) => {
          const active = tpls.data.activeId === tp.id;
          const kinds = tp.inspect.slides.reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {});
          return (
            <li key={tp.id} className={`border rounded-md px-3 py-2 ${active ? "border-ui-brand bg-ui-brand-surface" : "border-ui-border"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {tp.name} {active && <Tag size="sm" color="primary" variant="bold">{t("tpl.active")}</Tag>}
                  </div>
                  <div className="text-xs text-ui-secondary">
                    {tp.size >= 1048576 ? `${(tp.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(tp.size / 1024))} KB`} · {new Date(tp.uploadedAt).toLocaleString()} ·{" "}
                    {Object.entries(kinds)
                      .map(([k, n]) => `${n} ${k}`)
                      .join(", ") || "—"}
                  </div>
                  {!tp.inspect.ok && <div className="text-xs text-ui-error mt-1">{tp.inspect.error}</div>}
                </div>
                <div className="flex gap-1">
                  {!active && (
                    <Button size="sm" variant="outline" onClick={() => act.mutate({ id: tp.id, action: "activate" })}>
                      {t("tpl.useThis")}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" leftIcon={<RefreshIcon />} onClick={() => act.mutate({ id: tp.id, action: "inspect" })}>
                    {t("tpl.inspect")}
                  </Button>
                  <Button size="sm" variant="ghost" color="danger" leftIcon={<TrashIcon />} onClick={() => act.mutate({ id: tp.id, action: "delete" })}>
                    {t("common.remove")}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex gap-2 items-end">
        <div className="flex-1">
          <Field label={t("tpl.testLink")} hint={t("tpl.testLinkHint")}>
            <Input size="sm" fullWidth value={linkTpl} onChange={(e) => setLinkTpl(e.target.value)} />
          </Field>
        </div>
        <Button size="sm" className="mb-5" disabled={linkTpl === s.demo.testLinkTemplate} onClick={() => save.mutate({ demo: { ...s.demo, testLinkTemplate: linkTpl } })}>
          {t("common.save")}
        </Button>
      </div>
    </Card>
  );
}

function SkillsSection() {
  const { t } = useT();
  const q = useQuery({
    queryKey: ["skills"],
    queryFn: () => http.get<{ root: string; skills: { name: string; description: string; files: string[] }[]; references: string[] }>("/api/settings/skills"),
  });
  return (
    <Card id="skills" title={t("settings.skills")}>
      <p className="text-xs text-ui-secondary mb-3">{t("settings.skillsHint", { root: q.data?.root ?? "skills/" })}</p>
      <ul className="list-none p-0 space-y-3">
        {q.data?.skills.map((sk) => (
          <li key={sk.name} className="border border-ui-border rounded-md p-3">
            <div className="flex items-center gap-2">
              <code className="text-sm font-semibold text-ui-brand">{sk.name}</code>
              <Tag size="sm" color="secondary" variant="light">{t("settings.usedByDemo")}</Tag>
            </div>
            <p className="text-xs text-ui-subtle mt-1 line-clamp-3">{sk.description}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {sk.files.map((f) => (
                <Tag key={f} size="sm" color="neutral" variant="light">{f}</Tag>
              ))}
            </div>
          </li>
        ))}
        {!!q.data?.references.length && (
          <li className="border border-ui-border rounded-md p-3">
            <div className="text-sm font-semibold">references/</div>
            <p className="text-xs text-ui-subtle mt-1">{t("settings.referencesHint")}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {q.data.references.map((f) => (
                <Tag key={f} size="sm" color="neutral" variant="light">{f}</Tag>
              ))}
            </div>
          </li>
        )}
      </ul>
    </Card>
  );
}

function GlossarySection({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const [rows, setRows] = useState<GlossaryEntry[]>(s.glossary);
  const set = (i: number, p: Partial<GlossaryEntry>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Card
      id="glossary"
      title={t("settings.glossary")}
      actions={
        <>
          <Button size="sm" variant="ghost" leftIcon={<AddIcon />} onClick={() => setRows([...rows, { term: "", en: "", vi: "", keep: false }])}>
            {t("common.add")}
          </Button>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ glossary: rows.filter((r) => r.term.trim()) })}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <p className="text-xs text-ui-secondary mb-3">{t("settings.glossaryHint")}</p>
      <div className="space-y-2">
        <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 text-xs font-medium text-ui-secondary">
          <span>{t("glossary.term")}</span>
          <span>EN</span>
          <span>VI</span>
          <span>{t("glossary.keep")}</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-center">
            <Input size="sm" fullWidth value={r.term} onChange={(e) => set(i, { term: e.target.value })} />
            <Input size="sm" fullWidth value={r.en} disabled={r.keep} onChange={(e) => set(i, { en: e.target.value })} />
            <Input size="sm" fullWidth value={r.vi} disabled={r.keep} onChange={(e) => set(i, { vi: e.target.value })} />
            <Toggle size="sm" checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={t("glossary.keep")} />
            <Button size="sm" variant="ghost" color="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t("common.remove")}>
              <TrashIcon />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

/** Kéo Task: which Jira fields hold the AI tracking data (names as shown in Jira); empty = statuses only. */
function JiraWriteForm({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const pick = (j: PublicSettings["jira"]) => ({ aiActionField: j.aiActionField, aiScoreField: j.aiScoreField, aiActionValue: j.aiActionValue });
  const [f, setF] = useState(pick(s.jira));
  const dirty = JSON.stringify(f) !== JSON.stringify(pick(s.jira));
  return (
    <div className="mt-3 max-w-2xl space-y-3">
      <p className="text-xs text-ui-secondary">{t("settings.aiFieldsHint")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t("settings.aiActionField")}>
          <Input size="sm" fullWidth value={f.aiActionField} onChange={(e) => setF({ ...f, aiActionField: e.target.value })} />
        </Field>
        <Field label={t("settings.aiActionValue")}>
          <Input size="sm" fullWidth value={f.aiActionValue} onChange={(e) => setF({ ...f, aiActionValue: e.target.value })} />
        </Field>
        <Field label={t("settings.aiScoreField")}>
          <Input size="sm" fullWidth value={f.aiScoreField} onChange={(e) => setF({ ...f, aiScoreField: e.target.value })} />
        </Field>
      </div>
      <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ jira: { ...s.jira, ...f } })}>
        {t("common.save")}
      </Button>
    </div>
  );
}

function RecordingSettingsForm({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const [r, setR] = useState(s.recording);
  const [testing, setTesting] = useState(false);
  const setTts = (patch: Partial<typeof r.tts>) => setR({ ...r, tts: { ...r.tts, ...patch } });
  const dirty = JSON.stringify(r) !== JSON.stringify(s.recording);
  const voices = useQuery({ queryKey: ["mac-voices"], queryFn: () => http.get<{ mac: string[] }>("/api/demo/rec/voices"), staleTime: Infinity });
  const hasMac = (voices.data?.mac.length ?? 0) > 0;
  const keySet =
    r.tts.provider === "openai" ? s.secrets["openai.key"].set : r.tts.provider === "elevenlabs" ? s.secrets["elevenlabs.key"].set && !!r.tts.elevenVoiceId : hasMac;
  const macPicker = (
    <Field label={t("rec.macVoice")}>
      <Select
        size="sm"
        loading={voices.isLoading}
        items={[{ value: "", label: t("rec.macDefault") }, ...(voices.data?.mac ?? []).map((v) => ({ value: v, label: v }))]}
        value={[r.tts.macVoice]}
        onValueChange={(v) => setTts({ macVoice: v[0] ?? "" })}
      />
    </Field>
  );
  const listen = async () => {
    setTesting(true);
    try {
      if (dirty) await save.mutateAsync({ recording: r });
      const res = await fetch("/api/demo/rec/tts-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Here I open the bill of lading, and you can see the new cargo totals right in the header." }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      await new Audio(url).play();
    } catch (e) {
      toast.fromError(t("rec.ttsFailed"), e);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="mt-3 max-w-2xl space-y-3">
      <Field label={t("rec.appUrl")} hint={t("rec.appUrlHint")}>
        <Input size="sm" fullWidth value={r.appUrl} onChange={(e) => setR({ ...r, appUrl: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t("rec.browser")} hint={t("rec.browserHint")}>
          <Segmented size="sm" selectedIndex={r.browser === "chrome" ? 0 : 1} onChange={(i) => setR({ ...r, browser: i === 0 ? "chrome" : "chromium" })}>
            <SegmentedItem>Chrome</SegmentedItem>
            <SegmentedItem>Chromium</SegmentedItem>
          </Segmented>
        </Field>
        <Field label={t("rec.size")}>
          <div className="flex items-center gap-1">
            <Input size="sm" className="min-w-0 flex-1" inputMode="numeric" value={String(r.width)} onChange={(e) => setR({ ...r, width: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            <span className="text-ui-secondary">×</span>
            <Input size="sm" className="min-w-0 flex-1" inputMode="numeric" value={String(r.height)} onChange={(e) => setR({ ...r, height: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </div>
        </Field>
      </div>
      <div className="border-t border-ui-border pt-3">
        <Field label={t("rec.voiceProvider")} hint={t("rec.voiceHint")}>
          <Segmented
            size="sm"
            selectedIndex={r.tts.provider === "openai" ? 0 : r.tts.provider === "elevenlabs" ? 1 : 2}
            onChange={(i) => setTts({ provider: i === 0 ? "openai" : i === 1 ? "elevenlabs" : "macos" })}
          >
            <SegmentedItem>OpenAI</SegmentedItem>
            <SegmentedItem>ElevenLabs</SegmentedItem>
            <SegmentedItem>macOS</SegmentedItem>
          </Segmented>
        </Field>
      </div>
      {r.tts.provider !== "macos" && hasMac && !keySet && <p className="text-xs text-ui-heading m-0">{t("rec.macFallback")}</p>}
      {r.tts.provider === "macos" ? (
        <>
          {macPicker}
          <p className="text-xs text-ui-secondary m-0">{t("rec.macHint")}</p>
        </>
      ) : r.tts.provider === "openai" ? (
        <>
          <SecretInput name="openai.key" label={t("rec.openaiKey")} s={s} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("rec.voice")}>
              <Select
                size="sm"
                items={OPENAI_VOICES.map((v) => ({ value: v, label: v }))}
                value={[r.tts.openaiVoice]}
                onValueChange={(v) => v[0] && setTts({ openaiVoice: v[0] })}
              />
            </Field>
            <Field label={t("rec.model")}>
              <Input size="sm" fullWidth value={r.tts.openaiModel} onChange={(e) => setTts({ openaiModel: e.target.value })} />
            </Field>
          </div>
          <Field label={t("rec.instructions")} hint={t("rec.instructionsHint")}>
            <Input size="sm" fullWidth value={r.tts.instructions} onChange={(e) => setTts({ instructions: e.target.value })} />
          </Field>
        </>
      ) : (
        <>
          <SecretInput name="elevenlabs.key" label={t("rec.elevenKey")} s={s} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("rec.voiceId")} hint={t("rec.voiceIdHint")}>
              <Input size="sm" fullWidth value={r.tts.elevenVoiceId} onChange={(e) => setTts({ elevenVoiceId: e.target.value.trim() })} />
            </Field>
            <Field label={t("rec.model")}>
              <Input size="sm" fullWidth value={r.tts.elevenModel} onChange={(e) => setTts({ elevenModel: e.target.value })} />
            </Field>
          </div>
        </>
      )}
      <p className="text-xs text-ui-secondary m-0">{t("rec.privacy")}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ recording: r })}>
          {t("common.save")}
        </Button>
        <Button size="sm" variant="outline" disabled={!keySet && !hasMac} loading={testing} onClick={() => void listen()}>
          {t("rec.listen")}
        </Button>
      </div>
    </div>
  );
}

/** Time tracker: all per-user values live in ~/.dev-dashboard, the password as an encrypted secret. */
function LogTimeForm({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const [f, setF] = useState(s.timeTracker);
  const dirty = JSON.stringify(f) !== JSON.stringify(s.timeTracker);
  const qc = useQueryClient();
  const test = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync({ timeTracker: f });
      return http.post<{ userId: string }>("/api/logtime/test");
    },
    onSuccess: (r) => {
      // The server stored the user ID from the login response; reload settings so the field shows it.
      void qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(t("logtime.loginOk"), t("logtime.userIdFound", { id: r.userId }));
    },
    onError: (e) => toast.fromError(t("logtime.loginFailed"), e),
  });
  const setSlot = (i: number, patch: Partial<TimeSlot>) => setF({ ...f, slots: f.slots.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="mt-3 max-w-2xl space-y-3">
      <p className="text-xs text-ui-secondary">{t("logtime.settingsHint")}</p>
      <Field label={t("logtime.baseUrl")}>
        <Input size="sm" fullWidth value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("logtime.loginName")}>
          <Input size="sm" fullWidth autoComplete="off" value={f.loginName} onChange={(e) => setF({ ...f, loginName: e.target.value })} />
        </Field>
        <Field label={t("logtime.userId")} hint={t("logtime.userIdHint")}>
          <Input size="sm" fullWidth inputMode="numeric" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value.trim() })} />
        </Field>
        <Field label={t("logtime.mainTask")}>
          <Input size="sm" fullWidth inputMode="numeric" value={f.mainTaskId} onChange={(e) => setF({ ...f, mainTaskId: e.target.value.trim() })} />
        </Field>
        <Field label={t("logtime.kaizenTask")}>
          <Input size="sm" fullWidth inputMode="numeric" value={f.kaizenTaskId} onChange={(e) => setF({ ...f, kaizenTaskId: e.target.value.trim() })} />
        </Field>
      </div>
      <SecretInput name="timetracker.password" label={t("logtime.password")} s={s} />
      <div>
        <div className="text-label font-medium text-ui-body mb-1">{t("logtime.slots")}</div>
        <div className="space-y-2">
          {f.slots.map((slot, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input size="sm" type="time" value={slot.start} onChange={(e) => setSlot(i, { start: e.target.value })} aria-label={t("logtime.start")} />
              <span className="text-ui-secondary">→</span>
              <Input size="sm" type="time" value={slot.end} onChange={(e) => setSlot(i, { end: e.target.value })} aria-label={t("logtime.end")} />
              <div className="w-40">
                <Select
                  size="sm"
                  aria-label={t("logtime.task")}
                  items={[
                    { value: "main", label: t("logtime.taskMain") },
                    { value: "kaizen", label: t("logtime.taskKaizen") },
                  ]}
                  value={[slot.task]}
                  onValueChange={(v) => v[0] && setSlot(i, { task: v[0] as TimeSlot["task"] })}
                />
              </div>
              <Button size="sm" variant="ghost" color="danger" aria-label={t("common.remove")} onClick={() => setF({ ...f, slots: f.slots.filter((_, j) => j !== i) })}>
                <TrashIcon />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" leftIcon={<AddIcon />} onClick={() => setF({ ...f, slots: [...f.slots, { start: "17:00", end: "18:00", task: "main" }] })}>
            {t("logtime.addSlot")}
          </Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ timeTracker: f })}>
          {t("common.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          leftIcon={<CheckCircleIcon />}
          disabled={!f.baseUrl || !f.loginName || !s.secrets["timetracker.password"].set}
          loading={test.isPending}
          onClick={() => test.mutate()}
        >
          {t("logtime.testLogin")}
        </Button>
      </div>
    </div>
  );
}

function FeaturesSection({ s }: { s: PublicSettings }) {
  const { t } = useT();
  const save = useSave();
  const row = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void, extra?: ReactNode) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-ui-border last:border-0">
      <div className="min-w-0 break-words">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-ui-secondary">{hint}</div>
        {extra}
      </div>
      <Toggle size="sm" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    </div>
  );
  return (
    <Card id="features" title={t("settings.features")}>
      {row(t("settings.usage"), t("settings.usageHint"), s.features.usage, (v) => save.mutate({ features: { ...s.features, usage: v } }))}
      {row(
        t("rec.feature"),
        t("rec.featureHint"),
        s.features.recording,
        (v) => save.mutate({ features: { ...s.features, recording: v } }),
        s.features.recording && <RecordingSettingsForm key={JSON.stringify(s.recording)} s={s} />,
      )}
      {row(
        t("settings.jiraWrite"),
        t("settings.jiraWriteHint"),
        s.features.jiraWrite,
        (v) => save.mutate({ features: { ...s.features, jiraWrite: v } }),
        s.features.jiraWrite && <JiraWriteForm key={JSON.stringify(s.jira)} s={s} />,
      )}
      {row(
        t("logtime.feature"),
        t("logtime.featureHint"),
        s.features.logTime,
        (v) => save.mutate({ features: { ...s.features, logTime: v } }),
        s.features.logTime && <LogTimeForm key={JSON.stringify(s.timeTracker)} s={s} />,
      )}
    </Card>
  );
}

const SECTIONS = [
  ["jira", "Jira"],
  ["ai", "AI"],
  ["repos", "settings.repos"],
  ["template", "settings.template"],
  ["skills", "settings.skills"],
  ["glossary", "settings.glossary"],
  ["features", "settings.features"],
] as const;

export default function SettingsPage() {
  const { t } = useT();
  const settings = useSettings();
  const s = settings.data;
  if (!s) return settings.error ? <p className="text-ui-error">{String(settings.error)}</p> : <Loader fill />;
  return (
    <>
      <PageHeader title={t("nav.settings")} subtitle={t("settings.subtitle", { path: s.dataHome })} />
      <div className="flex flex-wrap gap-2 mb-5">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-xs no-underline px-3 py-1 rounded-md border border-ui-border bg-ui-raised transition-colors text-ui-body hover:border-ui-brand hover:text-ui-brand">
            {label.includes(".") ? t(label as Parameters<typeof t>[0]) : label}
          </a>
        ))}
      </div>
      <div className="space-y-5">
        <JiraSection key={JSON.stringify(s.jira)} s={s} />
        <AiSection key={JSON.stringify(s.ai)} s={s} />
        <ReposSection s={s} />
        <TemplateSection key={s.demo.testLinkTemplate} s={s} />
        <SkillsSection />
        <GlossarySection key={JSON.stringify(s.glossary)} s={s} />
        <FeaturesSection s={s} />
      </div>
    </>
  );
}
