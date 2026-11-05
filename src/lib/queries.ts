import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { http } from "./client";
import type { PublicSettings, RepoStatus, Sprint, SprintTicket } from "./types";

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => http.get<PublicSettings>("/api/settings"), staleTime: 60_000 });
}

export interface CliStatus {
  provider: "claude" | "copilot";
  found: boolean;
  bin: string;
  version: string;
}
export function useAiStatus() {
  return useQuery({ queryKey: ["ai-status"], queryFn: () => http.get<CliStatus[]>("/api/ai/status"), staleTime: 300_000 });
}

export function useSprints(enabled = true) {
  return useQuery({ queryKey: ["sprints"], queryFn: () => http.get<Sprint[]>("/api/jira/sprints"), enabled, staleTime: 300_000 });
}

export function useSprintTickets(sprintId: number | null) {
  return useQuery({
    queryKey: ["sprint", sprintId],
    queryFn: () => http.get<SprintTicket[]>(`/api/jira/sprint/${sprintId}`),
    enabled: sprintId !== null,
  });
}

export type RepoStatusResponse = RepoStatus & { suggestion?: string };
export function useRepoStatus(key: string, enabled = true) {
  return useQuery({
    queryKey: ["repo-status", key],
    queryFn: () => http.get<RepoStatusResponse>(`/api/repos/${key}/status`),
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

interface SprintPick {
  sprintId: number | null;
  setSprintId: (id: number | null) => void;
}
export const useSprintPick = create<SprintPick>((set) => ({
  sprintId: null,
  setSprintId: (sprintId) => {
    try {
      localStorage.setItem("dd.sprint", String(sprintId ?? ""));
    } catch {
      /* private mode */
    }
    set({ sprintId });
  },
}));

export function restoreSprint() {
  try {
    const v = Number(localStorage.getItem("dd.sprint"));
    if (v) useSprintPick.setState({ sprintId: v });
  } catch {
    /* private mode */
  }
}
