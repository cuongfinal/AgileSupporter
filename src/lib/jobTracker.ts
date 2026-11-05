import { create } from "zustand";
import { http, useJob } from "./client";
import { toast } from "./toast";
import type { JobState } from "./types";

export type TicketJobKind = "summary" | "review" | "spec" | "tests" | "estimate";
export type TrackedKind = TicketJobKind | "demo-draft" | "demo-build" | "demo-pdf" | "demo-flow" | "demo-record" | "demo-setup" | "retro" | "my-done";

export interface TrackedJob {
  id: string;
  kind: TrackedKind;
  keys: string[];
  startedAt: number;
  finished: boolean;
}

interface Store {
  jobs: TrackedJob[];
  add: (j: TrackedJob) => void;
  finish: (id: string) => void;
  dismiss: (id: string) => void;
}

const STORAGE = "dd.jobs";
const save = (jobs: TrackedJob[]) => {
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(jobs));
  } catch {
    /* private mode */
  }
};

// Lives outside any page/tab so a job keeps its progress when the user switches tabs, closes the drawer or navigates.
export const useJobTracker = create<Store>((set, get) => ({
  jobs: [],
  add: (j) => {
    const jobs = [...get().jobs.filter((x) => Date.now() - x.startedAt < 3_600_000), j].slice(-20);
    save(jobs);
    set({ jobs });
  },
  finish: (id) => {
    const jobs = get().jobs.map((x) => (x.id === id ? { ...x, finished: true } : x));
    save(jobs);
    set({ jobs });
  },
  dismiss: (id) => {
    const jobs = get().jobs.filter((x) => x.id !== id);
    save(jobs);
    set({ jobs });
  },
}));

export function restoreJobs() {
  try {
    const raw = sessionStorage.getItem(STORAGE);
    if (raw) useJobTracker.setState({ jobs: JSON.parse(raw) as TrackedJob[] });
  } catch {
    /* private mode */
  }
}

/** Registers a job started by any endpoint so its progress survives navigation. */
export function trackJob(kind: TrackedKind, keys: string[], job: JobState): void {
  useJobTracker.getState().add({ id: job.id, kind, keys, startedAt: Date.now(), finished: false });
}

export function useLatestOfKind<T = unknown>(kind: TrackedKind) {
  const tracked = useJobTracker((s) => [...s.jobs].reverse().find((j) => j.kind === kind));
  const job = useJob<T>(tracked?.id ?? null);
  const running = !!tracked && !tracked.finished && (!job.data || job.data.status === "running");
  return { tracked, job: job.data, running };
}

export async function startTracked(kind: TicketJobKind, keys: string[], force = false, extra: Record<string, unknown> = {}): Promise<void> {
  try {
    const j = await http.post<JobState>(`/api/${kind}/run`, { ...extra, keys, force });
    useJobTracker.getState().add({ id: j.id, kind, keys, startedAt: Date.now(), finished: false });
  } catch (e) {
    toast.fromError(`${kind} failed`, e);
  }
}

/** Latest tracked job of `kind` that includes `key` (live state polled from the server). */
export function useTrackedFor(kind: TrackedKind, key: string) {
  const tracked = useJobTracker((s) => [...s.jobs].reverse().find((j) => j.kind === kind && j.keys.includes(key)));
  const job = useJob(tracked?.id ?? null);
  const running = !!tracked && !tracked.finished && (!job.data || job.data.status === "running");
  return { tracked, job: job.data, running };
}

/** Latest tracked batch (any kind) — shown on the Tickets page. */
export function useLatestTracked() {
  const tracked = useJobTracker((s) => [...s.jobs].reverse().find((j) => j.kind === "summary" || j.kind === "review"));
  const job = useJob(tracked?.id ?? null);
  return { tracked, job: job.data };
}
