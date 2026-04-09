import React, { useCallback, useRef } from "react";
import { Z_INDEX } from "../constants/zLayers";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFloatingDropdownPosition } from "../hooks/useFloatingDropdownPosition";
import { WlPortal } from "./portal/WlPortal";
import { WlDropdownSurface } from "./portal/WlDropdownSurface";

export type SearchableDropdownPanelPortalProps = {
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** 面板最小宽度下限，实际为 max(该值, trigger 宽度) */
  minWidthPx?: number;
  /** 合并到定位后的面板容器（如 maxWidth） */
  panelStyle?: React.CSSProperties;
  /** 列表/关键字变化时重算位置 */
  repositionKey?: unknown;
};

/**
 * 可搜索大下拉：仅由父级在打开时挂载；定位与菜单层共用 Z_INDEX。
 */
export function SearchableDropdownPanelPortal({
  onClose,
  triggerRef,
  children,
  minWidthPx = 320,
  panelStyle: panelStyleProp,
  repositionKey,
}: SearchableDropdownPanelPortalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(onClose, true);

  const beforeMeasure = useCallback(
    (panel: HTMLDivElement, triggerRect: DOMRect) => {
      const minW = Math.max(minWidthPx, triggerRect.width);
      panel.style.minWidth = `${minW}px`;
    },
    [minWidthPx],
  );

  const layout = useFloatingDropdownPosition({
    triggerRef,
    panelRef,
    align: "left",
    beforeMeasure,
    contentKey: repositionKey,
  });

  const positionedVisible =
    layout != null
      ? {
          position: "fixed" as const,
          top: layout.top,
          left: layout.left,
          minWidth: layout.minWidth,
          maxHeight: layout.maxHeight,
          overflow: layout.maxHeight ? ("hidden" as const) : undefined,
          display: "flex" as const,
          flexDirection: "column" as const,
          zIndex: Z_INDEX.dropdownSurface,
          boxSizing: "border-box" as const,
          ...panelStyleProp,
        }
      : {
          position: "fixed" as const,
          top: -9999,
          left: 0,
          visibility: "hidden" as const,
          minWidth: minWidthPx,
          display: "flex" as const,
          flexDirection: "column" as const,
          zIndex: Z_INDEX.dropdownSurface,
          boxSizing: "border-box" as const,
          ...panelStyleProp,
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
        variant="searchable"
        className="wl-searchable-dropdown-panel"
        style={positionedVisible}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </WlDropdownSurface>
    </WlPortal>
  );
}
