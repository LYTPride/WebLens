import React, { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AUDIT_REASON_LENGTH } from "../constants/audit";

export type AuditReasonDialogProps = {
  open: boolean;
  actionLabel: string;
  items: string[];
  zIndex?: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

export type AuditedActionConfirmRequest = {
  title: string;
  description?: string;
  items: string[];
  variant: "danger" | "primary";
  onConfirm: (auditReason: string) => Promise<void>;
};

/** Required first step before a sensitive resource operation reaches confirmation. */
export const AuditReasonDialog: React.FC<AuditReasonDialogProps> = ({
  open,
  actionLabel,
  items,
  zIndex = 190,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [actionLabel, open]);

  const submit = useCallback(() => {
    const value = reason.trim();
    if (!value) {
      setError("操作原因是强制必填项，请填写后再继续。");
      textareaRef.current?.focus();
      return;
    }
    onConfirm(value);
  }, [onConfirm, reason]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open, submit]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--wl-overlay-scrim)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="wl-audit-reason-title"
        style={{
          width: 480,
          maxWidth: "92vw",
          padding: 20,
          borderRadius: 10,
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-bg-modal)",
          boxShadow: "var(--wl-shadow-modal)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div id="wl-audit-reason-title" style={{ color: "var(--wl-text-heading)", fontSize: 15, fontWeight: 600 }}>
          填写{actionLabel}原因
        </div>
        <div style={{ marginTop: 8, color: "var(--wl-text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
          为便于后续追查本次资源操作的背景、原因和目的，操作日志为强制必填项。填写后还需在资源确认窗口中确认，操作才会执行。
        </div>
        {items.length > 0 && (
          <div
            style={{
              maxHeight: 110,
              marginTop: 12,
              padding: "7px 9px",
              overflowY: "auto",
              border: "1px solid var(--wl-border-subtle)",
              borderRadius: 6,
              backgroundColor: "var(--wl-bg-input)",
              color: "var(--wl-text-secondary)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {items.map((item, index) => (
              <div key={`${item}-${index}`} style={{ wordBreak: "break-all" }}>{item}</div>
            ))}
          </div>
        )}
        <label style={{ display: "block", marginTop: 12, color: "var(--wl-text-label)", fontSize: 12, fontWeight: 600 }}>
          操作日志 <span style={{ color: "var(--wl-status-error-text)" }}>*</span>
          <textarea
            ref={textareaRef}
            value={reason}
            maxLength={MAX_AUDIT_REASON_LENGTH}
            rows={5}
            placeholder="请填写本次操作的背景、原因或目的"
            aria-invalid={!!error}
            onChange={(event) => {
              setReason(event.target.value);
              if (error && event.target.value.trim()) setError(null);
            }}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "9px 10px",
              boxSizing: "border-box",
              resize: "vertical",
              border: `1px solid ${error ? "var(--wl-status-error-text)" : "var(--wl-border-strong)"}`,
              borderRadius: 6,
              outline: "none",
              backgroundColor: "var(--wl-bg-input)",
              color: "var(--wl-text-heading)",
              font: "inherit",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          />
        </label>
        <div style={{ display: "flex", minHeight: 18, marginTop: 4, color: error ? "var(--wl-status-error-text)" : "var(--wl-text-muted)", fontSize: 11 }}>
          <span>{error ?? "可使用 Ctrl/⌘ + Enter 继续"}</span>
          <span style={{ marginLeft: "auto" }}>{reason.length}/{MAX_AUDIT_REASON_LENGTH}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="wl-confirm-btn-cancel"
            onClick={onClose}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "transparent",
              color: "var(--wl-text-secondary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            type="button"
            className="wl-confirm-btn-primary"
            onClick={submit}
            style={{
              padding: "6px 14px",
              border: "none",
              borderRadius: 6,
              backgroundColor: "var(--wl-action-primary)",
              color: "var(--wl-text-on-primary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            继续确认
          </button>
        </div>
      </div>
    </div>
  );
};
