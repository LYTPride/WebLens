import React, { useState } from "react";
import type { K8sEvent, NodeDescribeView, Pod } from "../../api";
import { DescribeEventsSection } from "./DescribeEventsSection";
import { countPodsOnNode } from "../../utils/nodeTable";

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
        <span key={k} style={tagStyle} title={`${k}=${String(v)}`}>
          <span style={{ color: "var(--wl-text-secondary)" }}>{k}</span>
          <span style={{ color: "var(--wl-text-muted)", margin: "0 4px" }}>=</span>
          {v == null ? "" : String(v)}
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

const condTh: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid var(--wl-border-table-header)",
  fontSize: 11,
  color: "var(--wl-text-secondary)",
};
const condTd: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 12,
  color: "var(--wl-text-heading)",
  verticalAlign: "top",
  wordBreak: "break-word",
};

export type NodeDescribeContentProps = {
  view?: NodeDescribeView | null;
  events: K8sEvent[];
  ageLabel: string;
  pods: Pod[];
};

export function NodeDescribeContent({ view, events, ageLabel, pods }: NodeDescribeContentProps) {
  if (!view || typeof view !== "object") {
    return <div style={{ fontSize: 12, color: "var(--wl-text-secondary)" }}>暂无 Describe 数据</div>;
  }

  const podCount = countPodsOnNode(pods, view.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Name：{view.name ?? "—"}</div>
          <div>Status：{view.statusDisplay ?? "—"}</div>
          <div>Roles：{view.roles ?? "—"}</div>
          <div>Version：{view.kubeletVersion || "—"}</div>
          <div>存活时间：{ageLabel}</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 4 }}>Labels</div>
          <KeyValueTags items={view.labels} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 4 }}>Annotations</div>
          <CollapsibleAnnotations annotations={view.annotations} />
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>网络与地址</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Internal IP：{view.internalIP || "—"}</div>
          <div>Hostname：{view.hostname || "—"}</div>
          {view.otherAddresses && view.otherAddresses.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 4 }}>其他地址</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--wl-text-secondary)" }}>
                {view.otherAddresses.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>资源容量</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>CPU（capacity）：{view.cpuCapacity || "—"}</div>
          <div>Memory（capacity）：{view.memoryCapacity || "—"}</div>
          <div>Ephemeral Storage：{view.ephemeralStorage || "—"}</div>
          <div>Pods 上限（capacity）：{view.maxPods || "—"}</div>
          <div>CPU（allocatable）：{view.allocatableCPU || "—"}</div>
          <div>Memory（allocatable）：{view.allocatableMemory || "—"}</div>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--wl-text-secondary)" }}>
            摘要来自 Node status.capacity / allocatable，非实时监控指标。
          </div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>调度与污点</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Unschedulable：{view.unschedulable ? "是" : "否"}</div>
          {view.taints && view.taints.length > 0 ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {view.taints.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : (
            <div style={{ marginTop: 6, color: "var(--wl-text-muted)" }}>无 Taints</div>
          )}
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>Conditions</h4>
        {view.conditions && view.conditions.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "var(--wl-describe-table-bg)", minWidth: 400 }}>
              <thead>
                <tr>
                  <th style={condTh}>Type</th>
                  <th style={condTh}>Status</th>
                  <th style={condTh}>Reason</th>
                  <th style={condTh}>Message</th>
                </tr>
              </thead>
              <tbody>
                {view.conditions.map((c) => (
                  <tr key={c.type}>
                    <td style={condTd}>{c.type}</td>
                    <td style={condTd}>{c.status}</td>
                    <td style={{ ...condTd, fontSize: 11 }}>{c.reason || "—"}</td>
                    <td style={{ ...condTd, fontSize: 11, color: "var(--wl-text-secondary)" }}>{c.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>—</div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>系统信息</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>OS Image：{view.osImage || "—"}</div>
          <div>Kernel Version：{view.kernelVersion || "—"}</div>
          <div>Container Runtime：{view.containerRuntime || "—"}</div>
          <div>Kubelet Version：{view.kubeletVersion || "—"}</div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>关联工作负载摘要</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          当前作用域 Pods 列表中调度到本节点的 Pod 数：<strong>{podCount}</strong>
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--wl-text-secondary)" }}>
            由前端 Pods 缓存按 spec.nodeName 统计；切换「所有命名空间」可覆盖更全工作负载。
          </div>
        </div>
      </section>

      <div
        style={
          events.length > 0
            ? {
                padding: 12,
                borderRadius: 8,
                backgroundColor: "rgba(127,29,29,0.18)",
                border: "1px solid rgba(248,113,113,0.35)",
              }
            : undefined
        }
      >
        <DescribeEventsSection events={Array.isArray(events) ? events.filter(Boolean) : []} />
      </div>
    </div>
  );
}
