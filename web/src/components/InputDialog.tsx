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
        backgroundColor: "rgba(0,0,0,0.5)",
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
          border: "1px solid #334155",
          backgroundColor: "#0f172a",
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="wl-input-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#e2e8f0" }}>
          {title}
        </div>
        {label ? <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>{label}</div> : null}
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
            border: "1px solid #334155",
            backgroundColor: "#020617",
            color: "#e2e8f0",
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
              border: "1px solid #334155",
              backgroundColor: "transparent",
              color: "#94a3b8",
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
              backgroundColor: submitting ? "#334155" : "#0d9488",
              color: "#fff",
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
