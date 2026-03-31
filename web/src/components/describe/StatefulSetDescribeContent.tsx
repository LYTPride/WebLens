import React, { useState } from "react";
import type { Pod, StatefulSetDescribeView, K8sEvent } from "../../api";
import { DescribeEventsSection } from "./DescribeEventsSection";
import {
  ordinalFromStsPodName,
  podReadyColumn,
  aggregatePodHealthLabel,
  sortStsPodsTroubleshootFirst,
  findSmallestOrdinalAbnormalPod,
  stsTroubleshootSummaryLine,
  podPersistentVolumeClaimNames,
  isPodHealthAbnormal,
  isHighRestartInStsGroup,
} from "../../utils/statefulsetPods";
import { getPodStatusInfo } from "../../utils/podTableStatus";

const sectionTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  color: "#e5e7eb",
};

const tagStyle: React.CSSProperties = {
  display: "inline-block",
  margin: "0 6px 6px 0",
  padding: "2px 8px",
  borderRadius: 4,
  backgroundColor: "rgba(30,41,59,0.9)",
  border: "1px solid #334155",
  fontSize: 11,
  color: "#cbd5e1",
  maxWidth: "100%",
  wordBreak: "break-all",
};

function KeyValueTags({ items }: { items: Record<string, string> | undefined }) {
  if (!items || Object.keys(items).length === 0) return <span style={{ fontSize: 12, color: "#64748b" }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
      {Object.entries(items).map(([k, v]) => (
        <span key={k} style={tagStyle} title={`${k}=${v}`}>
          <span style={{ color: "#94a3b8" }}>{k}</span>
          <span style={{ color: "#64748b", margin: "0 4px" }}>=</span>
          {v}
        </span>
      ))}
    </div>
  );
}

function CollapsibleAnnotations({ annotations }: { annotations: Record<string, string> | undefined }) {
  const [open, setOpen] = useState(false);
  if (!annotations || Object.keys(annotations).length === 0) {
    return <span style={{ fontSize: 12, color: "#64748b" }}>—</span>;
  }
  const keys = Object.keys(annotations);
  const preview = keys.slice(0, 2);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "2px 8px",
          marginBottom: 6,
          borderRadius: 4,
          border: "1px solid #334155",
          backgroundColor: "#0f172a",
          color: "#94a3af",
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        {open ? "收起 Annotations" : `展开 Annotations（${keys.length} 项）`}
      </button>
      {!open && (
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {preview.map((k) => (
            <div key={k} style={{ marginBottom: 2 }}>
              {k}
            </div>
          ))}
          {keys.length > 2 && <div>…</div>}
        </div>
      )}
      {open && <KeyValueTags items={annotations} />}
    </div>
  );
}

function healthBadgeStyle(label: string): React.CSSProperties {
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
  return {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: 999,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    color,
    fontSize: 11,
  };
}

export type StatefulSetDescribeContentProps = {
  view: StatefulSetDescribeView;
  events: K8sEvent[];
  ageLabel: string;
  childPods: Pod[];
  stsName: string;
};

/**
 * StatefulSet 结构化 Describe；实例表数据来自 Pods 缓存（与列表子表一致）
 */
