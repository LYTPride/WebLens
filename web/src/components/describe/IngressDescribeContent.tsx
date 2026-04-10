import React, { useState } from "react";
import type { IngressDescribeView, K8sEvent } from "../../api";
import type { IngressTrafficLabel, IngressTroubleshootResult } from "../../utils/ingressTroubleshoot";
import { DescribeEventsSection } from "./DescribeEventsSection";
import { ResourceJumpChip } from "../ResourceJumpChip";
import { ResourceNameWithCopy } from "../ResourceNameWithCopy";

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

function trafficLabelPill(hl: IngressTrafficLabel): React.CSSProperties {
  let bg = "var(--wl-pill-success-bg)";
  let border = "var(--wl-pill-success-border)";
  let color = "var(--wl-pill-success-text)";
  if (hl === "关注") {
    bg = "var(--wl-pill-attention-bg)";
    border = "var(--wl-pill-attention-border)";
    color = "var(--wl-pill-attention-text)";
  } else if (hl === "警告") {
    bg = "var(--wl-pill-orange-bg)";
    border = "var(--wl-pill-orange-border)";
    color = "var(--wl-pill-orange-text)";
  } else if (hl === "严重") {
    bg = "var(--wl-pill-danger-bg)";
    border = "var(--wl-pill-danger-border)";
    color = "var(--wl-pill-danger-text)";
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    color,
    fontSize: 11,
    boxSizing: "border-box",
  };
}

export type IngressDescribeContentProps = {
  /** 缺省或异常响应时为空，组件内安全降级 */
  view?: IngressDescribeView | null;
  events: K8sEvent[];
  ageLabel: string;
  /** 与列表/展开同一套排障模型；缺省时 Rules 仅展示静态列 */
  troubleshoot?: IngressTroubleshootResult | null;
  onJumpServices?: (serviceName: string) => void;
  onJumpPods?: (hint: string) => void;
  onCopyName: (name: string) => void;
};

/**
 * Ingress 结构化 Describe：规则表 + TLS + 默认后端 + Events（与 Deployment 分块风格一致）
 */
