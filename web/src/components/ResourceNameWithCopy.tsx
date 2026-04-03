import React from "react";
import copyIcon from "../assets/icon-copy.png";

export type ResourceNameWithCopyProps = {
  name: string;
  onCopy: (name: string) => void;
  /** 与单元格正文字号对齐，默认 12 */
  fontSize?: number;
  className?: string;
  /** 复制按钮 tooltip / aria-label（默认「复制名称」） */
  copyButtonTitle?: string;
};

/**
 * 表格 / Describe 中的 K8s 资源名：可换行正文 + 复制（不跳转；联动请单独用 ResourceJumpChip）。
 * 复制 icon 默认隐藏，悬停整块名称区或聚焦时显示（见 global.css）。
 */
export function ResourceNameWithCopy({
  name,
  onCopy,
  fontSize = 12,
  className,
  copyButtonTitle = "复制名称",
}: ResourceNameWithCopyProps) {
  return (
    <div className={["wl-resource-name-with-copy", className ?? ""].filter(Boolean).join(" ")}>
      <span className="wl-resource-name-with-copy__text" style={{ fontSize }} title={name}>
        {name}
      </span>
      <span className="wl-resource-name-with-copy__tools">
        <button
          type="button"
          className="wl-resource-name-with-copy__copy"
          onClick={() => onCopy(name)}
          title={copyButtonTitle}
          aria-label={`${copyButtonTitle}：${name}`}
        >
          <img src={copyIcon} alt="" style={{ height: 14, width: "auto", display: "block" }} />
        </button>
      </span>
    </div>
  );
}