export const StatefulSetDescribeContent: React.FC<StatefulSetDescribeContentProps> = ({
  view,
  events,
  ageLabel,
  childPods,
  stsName,
}) => {
  const sortedPods = sortStsPodsTroubleshootFirst(childPods, stsName);
  const primaryAbnormalPod = findSmallestOrdinalAbnormalPod(childPods, stsName);
  const describeSummary = stsTroubleshootSummaryLine(childPods, stsName);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Name：{view.name}</div>
          <div>Namespace：{view.namespace}</div>
          <div>ServiceName：{view.serviceName ?? "—"}</div>
          <div>存活时间：{ageLabel}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#94a3af", marginBottom: 4 }}>Labels</div>
          <KeyValueTags items={view.labels} />
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "#94a3af", marginBottom: 4 }}>Annotations</div>
          <CollapsibleAnnotations annotations={view.annotations} />
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>副本状态</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Replicas（期望）：{view.replicas}</div>
          <div>Ready Replicas：{view.readyReplicas}</div>
          <div>Current Replicas：{view.currentReplicas}</div>
          <div>Updated Replicas：{view.updatedReplicas}</div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>实例列表</h4>
        {describeSummary && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid rgba(234,179,8,0.35)",
              backgroundColor: "rgba(234,179,8,0.08)",
              fontSize: 12,
              color: "#e2e8f0",
              lineHeight: 1.5,
            }}
          >
            <div>{describeSummary}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
              列表已按异常优先排序；建议先处理 ordinal 最小的异常实例（见「优先检查」标记）。
            </div>
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 11,
              backgroundColor: "#020617",
            }}
          >
            <thead>
              <tr style={{ color: "#94a3af", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid #1f2937" }}>Ordinal</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid #1f2937" }}>Pod</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid #1f2937" }}>健康</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid #1f2937" }}>Ready</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid #1f2937" }}>Restarts</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid #1f2937" }}>PVC</th>
              </tr>
            </thead>
            <tbody>
              {sortedPods.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 8, color: "#64748b" }}>
                    暂无关联 Pod（或当前命名空间 Pods 列表未加载）
                  </td>
                </tr>
              ) : (
                sortedPods.map((p) => {
                  const ord = ordinalFromStsPodName(stsName, p.metadata.name);
                  const hl = p.healthLabel || "健康";
                  const { restarts } = getPodStatusInfo(p);
                  const highRestart = isHighRestartInStsGroup(p, sortedPods, (pp) => getPodStatusInfo(pp).restarts);
                  const pvcNames = podPersistentVolumeClaimNames(p);
                  const abnormalRow = isPodHealthAbnormal(p);
                  const isPrimaryAbnormal =
                    !!primaryAbnormalPod && p.metadata.uid === primaryAbnormalPod.metadata.uid;
                  const rowStyle: React.CSSProperties = {
                    backgroundColor: abnormalRow ? "rgba(248,113,113,0.06)" : undefined,
                    boxShadow: isPrimaryAbnormal
                      ? "inset 3px 0 0 rgba(250,204,21,0.9)"
                      : abnormalRow
                        ? "inset 3px 0 0 rgba(249,115,22,0.45)"
                        : undefined,
                  };
                  return (
                    <tr key={p.metadata.uid} style={rowStyle}>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #111827", color: "#e5e7eb" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span>{ord ?? "—"}</span>
                          {isPrimaryAbnormal && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: 4,
                                backgroundColor: "rgba(234,179,8,0.2)",
                                border: "1px solid rgba(250,204,21,0.55)",
                                color: "#facc15",
                              }}
                            >
                              优先检查
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #111827", color: "#e5e7eb" }}>
                        <span>{p.metadata.name}</span>
                        {ord != null && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "#64748b" }}>#{ord}</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #111827" }}>
                        <span style={healthBadgeStyle(hl)}>{hl}</span>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #111827", color: "#cbd5f5" }}>
                        {podReadyColumn(p)}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #111827",
                          color: highRestart ? "#fb923c" : "#cbd5f5",
                          fontWeight: highRestart ? 600 : undefined,
                        }}
                        title={highRestart ? "本组内重启偏高" : undefined}
                      >
                        {restarts}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid #111827",
                          color: "#cbd5f5",
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={pvcNames.length ? pvcNames.join(", ") : undefined}
                      >
                        {pvcNames.length ? pvcNames.join(", ") : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {sortedPods.length > 0 && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
            聚合健康：{aggregatePodHealthLabel(sortedPods)}
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>存储信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5" }}>
          {view.volumeClaimTemplateNames && view.volumeClaimTemplateNames.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {view.volumeClaimTemplateNames.map((n) => (
                <li key={n}>volumeClaimTemplate：{n}</li>
              ))}
            </ul>
          ) : (
            <span style={{ color: "#64748b" }}>无 volumeClaimTemplates</span>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>
            PVC 绑定状态可在命名空间 PVC 列表中查看（首版不自动关联名称）。
          </div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>更新策略</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Type：{view.strategyType || "—"}</div>
          {view.rollingPartition != null && <div>Partition：{view.rollingPartition}</div>}
          {view.podManagementPolicy && <div>PodManagementPolicy：{view.podManagementPolicy}</div>}
        </div>
      </section>

      <DescribeEventsSection events={events ?? []} />
    </div>
  );
};
