import React, { useCallback, useEffect, useMemo, useState } from "react";

export type TransferKind = "upload" | "download";

export type TransferStatus = "running" | "success" | "error";

/** 下载进度语义：真实 Content-Length / 列表原始大小估算 / 无法估算 */
export type DownloadProgressBasis = "exact" | "estimated" | "unknown";

export type TransferTask = {
  id: string;
  kind: TransferKind;
  /** 展示用文件名或任务标题 */
  label: string;
  status: TransferStatus;
  /** 进度条宽度 0–100；估算进行中且比例可超 100% 时条封顶约 97，完成后再 100 */
  percent: number | null;
  loaded: number;
  total: number | null;
  detail?: string;
  /** 仅下载：进度依据；上传勿设 */
  downloadBasis?: DownloadProgressBasis;
  /** 估算分母：勾选项在列表中的 size 之和（字节） */
  estimateTotalBytes?: number;
};

type Props = {
  tasks: TransferTask[];
  defaultCollapsed?: boolean;
  onDismissTask?: (id: string) => void;
};

export function formatTransferBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** 进行中时进度条旁文案：区分真实 / 估算 / 上传 */
function runningPercentLabel(t: TransferTask): string | null {
  if (t.percent == null || t.status !== "running") return null;
  if (t.kind === "upload") return `${t.percent}%`;
  if (t.downloadBasis === "exact") return `${t.percent}%（真实）`;
  if (t.downloadBasis === "estimated" && t.estimateTotalBytes != null && t.estimateTotalBytes > 0) {
    const raw = (t.loaded / t.estimateTotalBytes) * 100;
    const n = Math.round(raw);
    if (raw > 100) return `约 97%（估算）`;
    return `约 ${Math.min(99, n)}%（估算）`;
  }
  return null;
}

