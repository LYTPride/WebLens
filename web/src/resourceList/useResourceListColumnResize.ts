import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { useColumnResize } from "../hooks/useColumnResize";

/**
 * 资源列表表「可拖拽列宽」的统一封装：列宽 state + useColumnResize + 数据列总宽度。
 * 供 Pods / Deployments / StatefulSets / Ingresses 等复用；勾选列、展开列等单独加 LIST_SELECT_COL_WIDTH。
 * 次级展开子表（Ingress 规则、STS Pod、Service Ports/Endpoints）另起一组 columnKeys + 本 hook 实例，见 SecondaryExpandTable。
 */
export function useResourceListColumnResize<K extends string>(config: {
  columnKeys: readonly K[];
  defaults: Record<K, number>;
  minWidthForKey: (key: string) => number;
}): {
  columnWidths: Record<string, number>;
  setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>;
  beginResize: (colKey: K) => (e: React.MouseEvent) => void;
  resizingCol: string | null;
  /** 当前各数据列宽度之和（不含勾选列等额外列） */
  totalDataWidth: number;
} {
  const { columnKeys, defaults, minWidthForKey } = config;
  const defaultsRecord = defaults as Record<string, number>;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => ({ ...defaultsRecord }));
  const { beginResize, resizingCol } = useColumnResize(
    columnWidths,
    setColumnWidths,
    defaultsRecord,
    minWidthForKey,
  );

  const totalDataWidth = useMemo(
    () => columnKeys.reduce((sum, k) => sum + (columnWidths[k] ?? defaults[k]), 0),
    [columnKeys, columnWidths, defaults],
  );

  return {
    columnWidths,
    setColumnWidths,
    beginResize: beginResize as (colKey: K) => (e: React.MouseEvent) => void,
    resizingCol,
    totalDataWidth,
  };
}
