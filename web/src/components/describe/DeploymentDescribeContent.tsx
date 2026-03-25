import React, { useState } from "react";
import type { DeploymentDescribeView, K8sEvent } from "../../api";
import { DescribeEventsSection } from "./DescribeEventsSection";

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

const cardStyle: React.CSSProperties = {
  border: "1px solid #1f2937",
  borderRadius: 6,
  padding: 8,
  backgroundColor: "#020617",
  marginBottom: 8,
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

function ResourceMap({ req, lim }: { req?: Record<string, string>; lim?: Record<string, string> }) {
  const has = (req && Object.keys(req).length > 0) || (lim && Object.keys(lim).length > 0);
  if (!has) return <span style={{ color: "#64748b" }}>—</span>;
  return (
    <div style={{ fontSize: 11, color: "#cbd5f5", lineHeight: 1.5 }}>
      {req && Object.keys(req).length > 0 && (
        <div>
          <span style={{ color: "#94a3b8" }}>requests：</span>
          {Object.entries(req)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}
        </div>
      )}
      {lim && Object.keys(lim).length > 0 && (
        <div>
          <span style={{ color: "#94a3b8" }}>limits：</span>
          {Object.entries(lim)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}
        </div>
      )}
    </div>
  );
}

export type DeploymentDescribeContentProps = {
  view: DeploymentDescribeView;
  events: K8sEvent[];
  /** 与列表「存活时间」一致的可读时长 */
  ageLabel: string;
};

/**
 * Deployment 结构化 Describe 正文（分块 + Events 与 Pod 共用样式）
 */
export const DeploymentDescribeContent: React.FC<DeploymentDescribeContentProps> = ({
  view,
  events,
  ageLabel,
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Name：{view.name}</div>
          <div>Namespace：{view.namespace}</div>
          <div>创建时间：{view.creationTimestamp || "—"}</div>
          <div>存活时间：{ageLabel}</div>
          {view.selector && (
            <div style={{ marginTop: 6 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Selector</div>
              <code style={{ fontSize: 11, color: "#e2e8f0", wordBreak: "break-all" }}>{view.selector}</code>
            </div>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Labels</div>
          <KeyValueTags items={view.labels} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Annotations</div>
          <CollapsibleAnnotations annotations={view.annotations} />
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>副本与状态</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.7 }}>
          <div>Desired：{view.replicas.desired}</div>
          <div>Updated：{view.replicas.updated}</div>
          <div>Ready：{view.replicas.ready}</div>
          <div>Available：{view.replicas.available}</div>
          <div>Unavailable：{view.replicas.unavailable}</div>
        </div>
        {view.conditions && view.conditions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Conditions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {view.conditions.map((c, i) => (
                <div key={i} style={cardStyle}>
                  <div style={{ fontWeight: 600, color: "#e5e7eb" }}>{c.type}</div>
                  <div style={{ fontSize: 11, color: "#cbd5f5", marginTop: 4 }}>
                    Status：<span style={{ color: c.status === "True" ? "#86efac" : "#fca5a5" }}>{c.status}</span>
                  </div>
                  {c.reason && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Reason：{c.reason}</div>
                  )}
                  {c.message && (
                    <div style={{ fontSize: 11, color: "#cbd5f5", marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {c.message}
                    </div>
                  )}
                  {(c.lastTransitionTime || c.lastUpdateTime) && (
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                      {c.lastTransitionTime && <>LastTransition：{c.lastTransitionTime}</>}
                      {c.lastUpdateTime && (
                        <>
                          {c.lastTransitionTime ? " · " : ""}
                          LastUpdate：{c.lastUpdateTime}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>滚动更新策略</h4>
        <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
          <div>Strategy Type：{view.strategyType || "—"}</div>
          {view.rollingUpdate && (
            <>
              <div>MaxUnavailable：{view.rollingUpdate.maxUnavailable || "—"}</div>
              <div>MaxSurge：{view.rollingUpdate.maxSurge || "—"}</div>
            </>
          )}
          {view.progressDeadlineSeconds != null && (
            <div>Progress Deadline Seconds：{view.progressDeadlineSeconds}</div>
          )}
        </div>
      </section>

      <section>
        <h4 style={sectionTitle}>Pod 模板</h4>
        {view.podTemplate.serviceAccount && (
          <div style={{ fontSize: 12, color: "#cbd5f5", marginBottom: 8 }}>
            Service Account：{view.podTemplate.serviceAccount}
          </div>
        )}
        {view.podTemplate.nodeSelector && Object.keys(view.podTemplate.nodeSelector).length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Node Selector</div>
            <KeyValueTags items={view.podTemplate.nodeSelector} />
          </div>
        )}
        {view.podTemplate.tolerations && view.podTemplate.tolerations.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Tolerations</div>
            <div style={{ fontSize: 11, color: "#cbd5f5" }}>
              {view.podTemplate.tolerations.map((t, i) => (
                <div key={i} style={{ marginBottom: 4, padding: 6, borderRadius: 4, backgroundColor: "#0f172a" }}>
                  {[t.key, t.operator, t.value, t.effect].filter(Boolean).join(" · ") ||
                    JSON.stringify(t)}
                  {t.tolerationSeconds != null && ` · ${t.tolerationSeconds}s`}
                </div>
              ))}
            </div>
          </div>
        )}
        {view.podTemplate.volumes && view.podTemplate.volumes.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Volumes</div>
            <div style={{ fontSize: 11, color: "#cbd5f5" }}>
              {view.podTemplate.volumes.map((v) => (
                <div key={v.name}>
                  {v.name} <span style={{ color: "#64748b" }}>({v.kind})</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {view.podTemplate.initContainers && view.podTemplate.initContainers.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Init Containers</div>
            {view.podTemplate.initContainers.map((c) => (
              <div key={`init-${c.name}`} style={cardStyle}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "#cbd5f5", marginTop: 4 }}>Image：{c.image}</div>
                {c.ports && c.ports.length > 0 && (
                  <div style={{ fontSize: 11, color: "#cbd5f5" }}>Ports：{c.ports.join(", ")}</div>
                )}
                <ResourceMap req={c.requests} lim={c.limits} />
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Containers</div>
        {(!view.podTemplate.containers || view.podTemplate.containers.length === 0) && (
          <div style={{ fontSize: 12, color: "#64748b" }}>—</div>
        )}
        {view.podTemplate.containers.map((c) => (
          <div key={c.name} style={cardStyle}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "#cbd5f5", lineHeight: 1.6 }}>
              <div>Image：{c.image}</div>
              {c.ports && c.ports.length > 0 && <div>Ports：{c.ports.join(", ")}</div>}
            </div>
            <div style={{ marginTop: 6 }}>
              <ResourceMap req={c.requests} lim={c.limits} />
            </div>
            {c.volumeMounts && c.volumeMounts.length > 0 && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                Volume Mounts：{c.volumeMounts.join("；")}
              </div>
            )}
            {c.env && c.env.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 11 }}>
                <summary style={{ cursor: "pointer", color: "#94a3b8" }}>Env（{c.env.length}）</summary>
                <div style={{ marginTop: 6, color: "#cbd5f5" }}>
                  {c.env.map((e) => (
                    <div key={e.name} style={{ marginBottom: 4 }}>
                      <span style={{ color: "#94a3b8" }}>{e.name}</span>
                      {e.value && <> = {e.value}</>}
                      {e.from && (
                        <>
                          {" "}
                          <span style={{ color: "#64748b" }}>← {e.from}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </section>

      <DescribeEventsSection events={events} />
    </div>
  );
};