export function FileTransferTasksPanel({ tasks, defaultCollapsed = false, onDismissTask }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const running = useMemo(() => tasks.filter((t) => t.status === "running").length, [tasks]);

  useEffect(() => {
    ensureTransferPanelStyles();
  }, []);

  useEffect(() => {
    if (running > 0) setCollapsed(false);
  }, [running]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  if (tasks.length === 0) return null;

  return (
    <div style={panelWrap}>
      <button type="button" onClick={toggle} style={headerBtn} aria-expanded={!collapsed}>
        <span style={{ fontWeight: 600, color: "var(--wl-text-heading)" }}>传输任务</span>
        <span style={badge}>
          {tasks.length}
          {running > 0 ? ` · ${running} 进行中` : ""}
        </span>
        <span style={chevron}>{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div style={listScroll}>
          {tasks.map((t) => {
            const pctLabel = runningPercentLabel(t);
            return (
            <div key={t.id} style={row}>
              <div style={rowTop}>
                <span style={kindTag(t.kind)}>{t.kind === "upload" ? "上传" : "下载"}</span>
                <span style={nameSpan} title={t.label}>
                  {truncate(t.label, 36)}
                </span>
                {onDismissTask && t.status !== "running" && (
                  <button
                    type="button"
                    style={dismissBtn}
                    onClick={() => onDismissTask(t.id)}
                    aria-label="关闭此任务"
                  >
                    ×
                  </button>
                )}
              </div>
              <div style={rowMeta}>
                <span style={statusStyle(t.status)}>
                  {t.status === "running" && "进行中"}
                  {t.status === "success" && "成功"}
                  {t.status === "error" && "失败"}
                </span>
                {t.percent != null && t.status === "running" && pctLabel != null && (
                  <span style={{ color: "var(--wl-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                    {pctLabel}
                  </span>
                )}
                {t.percent != null && t.status === "running" && pctLabel == null && (
                  <span style={{ color: "var(--wl-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{t.percent}%</span>
                )}
                {t.percent == null && t.status === "running" && (
                  <span style={{ color: "var(--wl-text-secondary)" }}>{formatTransferBytes(t.loaded)}</span>
                )}
                {t.status === "success" && t.total != null && t.total > 0 && (
                  <span style={{ color: "var(--wl-text-muted)" }}>共 {formatTransferBytes(t.total)}</span>
                )}
                {t.status === "success" && (t.total == null || t.total <= 0) && t.loaded > 0 && (
                  <span style={{ color: "var(--wl-text-muted)" }}>共 {formatTransferBytes(t.loaded)}</span>
                )}
              </div>
              {t.percent != null && (
                <div style={barTrack}>
                  <div
                    style={{
                      ...barFill,
                      width: `${Math.min(100, Math.max(0, t.status === "success" ? 100 : t.percent))}%`,
                      backgroundColor:
                        t.downloadBasis === "estimated" && t.status === "running"
                          ? "#a78bfa"
                          : t.status === "error"
                            ? "#f87171"
                            : t.status === "success"
                              ? "#22c55e"
                              : "var(--wl-accent-sky)",
                    }}
                  />
                </div>
              )}
              {t.percent == null && t.status === "running" && (
                <div style={barTrack}>
                  <div style={indeterminateBar} />
                </div>
              )}
              {t.detail && (
                <div
                  style={{
                    ...detailLine,
                    color: t.status === "error" ? "#f87171" : "var(--wl-text-muted)",
                    whiteSpace: "pre-line",
                  }}
                >
                  {t.detail}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function kindTag(kind: TransferKind): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "1px 5px",
    borderRadius: 4,
    flexShrink: 0,
    backgroundColor: kind === "upload" ? "#1e3a5f" : "#312e81",
    color: kind === "upload" ? "#7dd3fc" : "#c4b5fd",
  };
}

function statusStyle(s: TransferStatus): React.CSSProperties {
  if (s === "success") return { color: "#4ade80", fontSize: 11 };
  if (s === "error") return { color: "#f87171", fontSize: 11 };
  return { color: "var(--wl-accent-sky)", fontSize: 11 };
}

const panelWrap: React.CSSProperties = {
  borderBottom: "1px solid var(--wl-border-table-row)",
  backgroundColor: "var(--wl-bg-expanded)",
  flexShrink: 0,
};

const headerBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 12,
};

const badge: React.CSSProperties = {
  color: "var(--wl-text-secondary)",
  fontSize: 11,
  flex: 1,
  minWidth: 0,
};

const chevron: React.CSSProperties = {
  color: "var(--wl-text-muted)",
  fontSize: 12,
  flexShrink: 0,
};

const listScroll: React.CSSProperties = {
  maxHeight: 140,
  overflowY: "auto",
  padding: "0 8px 8px",
  borderTop: "1px solid var(--wl-border-sidebar)",
};

const row: React.CSSProperties = {
  padding: "6px 4px",
  borderBottom: "1px solid var(--wl-border-sidebar)",
};
const rowTop: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};
const nameSpan: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  color: "var(--wl-text-heading)",
  fontSize: 11,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const dismissBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--wl-text-muted)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: "0 4px",
  flexShrink: 0,
};
const rowMeta: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 4,
  flexWrap: "wrap",
};
const barTrack: React.CSSProperties = {
  position: "relative",
  height: 4,
  borderRadius: 2,
  backgroundColor: "var(--wl-bg-control)",
  marginTop: 6,
  overflow: "hidden",
};
const barFill: React.CSSProperties = {
  height: "100%",
  borderRadius: 2,
  transition: "width 0.12s ease-out",
};
const indeterminateBar: React.CSSProperties = {
  height: "100%",
  width: "36%",
  borderRadius: 2,
  backgroundColor: "var(--wl-accent-sky)",
  animation: "wl-transfer-slide 1.1s ease-in-out infinite",
};

const detailLine: React.CSSProperties = {
  marginTop: 4,
  fontSize: 10,
  lineHeight: 1.35,
};

let injected = false;
function ensureTransferPanelStyles() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const id = "wl-file-transfer-keyframes";
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = `@keyframes wl-transfer-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}`;
  document.head.appendChild(el);
}
