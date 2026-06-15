import React from "react";
import type { K8sEvent } from "../../api";

const sectionTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  color: "var(--wl-text-primary)",
};

function isWarningEvent(ev: K8sEvent): boolean {
  const type = ev.type?.toLowerCase() ?? "";
  const reason = ev.reason?.toLowerCase() ?? "";
  return type === "warning" || reason.includes("fail");
}

/**
 * Describe 面板中的 Events 列表。Warning/失败类事件使用主题语义 token，避免浅色主题复用深色浅红文字。
 */
export const DescribeEventsSection: React.FC<{ events: K8sEvent[] }> = ({ events }) => {
  return (
    <section>
      <h4 style={sectionTitle}>Events</h4>
      {events.length === 0 && <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>暂无 Events</div>}
      {events.length > 0 && (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {events.map((ev) => {
            const isWarning = isWarningEvent(ev);
            return (
              <div
                key={ev.metadata?.uid || `${ev.lastTimestamp}-${ev.reason}-${ev.message}`}
                style={{
                  padding: "7px 9px",
                  borderRadius: 6,
                  marginBottom: 6,
                  backgroundColor: isWarning ? "var(--wl-event-warning-bg)" : "var(--wl-event-normal-bg)",
                  border: `1px solid ${isWarning ? "var(--wl-event-warning-border)" : "var(--wl-event-normal-border)"}`,
                  boxShadow: isWarning ? "inset 3px 0 0 var(--wl-event-warning-accent)" : undefined,
                }}
              >
                <div>
                  <span
                    style={{
                      fontWeight: isWarning ? 700 : 600,
                      color: isWarning ? "var(--wl-event-warning-title)" : "var(--wl-event-normal-title)",
                    }}
                  >
                    {ev.type ?? "-"} {ev.reason ?? ""}
                  </span>{" "}
                  <span style={{ color: isWarning ? "var(--wl-event-warning-meta)" : "var(--wl-event-normal-meta)" }}>
                    {ev.lastTimestamp ?? ev.firstTimestamp ?? ""}
                    {typeof ev.count === "number" && ev.count > 1 ? ` ×${ev.count}` : ""}
                  </span>
                </div>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    color: isWarning ? "var(--wl-event-warning-text)" : "var(--wl-event-normal-text)",
                  }}
                >
                  {ev.message}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
