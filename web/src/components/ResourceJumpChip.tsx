import React from "react";

/**
 * 跨资源联动入口：全站统一轻量胶囊按钮（深色主题、无下划线、与 .wl-* 体系一致）。
 * 仅承载短动作标签（Services / Pods / Ingress）；资源全名请用 ResourceNameWithCopy + 本组件分开展示。
 */
export type ResourceJumpChipProps = {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  /** 更小的内边距与字号，适合表格「联动」列的短标签（Services / Pods） */
  compact?: boolean;
  className?: string;
};

export function ResourceJumpChip({
  label,
  onClick,
  title,
  disabled,
  compact,
  className,
}: ResourceJumpChipProps) {
  const cls = [
    "wl-resource-jump",
    compact ? "wl-resource-jump--compact" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} title={title} disabled={disabled} onClick={onClick}>
      <span className="wl-resource-jump__text">{label}</span>
    </button>
  );
}
