import React from "react";
import type { K8sEvent } from "../../api";

const sectionTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  color: "#e5e7eb",
};

/**
 * Describe 面板中的 Events 列表，与 Pod describe 视觉一致（Warning/失败类事件红色底高亮）
 */
export const DescribeEventsSection: React.FC<{ events: K8sEvent[] }> = ({ events }) => {
  return (
    <section>
      <h4 style={sectionTitle}>Events</h4>
      {events.length === 0 && <div style={{ fontSize: 12, color: "#64748b" }}>暂无 Events</div>}
      {events.length > 0 && (
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {events.map((ev) => {
            const isWarning =
              (ev.type && ev.type.toLowerCase() === "warning") ||
              (ev.reason && ev.reason.toLowerCase().includes("fail"));
            return (
              <div
                key={ev.metadata?.uid || `${ev.lastTimestamp}-${ev.reason}-${ev.message}`}
                style={{
                  padding: "4px 6px",
                  borderRadius: 4,
                  marginBottom: 4,
                  backgroundColor: isWarning ? "rgba(127,29,29,0.2)" : "transparent",
                }}
              >
                <div>
                  <span
                    style={{
                      fontWeight: isWarning ? 700 : 500,
                      color: isWarning ? "#f97373" : "#e5e7eb",
                    }}
                  >
                    {ev.type ?? "-"} {ev.reason ?? ""}
                  </span>{" "}
                  <span style={{ color: "#9ca3af" }}>
                    {ev.lastTimestamp ?? ev.firstTimestamp ?? ""}
                    {typeof ev.count === "number" && ev.count > 1 ? ` ×${ev.count}` : ""}
                  </span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", color: isWarning ? "#fecaca" : "#cbd5f5" }}>
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
