export const THEME_STORAGE_KEY = "weblens-theme";

export type ThemeMode = "dark" | "light";

export function readStoredThemeChoice(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredThemeChoice(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function getPreferredThemeFromSystem(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** 无本地记录时跟系统；有记录时以本地为准（与 index.html 首屏脚本一致） */
export function resolveThemeForFirstPaint(): ThemeMode {
  return readStoredThemeChoice() ?? getPreferredThemeFromSystem();
}

export function readThemeFromDocument(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  const a = document.documentElement.getAttribute("data-theme");
  return a === "light" ? "light" : "dark";
}
