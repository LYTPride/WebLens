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
  color: "var(--wl-text-primary)",
};

const tagStyle: React.CSSProperties = {
  display: "inline-block",
  margin: "0 6px 6px 0",
  padding: "2px 8px",
  borderRadius: 4,
  backgroundColor: "rgba(30,41,59,0.9)",
  border: "1px solid var(--wl-border-strong)",
  fontSize: 11,
  color: "var(--wl-text-secondary)",
  maxWidth: "100%",
  wordBreak: "break-all",
};

function KeyValueTags({ items }: { items: Record<string, string> | undefined }) {
  if (!items || Object.keys(items).length === 0) return <span style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
      {Object.entries(items).map(([k, v]) => (
        <span key={k} style={tagStyle} title={`${k}=${v}`}>
          <span style={{ color: "var(--wl-text-secondary)" }}>{k}</span>
          <span style={{ color: "var(--wl-text-muted)", margin: "0 4px" }}>=</span>
          {v}
        </span>
      ))}
    </div>
  );
}

function CollapsibleAnnotations({ annotations }: { annotations: Record<string, string> | undefined }) {
  const [open, setOpen] = useState(false);
  if (!annotations || Object.keys(annotations).length === 0) {
    return <span style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>—</span>;
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
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-describe-section-bg)",
          color: "var(--wl-text-secondary)",
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        {open ? "收起 Annotations" : `展开 Annotations（${keys.length} 项）`}
      </button>
      {!open && (
        <div style={{ fontSize: 11, color: "var(--wl-text-muted)" }}>
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
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Name：{view.name}</div>
          <div>Namespace：{view.namespace}</div>
          <div>ServiceName：{view.serviceName ?? "—"}</div>
          <div>存活时间：{ageLabel}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 4 }}>Labels</div>
          <KeyValueTags items={view.labels} />
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 4 }}>Annotations</div>
          <CollapsibleAnnotations annotations={view.annotations} />
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>副本状态</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
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
              color: "var(--wl-text-heading)",
              lineHeight: 1.5,
            }}
          >
            <div>{describeSummary}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--wl-text-muted)" }}>
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
              backgroundColor: "var(--wl-describe-table-bg)",
            }}
          >
            <thead>
              <tr style={{ color: "var(--wl-text-secondary)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-header)" }}>Ordinal</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-header)" }}>Pod</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-header)" }}>健康</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-header)" }}>Ready</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-header)" }}>Restarts</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-header)" }}>PVC</th>
              </tr>
            </thead>
            <tbody>
              {sortedPods.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 8, color: "var(--wl-text-muted)" }}>
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
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-row)", color: "var(--wl-text-primary)" }}>
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
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-row)", color: "var(--wl-text-primary)" }}>
                        <span>{p.metadata.name}</span>
                        {ord != null && (
                          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--wl-text-muted)" }}>#{ord}</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-row)" }}>
                        <span style={healthBadgeStyle(hl)}>{hl}</span>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--wl-border-table-row)", color: "var(--wl-text-secondary)" }}>
                        {podReadyColumn(p)}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--wl-border-table-row)",
                          color: highRestart ? "#fb923c" : "var(--wl-text-secondary)",
                          fontWeight: highRestart ? 600 : undefined,
                        }}
                        title={highRestart ? "本组内重启偏高" : undefined}
                      >
                        {restarts}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--wl-border-table-row)",
                          color: "var(--wl-text-secondary)",
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
          <div style={{ fontSize: 11, color: "var(--wl-text-muted)", marginTop: 6 }}>
            聚合健康：{aggregatePodHealthLabel(sortedPods)}
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>存储信息</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)" }}>
          {view.volumeClaimTemplateNames && view.volumeClaimTemplateNames.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {view.volumeClaimTemplateNames.map((n) => (
                <li key={n}>volumeClaimTemplate：{n}</li>
              ))}
            </ul>
          ) : (
            <span style={{ color: "var(--wl-text-muted)" }}>无 volumeClaimTemplates</span>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--wl-text-muted)" }}>
            PVC 绑定状态可在命名空间 PVC 列表中查看（首版不自动关联名称）。
          </div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>更新策略</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Type：{view.strategyType || "—"}</div>
          {view.rollingPartition != null && <div>Partition：{view.rollingPartition}</div>}
          {view.podManagementPolicy && <div>PodManagementPolicy：{view.podManagementPolicy}</div>}
        </div>
      </section>

      <DescribeEventsSection events={events ?? []} />
    </div>
  );
};
