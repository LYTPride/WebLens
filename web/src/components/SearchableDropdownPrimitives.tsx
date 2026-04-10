import React from "react";
import type { ClusterSummary } from "../api";

/** 与主页「作用域选择」下拉内搜索框一致的 input 样式，供多处复用 */
export const WL_SEARCHABLE_DROPDOWN_INPUT_STYLE: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--wl-border-subtle)",
  backgroundColor: "var(--wl-bg-input)",
  color: "var(--wl-text-primary)",
  fontSize: 13,
};

/** 下拉面板外层（flex 列：顶栏搜索 + 滚动列表） */
export const WL_SEARCHABLE_DROPDOWN_PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  marginTop: 4,
  minWidth: 320,
  maxHeight: 320,
  backgroundColor: "var(--wl-menu-search-bg)",
  border: "1px solid var(--wl-menu-search-border)",
  borderRadius: 8,
  boxShadow: "var(--wl-shadow-dropdown)",
  zIndex: 41,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

/** 搜索框外圈留白 */
export const WL_SEARCHABLE_DROPDOWN_SEARCH_MARGIN_STYLE: React.CSSProperties = {
  margin: 8,
  minWidth: 0,
  flexShrink: 0,
};

/** 列表滚动区（占满剩余高度） */
export const WL_SEARCHABLE_DROPDOWN_SCROLL_STYLE: React.CSSProperties = {
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
  maxHeight: 260,
};

/** Portal 大下拉：高度由外层面板 maxHeight 约束，列表区仅 flex 滚动 */
export const WL_SEARCHABLE_DROPDOWN_SCROLL_PORTAL_STYLE: React.CSSProperties = {
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
};

export function kubeconfigDisplayFileName(filePath: string): string {
  return filePath.replace(/^.*[/\\]/, "") || filePath;
}

type TwoColRowProps = {
  left: React.ReactNode;
  right: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** 是否显示底部分隔线 */
  borderBottom?: boolean;
};

/**
 * 下拉项双列：左文件名、右集群名（或其它主文案），纵向与其它行对齐。
 */
export function SearchableDropdownTwoColumnRow({
  left,
  right,
  selected,
  onClick,
  borderBottom = true,
}: TwoColRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`wl-searchable-dropdown-row${selected ? " wl-searchable-dropdown-row--selected" : ""}`}
      style={{
        display: "block",
        width: "100%",
        padding: "8px 12px",
        textAlign: "left",
        border: "none",
        borderBottom: borderBottom ? "1px solid var(--wl-border-strong)" : undefined,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) min-content minmax(0, 1.15fr)",
          columnGap: 8,
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: selected ? "var(--wl-accent-sky)" : "var(--wl-text-heading)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={typeof left === "string" ? left : undefined}
        >
          {left}
        </span>
        <span style={{ color: "var(--wl-text-muted)", fontSize: 12, userSelect: "none" }} aria-hidden>
          ·
        </span>
        <span
          style={{
            fontSize: 12,
            color: selected ? "var(--wl-accent-sky-muted)" : "var(--wl-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={typeof right === "string" ? right : undefined}
        >
          {right}
        </span>
      </div>
    </button>
  );
}

/** 平台配置里集群行：左文件、右集群名（与列表数据一致） */
export function clusterOptionColumns(cluster: ClusterSummary): { left: string; right: string } {
  return {
    left: kubeconfigDisplayFileName(cluster.filePath),
    right: cluster.name,
  };
}
