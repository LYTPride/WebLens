import React from "react";
import type { SortDirection } from "../utils/resourceListSort";

const arrowBtnBase: React.CSSProperties = {
  padding: 0,
  margin: 0,
  border: "none",
  background: "none",
  cursor: "pointer",
  lineHeight: 0.85,
  fontSize: 9,
  color: "#64748b",
};

export interface ResourceSortArrowsProps {
  activeDirection: SortDirection | null;
  onPickAsc: () => void;
  onPickDesc: () => void;
}

/**
 * 表头排序：上三角正序、下三角倒序；当前方向高亮。
 */
export const ResourceSortArrows: React.FC<ResourceSortArrowsProps> = ({
  activeDirection,
  onPickAsc,
  onPickDesc,
}) => (
  <span
    style={{ display: "inline-flex", flexDirection: "column", flexShrink: 0, marginLeft: 2 }}
    onMouseDown={(e) => e.stopPropagation()}
  >
    <button
      type="button"
      aria-label="按此列升序排序"
      onClick={(e) => {
        e.stopPropagation();
        onPickAsc();
      }}
      style={{
        ...arrowBtnBase,
        color: activeDirection === "asc" ? "#38bdf8" : "#64748b",
      }}
    >
      ▲
    </button>
    <button
      type="button"
      aria-label="按此列降序排序"
      onClick={(e) => {
        e.stopPropagation();
        onPickDesc();
      }}
      style={{
        ...arrowBtnBase,
        color: activeDirection === "desc" ? "#38bdf8" : "#64748b",
      }}
    >
      ▼
    </button>
  </span>
);
