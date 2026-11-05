import { create } from "zustand";
import type { Lang } from "./types";
import { en, vi } from "./messages";

interface LangStore {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangStore>((set) => ({
  lang: "en",
  setLang: (lang) => {
    try {
      localStorage.setItem("dd.lang", lang);
    } catch {
      /* private mode */
    }
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

export function restoreLang() {
  try {
    const saved = localStorage.getItem("dd.lang");
    if (saved === "en" || saved === "vi") useLang.getState().setLang(saved);
  } catch {
    /* private mode */
  }
}

export type MessageKey = keyof typeof en;

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = (lang === "vi" ? vi[key] : en[key]) ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const lang = useLang((s) => s.lang);
  return {
    lang,
    t: (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    pick: <T,>(b: { en: T; vi: T }): T => b[lang],
  };
}
