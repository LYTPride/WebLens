import { useLayoutEffect } from "react";

/**
 * 下拉/弹层打开时将焦点移到搜索框：供「带内置搜索的下拉菜单」复用。
 * 使用双 requestAnimationFrame，避免与首帧布局冲突导致闪动或 focus 丢失。
 *
 * @param selectAllWhenNonEmpty 为 true 时，若输入框已有内容则在 focus 后全选，便于直接替换关键字
 */
export function useFocusInputWhenOpen(
  open: boolean,
  inputRef: React.RefObject<HTMLInputElement | null>,
  selectAllWhenNonEmpty = false,
): void {
  useLayoutEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const el = inputRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        if (selectAllWhenNonEmpty && el.value.length > 0) {
          el.select();
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, inputRef, selectAllWhenNonEmpty]);
}
