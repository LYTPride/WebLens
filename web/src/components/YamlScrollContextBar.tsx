import React from "react";

const DEFAULT_FONT =
  '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export type YamlScrollContextBarProps = {
  /** 当前视口所在行的 key 路径（由 buildYamlKeyPathPerLine 等得到） */
  segments: string[];
  /** 无 key 时的占位文案 */
  emptyLabel?: string;
};

/**
 * YAML 编辑器顶部上下文路径条：单行面包屑，过长时横向滚动；完整路径放在 title 上。
 */
export const YamlScrollContextBar: React.FC<YamlScrollContextBarProps> = ({
  segments,
  emptyLabel = "（文档根 / 无 key 上下文）",
}) => {
  const title = segments.join(" › ");
  return (
    <div
      title={title || undefined}
      style={{
        flexShrink: 0,
        borderBottom: "1px solid #1e293b",
        backgroundColor: "#0c1222",
        padding: "5px 12px",
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        fontSize: 11,
        color: "#94a3b8",
        fontFamily: DEFAULT_FONT,
        letterSpacing: "0.02em",
      }}
    >
      {segments.length > 0 ? (
        <span>
          {segments.map((seg, i) => (
            <React.Fragment key={`${i}-${seg}`}>
              {i > 0 && <span style={{ opacity: 0.55, margin: "0 4px" }}>›</span>}
              <span style={{ color: "#cbd5e1" }}>{seg}</span>
            </React.Fragment>
          ))}
        </span>
      ) : (
        <span style={{ opacity: 0.45 }}>{emptyLabel}</span>
      )}
    </div>
  );
};
