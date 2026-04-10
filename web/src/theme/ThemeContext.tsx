import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getPreferredThemeFromSystem,
  readStoredThemeChoice,
  readThemeFromDocument,
  resolveThemeForFirstPaint,
  type ThemeMode,
  writeStoredThemeChoice,
} from "./themeStorage";

type ThemeContextValue = {
  theme: ThemeMode;
  /** 用户显式切换并写入 localStorage */
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialThemeState(): ThemeMode {
  if (typeof document !== "undefined") {
    const fromDom = readThemeFromDocument();
    if (fromDom === "light" || fromDom === "dark") return fromDom;
  }
  return resolveThemeForFirstPaint();
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialThemeState);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  /** 未手动存偏好时，跟随系统色变化 */
  useEffect(() => {
    if (readStoredThemeChoice() !== null) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      setThemeState(mq.matches ? "light" : "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    writeStoredThemeChoice(mode);
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
