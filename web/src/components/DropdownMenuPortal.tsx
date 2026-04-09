import React, { useRef } from "react";
import { Z_INDEX } from "../constants/zLayers";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFloatingDropdownPosition } from "../hooks/useFloatingDropdownPosition";
import type { DropdownAlign } from "../utils/dropdownPosition";
import { WlPortal } from "./portal/WlPortal";
import { WlDropdownSurface } from "./portal/WlDropdownSurface";

export type DropdownMenuPortalProps = {
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /**
   * 由父级在「打开」为 true 时再渲染本组件；不要传 open=false 常驻挂载。
   * 关闭方式：点击遮罩、Escape、再次点 trigger、菜单项内自行 onClose。
   */
  align?: DropdownAlign;
  /** 附加在统一表面上的 class（如历史兼容 `wl-table-dropdown-menu`） */
  surfaceClassName?: string;
  /** 合并到定位后的表面（flex、padding、minWidth 等） */
  surfaceStyle?: React.CSSProperties;
  /** 子菜单展开等导致高度变化时传入，触发重新测量 */
  repositionKey?: unknown;
};

/**
 * 轻量下拉菜单：body Portal + 统一定位 + z-index + Escape 关闭。
 * @see Z_INDEX.dropdownBackdrop / dropdownSurface
 */
export function DropdownMenuPortal({
  onClose,
  triggerRef,
  children,
  align = "right",
  surfaceClassName,
  surfaceStyle,
  repositionKey,
}: DropdownMenuPortalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(onClose, true);

  const layout = useFloatingDropdownPosition({
    triggerRef,
    panelRef,
    align,
    contentKey: repositionKey,
  });

  const positionedVisible =
    layout != null
      ? {
          position: "fixed" as const,
          top: layout.top,
          left: layout.left,
          maxHeight: layout.maxHeight,
          overflowY: layout.maxHeight ? ("auto" as const) : undefined,
          zIndex: Z_INDEX.dropdownSurface,
          ...surfaceStyle,
        }
      : {
          position: "fixed" as const,
          top: -9999,
          left: 0,
          visibility: "hidden" as const,
          zIndex: Z_INDEX.dropdownSurface,
          ...surfaceStyle,
        };

  return (
    <WlPortal>
      <div
        style={{ position: "fixed", inset: 0, zIndex: Z_INDEX.dropdownBackdrop }}
        onClick={onClose}
        aria-hidden
      />
      <WlDropdownSurface
        ref={panelRef}
        variant="menu"
        className={surfaceClassName}
        style={positionedVisible}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </WlDropdownSurface>
    </WlPortal>
  );
}
