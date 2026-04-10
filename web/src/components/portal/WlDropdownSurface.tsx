import React from "react";

export type WlDropdownSurfaceVariant = "menu" | "searchable";

const VARIANT_CLASS: Record<WlDropdownSurfaceVariant, string> = {
  menu: "wl-dropdown-surface wl-dropdown-surface--menu",
  searchable: "wl-dropdown-surface wl-dropdown-surface--searchable",
};

type WlDropdownSurfaceProps = {
  variant: WlDropdownSurfaceVariant;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  role?: React.AriaRole;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
};

/**
 * 统一下拉视觉容器（背景、圆角、阴影由 global.css 绑定 variant）。
 */
export const WlDropdownSurface = React.forwardRef<HTMLDivElement, WlDropdownSurfaceProps>(
  function WlDropdownSurface({ variant, className, style, children, role = "presentation", onClick }, ref) {
    const cn = [VARIANT_CLASS[variant], className].filter(Boolean).join(" ");
    return (
      <div ref={ref} className={cn} style={style} role={role} onClick={onClick}>
        {children}
      </div>
    );
  },
);
