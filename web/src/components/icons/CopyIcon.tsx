import React from "react";

export type CopyIconProps = {
  /** 视口像素边长，默认 15，与列表行高协调 */
  size?: number;
  className?: string;
};

/**
 * 复制双框图标：描边、currentColor，与深色主题及列表内操作区线条风格一致。
 */
export function CopyIcon({ size = 15, className }: CopyIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 01-2 2h-2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="4" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}
