import React, { useCallback, useEffect, useState } from "react";

export type ConfirmDialogVariant = "danger" | "primary";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** 标题下的说明文字 */
  description?: string;
  /** 列表上方小字，默认「将处理以下资源（可滚动查看全部）：」 */
  listCaption?: string;
  /** 中间可滚动列表；空数组时可隐藏列表区 */
  items: string[];
  variant?: ConfirmDialogVariant;
  confirmText?: string;
  cancelText?: string;
  /** 外部忙碌（如批量操作）；与内部提交互斥 */
  busy?: boolean;
  busyText?: string;
  zIndex?: number;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * WebLens 统一确认弹窗：深色主题，与批量删除等现有模态一致。
 * 后续新增危险操作/需确认的操作应优先使用本组件。
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  listCaption = "将处理以下资源（可滚动查看全部）：",
  items,
  variant = "danger",
  confirmText = "确定",
  cancelText = "取消",
  busy = false,
  busyText = "执行中…",
  zIndex = 185,
  onClose,
  onConfirm,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const locked = busy || submitting;

  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (locked) return;
    try {
      setSubmitting(true);
      await Promise.resolve(onConfirm());
      onClose();
    } catch {
      /* 错误由调用方 toast/setError 处理 */
    } finally {
      setSubmitting(false);
    }
  }, [locked, onConfirm, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  if (!open) return null;

  const confirmBg = variant === "primary"
    ? locked
      ? "var(--wl-action-primary-locked)"
      : "var(--wl-action-primary)"
    : locked
      ? "var(--wl-action-primary-locked)"
      : "var(--wl-action-danger)";

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
      onClick={() => {
        if (!locked) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="wl-confirm-title"
        style={{
          width: 440,
          maxWidth: "92vw",
          padding: 20,
          borderRadius: 10,
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-bg-modal)",
          boxShadow: "var(--wl-shadow-modal)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="wl-confirm-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, color: "var(--wl-text-heading)" }}>
          {title}
        </div>
        {description ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>{description}</div>
        ) : null}
        {items.length > 0 ? (
          <>
            <div style={{ fontSize: 11, color: "var(--wl-text-muted)", marginBottom: 8 }}>{listCaption}</div>
            <div
              style={{
                maxHeight: 220,
                overflowY: "auto",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--wl-border-subtle)",
                backgroundColor: "var(--wl-bg-input)",
                fontSize: 12,
                color: "var(--wl-text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {items.map((line, i) => (
                <div
                  key={`${line}-${i}`}
                  style={{
                    borderBottom: i < items.length - 1 ? "1px solid var(--wl-border-table-row)" : undefined,
                    padding: "4px 0",
                    wordBreak: "break-all",
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          </>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              if (!locked) onClose();
            }}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "transparent",
              color: "var(--wl-text-secondary)",
              cursor: locked ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => void handleConfirm()}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              backgroundColor: confirmBg,
              color: "var(--wl-text-on-primary)",
              cursor: locked ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {locked ? busyText : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
