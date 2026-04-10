import React from "react";

export type WlMenuItemButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean;
};

/**
 * 统一下拉菜单行按钮：hover / danger / disabled 由 global.css `.wl-menu-item*` 控制。
 */
export const WlMenuItemButton = React.forwardRef<HTMLButtonElement, WlMenuItemButtonProps>(
  function WlMenuItemButton({ className, danger, type = "button", ...rest }, ref) {
    const cn = [
      "wl-menu-item",
      danger ? "wl-menu-item-danger" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return <button ref={ref} type={type} className={cn} {...rest} />;
  },
);
