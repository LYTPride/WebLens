import { useEffect } from "react";

/**
 * 按下 Escape 时关闭浮层（菜单 / 下拉等）。
 */
export function useEscapeToClose(onClose: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled, onClose]);
}
