import React, { useState } from "react";
import type { K8sEvent, ServiceDescribeView } from "../../api";
import { DescribeEventsSection } from "./DescribeEventsSection";
import { ResourceJumpChip } from "../ResourceJumpChip";
import { ResourceNameWithCopy } from "../ResourceNameWithCopy";

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

export type ServiceDescribeContentProps = {
  view?: ServiceDescribeView | null;
  events: K8sEvent[];
  ageLabel: string;
  onJumpPods?: (podName: string) => void;
  onJumpIngress?: (ingressName: string) => void;
  onCopyName: (name: string) => void;
};

export function ServiceDescribeContent({
  view,
  events,
  ageLabel,
  onJumpPods,
  onJumpIngress,
  onCopyName,
}: ServiceDescribeContentProps) {
  if (!view || typeof view !== "object") {
    return <div style={{ fontSize: 12, color: "#94a3b8" }}>暂无 Describe 数据</div>;
  }

  const noEndpoints = view.endpointReadyCount === 0 && view.endpointNotReadyCount === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Name：{view.name ?? "—"}</div>
          <div>Namespace：{view.namespace ?? "—"}</div>
          <div>Type：{view.type || "—"}</div>
          <div>Cluster IP：{view.clusterIP || "None"}</div>
          {view.externalName ? <div>ExternalName：{view.externalName}</div> : null}
          {view.loadBalancerIngress && view.loadBalancerIngress.length > 0 ? (
            <div>LoadBalancer Ingress：{view.loadBalancerIngress.join(", ")}</div>
          ) : null}
          <div>Session Affinity：{view.sessionAffinity || "—"}</div>
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
        <h4 style={sectionTitle}>Ports</h4>
        {!view.ports?.length ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>无端口定义</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#020617", minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={miniTh}>Name</th>
                  <th style={miniTh}>Protocol</th>
                  <th style={miniTh}>Port</th>
                  <th style={miniTh}>TargetPort</th>
                  <th style={miniTh}>NodePort</th>
                </tr>
              </thead>
              <tbody>
                {view.ports.map((p, i) => (
                  <tr key={i}>
                    <td style={miniTd}>{p.name || "—"}</td>
                    <td style={miniTd}>{p.protocol || "TCP"}</td>
                    <td style={miniTd}>{p.port}</td>
                    <td style={miniTd}>{p.targetPort || "—"}</td>
                    <td style={miniTd}>{p.nodePort && p.nodePort > 0 ? p.nodePort : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>Selector</h4>
        {!view.selector || Object.keys(view.selector).length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>无 selector</div>
        ) : (
          <KeyValueTags items={view.selector} />
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>Endpoints</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", marginBottom: 8, lineHeight: 1.5 }}>
          <div>
            Ready：{view.endpointReadyCount}，NotReady：{view.endpointNotReadyCount}
          </div>
          {noEndpoints && (
            <div style={{ color: "#f97316", marginTop: 6, fontWeight: 600 }}>
              当前无 Endpoints 地址，请检查 Pod / selector / Endpoints 对象。
            </div>
          )}
        </div>
        {!view.endpointRows?.length && !noEndpoints ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>暂无地址行</div>
        ) : view.endpointRows?.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#020617", minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={miniTh}>IP</th>
                  <th style={miniTh}>Ports</th>
                  <th style={miniTh}>Ready</th>
                  <th style={miniTh}>Pod</th>
                  <th style={miniTh}>健康</th>
                  <th style={miniTh}>Node</th>
                  <th style={miniTh}>说明</th>
                  <th style={miniTh}>联动</th>
                </tr>
              </thead>
              <tbody>
                {view.endpointRows.map((r, i) => (
                  <tr
                    key={i}
                    style={
                      !r.ready
                        ? { backgroundColor: "rgba(249,115,22,0.06)" }
                        : r.podHealth && r.podHealth !== "健康"
                          ? { backgroundColor: "rgba(202,138,4,0.05)" }
                          : undefined
                    }
                  >
                    <td style={miniTd}>{r.ip}</td>
                    <td style={{ ...miniTd, fontSize: 11 }}>{r.ports}</td>
                    <td style={miniTd}>{r.ready ? "是" : "否"}</td>
                    <td style={miniTd}>
                      {r.podName ? (
                        <ResourceNameWithCopy
                          name={r.podName}
                          onCopy={onCopyName}
                          fontSize={12}
                          copyButtonTitle="复制 Pod 名称"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={miniTd}>{r.podHealth || "—"}</td>
                    <td style={{ ...miniTd, fontSize: 11 }}>{r.nodeName || "—"}</td>
                    <td style={{ ...miniTd, fontSize: 11, color: "#94a3b8" }}>{r.note || "—"}</td>
                    <td style={miniTd}>
                      {r.podName && onJumpPods ? (
                        <ResourceJumpChip
                          label="Pods"
                          compact
                          onClick={() => onJumpPods(r.podName!)}
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
        ) : null}
      </section>

      <section>
        <h4 style={sectionTitle}>关联资源</h4>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
          关联 Pods（selector 命中，健康标签与列表一致）
        </div>
        {!view.relatedPods?.length ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>无匹配 Pod 或当前无 selector</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#020617" }}>
              <thead>
                <tr>
                  <th style={miniTh}>Pod</th>
                  <th style={miniTh}>Phase</th>
                  <th style={miniTh}>健康</th>
                  <th style={miniTh}>联动</th>
                </tr>
              </thead>
              <tbody>
                {view.relatedPods.map((p) => (
                  <tr key={p.name}>
                    <td style={miniTd}>
                      <ResourceNameWithCopy
                        name={p.name}
                        onCopy={onCopyName}
                        fontSize={12}
                        copyButtonTitle="复制 Pod 名称"
                      />
                    </td>
                    <td style={miniTd}>{p.phase}</td>
                    <td style={miniTd}>{p.healthLabel}</td>
                    <td style={miniTd}>
                      {onJumpPods ? (
                        <ResourceJumpChip
                          label="Pods"
                          compact
                          onClick={() => onJumpPods(p.name)}
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

        <div style={{ fontSize: 11, color: "#94a3b8", margin: "12px 0 8px" }}>
          引用本 Service 的 Ingress（同命名空间扫描）
        </div>
        {!view.referencedByIngresses?.length ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>未发现引用（或列表规则未指向此 Service）</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
            {view.referencedByIngresses.map((ing, i) => (
              <li key={`${ing.ingressName}-${i}`} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "6px 8px" }}>
                  <ResourceNameWithCopy
                    name={ing.ingressName}
                    onCopy={onCopyName}
                    fontSize={12}
                    copyButtonTitle="复制 Ingress 名称"
                  />
                  {onJumpIngress ? (
                    <ResourceJumpChip
                      label="Ingress"
                      compact
                      onClick={() => onJumpIngress(ing.ingressName)}
                      title="打开 Ingress 列表并过滤"
                    />
                  ) : null}
                </div>
                <span style={{ color: "#94a3b8", fontSize: 11, display: "block", marginTop: 2 }}>
                  {ing.host} {ing.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DescribeEventsSection events={Array.isArray(events) ? events.filter(Boolean) : []} />
    </div>
  );
}
