import React from "react";
import { useTheme } from "../theme/ThemeContext";

/**
 * 深色主题显示太阳（点击切浅色）；浅色显示月亮（点击切深色）。
 * 图标线条风，约 250ms 交叉淡入淡出。
 */
export const ThemeToggleButton: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="wl-theme-toggle"
      title={isDark ? "切换为浅色主题" : "切换为深色主题"}
      aria-label={isDark ? "切换为浅色主题" : "切换为深色主题"}
    >
      <span className="wl-theme-toggle__icons" aria-hidden>
        <svg
          className="wl-theme-toggle__icon wl-theme-toggle__icon--sun"
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg
          className="wl-theme-toggle__icon wl-theme-toggle__icon--moon"
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      </span>
    </button>
  );
};
