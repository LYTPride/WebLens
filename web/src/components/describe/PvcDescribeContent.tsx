import React, { useState } from "react";
import type { K8sEvent, Pod, PvcDescribeView } from "../../api";
import { DescribeEventsSection } from "./DescribeEventsSection";
import { ResourceJumpChip } from "../ResourceJumpChip";
import { ResourceNameWithCopy } from "../ResourceNameWithCopy";
import { PodHealthPill, PodListStatusPill } from "../PodStatusPills";
import {
  describePvcStorageClassNote,
  derivePvcExpandUsedByRows,
  podIsHealthAbnormal,
  podsUsingPvcClaim,
  type PvcListRow,
} from "../../utils/pvcTable";

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
        <span key={k} style={tagStyle} title={`${k}=${String(v)}`}>
          <span style={{ color: "#94a3b8" }}>{k}</span>
          <span style={{ color: "#64748b", margin: "0 4px" }}>=</span>
          {v == null ? "" : String(v)}
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
          color: "#94a3b8",
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

const miniTh: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid #1f2937",
  fontSize: 11,
  color: "#94a3b8",
};
const miniTd: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #111827",
  fontSize: 12,
  color: "#e2e8f0",
  verticalAlign: "top",
  wordBreak: "break-word",
};

export type PvcDescribeContentProps = {
  view?: PvcDescribeView | null;
  events: K8sEvent[];
  ageLabel: string;
  pods: Pod[];
  onCopyName: (name: string) => void;
  onJumpPods?: (podName: string) => void;
};

export function PvcDescribeContent({
  view,
  events,
  ageLabel,
  pods,
  onCopyName,
  onJumpPods,
}: PvcDescribeContentProps) {
  if (!view || typeof view !== "object") {
    return <div style={{ fontSize: 12, color: "#94a3b8" }}>暂无 Describe 数据</div>;
  }

  const statusText = view.isTerminating ? "Terminating" : view.statusPhase || "—";
  const usedRows = derivePvcExpandUsedByRows(pods, view.namespace, view.name);
  const mountingPods = podsUsingPvcClaim(pods, view.namespace, view.name);
  const abnormalMountCount = mountingPods.filter(podIsHealthAbnormal).length;
  const scNoteRow: PvcListRow = {
    spec: {
      storageClassName:
        view.storageClass != null && view.storageClass !== "" && view.storageClass !== "—"
          ? view.storageClass
          : undefined,
    },
  };
  const storageClassNote = describePvcStorageClassNote(scNoteRow);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Name：{view.name ?? "—"}</div>
          <div>Namespace：{view.namespace ?? "—"}</div>
          <div>Status：{statusText}</div>
          <div>Volume：{view.volumeName || "—"}</div>
          <div>StorageClass：{view.storageClass || "—"}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>{storageClassNote}</div>
          <div>存活时间：{ageLabel}</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Labels</div>
          <KeyValueTags items={view.labels} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>Annotations</div>
          <CollapsibleAnnotations annotations={view.annotations} />
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>容量与访问模式</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Requested Storage：{view.requestedStorage || "—"}</div>
          <div>Capacity：{view.capacity || "—"}</div>
          <div>Access Modes：{view.accessModes || "—"}</div>
          <div>VolumeMode：{view.volumeMode || "—"}</div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>绑定信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>PV Name：{view.volumeName && view.volumeName !== "—" ? view.volumeName : "未绑定"}</div>
          <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 11 }}>
            绑定关系以 PVC status 为准；PV 详情页后续版本可扩展联动。
          </div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>关联资源</h4>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
          使用本 PVC 的 Pod（由当前作用域 Pods 列表推导 claimName 挂载）
        </div>
        {mountingPods.length === 0 && (
          <div style={{ fontSize: 12, color: "#fbbf24", marginBottom: 8 }}>
            当前列表范围内无同命名空间 Pod 挂载此卷；若实际有负载，请确认命名空间与列表作用域。
          </div>
        )}
            {abnormalMountCount > 0 && (
          <div style={{ fontSize: 12, color: "#f87171", marginBottom: 8 }}>
            {abnormalMountCount} 个挂载 Pod 处于非「健康」或 Status 异常，可从下表跳转 Pods 排查。
          </div>
        )}
        {usedRows.length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>无关联 Pod</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#020617", minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={miniTh}>Pod</th>
                  <th style={miniTh}>状态标签</th>
                  <th style={miniTh}>Status</th>
                  <th style={miniTh}>Node</th>
                  <th style={miniTh}>联动</th>
                </tr>
              </thead>
              <tbody>
                {usedRows.map((r) => (
                  <tr key={r.podName}>
                    <td style={miniTd}>
                      <ResourceNameWithCopy
                        name={r.podName}
                        onCopy={onCopyName}
                        fontSize={12}
                        copyButtonTitle="复制 Pod 名称"
                      />
                    </td>
                    <td style={miniTd}>
                      <PodHealthPill label={r.healthLabel} title={r.healthReasonsText || undefined} />
                    </td>
                    <td style={miniTd}>
                      <PodListStatusPill text={r.statusText} />
                    </td>
                    <td style={{ ...miniTd, fontSize: 11 }}>{r.node}</td>
                    <td style={miniTd}>
                      {onJumpPods ? (
                        <ResourceJumpChip
                          label="Pods"
                          compact
                          onClick={() => onJumpPods(r.podName)}
                          title="打开 Pods 并过滤"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DescribeEventsSection events={Array.isArray(events) ? events.filter(Boolean) : []} />
    </div>
  );
}
