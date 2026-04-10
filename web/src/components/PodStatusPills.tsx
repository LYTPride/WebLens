import React from "react";

const pillBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  maxWidth: "100%",
  boxSizing: "border-box",
};

/** 与 Pods 列表「状态标签」列色系一致（健康 / 关注 / 警告 / 严重）；色值随主题 token 变化 */
export function PodHealthPill({ label, title }: { label: string; title?: string }) {
  let bg = "var(--wl-pill-success-bg)";
  let border = "var(--wl-pill-success-border)";
  let color = "var(--wl-pill-success-text)";
  if (label === "关注") {
    bg = "var(--wl-pill-attention-bg)";
    border = "var(--wl-pill-attention-border)";
    color = "var(--wl-pill-attention-text)";
  } else if (label === "警告") {
    bg = "var(--wl-pill-orange-bg)";
    border = "var(--wl-pill-orange-border)";
    color = "var(--wl-pill-orange-text)";
  } else if (label === "严重") {
    bg = "var(--wl-pill-danger-bg)";
    border = "var(--wl-pill-danger-border)";
    color = "var(--wl-pill-danger-text)";
  }
  return (
    <span
      style={{
        ...pillBase,
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color,
        cursor: title ? "default" : "inherit",
      }}
      title={title}
    >
      {label}
    </span>
  );
}

function podListStatusPillColors(text: string): { bg: string; border: string; color: string } {
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  if (raw === "" || raw === "-" || t === "unknown") {
    return {
      bg: "var(--wl-pill-neutral-bg)",
      border: "var(--wl-pill-neutral-border)",
      color: "var(--wl-pill-neutral-text)",
    };
  }
  if (t === "running") {
    return {
      bg: "var(--wl-pill-success-bg)",
      border: "var(--wl-pill-success-border)",
      color: "var(--wl-pill-success-text)",
    };
  }
  if (t === "pending") {
    return {
      bg: "var(--wl-pill-attention-bg)",
      border: "var(--wl-pill-attention-border)",
      color: "var(--wl-pill-attention-text)",
    };
  }
  if (t === "succeeded" || t === "completed" || t.includes("completed")) {
    return {
      bg: "var(--wl-pill-info-bg)",
      border: "var(--wl-pill-info-border)",
      color: "var(--wl-pill-info-text)",
    };
  }
  if (t === "failed" || t.includes("failed") || t.includes("error") || t.includes("crash") || t.includes("backoff")) {
    return {
      bg: "var(--wl-pill-danger-bg)",
      border: "var(--wl-pill-danger-border)",
      color: "var(--wl-pill-danger-text)",
    };
  }
  if (t.includes("terminat")) {
    return {
      bg: "var(--wl-pill-muted-bg)",
      border: "var(--wl-pill-muted-border)",
      color: "var(--wl-pill-muted-text)",
    };
  }
  if (t.startsWith("init:") || t.includes("creating") || t.includes("waiting")) {
    return {
      bg: "var(--wl-pill-attention-bg)",
      border: "var(--wl-pill-attention-border)",
      color: "var(--wl-pill-attention-text)",
    };
  }
  if (t.includes("oom") || t.includes("kill")) {
    return {
      bg: "var(--wl-pill-danger-bg)",
      border: "var(--wl-pill-danger-border)",
      color: "var(--wl-pill-danger-text)",
    };
  }
  return {
    bg: "var(--wl-pill-surface-bg)",
    border: "var(--wl-pill-surface-border)",
    color: "var(--wl-pill-surface-text)",
  };
}

/**
 * Pods 列表 Status 列与 PVC Describe 关联 Pod 表：与 getPodStatusInfo 文案配套的胶囊色（非第二套健康体系）。
 */
export function PodListStatusPill({ text, title }: { text: string; title?: string }) {
  const { bg, border, color } = podListStatusPillColors(text);
  const display = text.trim() || "—";
  return (
    <span
      style={{
        ...pillBase,
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color,
      }}
      title={title ?? (display !== "—" ? display : undefined)}
    >
      {display}
    </span>
  );
}
