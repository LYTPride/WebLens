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

/** 与 Pods 列表「状态标签」列色系一致（健康 / 关注 / 警告 / 严重） */
export function PodHealthPill({ label, title }: { label: string; title?: string }) {
  let bg = "rgba(22,163,74,0.15)";
  let border = "rgba(22,163,74,0.6)";
  let color = "#bbf7d0";
  if (label === "关注") {
    bg = "rgba(202,138,4,0.18)";
    border = "rgba(234,179,8,0.7)";
    color = "#facc15";
  } else if (label === "警告") {
    bg = "rgba(249,115,22,0.2)";
    border = "rgba(249,115,22,0.75)";
    color = "#fed7aa";
  } else if (label === "严重") {
    bg = "rgba(185,28,28,0.25)";
    border = "rgba(248,113,113,0.85)";
    color = "#fecaca";
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
    return { bg: "rgba(100,116,139,0.2)", border: "rgba(148,163,184,0.55)", color: "#cbd5e1" };
  }
  if (t === "running") {
    return { bg: "rgba(22,163,74,0.15)", border: "rgba(22,163,74,0.6)", color: "#bbf7d0" };
  }
  if (t === "pending") {
    return { bg: "rgba(202,138,4,0.18)", border: "rgba(234,179,8,0.7)", color: "#facc15" };
  }
  if (t === "succeeded" || t === "completed" || t.includes("completed")) {
    return { bg: "rgba(59,130,246,0.15)", border: "rgba(96,165,250,0.65)", color: "#bfdbfe" };
  }
  if (t === "failed" || t.includes("failed") || t.includes("error") || t.includes("crash") || t.includes("backoff")) {
    return { bg: "rgba(185,28,28,0.25)", border: "rgba(248,113,113,0.85)", color: "#fecaca" };
  }
  if (t.includes("terminat")) {
    return { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.45)", color: "#cbd5e1" };
  }
  if (t.startsWith("init:") || t.includes("creating") || t.includes("waiting")) {
    return { bg: "rgba(202,138,4,0.18)", border: "rgba(234,179,8,0.7)", color: "#facc15" };
  }
  if (t.includes("oom") || t.includes("kill")) {
    return { bg: "rgba(185,28,28,0.25)", border: "rgba(248,113,113,0.85)", color: "#fecaca" };
  }
  return { bg: "rgba(30,41,59,0.85)", border: "rgba(51,65,85,0.9)", color: "#e2e8f0" };
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
