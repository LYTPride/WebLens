import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

const eyeIcon = (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const PasswordBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}> = ({ value, onChange, autoComplete }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "8px 36px 8px 10px",
          borderRadius: 6,
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-bg-input)",
          color: "var(--wl-text-heading)",
          fontSize: 13,
        }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "隐藏密码" : "显示密码"}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          width: 26,
          height: 26,
          border: "none",
          background: "transparent",
          color: "var(--wl-text-muted)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {eyeIcon}
      </button>
    </div>
  );
};

export const PasswordChangeDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const submit = useCallback(async () => {
    if (saving) return;
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await changePassword(oldPassword, newPassword);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "修改密码失败");
    } finally {
      setSaving(false);
    }
  }, [changePassword, confirmPassword, newPassword, oldPassword, onClose, saving]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 185,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--wl-overlay-scrim)",
      }}
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="wl-password-title"
        style={{
          width: 420,
          maxWidth: "92vw",
          padding: 20,
          borderRadius: 8,
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-bg-modal)",
          boxShadow: "var(--wl-shadow-modal)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="wl-password-title" style={{ color: "var(--wl-text-heading)", fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
          修改密码
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 12, color: "var(--wl-text-label)" }}>
            当前密码
            <PasswordBox value={oldPassword} onChange={setOldPassword} autoComplete="current-password" />
          </label>
          <label style={{ fontSize: 12, color: "var(--wl-text-label)" }}>
            新密码
            <PasswordBox value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          </label>
          <label style={{ fontSize: 12, color: "var(--wl-text-label)" }}>
            确认新密码
            <PasswordBox value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          </label>
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>至少 8 位，不能使用默认密码，不能与旧密码相同。</div>
          {error && <div style={{ color: "var(--wl-pill-danger-text)", fontSize: 12 }}>{error}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "transparent",
              color: "var(--wl-text-secondary)",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving || !oldPassword || !newPassword || !confirmPassword}
            onClick={() => void submit()}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              backgroundColor: saving ? "var(--wl-action-primary-locked)" : "var(--wl-action-primary)",
              color: "var(--wl-text-on-primary)",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
};
