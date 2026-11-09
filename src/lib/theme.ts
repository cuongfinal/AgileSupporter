import { create } from "zustand";

/** "system" follows the OS (prefers-color-scheme); light/dark pin it via <html data-theme>. See styles/globals.css. */
export type ThemePref = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "dd.theme";

/** Runs in _document before first paint so a pinned theme never flashes; keep in sync with applyTheme(). */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

interface ThemeStore {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
}

export const useTheme = create<ThemeStore>((set) => ({
  theme: "system",
  setTheme: (theme) => {
    try {
      if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* private mode */
    }
    applyTheme(theme);
    set({ theme });
  },
}));

export function restoreTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") useTheme.setState({ theme: saved });
  } catch {
    /* private mode */
  }
}
