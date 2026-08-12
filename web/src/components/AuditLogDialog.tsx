import React, { useEffect } from "react";

export type AuditLogDialogProps = {
  open: boolean;
  content: string;
  onClose: () => void;
};

export const AuditLogDialog: React.FC<AuditLogDialogProps> = ({ open, content, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 190,
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
        aria-labelledby="wl-audit-log-title"
        style={{
          width: 560,
          maxWidth: "92vw",
          padding: 20,
          borderRadius: 10,
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-bg-modal)",
          boxShadow: "var(--wl-shadow-modal)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div id="wl-audit-log-title" style={{ color: "var(--wl-text-heading)", fontSize: 15, fontWeight: 600 }}>
          资源操作日志
        </div>
        <div style={{ marginTop: 8, color: "var(--wl-text-secondary)", fontSize: 12 }}>
          用户在执行高危或敏感资源操作前填写的背景、原因或目的。
        </div>
        <div
          style={{
            maxHeight: "45vh",
            marginTop: 12,
            padding: 12,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            border: "1px solid var(--wl-border-subtle)",
            borderRadius: 6,
            backgroundColor: "var(--wl-bg-input)",
            color: "var(--wl-text-primary)",
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          {content}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            className="wl-confirm-btn-primary"
            onClick={onClose}
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
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
