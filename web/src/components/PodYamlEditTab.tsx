import React, { useCallback, useEffect, useRef, useState } from "react";
import { applyPodYaml, fetchPodYaml } from "../api";

const LINE_HEIGHT = 18;
const MINIMAP_WIDTH = 80;

interface PodYamlEditTabProps {
  clusterId: string;
  namespace: string;
  podName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export const PodYamlEditTab: React.FC<PodYamlEditTabProps> = ({
  clusterId,
  namespace,
  podName,
  onClose,
  onSaved,
}) => {
  const [yaml, setYaml] = useState("");
  const [initialYaml, setInitialYaml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const minimapWrapRef = useRef<HTMLDivElement>(null);
  const [viewportStyle, setViewportStyle] = useState<{ top: number; height: number }>({ top: 0, height: 0 });
  const [minimapHeight, setMinimapHeight] = useState(0);

  const loadYaml = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await fetchPodYaml(clusterId, namespace, podName);
      setYaml(text);
      setInitialYaml(text);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "加载 YAML 失败");
    } finally {
      setLoading(false);
    }
  }, [clusterId, namespace, podName]);

  useEffect(() => {
    loadYaml();
  }, [loadYaml]);

  const updateViewportFromEditor = useCallback(() => {
    const el = editorRef.current;
    const wrap = minimapWrapRef.current;
    const ln = lineNumbersRef.current;
    if (ln && el) ln.scrollTop = el.scrollTop;
    if (!wrap) return;
    const h = wrap.clientHeight;
    if (h && h !== minimapHeight) setMinimapHeight(h);
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setViewportStyle({ top: 0, height: h });
      return;
    }
    setViewportStyle({
      top: (scrollTop / scrollHeight) * h,
      height: Math.max(20, (clientHeight / scrollHeight) * h),
    });
  }, []);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    updateViewportFromEditor();
    const onScroll = () => updateViewportFromEditor();
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [yaml, updateViewportFromEditor]);

  useEffect(() => {
    const wrap = minimapWrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setMinimapHeight(wrap.clientHeight));
    ro.observe(wrap);
    setMinimapHeight(wrap.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = minimapWrapRef.current;
    const el = editorRef.current;
    if (!wrap || !el) return;
    const rect = wrap.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    el.scrollTop = ratio * el.scrollHeight - el.clientHeight / 2;
  };

  const isDirty = yaml !== initialYaml;

  const save = async (andClose: boolean) => {
    if (!isDirty) {
      if (andClose) onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await applyPodYaml(clusterId, namespace, podName, yaml);
      setInitialYaml(yaml);
      onSaved?.();
      if (andClose) onClose();
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setYaml(initialYaml);
    setError(null);
    onClose();
  };

  const lines = yaml.split("\n");
  const lineCount = lines.length;

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
        backgroundColor: "#0f172a",
      }}
    >
      {/* 资源信息 + 操作按钮 */}
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
          <span>Kind: Pod</span>
          <span>Name: {podName}</span>
          <span>Namespace: {namespace}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              fontSize: 12,
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

      {/* 编辑器 + 缩略图 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* 行号 + 编辑区 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            overflow: "hidden",
          }}
        >
          <div
            ref={lineNumbersRef}
            style={{
              width: 40,
              flexShrink: 0,
              overflow: "auto",
              borderRight: "1px solid #1e293b",
              backgroundColor: "#0f172a",
              color: "#64748b",
              fontSize: 12,
              lineHeight: LINE_HEIGHT,
              paddingTop: 10,
              paddingRight: 8,
              textAlign: "right",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={editorRef}
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 12px",
              border: "none",
              outline: "none",
              backgroundColor: "#020617",
              color: "#e2e8f0",
              fontSize: 13,
              lineHeight: LINE_HEIGHT,
              fontFamily: "ui-monospace, monospace",
              resize: "none",
            }}
          />
        </div>

        {/* 文档缩略与定位区 */}
        <div
          ref={minimapWrapRef}
          role="button"
          tabIndex={0}
          onClick={handleMinimapClick}
          style={{
            width: MINIMAP_WIDTH,
            flexShrink: 0,
            position: "relative",
            overflow: "hidden",
            borderLeft: "1px solid #1e293b",
            backgroundColor: "#0f172a",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: lineCount * 2,
              padding: 2,
              fontSize: 2,
              lineHeight: 2,
              fontFamily: "ui-monospace, monospace",
              color: "#64748b",
              whiteSpace: "pre",
              wordBreak: "break-all",
              transformOrigin: "top left",
              transform: minimapHeight > 0 && lineCount > 0
                ? `scaleY(${minimapHeight / (lineCount * 2)})`
                : undefined,
            }}
          >
            {yaml}
          </div>
          {/* 当前可见区域指示 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: viewportStyle.top,
              height: viewportStyle.height,
              backgroundColor: "rgba(100, 116, 139, 0.35)",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
};
