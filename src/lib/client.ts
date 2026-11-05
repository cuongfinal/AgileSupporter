import { useQuery } from "@tanstack/react-query";
import type { JobState } from "./types";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? (typeof data === "string" && data ? data : `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data as T;
}

export const http = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export function useJob<T = unknown>(id: string | null) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => http.get<JobState<T>>(`/api/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "running" ? false : 1000),
    staleTime: 0,
  });
}

export function download(filename: string, content: string, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function vscodeLink(absPath: string, line: number | null): string {
  return `vscode://file${absPath.startsWith("/") ? "" : "/"}${encodeURI(absPath)}${line ? `:${line}` : ""}`;
}
