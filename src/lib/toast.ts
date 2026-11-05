import { create } from "zustand";

export type ToastKind = "success" | "error" | "info" | "warning";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastStore {
  items: ToastItem[];
  push: (kind: ToastKind, title: string, message?: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastStore>((set) => ({
  items: [],
  push: (kind, title, message) => set((s) => ({ items: [...s.items.slice(-3), { id: ++seq, kind, title, message }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, message?: string) => useToasts.getState().push("success", title, message),
  error: (title: string, message?: string) => useToasts.getState().push("error", title, message),
  info: (title: string, message?: string) => useToasts.getState().push("info", title, message),
  fromError: (title: string, e: unknown) => useToasts.getState().push("error", title, e instanceof Error ? e.message : String(e)),
};
