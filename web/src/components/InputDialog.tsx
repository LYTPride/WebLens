import React, { useCallback, useEffect, useRef, useState } from "react";

export type InputDialogProps = {
  open: boolean;
  title: string;
  label?: string;
  initialValue: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  zIndex?: number;
  onClose: () => void;
  /** 返回 false 可阻止关闭（如校验失败） */
  onConfirm: (value: string) => void | boolean | Promise<void | boolean>;
};

/**
 * WebLens 风格单行输入弹窗，替代 window.prompt（重命名、新建文件夹等）。
 */
export const InputDialog: React.FC<InputDialogProps> = ({
  open,
  title,
  label,
  initialValue,
  placeholder,
  confirmText = "确定",
  cancelText = "取消",
  zIndex = 185,
  onClose,
  onConfirm,
}) => {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setSubmitting(false);
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open, initialValue]);

  const submit = useCallback(async () => {
    if (submitting) return;
    const v = value.trim();
    try {
      setSubmitting(true);
      const r = await Promise.resolve(onConfirm(v));
      if (r !== false) onClose();
    } finally {
      setSubmitting(false);
    }
  }, [value, onConfirm, onClose, submitting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
      if (e.key === "Enter" && !submitting) void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose, submit]);

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
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="wl-input-title"
        style={{
          width: 400,
          maxWidth: "92vw",
          padding: 20,
          borderRadius: 10,
          border: "1px solid var(--wl-border-strong)",
          backgroundColor: "var(--wl-bg-modal)",
          boxShadow: "var(--wl-shadow-modal)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="wl-input-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--wl-text-heading)" }}>
          {title}
        </div>
        {label ? <div style={{ fontSize: 12, color: "var(--wl-text-secondary)", marginBottom: 6 }}>{label}</div> : null}
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={submitting}
          onChange={(e) => setValue(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--wl-border-strong)",
            backgroundColor: "var(--wl-bg-input)",
            color: "var(--wl-text-heading)",
            fontSize: 13,
            marginBottom: 16,
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => !submitting && onClose()}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "transparent",
              color: "var(--wl-text-secondary)",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              backgroundColor: submitting ? "var(--wl-action-primary-locked)" : "var(--wl-action-primary)",
              color: "var(--wl-text-on-primary)",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {submitting ? "提交中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
