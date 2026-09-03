import React, { useEffect, useMemo, useState } from "react";
import { applyConfigMapYaml, type ConfigMap } from "../api";
import { AuditReasonDialog } from "./AuditReasonDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  deriveConfigMapKeyRows,
  formatConfigMapReferenceSummary,
  type ConfigMapReferenceSummary,
} from "../utils/configMapTable";

export type ConfigMapEditorTabProps = {
  clusterId: string;
  configMap: ConfigMap;
  references: ConfigMapReferenceSummary;
  onClose: () => void;
  onSaved?: (result: ConfigMap) => void;
  setToastMessage?: (message: string | null) => void;
};

function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyText(text: string, onDone?: (ok: boolean) => void) {
  const fallback = () => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(textarea);
      onDone?.(!!ok);
    } catch {
      onDone?.(false);
    }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => onDone?.(true)).catch(fallback);
  } else {
    fallback();
  }
}

function toolbarButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid var(--wl-border-strong)",
    backgroundColor: "var(--wl-bg-control)",
    color: disabled ? "var(--wl-text-muted)" : "var(--wl-text-heading)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
  };
}

export const ConfigMapEditorTab: React.FC<ConfigMapEditorTabProps> = ({
  clusterId,
  configMap,
  references,
  onClose,
  onSaved,
  setToastMessage,
}) => {
  const [draft, setDraft] = useState<ConfigMap>(configMap);
  const keyRows = useMemo(() => deriveConfigMapKeyRows(draft), [draft]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [valueDraft, setValueDraft] = useState("");
  const [initialValue, setInitialValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveIntent, setSaveIntent] = useState<{ auditReason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(configMap);
  }, [configMap]);

  useEffect(() => {
    if (keyRows.length === 0) {
      setSelectedId("");
      return;
    }
    if (!selectedId || !keyRows.some((row) => `${row.source}:${row.key}` === selectedId)) {
      setSelectedId(`${keyRows[0].source}:${keyRows[0].key}`);
    }
  }, [keyRows, selectedId]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const [source, ...rest] = selectedId.split(":");
    const key = rest.join(":");
    if (source !== "data" && source !== "binaryData") return null;
    return keyRows.find((row) => row.source === source && row.key === key) ?? null;
  }, [keyRows, selectedId]);

  useEffect(() => {
    if (!selected) {
      setValueDraft("");
      setInitialValue("");
      return;
    }
    const value = selected.source === "data" ? draft.data?.[selected.key] ?? "" : draft.binaryData?.[selected.key] ?? "";
    setValueDraft(value);
    setInitialValue(value);
    setError(null);
  }, [draft, selected?.key, selected?.source]);

  const isEditable = selected?.source === "data";
  const isDirty = valueDraft !== initialValue;
  const ns = draft.metadata.namespace ?? "";
  const name = draft.metadata.name;
  const impactText = formatConfigMapReferenceSummary(references);

  const saveCurrentKey = async (auditReason: string) => {
    if (!selected || selected.source !== "data" || !isDirty) return;
    setSaving(true);
    setError(null);
    try {
      const next: ConfigMap = {
        ...draft,
        metadata: { ...draft.metadata },
        data: { ...(draft.data ?? {}), [selected.key]: valueDraft },
        binaryData: draft.binaryData ? { ...draft.binaryData } : undefined,
      };
      const updated = await applyConfigMapYaml(clusterId, ns, name, JSON.stringify(next, null, 2), auditReason);
      setDraft(updated);
      setInitialValue(valueDraft);
      onSaved?.(updated);
      setToastMessage?.("ConfigMap key 已保存");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error ?? e?.message ?? "保存失败");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div
      style={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        backgroundColor: "var(--wl-bg-elevated)",
        color: "var(--wl-text-primary)",
      }}
    >
      <aside
        style={{
          width: 300,
          minWidth: 240,
          maxWidth: 380,
          borderRight: "1px solid var(--wl-border-sidebar)",
          backgroundColor: "var(--wl-bg-table)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--wl-border-sidebar)", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--wl-text-heading)" }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginTop: 2 }}>{ns || "—"} · {keyRows.length} keys</div>
        </div>
        <div style={{ overflowY: "auto", minHeight: 0, padding: 6 }}>
          {keyRows.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--wl-text-muted)" }}>无配置 key</div>
          ) : (
            keyRows.map((row) => {
              const id = `${row.source}:${row.key}`;
              const active = selectedId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedId(id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 4,
                    padding: "8px 10px",
                    marginBottom: 4,
                    borderRadius: 6,
                    border: active ? "1px solid var(--wl-border-strong)" : "1px solid transparent",
                    backgroundColor: active ? "var(--wl-bg-control)" : "transparent",
                    color: "var(--wl-text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  title={row.key}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>
                    {row.key}
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", color: "var(--wl-text-secondary)", fontSize: 11 }}>
                    <span>{row.source}</span>
                    <span>{row.sizeDisplay}</span>
                    <span>{row.lineCount}</span>
                    {row.risky && <span style={{ color: "var(--wl-pill-attention-text)" }}>疑似敏感</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--wl-border-sidebar)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--wl-text-heading)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected ? selected.key : "未选择 key"}
            </div>
            <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginTop: 2 }}>
              {selected ? `${selected.source} · ${selected.detectedType} · ${selected.sizeDisplay}` : "—"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {error && <span style={{ color: "var(--wl-status-error-text)", fontSize: 12 }}>{error}</span>}
            <button
              type="button"
              onClick={() => selected && copyText(valueDraft, (ok) => setToastMessage?.(ok ? "已复制当前 key 内容" : "复制失败"))}
              disabled={!selected}
              style={toolbarButtonStyle(!selected)}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => selected && downloadText(`${name}-${selected.key}`, valueDraft)}
              disabled={!selected}
              style={toolbarButtonStyle(!selected)}
            >
              Download
            </button>
            <button type="button" onClick={onClose} style={toolbarButtonStyle(false)}>
              Close
            </button>
            <button
              type="button"
              onClick={() => setSaveIntent({})}
              disabled={!isEditable || !isDirty || saving}
              style={{
                ...toolbarButtonStyle(!isEditable || !isDirty || saving),
                backgroundColor: isEditable && isDirty && !saving ? "var(--wl-action-primary)" : "var(--wl-bg-control)",
                color: isEditable && isDirty && !saving ? "var(--wl-text-on-primary)" : "var(--wl-text-muted)",
              }}
            >
              Save Key
            </button>
          </div>
        </div>

        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--wl-border-sidebar)",
            color: "var(--wl-text-secondary)",
            fontSize: 12,
            lineHeight: 1.5,
            flexShrink: 0,
            backgroundColor: "var(--wl-describe-section-bg)",
          }}
        >
          当前影响范围：{impactText}。修改后可能需要重启相关工作负载才会生效；删除或改名 key 可能导致应用启动失败。
          {selected?.source === "binaryData" && <span> 当前 key 来自 binaryData，按 base64 内容只读展示。</span>}
        </div>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: 12, display: "flex" }}>
          <textarea
            value={valueDraft}
            onChange={(e) => setValueDraft(e.currentTarget.value)}
            readOnly={!isEditable}
            spellCheck={false}
            style={{
              flex: 1,
              width: "100%",
              minWidth: 0,
              minHeight: 0,
              resize: "none",
              borderRadius: 6,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "var(--wl-bg-table)",
              color: "var(--wl-text-heading)",
              caretColor: "var(--wl-text-heading)",
              padding: 12,
              fontFamily:
                '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 12,
              lineHeight: 1.55,
              outline: "none",
            }}
          />
        </div>
      </section>
    </div>
    <AuditReasonDialog
      open={!!saveIntent && !saveIntent.auditReason}
      actionLabel="编辑 ConfigMap"
      items={[`${ns}/${name}${selected ? ` · key: ${selected.key}` : ""}`]}
      onClose={() => setSaveIntent(null)}
      onConfirm={(auditReason) => {
        setSaveIntent((current) => current ? { ...current, auditReason } : null);
      }}
    />
    <ConfirmDialog
      open={!!saveIntent?.auditReason}
      title="确认保存 1 个 ConfigMap key？"
      description="保存后配置会立即提交到当前集群，请确认目标 ConfigMap 与 key。"
      items={[`${ns}/${name}${selected ? ` · key: ${selected.key}` : ""}`]}
      variant="primary"
      busy={saving}
      busyText="保存中…"
      onClose={() => setSaveIntent(null)}
      onConfirm={async () => {
        const auditReason = saveIntent?.auditReason;
        if (!auditReason) return;
        await saveCurrentKey(auditReason);
      }}
    />
    </>
  );
};
