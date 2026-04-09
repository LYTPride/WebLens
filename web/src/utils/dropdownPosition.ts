/** 下拉 / 弹出层相对视口的定位（供 Portal 菜单复用） */

export type DropdownAlign = "right" | "left";

export type ComputeDropdownPositionOptions = {
  align: DropdownAlign;
  /** 距视口边缘留白，默认 8 */
  margin?: number;
  viewportW: number;
  viewportH: number;
};

/**
 * 默认向下展开；下方空间不足则向上；上下都不足则选空间较大一侧并限制 maxHeight 以便内部滚动。
 */
export function computeDropdownPosition(
  trigger: DOMRect,
  panelWidth: number,
  panelHeight: number,
  opts: ComputeDropdownPositionOptions,
): { top: number; left: number; maxHeight?: number } {
  const margin = opts.margin ?? 8;
  const { viewportW: vw, viewportH: vh } = opts;

  const pw = Math.max(panelWidth, 1);
  const ph = Math.max(panelHeight, 1);

  let left = opts.align === "right" ? trigger.right - pw : trigger.left;
  left = Math.max(margin, Math.min(left, vw - pw - margin));

  const availBelow = vh - trigger.bottom - 2 * margin;
  const availAbove = trigger.top - 2 * margin;

  let top: number;
  let maxHeight: number | undefined;

  if (ph <= availBelow) {
    top = trigger.bottom + margin;
  } else if (ph <= availAbove) {
    top = trigger.top - ph - margin;
  } else if (availBelow >= availAbove) {
    maxHeight = Math.max(120, availBelow);
    top = trigger.bottom + margin;
  } else {
    maxHeight = Math.max(120, availAbove);
    top = trigger.top - maxHeight - margin;
  }

  const usedH = maxHeight ?? ph;
  top = Math.max(margin, Math.min(top, vh - usedH - margin));

  return { top, left, maxHeight };
}
