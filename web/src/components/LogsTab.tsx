import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchPodLogs, streamPodLogs } from "../api";
import { ClearableSearchInput } from "./ClearableSearchInput";
import { DropdownMenuPortal } from "./DropdownMenuPortal";

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
  const [showPrevious, setShowPrevious] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [loadedAllHistory, setLoadedAllHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sinceTime, setSinceTime] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const currentMatchRef = useRef<HTMLSpanElement>(null);
  const downloadMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!isActive) return;
    setContent("");
    setError(null);
    setCurrentMatchIndex(0);
    const nowIso = new Date().toISOString();
    setSinceTime(nowIso);
    const cancel = streamPodLogs(clusterId, namespace, podName, {
      container: currentContainer || undefined,
      tailLines: 500,
      previous: showPrevious,
      timestamps: showTimestamps,
      onChunk: (text) => setContent((prev) => prev + text),
      onError: (err) => setError(err?.message ?? "加载失败"),
    });
    return cancel;
  }, [isActive, clusterId, namespace, podName, currentContainer, showPrevious, showTimestamps]);

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

  const downloadAsFile = async (mode: "visible" | "all") => {
    try {
      let data = content;
      if (mode === "all") {
        data = await fetchPodLogs(
          clusterId,
          namespace,
          podName,
          currentContainer || undefined,
          false,
          showPrevious,
          showTimestamps,
          undefined, // all logs: 不带 sinceTime
        );
      }
      // 统一换行符为 CRLF，避免在部分编辑器（如 Windows 记事本）中显示为单行
      const normalized = data.replace(/\r?\n/g, "\r\n");
      const blob = new Blob([normalized], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const containerPart = currentContainer ? `-${currentContainer}` : "";
      const suffix = mode === "visible" ? "visible" : "all";
      a.href = url;
      a.download = `${podName}${containerPart}-${suffix}-logs.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadMenuOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "下载日志失败");
      setDownloadMenuOpen(false);
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

  const handleScroll = () => {
    const el = preRef.current;
    if (!el) return;
    if (loadedAllHistory || loadingOlder) return;
    // 当用户滚动到顶部附近时，尝试加载更早的日志
    if (el.scrollTop <= 40) {
      setLoadingOlder(true);
      const oldScrollHeight = el.scrollHeight;
      const oldScrollTop = el.scrollTop;
      fetchPodLogs(
        clusterId,
        namespace,
        podName,
        currentContainer || undefined,
        false,
        showPrevious,
        showTimestamps,
        undefined, // load older: 明确拉全量，再做前缀合并
      )
        .then((full) => {
          if (!full) return;
          // 尝试在完整日志中找到当前内容的最后一次出现位置，以避免重复
          const idx = full.lastIndexOf(content);
          let merged: string;
          if (idx >= 0) {
            merged = full.slice(0, idx) + content;
          } else {
            merged = full;
          }
          setContent(merged);
          setLoadedAllHistory(true);
          // 在下一帧调整 scrollTop，尽量保持当前视图位置不跳动
          setTimeout(() => {
            const node = preRef.current;
            if (!node) return;
            const newHeight = node.scrollHeight;
            node.scrollTop = newHeight - oldScrollHeight + oldScrollTop;
          }, 0);
        })
        .catch((e: any) => {
          // 加载更早日志失败不影响现有内容，只提示错误一次
          setError((prev) => prev ?? e?.message ?? "加载更早日志失败");
        })
        .finally(() => {
          setLoadingOlder(false);
        });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--wl-border-sidebar)",
          flexShrink: 0,
        }}
      >
        <label style={{ fontSize: 12, color: "var(--wl-text-secondary)" }}>容器：</label>
        <select
          value={currentContainer}
          onChange={(e) => setCurrentContainer(e.target.value)}
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid var(--wl-border-strong)",
            backgroundColor: "var(--wl-bg-elevated)",
            color: "var(--wl-text-heading)",
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
        {sinceTime && (
          <span style={{ fontSize: 12, color: "var(--wl-text-muted)", marginLeft: 8, whiteSpace: "nowrap" }}>
            Logs from{" "}
            {(() => {
              const d = new Date(sinceTime);
              if (Number.isNaN(d.getTime())) return sinceTime;
              return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
                d.getDate(),
              ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
                d.getMinutes(),
              ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
            })()}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--wl-text-secondary)" }}>
          <input
            type="checkbox"
            checked={showPrevious}
            onChange={(e) => setShowPrevious(e.target.checked)}
            style={{ margin: 0 }}
          />
          previous 容器日志
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--wl-text-secondary)" }}>
          <input
            type="checkbox"
            checked={showTimestamps}
            onChange={(e) => setShowTimestamps(e.target.checked)}
            style={{ margin: 0 }}
          />
          显示时间戳
        </label>
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
        <ClearableSearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setCurrentMatchIndex(0);
          }}
          placeholder="搜索关键字"
          style={{ width: 140 }}
          inputStyle={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid var(--wl-border-strong)",
            backgroundColor: "var(--wl-bg-input)",
            color: "var(--wl-text-heading)",
            fontSize: 12,
          }}
        />
        {keyword && (
          <>
            <span style={{ fontSize: 12, color: "var(--wl-text-secondary)", whiteSpace: "nowrap" }}>
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
        <div style={{ position: "relative" }}>
          <button
            ref={downloadMenuOpen ? downloadMenuTriggerRef : undefined}
            type="button"
            onClick={() => setDownloadMenuOpen((v) => !v)}
            title="下载日志"
            style={{ ...navBtnStyle, padding: "4px 10px", marginLeft: 4 }}
          >
            Download
          </button>
          {downloadMenuOpen && (
          <DropdownMenuPortal
            onClose={() => setDownloadMenuOpen(false)}
            triggerRef={downloadMenuTriggerRef}
            align="right"
            surfaceStyle={{ padding: 0, minWidth: 140 }}
          >
            <button
              type="button"
              className="wl-menu-item"
              onClick={() => {
                setDownloadMenuOpen(false);
                downloadAsFile("visible");
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 12px",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                textAlign: "left",
              }}
            >
              Visible logs
            </button>
            <button
              type="button"
              className="wl-menu-item"
              onClick={() => {
                setDownloadMenuOpen(false);
                downloadAsFile("all");
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 12px",
                border: "none",
                borderTop: "1px solid var(--wl-border-strong)",
                cursor: "pointer",
                fontSize: 13,
                textAlign: "left",
              }}
            >
              All logs
            </button>
          </DropdownMenuPortal>
          )}
        </div>
      </div>
      <pre
        ref={preRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          margin: 0,
          padding: 10,
          overflow: "auto",
          fontSize: 13,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          color: "var(--wl-text-heading)",
          backgroundColor: "var(--wl-describe-table-bg)",
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
                  backgroundColor:
                    seg.matchIndex === safeIndex ? "#b45309" : "var(--wl-log-match-inactive-bg)",
                  color:
                    seg.matchIndex === safeIndex
                      ? "var(--wl-text-on-primary)"
                      : "var(--wl-log-match-inactive-text)",
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
  border: "1px solid var(--wl-border-strong)",
  backgroundColor: "var(--wl-bg-control)",
  color: "var(--wl-text-heading)",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1.2,
};
