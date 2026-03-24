import React, { useCallback, useEffect, useRef, useState } from "react";
import { PodShell } from "./PodShell";
import { LogsTab } from "./LogsTab";
import { PodYamlEditTab } from "./PodYamlEditTab";
import { podExecWsUrl } from "../api";
import { FileManagerPanel } from "./FileManagerPanel";

export interface PanelTab {
  id: string;
  type: "shell" | "logs" | "edit";
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  title: string;
  /** 该 Pod 的容器列表（用于 Logs 容器下拉） */
  containers: string[];
}

interface BottomPanelProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onActiveTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAll: () => void;
  heightRatio: number;
  onHeightRatioChange: (r: number) => void;
  minimized: boolean;
  onMinimizedChange: (v: boolean) => void;
}

const MIN_HEIGHT = 0.15;
const MAX_HEIGHT = 0.85;
const DEFAULT_HEIGHT = 0.4;

export const BottomPanel: React.FC<BottomPanelProps> = ({
  tabs,
  activeTabId,
  onActiveTab,
  onCloseTab,
  onCloseAll,
  heightRatio,
  onHeightRatioChange,
  minimized,
  onMinimizedChange,
}) => {
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartRatio = useRef(0);

  // Shell 工作区：右侧文件面板（按 tab 维度记忆展开状态/宽度/路径）
  const [fileOpenByTab, setFileOpenByTab] = useState<Record<string, boolean>>({});
  const [fileWidthByTab, setFileWidthByTab] = useState<Record<string, number>>({});
  const [filePathByTab, setFilePathByTab] = useState<Record<string, string>>({});
  const [fileDragging, setFileDragging] = useState(false);
  const fileDragStartX = useRef(0);
  const fileDragStartW = useRef(0);
  const fileDragTabId = useRef<string | null>(null);

  useEffect(() => {
    if (!fileDragging) return;
    const onMove = (e: MouseEvent) => {
      const id = fileDragTabId.current;
      if (!id) return;
      const delta = fileDragStartX.current - e.clientX; // 向左拖 => 面板更宽
      let next = fileDragStartW.current + delta;
      next = Math.max(300, Math.min(780, next));
      setFileWidthByTab((prev) => ({ ...prev, [id]: next }));
    };
    const onUp = () => setFileDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [fileDragging]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      dragStartY.current = e.clientY;
      dragStartRatio.current = heightRatio;
    },
    [heightRatio],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY;
      const deltaRatio = deltaY / window.innerHeight;
      let next = dragStartRatio.current + deltaRatio;
      next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next));
      onHeightRatioChange(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onHeightRatioChange]);

  if (tabs.length === 0) return null;

  const heightPx = minimized ? undefined : `${heightRatio * 100}vh`;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: minimized ? "auto" : heightPx,
        maxHeight: minimized ? 40 : undefined,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0f172a",
        borderTop: "1px solid #1e293b",
        zIndex: 100,
        boxShadow: "0 -2px 12px rgba(0,0,0,0.3)",
      }}
    >
      {/* 拖拽条 */}
      <div
        role="button"
        tabIndex={0}
        onMouseDown={handleDragStart}
        onClick={() => minimized && onMinimizedChange(false)}
        style={{
          height: 8,
          cursor: minimized ? "pointer" : "ns-resize",
          background: dragging ? "#334155" : "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={minimized ? "点击展开" : "拖拽调整高度"}
      >
        {!minimized && (
          <span style={{ width: 40, height: 3, borderRadius: 2, backgroundColor: "#475569", fontSize: 0 }} />
        )}
      </div>

      {/* 标签栏 + 最小化/关闭全部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid #1e293b",
          flexShrink: 0,
          minHeight: 36,
        }}
      >
        <div style={{ display: "flex", flex: 1, overflowX: "auto", minWidth: 0 }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onActiveTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRight: "1px solid #1e293b",
                backgroundColor: activeTabId === t.id ? "#1e293b" : "transparent",
                color: activeTabId === t.id ? "#e2e8f0" : "#94a3b8",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <span>
                {t.type === "shell" ? "Shell" : t.type === "logs" ? "Logs" : "Pod"}: {t.type === "edit" ? t.pod : t.title}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t.id);
                }}
                style={{
                  padding: 0,
                  border: "none",
                  background: "none",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
                title="关闭此标签"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
          <button
            type="button"
            onClick={() => onMinimizedChange(!minimized)}
            style={panelBtnStyle}
            title={minimized ? "展开" : "最小化"}
          >
            {minimized ? "▴" : "▾"}
          </button>
          <button type="button" onClick={onCloseAll} style={panelBtnStyle} title="关闭全部">
            关闭全部
          </button>
        </div>
      </div>

      {/* 内容区：所有标签常驻 DOM 仅隐藏，避免切换/最小化时 Shell 重连清空输出 */}
      {tabs.length > 0 && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: minimized ? "none" : "flex",
            flexDirection: "column",
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{
                display: activeTabId !== tab.id ? "none" : "flex",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                backgroundColor: tab.type === "shell" ? "#020617" : undefined,
              }}
            >
              {tab.type === "shell" ? (
                <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
                    <PodShell
                      wsUrl={podExecWsUrl(tab.clusterId, tab.namespace, tab.pod, tab.container)}
                      podName={tab.pod}
                      namespace={tab.namespace}
                      onClose={() => onCloseTab(tab.id)}
                      inline
                    />
                  </div>

                  {/* 右侧文件面板：默认收起为窄条 */}
                  {fileOpenByTab[tab.id] ? (
                    <>
                      {/* 分隔拖拽条 */}
                      <div
                        role="presentation"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          fileDragTabId.current = tab.id;
                          fileDragStartX.current = e.clientX;
                          fileDragStartW.current = fileWidthByTab[tab.id] ?? 520;
                          setFileDragging(true);
                        }}
                        title="拖拽调整 Shell / 文件窗口宽度"
                        style={{
                          width: 6,
                          cursor: "col-resize",
                          background: fileDragging ? "#334155" : "transparent",
                          borderLeft: "1px solid rgba(30,41,59,0.6)",
                          borderRight: "1px solid rgba(30,41,59,0.6)",
                        }}
                      />
                      <div
                        style={{
                          width: fileWidthByTab[tab.id] ?? 520,
                          minWidth: 300,
                          maxWidth: 780,
                          display: "flex",
                          flexDirection: "column",
                          backgroundColor: "#020617",
                          borderLeft: "1px solid #1e293b",
                        }}
                      >
                        <div
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid #1e293b",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: "#020617",
                            flexShrink: 0,
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>文件管理</div>
                          <button
                            type="button"
                            onClick={() => setFileOpenByTab((prev) => ({ ...prev, [tab.id]: false }))}
                            title="收起文件窗口"
                            style={{
                              padding: "2px 6px",
                              borderRadius: 6,
                              border: "1px solid #334155",
                              backgroundColor: "#1e293b",
                              color: "#e2e8f0",
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            ▶
                          </button>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                          <FileManagerPanel
                            clusterId={tab.clusterId}
                            namespace={tab.namespace}
                            pod={tab.pod}
                            container={tab.container}
                            path={filePathByTab[tab.id] ?? "/"}
                            onPathChange={(p) => setFilePathByTab((prev) => ({ ...prev, [tab.id]: p }))}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        width: 24,
                        minWidth: 24,
                        borderLeft: "1px solid #1e293b",
                        backgroundColor: "#020617",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setFileOpenByTab((prev) => ({ ...prev, [tab.id]: true }))}
                        title="展开文件窗口"
                        style={{
                          width: 20,
                          height: 48,
                          borderRadius: 10,
                          border: "1px solid #334155",
                          backgroundColor: "#1e293b",
                          color: "#e2e8f0",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        ◀
                      </button>
                    </div>
                  )}
                </div>
              ) : tab.type === "logs" ? (
                <LogsTab
                  clusterId={tab.clusterId}
                  namespace={tab.namespace}
                  podName={tab.pod}
                  container={tab.container}
                  containers={tab.containers}
                  onClose={() => onCloseTab(tab.id)}
                  isActive={activeTabId === tab.id}
                />
              ) : (
                <PodYamlEditTab
                  clusterId={tab.clusterId}
                  namespace={tab.namespace}
                  podName={tab.pod}
                  onClose={() => onCloseTab(tab.id)}
                  isActive={activeTabId === tab.id}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const panelBtnStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid #334155",
  backgroundColor: "#1e293b",
  color: "#94a3b8",
  cursor: "pointer",
  fontSize: 12,
};
