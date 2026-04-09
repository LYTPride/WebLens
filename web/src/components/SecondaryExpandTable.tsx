import React from "react";
import { ResizableTh } from "./ResizableTh";

export type SecondaryExpandColumnDef<K extends string = string> = {
  key: K;
  label: string;
};

/** 与次级展开表头统一：略紧凑，贴近原 Ingress/Service 展开区 */
export const secondaryExpandThBase: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid #1f2937",
  fontSize: 11,
  color: "#94a3b8",
};

export const secondaryExpandTdBase: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #111827",
  fontSize: 12,
  color: "#e5e7eb",
};

/**
 * 数据列：强制落在列宽内换行，配合 table-layout:fixed + colgroup，避免小屏串列。
 */
export function secondaryExpandDataCellStyle(base: React.CSSProperties = secondaryExpandTdBase): React.CSSProperties {
  return {
    ...base,
    verticalAlign: "top",
    maxWidth: 0,
    overflow: "hidden",
    wordBreak: "break-word",
    overflowWrap: "break-word",
    whiteSpace: "normal",
    boxSizing: "border-box",
  };
}

/** path / 正则等：允许在任意字符处断行 */
export function secondaryExpandBreakAllCellStyle(base: React.CSSProperties = secondaryExpandTdBase): React.CSSProperties {
  return {
    ...secondaryExpandDataCellStyle(base),
    wordBreak: "break-all",
  };
}

/** 含 Portal 菜单、Chip 的列：不裁切弹出层，但仍顶对齐 */
export function secondaryExpandActionsCellStyle(base: React.CSSProperties = secondaryExpandTdBase): React.CSSProperties {
  return {
    ...base,
    verticalAlign: "top",
    overflow: "visible",
    whiteSpace: "normal",
    wordBreak: "break-word",
    boxSizing: "border-box",
  };
}

type SecondaryExpandTableProps<K extends string> = {
  columns: readonly SecondaryExpandColumnDef<K>[];
  columnWidths: Record<string, number>;
  defaults: Record<K, number>;
  beginResize: (colKey: K) => (e: React.MouseEvent) => void;
  totalDataWidth: number;
  children: React.ReactNode;
};

/**
 * 资源页「次级展开」统一表格：colgroup 与 ResizableTh 同源宽、横向可滚动，低分辨率不串列。
 */
export function SecondaryExpandTable<K extends string>({
  columns,
  columnWidths,
  defaults,
  beginResize,
  totalDataWidth,
  children,
}: SecondaryExpandTableProps<K>) {
  const tableWidth = Math.max(totalDataWidth, 320);
  return (
    <div
      className="wl-secondary-expand-table-wrap"
      style={{
        overflowX: "auto",
        maxWidth: "100%",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <table
        style={{
          width: tableWidth,
          minWidth: "100%",
          borderCollapse: "collapse",
          backgroundColor: "#020617",
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: columnWidths[c.key] ?? defaults[c.key] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <ResizableTh
                key={c.key}
                label={c.label}
                width={columnWidths[c.key] ?? defaults[c.key]}
                thBase={secondaryExpandThBase}
                sticky={false}
                onResizeStart={beginResize(c.key)}
              />
            ))}
          </tr>
        </thead>
        <tbody className="wl-table-body">{children}</tbody>
      </table>
    </div>
  );
}
