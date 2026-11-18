import React, { useRef } from "react";
import { DropdownMenuPortal } from "./DropdownMenuPortal";
import { WlMenuItemButton, type WlMenuItemButtonProps } from "./portal/WlMenuItemButton";

type ResourceRowMenuProps = {
  label: string;
  open: boolean;
  busy?: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

export function ResourceRowMenu({ label, open, busy, disabled, onOpenChange, children }: ResourceRowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        className="wl-table-menu-trigger"
        title="操作"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => onOpenChange(!open)}
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          cursor: busy ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          lineHeight: 1,
          opacity: busy ? 0.5 : 1,
        }}
      >
        ⋮
      </button>
      {open && (
        <DropdownMenuPortal
          triggerRef={triggerRef}
          onClose={() => onOpenChange(false)}
          align="right"
          surfaceStyle={{ padding: "4px 0", minWidth: 176 }}
        >
          {children}
        </DropdownMenuPortal>
      )}
    </div>
  );
}

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};

export function ResourceRowMenuItem({ icon, children, ...props }: WlMenuItemButtonProps & { icon: string }) {
  return (
    <WlMenuItemButton {...props} style={itemStyle}>
      <span aria-hidden="true" style={{ marginRight: 8 }}>{icon}</span> {children}
    </WlMenuItemButton>
  );
}
