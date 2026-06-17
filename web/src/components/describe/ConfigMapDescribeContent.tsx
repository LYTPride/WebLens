import React, { useMemo, useState } from "react";
import type { ConfigMapDescribeView, K8sEvent, Pod } from "../../api";
import { DescribeEventsSection } from "./DescribeEventsSection";
import { ResourceJumpChip } from "../ResourceJumpChip";
import { ResourceNameWithCopy } from "../ResourceNameWithCopy";
import {
  configMapKey,
  deriveConfigMapKeyRows,
  deriveConfigMapReferences,
  deriveConfigMapRisks,
  formatConfigMapReferenceSummary,
  normalizeConfigMapDescribeView,
  summarizeConfigMapSize,
  type ConfigMapRisk,
} from "../../utils/configMapTable";

const sectionTitle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  color: "var(--wl-text-primary)",
};

const miniTh: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid var(--wl-border-table-header)",
  fontSize: 11,
  color: "var(--wl-text-secondary)",
};

const miniTd: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 12,
  color: "var(--wl-text-heading)",
  verticalAlign: "top",
  wordBreak: "break-word",
};

const tagStyle: React.CSSProperties = {
  display: "inline-block",
  margin: "0 6px 6px 0",
  padding: "2px 8px",
  borderRadius: 4,
  backgroundColor: "var(--wl-pill-surface-bg)",
  border: "1px solid var(--wl-pill-surface-border)",
  fontSize: 11,
  color: "var(--wl-pill-surface-text)",
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
  if (!annotations || Object.keys(annotations).length === 0) return <span style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>—</span>;
  const keys = Object.keys(annotations);
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
      {open ? <KeyValueTags items={annotations} /> : <div style={{ fontSize: 11, color: "var(--wl-text-muted)" }}>{keys.slice(0, 3).join("、")}{keys.length > 3 ? "…" : ""}</div>}
    </div>
  );
}

function riskBoxStyle(risk: ConfigMapRisk): React.CSSProperties {
  let bg = "var(--wl-pill-success-bg)";
  let border = "var(--wl-pill-success-border)";
  let color = "var(--wl-pill-success-text)";
  if (risk.level === "info") {
    bg = "var(--wl-pill-info-bg)";
    border = "var(--wl-pill-info-border)";
    color = "var(--wl-pill-info-text)";
  } else if (risk.level === "warning") {
    bg = "var(--wl-pill-attention-bg)";
    border = "var(--wl-pill-attention-border)";
    color = "var(--wl-pill-attention-text)";
  } else if (risk.level === "danger") {
    bg = "var(--wl-pill-danger-bg)";
    border = "var(--wl-pill-danger-border)";
    color = "var(--wl-pill-danger-text)";
  }
  return {
    padding: "8px 10px",
    borderRadius: 6,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    color,
    fontSize: 12,
    lineHeight: 1.5,
  };
}

export type ConfigMapDescribeContentProps = {
  view?: ConfigMapDescribeView | null;
  events: K8sEvent[];
  pods: Pod[];
  ageLabel: string;
  onCopyName: (name: string) => void;
  onJumpPods?: (podName: string) => void;
};

