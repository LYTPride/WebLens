import React, { useState } from "react";

const cardStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: "48px auto",
  padding: "28px 24px",
  borderRadius: 12,
  border: "1px solid #334155",
  backgroundColor: "rgba(15,23,42,0.95)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 16,
  fontWeight: 700,
  color: "#e2e8f0",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.65,
  color: "#94a3b8",
};

export type ResourceAccessDeniedStateProps = {
  /** 主标题 */
  title?: string;
  /** 说明段落（可多行） */
  description: React.ReactNode;
  /** 可选：折叠展示的技术摘要（勿默认大段展示） */
  technicalSummary?: string;
  /** 资源展示名，用于图标旁提示 */
  resourceLabel?: string;
};

/**
 * 通用「当前身份无权访问该资源」受限态，供 Nodes 及后续各资源页复用。
 */
export function ResourceAccessDeniedState({
  title = "暂无访问权限",
  description,
  technicalSummary,
  resourceLabel,
}: ResourceAccessDeniedStateProps) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>
        <span aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
          🔒
        </span>
        {title}
        {resourceLabel ? (
          <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>({resourceLabel})</span>
        ) : null}
      </h3>
      <div style={bodyStyle}>{description}</div>
      {technicalSummary ? (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #475569",
              backgroundColor: "#0f172a",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {showDetail ? "隐藏" : "查看"}技术摘要
          </button>
          {showDetail && (
            <pre
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 6,
                backgroundColor: "#020617",
                border: "1px solid #1e293b",
                fontSize: 11,
                color: "#cbd5e1",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {technicalSummary}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
