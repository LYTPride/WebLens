import React from "react";
import type { ClusterSummary } from "../api";

/** 与主页「作用域选择」下拉内搜索框一致的 input 样式，供多处复用 */
export const WL_SEARCHABLE_DROPDOWN_INPUT_STYLE: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid #1f2937",
  backgroundColor: "#020617",
  color: "#e5e7eb",
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
  backgroundColor: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
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
      style={{
        display: "block",
        width: "100%",
        padding: "8px 12px",
        textAlign: "left",
        backgroundColor: selected ? "#1e293b" : "transparent",
        border: "none",
        borderBottom: borderBottom ? "1px solid #1e293b" : undefined,
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
            color: selected ? "#38bdf8" : "#e2e8f0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={typeof left === "string" ? left : undefined}
        >
          {left}
        </span>
        <span style={{ color: "#475569", fontSize: 12, userSelect: "none" }} aria-hidden>
          ·
        </span>
        <span
          style={{
            fontSize: 12,
            color: selected ? "#7dd3fc" : "#94a3b8",
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
