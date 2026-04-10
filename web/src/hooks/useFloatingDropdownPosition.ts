import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { computeDropdownPosition, type DropdownAlign } from "../utils/dropdownPosition";

export type FloatingDropdownLayout = {
  top: number;
  left: number;
  maxHeight?: number;
  minWidth?: number;
};

type UseFloatingDropdownPositionOptions = {
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  align: DropdownAlign;
  /** 测量前回调（例如可搜索面板根据 trigger 宽度设 minWidth） */
  beforeMeasure?: (panel: HTMLDivElement, triggerRect: DOMRect) => void;
  /** 内容变化导致高度变化时重算 */
  contentKey?: unknown;
};

/**
 * 统一下拉定位：视口边距、上下翻折、maxHeight、横向夹紧。
 * 由父级「仅打开时挂载」本 hook 所在组件，避免未打开时订阅。
 */
export function useFloatingDropdownPosition({
  triggerRef,
  panelRef,
  align,
  beforeMeasure,
  contentKey,
}: UseFloatingDropdownPositionOptions): FloatingDropdownLayout | null {
  const [layout, setLayout] = useState<FloatingDropdownLayout | null>(null);
  const beforeMeasureRef = useRef(beforeMeasure);
  beforeMeasureRef.current = beforeMeasure;

  useLayoutEffect(() => {
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      const trig = triggerRef.current;
      const panel = panelRef.current;
      if (!trig || !panel) return;
      const tr = trig.getBoundingClientRect();
      beforeMeasureRef.current?.(panel, tr);
      const pw = panel.offsetWidth || 160;
      const ph = panel.offsetHeight || 80;
      const pos = computeDropdownPosition(tr, pw, ph, {
        align,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      });
      const minWStyle = panel.style.minWidth;
      const minWidth =
        minWStyle && minWStyle.endsWith("px") ? parseFloat(minWStyle) : undefined;
      setLayout({
        ...pos,
        ...(minWidth != null && !Number.isNaN(minWidth) ? { minWidth } : {}),
      });
    };

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      run();
      raf2 = requestAnimationFrame(run);
    });

    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
    };
  }, [align, contentKey, triggerRef, panelRef]);

  return layout;
}
