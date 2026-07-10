import React, { useRef, useState } from "react";
import { DropdownMenuPortal } from "../components/DropdownMenuPortal";
import { useAuth } from "./AuthContext";
import { PasswordChangeDialog } from "./PasswordChangeDialog";

const menuItemStyle: React.CSSProperties = {
  width: "100%",
  justifyContent: "flex-start",
  padding: "7px 10px",
  fontSize: 13,
};

export const UserMenu: React.FC = () => {
  const { auth, logout } = useAuth();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="wl-header-settings-action wl-header-settings-action--soft"
        title={auth?.user.username ? `用户配置：${auth.user.username}` : "用户配置"}
        aria-label="用户配置"
        onClick={() => {
          setSpinning(true);
          setOpen((v) => !v);
        }}
        onAnimationEnd={() => setSpinning(false)}
        data-spinning={spinning ? "true" : "false"}
      >
        <span className="wl-header-settings-action__icon" aria-hidden>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21a8 8 0 0 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </span>
      </button>
      {open && (
        <DropdownMenuPortal
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          align="right"
          surfaceStyle={{ padding: 4, minWidth: 160 }}
        >
          <button
            type="button"
            className="wl-menu-item"
            style={menuItemStyle}
            onClick={() => {
              setOpen(false);
              setPasswordOpen(true);
            }}
          >
            修改密码
          </button>
          <button
            type="button"
            className="wl-menu-item"
            style={menuItemStyle}
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            登出系统
          </button>
        </DropdownMenuPortal>
      )}
      <PasswordChangeDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
};
