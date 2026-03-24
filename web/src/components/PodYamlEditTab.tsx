import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyDeploymentYaml,
  applyPodYaml,
  fetchDeploymentYaml,
  fetchPodYaml,
} from "../api";

const MINIMAP_WIDTH = 56;
const LINE_HEIGHT = 18;

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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const minimapWrapRef = useRef<HTMLDivElement>(null);
  const [viewportStyle, setViewportStyle] = useState<{ top: number; height: number }>({ top: 0, height: 0 });
  const [minimapHeight, setMinimapHeight] = useState(0);

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
      const el = editorRef.current;
      if (!el || total === 0) return;
      const target = matches[idx];
      if (!target) return;
      if (focusEditor) {
        el.focus();
      }
      el.setSelectionRange(target.start, target.end);
      // 根据匹配所在行，手动滚动到视图中央附近，确保可见并同步 minimap
      const before = yaml.slice(0, target.start);
      const lineIndex = before.split("\n").length - 1; // 从 0 开始
      const targetTop = lineIndex * LINE_HEIGHT;
      const viewTop = targetTop - el.clientHeight / 2;
      el.scrollTop = Math.max(0, viewTop);
      // 额外触发一次 viewport 更新和 minimap 同步
      setTimeout(() => updateViewportFromEditor(), 0);
    },
    [matches, total, yaml, updateViewportFromEditor],
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
      const next = (i + 1) % total;
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
        flex: 1,
        minWidth: 0,
        width: "100%",
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
          <span>Kind: {yamlKind === "deployment" ? "Deployment" : "Pod"}</span>
          <span>Name: {podName}</span>
          <span>Namespace: {namespace}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentMatchIndex(0);
            }}
            placeholder="搜索关键字"
            style={{
              width: 160,
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

      {/* 编辑器 + 缩略图 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          overflow: "hidden",
          width: "100%",
        }}
      >
        {/* 行号 + 编辑区 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            overflow: "hidden",
            width: "100%",
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
              lineHeight: 1.5,
              paddingTop: 10,
              paddingRight: 8,
              textAlign: "right",
              fontFamily:
                '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily:
                '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              resize: "none",
            }}
          />
        </div>

        {/* 文档缩略与定位区（窄列，不占用过多宽度） */}
        <div
          ref={minimapWrapRef}
          role="button"
          tabIndex={0}
          onClick={handleMinimapClick}
          style={{
            width: MINIMAP_WIDTH,
            flex: "0 0 auto",
            position: "relative",
            overflow: "hidden",
            borderLeft: "1px solid #1e293b",
            backgroundColor: "#020617",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              padding: 2,
              fontSize: 2,
              lineHeight: 2,
              fontFamily: "ui-monospace, monospace",
              color: "#64748b",
              whiteSpace: "pre",
              wordBreak: "break-all",
              opacity: 0.7,
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
              height: viewportStyle.height || 40,
              backgroundColor: "rgba(148, 163, 184, 0.45)",
              borderRadius: 2,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
};
