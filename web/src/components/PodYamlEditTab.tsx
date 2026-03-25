import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyDeploymentYaml,
  applyPodYaml,
  fetchDeploymentYaml,
  fetchPodYaml,
} from "../api";
import { ClearableSearchInput } from "./ClearableSearchInput";
import { YamlMonacoEditor, type YamlMonacoEditorHandle } from "./YamlMonacoEditor";

interface PodYamlEditTabProps {
  clusterId: string;
  namespace: string;
  podName: string;
  /** 默认 Pod；Deployment 时与 podName 传部署名称 */
  yamlKind?: "pod" | "deployment";
  onClose: () => void;
  /** Deployment 保存时传入 API 返回的 JSON 对象，便于列表局部更新 */
  onSaved?: (result?: unknown) => void;
  /** 仅当标签激活时才请求 YAML，避免与 Watch 等长连接争抢导致长时间等待 */
  isActive?: boolean;
}

export const PodYamlEditTab: React.FC<PodYamlEditTabProps> = ({
  clusterId,
  namespace,
  podName,
  yamlKind = "pod",
  onClose,
  onSaved,
  isActive = true,
}) => {
  const [yaml, setYaml] = useState("");
  const [initialYaml, setInitialYaml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const editorRef = useRef<YamlMonacoEditorHandle>(null);

  const loadYaml = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const text =
        yamlKind === "deployment"
          ? await fetchDeploymentYaml(clusterId, namespace, podName)
          : await fetchPodYaml(clusterId, namespace, podName);
      setYaml(text);
      setInitialYaml(text);
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error ?? err?.message ?? "加载 YAML 失败");
    } finally {
      setLoading(false);
    }
  }, [clusterId, namespace, podName, yamlKind]);

  useEffect(() => {
    if (isActive) loadYaml();
  }, [isActive, loadYaml]);

  const isDirty = yaml !== initialYaml;

  const keyword = search.trim();
  const { matches, total } = useMemo(() => {
    if (!keyword) return { matches: [] as { start: number; end: number }[], total: 0 };
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const list: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(yaml)) !== null) {
      list.push({ start: m.index, end: m.index + m[0].length });
    }
    return { matches: list, total: list.length };
  }, [yaml, keyword]);

  const safeIndex = total > 0 ? ((currentMatchIndex % total) + total) % total : 0;

  const scrollToMatch = useCallback(
    (idx: number, opts?: { focusEditor?: boolean }) => {
      const focusEditor = opts?.focusEditor ?? true;
      const api = editorRef.current;
      if (!api || total === 0) return;
      const target = matches[idx];
      if (!target) return;
      if (focusEditor) {
        api.focus();
      }
      api.selectRangeByOffset(target.start, target.end);
    },
    [matches, total],
  );

  const goPrev = () => {
    if (total === 0) return;
    setCurrentMatchIndex((i) => {
      const next = (i - 1 + total) % total;
      scrollToMatch(next, { focusEditor: true });
      return next;
    });
  };
  const goNext = () => {
    if (total === 0) return;
    setCurrentMatchIndex((i) => {
      const next = (i + 1 + total) % total;
      scrollToMatch(next, { focusEditor: true });
      return next;
    });
  };

  const save = async (andClose: boolean) => {
    if (!isDirty) {
      if (andClose) onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (yamlKind === "deployment") {
        const data = await applyDeploymentYaml(clusterId, namespace, podName, yaml);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else {
        await applyPodYaml(clusterId, namespace, podName, yaml);
        setInitialYaml(yaml);
        onSaved?.();
      }
      if (andClose) onClose();
    } catch (e: unknown) {
      const err = e as { message?: string; response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error ?? err?.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setYaml(initialYaml);
    setError(null);
    onClose();
  };

  if (loading) {
    return (
      <div style={{ padding: 24, color: "#94a3b8" }}>加载 YAML…</div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        flex: 1,
        minWidth: 0,
        width: "100%",
        backgroundColor: "#0f172a",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid #1e293b",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#94a3b8", fontSize: 12 }}>
          <span>Kind: {yamlKind === "deployment" ? "Deployment" : "Pod"}</span>
          <span>Name: {podName}</span>
          <span>Namespace: {namespace}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ClearableSearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setCurrentMatchIndex(0);
            }}
            placeholder="搜索关键字"
            style={{ width: 160 }}
            inputStyle={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid #334155",
              backgroundColor: "#020617",
              color: "#e2e8f0",
              fontSize: 12,
            }}
          />
          {keyword && (
            <>
              <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
                × {total > 0 ? `${safeIndex + 1}/${total}` : "0/0"}
              </span>
              <button
                type="button"
                onClick={goPrev}
                title="上一处匹配"
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid #334155",
                  backgroundColor: "#1e293b",
                  color: "#e2e8f0",
                  cursor: total > 0 ? "pointer" : "not-allowed",
                  fontSize: 12,
                  lineHeight: 1.2,
                }}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={goNext}
                title="下一处匹配"
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid #334155",
                  backgroundColor: "#1e293b",
                  color: "#e2e8f0",
                  cursor: total > 0 ? "pointer" : "not-allowed",
                  fontSize: 12,
                  lineHeight: 1.2,
                }}
              >
                ▼
              </button>
            </>
          )}
          {error && (
            <span style={{ fontSize: 12, color: "#f97373" }}>{error}</span>
          )}
          <button
            type="button"
            onClick={cancel}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #334155",
              backgroundColor: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save(false)}
            disabled={saving || !isDirty}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #334155",
              backgroundColor: "#1e293b",
              color: isDirty && !saving ? "#e2e8f0" : "#64748b",
              cursor: isDirty && !saving ? "pointer" : "not-allowed",
              fontSize: 12,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "none",
              backgroundColor: "#0d9488",
              color: "#fff",
              cursor: saving ? "not-allowed" : "pointer",
              fontSize: 12,
            }}
          >
            Save & Close
          </button>
        </div>
      </div>

      {/* Monaco：内置行号、YAML 高亮、右侧 minimap、编辑器内 sticky scroll（indentation 模型） */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        <YamlMonacoEditor ref={editorRef} value={yaml} onChange={setYaml} />
      </div>
    </div>
  );
};
