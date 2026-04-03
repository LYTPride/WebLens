import React, { useState } from "react";
import type { EventSortRow } from "../../utils/resourceListSort";
import { buildEventSortStats } from "../../utils/resourceListSort";
import { formatEventInvolved, involvedKindToView, involvedObjectFilterName } from "../../utils/eventTable";
import { ResourceJumpChip } from "../ResourceJumpChip";

const sectionTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  color: "#e5e7eb",
};

function formatTime(s: string | undefined): string {
  if (!s) return "—";
  return s;
}

export type EventDescribeContentProps = {
  event: EventSortRow;
  /** 跳转关联资源页并设置名称过滤（由 InvolvedObject.kind 在 App 内统一解析） */
  onJumpToResource: (involvedKind: string | undefined, nameFilter: string) => void;
  /** Nodes 无权限时禁用跳转并展示 title */
  nodesNavBlocked?: boolean;
  copyText: (text: string) => void;
};

export function EventDescribeContent({
  event,
  onJumpToResource,
  nodesNavBlocked,
  copyText,
}: EventDescribeContentProps) {
  const [copied, setCopied] = useState(false);
  const stats = buildEventSortStats(event);
  const view = involvedKindToView(event.involvedObject?.kind);
  const filterName = involvedObjectFilterName(event);
  const jumpLabel =
    view === "pods"
      ? "Pods"
      : view === "persistentvolumeclaims"
        ? "PVC"
        : view === "services"
          ? "Services"
          : view === "ingresses"
            ? "Ingresses"
            : view === "nodes"
              ? "Nodes"
              : view === "deployments"
                ? "Deployments"
                : view === "statefulsets"
                  ? "Stateful Sets"
                  : "";

  const handleCopyMessage = () => {
    const msg = event.message || "";
    if (!msg) return;
    copyText(msg);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.65 }}>
          <div>Type：{event.type || "—"}</div>
          <div>Reason：{event.reason || "—"}</div>
          <div>Namespace：{event.metadata?.namespace || "—"}</div>
          <div>Count：{stats.count}</div>
          <div>First Seen：{formatTime(event.firstTimestamp)}</div>
          <div>Last Seen：{stats.lastSeenMs ? new Date(stats.lastSeenMs).toLocaleString() : formatTime(event.lastTimestamp)}</div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>Message</h4>
        <div
          style={{
            fontSize: 12,
            color: "#e2e8f0",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            padding: "8px 10px",
            borderRadius: 6,
            backgroundColor: "rgba(15,23,42,0.9)",
            border: "1px solid #334155",
          }}
        >
          {event.message || "—"}
        </div>
        {event.message ? (
          <button
            type="button"
            onClick={handleCopyMessage}
            style={{
              marginTop: 8,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #475569",
              backgroundColor: "#0f172a",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {copied ? "已复制" : "复制全文"}
          </button>
        ) : null}
      </section>

      <section>
        <h4 style={sectionTitle}>Involved Object</h4>
        <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.65 }}>
          <div>Kind：{event.involvedObject?.kind || "—"}</div>
          <div>Name：{event.involvedObject?.name || "—"}</div>
          <div>Namespace：{event.involvedObject?.namespace || event.metadata?.namespace || "—"}</div>
          <div>UID：{event.involvedObject?.uid || event.metadata?.uid || "—"}</div>
        </div>
        {view && filterName ? (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <ResourceJumpChip
              label={`打开 ${jumpLabel}`}
              compact
              disabled={view === "nodes" && nodesNavBlocked}
              title={
                view === "nodes" && nodesNavBlocked
                  ? "当前身份无权查看 Nodes，无法跳转"
                  : `跳转到 ${jumpLabel} 并过滤「${filterName}」`
              }
              onClick={() => {
                if (view === "nodes" && nodesNavBlocked) return;
                onJumpToResource(event.involvedObject?.kind, filterName);
              }}
            />
            <span style={{ fontSize: 11, color: "#64748b" }}>{formatEventInvolved(event)}</span>
          </div>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>
            该 Involved Object 暂无一键跳转（支持常见工作负载与网络/存储资源；v1 未开放或无法列表展示的类型已省略）。
          </p>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>Source</h4>
        <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.65 }}>
          <div>Component：{event.source?.component || "—"}</div>
          <div>Host：{event.source?.host || "—"}</div>
        </div>
      </section>
    </div>
  );
}
