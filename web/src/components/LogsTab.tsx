import React, { useEffect, useMemo, useRef, useState } from "react";
import { streamPodLogs } from "../api";

interface LogsTabProps {
  clusterId: string;
  namespace: string;
  podName: string;
  container: string;
  containers: string[];
  onClose?: () => void;
  /** 仅当标签激活时才建立日志流，避免与 Watch 等长连接争抢导致长时间等待 */
  isActive?: boolean;
}

export const LogsTab: React.FC<LogsTabProps> = ({
  clusterId,
  namespace,
  podName,
  container,
  containers,
  isActive = true,
}) => {
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [currentContainer, setCurrentContainer] = useState(container);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const currentMatchRef = useRef<HTMLSpanElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!isActive) return;
    setContent("");
    setError(null);
    setCurrentMatchIndex(0);
    const cancel = streamPodLogs(clusterId, namespace, podName, {
      container: currentContainer || undefined,
      tailLines: 500,
      onChunk: (text) => setContent((prev) => prev + text),
      onError: (err) => setError(err?.message ?? "加载失败"),
    });
    return cancel;
  }, [isActive, clusterId, namespace, podName, currentContainer]);

  useEffect(() => {
    if (!autoScroll) return;
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [content, autoScroll]);

  const keyword = search.trim();
  const { matches, total } = useMemo(() => {
    if (!keyword) return { matches: [] as { start: number; end: number }[], total: 0 };
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const list: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      list.push({ start: m.index, end: m.index + m[0].length });
    }
    return { matches: list, total: list.length };
  }, [content, keyword]);

  const safeIndex = total > 0 ? ((currentMatchIndex % total) + total) % total : 0;
  useEffect(() => {
    if (total > 0 && currentMatchRef.current) {
      currentMatchRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [safeIndex, total]);

  const goPrev = () => {
    if (total === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + total) % total);
  };
  const goNext = () => {
    if (total === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % total);
  };
  const toBottom = () => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  };

  const segments = useMemo(() => {
    if (!keyword || matches.length === 0) {
      return [{ type: "text" as const, value: content }];
    }
    const list: { type: "text" | "match"; value: string; matchIndex?: number }[] = [];
    let last = 0;
    matches.forEach(({ start, end }, i) => {
      if (start > last) list.push({ type: "text", value: content.slice(last, start) });
      list.push({ type: "match", value: content.slice(start, end), matchIndex: i });
      last = end;
    });
    if (last < content.length) list.push({ type: "text", value: content.slice(last) });
    return list;
  }, [content, keyword, matches]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid #1e293b",
          flexShrink: 0,
        }}
      >
        <label style={{ fontSize: 12, color: "#94a3b8" }}>容器：</label>
        <select
          value={currentContainer}
          onChange={(e) => setCurrentContainer(e.target.value)}
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid #334155",
            backgroundColor: "#0f172a",
            color: "#e2e8f0",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {containers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div style={{ flex: 1, minWidth: 0 }} />
        <button
          type="button"
          onClick={() => {
            setSearch("error");
            setCurrentMatchIndex(0);
          }}
          style={navBtnStyle}
          title="快速匹配 error"
        >
          error
        </button>
        <button
          type="button"
          onClick={() => {
            setSearch("warn");
            setCurrentMatchIndex(0);
          }}
          style={navBtnStyle}
          title="快速匹配 warn"
        >
          warn
        </button>
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          style={navBtnStyle}
          title={autoScroll ? "暂停自动滚动" : "恢复自动滚动"}
        >
          {autoScroll ? "暂停滚动" : "自动滚动"}
        </button>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCurrentMatchIndex(0);
          }}
          placeholder="搜索关键字"
          style={{
            width: 140,
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
              style={navBtnStyle}
            >
              ▲
            </button>
            <button
              type="button"
              onClick={goNext}
              title="下一处匹配"
              style={navBtnStyle}
            >
              ▼
            </button>
          </>
        )}
        <button
          type="button"
          onClick={toBottom}
          title="滚到底部"
          style={{ ...navBtnStyle, padding: "4px 8px" }}
        >
          To bottom ▼
        </button>
      </div>
      <pre
        ref={preRef}
        style={{
          flex: 1,
          margin: 0,
          padding: 10,
          overflow: "auto",
          fontSize: 13,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          color: "#e2e8f0",
          backgroundColor: "#020617",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          minHeight: 0,
        }}
      >
        {error ? (
          <span style={{ color: "#f97373" }}>{error}</span>
        ) : content === "" ? (
          "(等待日志…)"
        ) : (
          segments.map((seg, i) =>
            seg.type === "text" ? (
              <span key={i}>{seg.value}</span>
            ) : (
              <span
                key={i}
                ref={seg.matchIndex === safeIndex ? currentMatchRef : undefined}
                style={{
                  backgroundColor: seg.matchIndex === safeIndex ? "#b45309" : "#475569",
                  color: "#fff",
                }}
              >
                {seg.value}
              </span>
            ),
          )
        )}
      </pre>
    </div>
  );
};

const navBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  borderRadius: 4,
  border: "1px solid #334155",
  backgroundColor: "#1e293b",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1.2,
};
