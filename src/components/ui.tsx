import { Button, Tag } from "@/components/kit";
import { CopyIcon, RefreshIcon, TrashIcon } from "@/components/icons";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type MessageKey, useT } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { JobState, Severity, Staleness, StatusCategory } from "@/lib/types";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold text-ui-heading-strong">{title}</h1>
        {subtitle && <div className="text-sm text-ui-secondary mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`bg-white border border-ui-border rounded-lg scroll-mt-20 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-ui-border">
          <h2 className="text-[15px] font-semibold text-ui-heading">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-ui-secondary py-8 text-center">{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ui-body mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ui-secondary mt-1">{hint}</span>}
    </label>
  );
}

export function Md({ children }: { children: string }) {
  return (
    <div className="md text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer">{c}</a> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function CopyButton({ text, label, size = "sm" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const { t } = useT();
  return (
    <Button
      size={size}
      variant="outline"
      color="neutral"
      leftIcon={<CopyIcon />}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => toast.success(t("common.copied")));
      }}
    >
      {label ?? t("common.copy")}
    </Button>
  );
}

const CAT_COLOR: Record<StatusCategory, "neutral" | "blue" | "green"> = { new: "neutral", indeterminate: "blue", done: "green" };
export function StatusTag({ status, category }: { status: string; category: StatusCategory }) {
  return (
    <Tag size="sm" color={CAT_COLOR[category]} variant="light">
      {status}
    </Tag>
  );
}

const SEV_COLOR: Record<Severity, "red" | "orange" | "neutral"> = { high: "red", medium: "orange", low: "neutral" };
export function SeverityTag({ severity }: { severity: Severity }) {
  const { t } = useT();
  return (
    <Tag size="sm" color={SEV_COLOR[severity]} variant={severity === "high" ? "bold" : "light"}>
      {t(`severity.${severity}` as MessageKey)}
    </Tag>
  );
}

export function ReviewCounts({ counts }: { counts: { high: number; medium: number; low: number } | null }) {
  const { t } = useT();
  if (!counts) return null;
  const total = counts.high + counts.medium + counts.low;
  if (!total)
    return (
      <Tag size="sm" color="green" variant="light">
        {t("review.clean")}
      </Tag>
    );
  return (
    <span className="inline-flex gap-1">
      {counts.high > 0 && <Tag size="sm" color="red" variant="bold">{counts.high}</Tag>}
      {counts.medium > 0 && <Tag size="sm" color="orange" variant="light">{counts.medium}</Tag>}
      {counts.low > 0 && <Tag size="sm" color="neutral" variant="light">{counts.low}</Tag>}
    </span>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function JobProgress({ job, showItems = false }: { job: JobState | undefined; showItems?: boolean }) {
  const { t } = useT();
  const now = useNow(job?.status === "running");
  if (!job) return null;
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
  const secs = Math.max(0, Math.round(((job.finishedAt ?? now) - job.startedAt) / 1000));
  const failed = Object.entries(job.items).filter(([, v]) => v.status === "error");
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center justify-between text-xs text-ui-secondary">
        <span>
          {job.status === "running" ? t("job.running") : job.status === "done" ? t("job.done") : t("job.failed")}
          {job.progress.label ? ` · ${job.progress.label}` : ""}
        </span>
        <span>
          {job.progress.done}/{job.progress.total} · {secs}s
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-ui-border overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${job.status === "error" ? "bg-ui-error" : "bg-ui-brand"} ${job.status === "running" && pct === 0 ? "animate-pulse" : ""}`}
          style={{ width: `${job.status === "done" ? 100 : job.status === "running" && pct === 0 ? 15 : pct}%` }}
        />
      </div>
      {job.error && <p className="text-xs text-ui-error whitespace-pre-wrap">{job.error}</p>}
      {showItems && failed.length > 0 && (
        <ul className="text-xs text-ui-error space-y-1">
          {failed.map(([k, v]) => (
            <li key={k}>
              <b>{k}</b>: {v.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Two-step delete: the first click asks, the second (within 4s) confirms. */
export function ConfirmDelete({
  onConfirm,
  label,
  iconOnly = false,
  disabled = false,
}: {
  onConfirm: () => void;
  label?: string;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  if (armed)
    return (
      <Button
        size="sm"
        color="danger"
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
          onConfirm();
        }}
      >
        {t("common.confirmDelete")}
      </Button>
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      color="danger"
      disabled={disabled}
      leftIcon={iconOnly ? undefined : <TrashIcon />}
      aria-label={label ?? t("common.delete")}
      title={label ?? t("common.delete")}
      onClick={(e) => {
        e.stopPropagation();
        setArmed(true);
      }}
    >
      {iconOnly ? <TrashIcon /> : (label ?? t("common.delete"))}
    </Button>
  );
}

export function Counter({ value, max, unit = "chars" }: { value: string; max: number; unit?: "chars" | "words" }) {
  const n = unit === "words" ? value.trim().split(/\s+/).filter(Boolean).length : value.length;
  return <span className={`text-xs ${n > max ? "text-ui-error font-semibold" : "text-ui-secondary"}`}>{n}/{max}</span>;
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="bg-white border border-ui-border rounded-lg px-4 py-3">
      <div className="text-xs text-ui-secondary">{label}</div>
      <div className="text-2xl font-semibold text-ui-primary mt-1">{value}</div>
      {hint && <div className="text-xs text-ui-secondary mt-0.5">{hint}</div>}
    </div>
  );
}

/** Warns that an AI result was made from an older version of the ticket (or review). */
export function StaleBanner({ stale, onRerun, busy }: { stale: Staleness | null | undefined; onRerun?: () => void; busy?: boolean }) {
  const { t } = useT();
  if (!stale) return null;
  const strong = stale.state === "stale";
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 mb-3 text-sm border ${
        strong ? "bg-ui-warning-surface border-ui-warning text-ui-warning-dark" : "bg-ui-surface border-ui-border text-ui-subtle"
      }`}
    >
      <span>
        <span aria-hidden>⚠ </span>
        {t(`stale.${stale.reason}` as MessageKey)}
      </span>
      {onRerun && (
        <Button size="sm" variant="outline" loading={busy} onClick={onRerun}>
          {t("common.rerun")}
        </Button>
      )}
    </div>
  );
}

export function StaleTag({ stale }: { stale: Staleness | null | undefined }) {
  const { t } = useT();
  if (!stale) return null;
  return (
    <span title={t("stale.tagHint")}>
      <Tag size="sm" color="orange" variant="light">
        ⚠ {t("stale.tag")}
      </Tag>
    </span>
  );
}

/** Force-reloads the page's data (Jira is never cached server-side, so this is a fresh read). */
export function ReloadButton({ keys }: { keys: string[] }) {
  const { t } = useT();
  const qc = useQueryClient();
  const fetching = useIsFetching({ predicate: (q) => keys.includes(String(q.queryKey[0])) });
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setBusy(true);
    try {
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" leftIcon={<RefreshIcon />} loading={busy || fetching > 0} onClick={() => void reload()} title={t("common.reloadHint")}>
      {t("common.reload")}
    </Button>
  );
}
