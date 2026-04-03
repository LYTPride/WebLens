import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 表头列宽拖拽底层实现；资源页请优先用 `useResourceListColumnResize` 统一接状态与总宽。
 * @param minForKey 可按列设置最小宽度，避免拖得过窄
 */
export function useColumnResize(
  columnWidths: Record<string, number>,
  setColumnWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>,
  defaults: Record<string, number>,
  minForKey: (colKey: string) => number,
) {
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const minForKeyRef = useRef(minForKey);
  minForKeyRef.current = minForKey;

  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const minW = minForKeyRef.current(resizingCol);
      setColumnWidths((prev) => ({
        ...prev,
        [resizingCol]: Math.max(minW, (resizeStartWidth.current + delta) | 0),
      }));
    };
    const onUp = () => setResizingCol(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingCol, setColumnWidths]);

  const beginResize = useCallback(
    (colKey: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      setResizingCol(colKey);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = columnWidths[colKey] ?? defaults[colKey];
    },
    [columnWidths, defaults],
  );

  return { resizingCol, beginResize };
}