export function IngressDescribeContent({
  view,
  events,
  ageLabel,
  troubleshoot,
  onJumpServices,
  onJumpPods,
  onCopyName,
}: IngressDescribeContentProps) {
  if (!view || typeof view !== "object") {
    return <div style={{ fontSize: 12, color: "var(--wl-text-secondary)" }}>暂无 Describe 数据</div>;
  }
  const rules = Array.isArray(view.rules) ? view.rules : [];
  const tlsList = Array.isArray(view.tls) ? view.tls : [];
  const hostCount = typeof view.hostCount === "number" ? view.hostCount : 0;
  const pathCount = typeof view.pathCount === "number" ? view.pathCount : rules.length;
  const diagRows = troubleshoot?.ruleRows ?? [];
  const useDiagTable = !!troubleshoot && diagRows.length > 0;

  const noSelectorBackendCount = troubleshoot
    ? new Set(
        troubleshoot.ruleRows.filter((r) => r.status === "无 selector").map((r) => r.serviceName).filter(Boolean),
      ).size
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section>
        <h4 style={sectionTitle}>基本信息</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Name：{view.name ?? "—"}</div>
          <div>Namespace：{view.namespace ?? "—"}</div>
          <div>Ingress Class：{view.ingressClassName || "—"}</div>
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
        <h4 style={sectionTitle}>规则摘要</h4>
        <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
          <div>Hosts 数：{hostCount}</div>
          <div>Paths 数：{pathCount}</div>
          <div>Backends（去重 Service）：{troubleshoot?.backendServiceCount ?? "—"}</div>
          <div>TLS：{view.tlsConfigured ? "已配置" : "未配置"}</div>
          <div>Default Backend：{view.hasDefaultBackend ? "有" : "无"}</div>
          {troubleshoot && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={trafficLabelPill(troubleshoot.label)} title={troubleshoot.summary}>
                {troubleshoot.label}
              </span>
              <span
                style={{
                  color: troubleshoot.label === "健康" ? "var(--wl-text-muted)" : "var(--wl-text-heading)",
                }}
              >
                {troubleshoot.label === "健康" ? "正常" : troubleshoot.summary}
              </span>
            </div>
          )}
        </div>
        {troubleshoot && (
          <div style={{ fontSize: 11, color: "var(--wl-text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            检测范围：当前命名空间内 Service 列表与同作用域 Pod 缓存；未查询 Endpoints API；TLS Secret 存在性未校验。
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>Rules</h4>
        {useDiagTable ? (
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 6 }}>
              异常优先；与列表展开使用同一套诊断行。
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                backgroundColor: "var(--wl-describe-table-bg)",
                minWidth: 560,
                tableLayout: "fixed",
              }}
            >
              <thead>
                <tr>
                  {[
                    "Host",
                    "Path",
                    "PathType",
                    "Backend Service",
                    "Port",
                    "TLS",
                    "状态",
                    "异常说明",
                    "联动",
                  ].map((h) => (
                    <th key={h} style={miniTh}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diagRows.map((r, ri) => {
                  const rowShell: React.CSSProperties =
                    r.severityRank >= 3
                      ? { backgroundColor: "rgba(185,28,28,0.08)" }
                      : r.severityRank >= 2
                        ? { backgroundColor: "rgba(249,115,22,0.06)" }
                        : r.severityRank >= 1
                          ? { backgroundColor: "rgba(202,138,4,0.05)" }
                          : {};
                  const canLinkSvc =
                    !!onJumpServices &&
                    r.serviceName &&
                    r.serviceName !== "—" &&
                    r.status !== "Service 不存在";
                  return (
                    <tr key={ri} style={rowShell}>
                      <td style={miniTd}>{r.host}</td>
                      <td style={{ ...miniTd, wordBreak: "break-all" }}>{r.path}</td>
                      <td style={miniTd}>{r.pathType}</td>
                      <td style={miniTd}>
                        {r.serviceName && r.serviceName !== "—" ? (
                          <ResourceNameWithCopy
                            name={r.serviceName}
                            onCopy={onCopyName}
                            fontSize={12}
                            copyButtonTitle="复制 Service 名称"
                          />
                        ) : (
                          r.serviceName ?? "—"
                        )}
                      </td>
                      <td style={miniTd}>{r.portDisplay}</td>
                      <td style={{ ...miniTd, fontSize: 11 }}>{r.tlsHint}</td>
                      <td style={{ ...miniTd, fontWeight: 600 }}>{r.status}</td>
                      <td style={{ ...miniTd, fontSize: 11, color: "var(--wl-text-secondary)" }}>{r.detail}</td>
                      <td style={miniTd}>
                        {canLinkSvc && onJumpPods ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                            <ResourceJumpChip
                              label="Services"
                              compact
                              onClick={() => onJumpServices?.(r.serviceName)}
                              title="打开 Services 列表并过滤此名称"
                            />
                            <ResourceJumpChip
                              label="Pods"
                              compact
                              onClick={() => onJumpPods(r.serviceName)}
                              title="打开 Pods 列表并过滤此名称"
                            />
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : rules.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>暂无 HTTP 规则</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                backgroundColor: "var(--wl-describe-table-bg)",
                minWidth: 480,
              }}
            >
              <thead>
                <tr>
                  <th style={miniTh}>Host</th>
                  <th style={miniTh}>Path</th>
                  <th style={miniTh}>PathType</th>
                  <th style={miniTh}>Service</th>
                  <th style={miniTh}>Port</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={i}>
                    <td style={miniTd}>{r?.host === "" || r?.host == null ? "（任意 Host）" : String(r.host)}</td>
                    <td style={miniTd}>{r?.path != null ? String(r.path) : "—"}</td>
                    <td style={miniTd}>{r?.pathType != null && r.pathType !== "" ? String(r.pathType) : "—"}</td>
                    <td style={miniTd}>
                      {r?.serviceName != null && r.serviceName !== "" ? (
                        <ResourceNameWithCopy
                          name={String(r.serviceName)}
                          onCopy={onCopyName}
                          fontSize={12}
                          copyButtonTitle="复制 Service 名称"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={miniTd}>{r?.port != null && r.port !== "" ? String(r.port) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>TLS</h4>
        {!tlsList.length ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>未配置 TLS</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "var(--wl-describe-table-bg)" }}>
              <thead>
                <tr>
                  <th style={miniTh}>Secret</th>
                  <th style={miniTh}>Hosts</th>
                  <th style={miniTh}>状态</th>
                </tr>
              </thead>
              <tbody>
                {tlsList.map((t, i) => (
                  <tr key={i}>
                    <td style={miniTd}>{t?.secretName != null ? String(t.secretName) : "—"}</td>
                    <td style={miniTd}>
                      {Array.isArray(t?.hosts) && t.hosts.length ? t.hosts.join(", ") : "（未限定 / 依控制器）"}
                    </td>
                    <td style={{ ...miniTd, fontSize: 11, color: "var(--wl-text-secondary)" }}>引用已配置（Secret 存在性未校验）</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tlsList.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--wl-text-muted)", marginTop: 6 }}>
            当前版本不请求 Secret 资源；证书是否有效请在集群侧核对。
          </div>
        )}
      </section>

      <section>
        <h4 style={sectionTitle}>Default Backend</h4>
        {!view.defaultBackend ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>无</div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.6 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 8 }}>
              <span style={{ flexShrink: 0, color: "var(--wl-text-secondary)" }}>Service：</span>
              {view.defaultBackend.serviceName ? (
                <ResourceNameWithCopy
                  name={view.defaultBackend.serviceName}
                  onCopy={onCopyName}
                  fontSize={12}
                  copyButtonTitle="复制 Service 名称"
                />
              ) : (
                "—"
              )}
            </div>
            <div>Port：{view.defaultBackend.port ?? "—"}</div>
          </div>
        )}
      </section>

      {troubleshoot && (
        <section>
          <h4 style={sectionTitle}>后端状态摘要</h4>
          <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", lineHeight: 1.7 }}>
            <div>规则行数：{troubleshoot.ruleRows.length}</div>
            <div>异常规则数：{troubleshoot.badRuleCount}</div>
            <div>不存在的 Backend Service 数：{troubleshoot.missingServices.length}</div>
            <div>无匹配 Pod 的 Backend 数：{troubleshoot.noPodServices.length}</div>
            {noSelectorBackendCount > 0 && <div>无 selector 的 Backend 数：{noSelectorBackendCount}</div>}
          </div>
        </section>
      )}

      <DescribeEventsSection events={Array.isArray(events) ? events.filter(Boolean) : []} />
    </div>
  );
}