export function ConfigMapDescribeContent({
  view,
  events,
  pods,
  ageLabel,
  onCopyName,
  onJumpPods,
}: ConfigMapDescribeContentProps) {
  const cm = useMemo(() => (view ? normalizeConfigMapDescribeView(view) : null), [view]);
  const refs = useMemo(() => {
    if (!cm) return null;
    return deriveConfigMapReferences(pods, cm.metadata.namespace ?? "", cm.metadata.name);
  }, [cm, pods]);
  const risks = useMemo(() => (cm && refs ? deriveConfigMapRisks(cm, refs) : []), [cm, refs]);
  const size = useMemo(() => (cm ? summarizeConfigMapSize(cm) : null), [cm]);
  const keyRows = useMemo(() => (cm ? deriveConfigMapKeyRows(cm) : []), [cm]);

  if (!view || !cm || !refs || !size) {
    return <div style={{ fontSize: 12, color: "var(--wl-text-secondary)" }}>暂无 Describe 数据</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>影响范围</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", marginBottom: 8 }}>
          {formatConfigMapReferenceSummary(refs)}（当前实现统计同作用域 Pod 引用；workload 模板引用结构已预留）
        </div>
        {refs.references.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>当前未发现引用资源</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", backgroundColor: "var(--wl-describe-table-bg)" }}>
              <thead>
                <tr>
                  <th style={miniTh}>Kind</th>
                  <th style={miniTh}>Name</th>
                  <th style={miniTh}>Namespace</th>
                  <th style={miniTh}>引用方式</th>
                  <th style={miniTh}>容器</th>
                  <th style={miniTh}>Key / Volume</th>
                  <th style={miniTh}>联动</th>
                </tr>
              </thead>
              <tbody>
                {refs.references.map((ref, idx) => (
                  <tr key={`${ref.kind}-${ref.namespace}-${ref.name}-${ref.method}-${ref.containerName ?? ""}-${ref.keyName ?? ""}-${idx}`}>
                    <td style={miniTd}>{ref.kind}</td>
                    <td style={miniTd}>
                      <ResourceNameWithCopy name={ref.name} onCopy={onCopyName} fontSize={12} copyButtonTitle="复制资源名称" />
                    </td>
                    <td style={miniTd}>{ref.namespace}</td>
                    <td style={miniTd}>{ref.method}</td>
                    <td style={miniTd}>{ref.containerName || "—"}</td>
                    <td style={miniTd}>{ref.keyName || ref.volumeName || "—"}</td>
                    <td style={miniTd}>
                      {ref.kind === "Pod" && onJumpPods ? (
                        <ResourceJumpChip label="Pods" compact onClick={() => onJumpPods(ref.name)} title="打开 Pods 列表并过滤" />
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

      <section>
        <h4 style={sectionTitle}>风险分析</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {risks.map((risk) => (
            <div key={risk.label} style={riskBoxStyle(risk)}>
              {risk.reason}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>配置摘要</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.7 }}>
          <div>总 key 数：{size.totalKeys}</div>
          <div>data key 数：{size.dataKeys}</div>
          <div>binaryData key 数：{size.binaryDataKeys}</div>
          <div>总大小：{size.display}</div>
          <div>引用资源数：{refs.totalResources}</div>
          <div>ResourceVersion：{view.resourceVersion || "—"}</div>
          <div>存活时间：{ageLabel}</div>
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>Key 列表</h4>
        {keyRows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>无配置 key</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse", backgroundColor: "var(--wl-describe-table-bg)" }}>
              <thead>
                <tr>
                  <th style={miniTh}>Key</th>
                  <th style={miniTh}>类型</th>
                  <th style={miniTh}>大小</th>
                  <th style={miniTh}>行数</th>
                  <th style={miniTh}>识别类型</th>
                  <th style={miniTh}>风险</th>
                </tr>
              </thead>
              <tbody>
                {keyRows.map((row) => (
                  <tr key={`${row.source}-${row.key}`}>
                    <td style={{ ...miniTd, maxWidth: 220 }} title={row.key}>{row.key}</td>
                    <td style={miniTd}>{row.source}</td>
                    <td style={miniTd}>{row.sizeDisplay}</td>
                    <td style={miniTd}>{row.lineCount}</td>
                    <td style={miniTd}>{row.detectedType}</td>
                    <td style={miniTd}>
                      {row.risky ? <span style={tagStyle}>疑似敏感 key</span> : <span style={{ color: "var(--wl-text-muted)" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.7 }}>
          <div>Name：{view.name}</div>
          <div>Namespace：{view.namespace}</div>
          <div>UID：{view.uid || "—"}</div>
          <div>CreationTimestamp：{view.creationTimestamp || "—"}</div>
          <div>ResourceVersion：{view.resourceVersion || "—"}</div>
          <div style={{ fontSize: 11, color: "var(--wl-text-muted)", marginTop: 4 }}>Key：{configMapKey(view.namespace, view.name)}</div>
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

      <DescribeEventsSection events={events} />
    </div>
  );
}
