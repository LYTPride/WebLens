import React from "react";

export interface ResizableThProps {
  label: React.ReactNode;
  /** 表头标签右侧扩展（如排序箭头），与拖拽调宽手柄互不干扰 */
  sortTrailing?: React.ReactNode;
  width: number;
  /** 表头基础样式（与页面 th 一致） */
  thBase: React.CSSProperties;
  sticky?: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
}

/**
 * 可拖拽右边界的表头单元格。
 * 与 `useResourceListColumnResize` + `useColumnResize` 配合，供各资源列表表复用。
 */
export const ResizableTh: React.FC<ResizableThProps> = ({
  label,
  sortTrailing,
  width,
  thBase,
  sticky = true,
  onResizeStart,
}) => (
  <th
    className={sticky ? "wl-table-sticky-head" : undefined}
    style={{
      ...thBase,
      ...(sticky
        ? {
            position: "sticky" as const,
            top: 0,
            zIndex: 2,
            backgroundColor: "#0f172a",
            boxShadow: "0 1px 0 0 #1f2937",
          }
        : { position: "relative" as const }),
      width,
      maxWidth: width,
      minWidth: width,
      boxSizing: "border-box",
      verticalAlign: "middle",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        minWidth: 0,
        paddingRight: sortTrailing ? 2 : 0,
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {sortTrailing}
    </div>
    <div
      role="presentation"
      onMouseDown={onResizeStart}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 6,
        bottom: 0,
        cursor: "col-resize",
        userSelect: "none",
      }}
      title="拖拽调整列宽"
    />
  </th>
);
