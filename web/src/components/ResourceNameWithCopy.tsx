import React from "react";
import copyIcon from "../assets/icon-copy.png";

export type ResourceNameWithCopyProps = {
  name: string;
  onCopy: (name: string) => void;
  /** 与单元格正文字号对齐，默认 12 */
  fontSize?: number;
  className?: string;
};

/**
 * 表格 / Describe 中的 K8s 资源名：可换行正文 + 复制（不跳转；联动请单独用 ResourceJumpChip）。
 */
export function ResourceNameWithCopy({ name, onCopy, fontSize = 12, className }: ResourceNameWithCopyProps) {
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
          title="复制名称"
          aria-label={`复制 ${name}`}
        >
          <img src={copyIcon} alt="" style={{ height: 14, width: "auto", display: "block" }} />
        </button>
      </span>
    </div>
  );
}
