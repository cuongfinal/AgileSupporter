import type { JobState } from "@/lib/types";
import { newId } from "./store";

type ItemStatus = JobState["items"][string]["status"];

export interface JobContext {
  setTotal(total: number): void;
  step(label?: string): void;
  label(label: string): void;
  item(key: string, status: ItemStatus, error?: string): void;
}

const g = globalThis as unknown as { __devDashJobs?: Map<string, JobState> };
const jobs = (g.__devDashJobs ??= new Map<string, JobState>());

export function startJob<T>(kind: string, total: number, fn: (ctx: JobContext) => Promise<T>): JobState<T> {
  const job: JobState<T> = {
    id: newId(),
    kind,
    status: "running",
    progress: { done: 0, total, label: "" },
    items: {},
    startedAt: Date.now(),
  };
  jobs.set(job.id, job as JobState);
  if (jobs.size > 100) jobs.delete(jobs.keys().next().value as string);

  const ctx: JobContext = {
    setTotal: (t) => (job.progress.total = t),
    step: (label) => {
      job.progress.done += 1;
      if (label !== undefined) job.progress.label = label;
    },
    label: (label) => (job.progress.label = label),
    item: (key, status, error) => (job.items[key] = { status, error }),
  };

  fn(ctx)
    .then((result) => {
      job.result = result;
      job.status = "done";
    })
    .catch((e: unknown) => {
      job.error = e instanceof Error ? e.message : String(e);
      job.status = "error";
    })
    .finally(() => (job.finishedAt = Date.now()));
  return job;
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next);
  });
  await Promise.all(workers);
}
