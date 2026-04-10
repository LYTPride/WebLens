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
  /** edit 标签：YAML 资源类型，默认 pod */
  yamlKind?: "pod" | "deployment" | "statefulset" | "ingress" | "service" | "pvc" | "node";
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
  /** YAML 保存成功（Deployment 时带 API 返回体） */
  onEditSaved?: (tab: PanelTab, result?: unknown) => void;
}

const MIN_HEIGHT = 0.15;
const MAX_HEIGHT = 0.85;
const DEFAULT_HEIGHT = 0.4;

/** Shell 标签右侧文件面板：每 tab.id 独立 */
export interface ShellFilePanelState {
  isExpanded: boolean;
  hasUserInteracted: boolean;
  /** 已消费首次引导（含已播放标题提示），避免重复 */
  hasShownHint: boolean;
}

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
  onEditSaved,
}) => {
  const [dragging, setDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartRatio = useRef(0);

  // Shell 工作区：右侧文件面板（按 tab 维度记忆展开/用户操作/首次提示）
  const [shellFilePanelByTab, setShellFilePanelByTab] = useState<Record<string, ShellFilePanelState>>({});
  /** 标题区引导动效：与 hasShownHint 配合；结束用 onAnimationEnd 清理，避免 Strict Mode 误清定时器 */
  const [filePanelIntroVisualByTab, setFilePanelIntroVisualByTab] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    setShellFilePanelByTab((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const t of tabs) {
        if (t.type !== "shell") continue;
        if (next[t.id] === undefined) {
          next[t.id] = {
            isExpanded: true,
            hasUserInteracted: false,
            hasShownHint: false,
          };
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        if (!tabs.some((x) => x.id === id && x.type === "shell")) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setFilePanelIntroVisualByTab((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(next)) {
        if (!tabs.some((x) => x.id === k && x.type === "shell")) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  useEffect(() => {
    const toHint: string[] = [];
    for (const t of tabs) {
      if (t.type !== "shell") continue;
      const st = shellFilePanelByTab[t.id];
      if (!st || st.hasUserInteracted || st.hasShownHint || !st.isExpanded) continue;
      toHint.push(t.id);
    }
    if (toHint.length === 0) return;
    setShellFilePanelByTab((prev) => {
      const next = { ...prev };
      for (const id of toHint) {
        next[id] = { ...next[id], hasShownHint: true };
      }
      return next;
    });
    setFilePanelIntroVisualByTab((prev) => {
      const next = { ...prev };
      for (const id of toHint) {
        next[id] = true;
      }
      return next;
    });
  }, [tabs, shellFilePanelByTab]);

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
        width: "100%",
        maxWidth: "100%",
        height: minimized ? "auto" : heightPx,
        /* 拖拽条 8px + 标签行；标签滚动区含底部 padding 为 scrollbar 留带，最小化总高约 60 */
        maxHeight: minimized ? 60 : undefined,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--wl-bg-elevated)",
        borderTop: "1px solid var(--wl-border-sidebar)",
        zIndex: 100,
        boxShadow: "var(--wl-shadow-bottom-panel)",
        /* 防止宽标签把 fixed 层撑出视口，避免视口级横向滚动与标签条 scrollbar 混淆 */
        overflowX: "hidden",
        overflowY: "hidden",
        boxSizing: "border-box",
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
          background: dragging
            ? "var(--wl-bg-control)"
            : "linear-gradient(180deg, var(--wl-border-sidebar) 0%, var(--wl-bg-elevated) 100%)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={minimized ? "点击展开" : "拖拽调整高度"}
      >
        {!minimized && (
          <span
            style={{ width: 40, height: 3, borderRadius: 2, backgroundColor: "var(--wl-bottom-resize-handle)", fontSize: 0 }}
          />
        )}
      </div>

      {/* 标签栏 + 最小化/关闭全部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--wl-border-sidebar)",
          flexShrink: 0,
          minHeight: 36,
          /* 作为列 flex 子项时须可窄于内容，否则整行 min-width 会变成所有标签宽度之和 */
          minWidth: 0,
          width: "100%",
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        <div
          className="wl-bottom-panel-tabs-scroll"
          style={{
            display: "flex",
            flex: 1,
            flexBasis: 0,
            alignItems: "center",
            overflowX: "auto",
            overflowY: "hidden",
            minWidth: 0,
            maxWidth: "100%",
            overscrollBehaviorX: "contain",
            WebkitOverflowScrolling: "touch",
            /* 为横向 scrollbar 留出独立带区，避免悬停/拖动时压住标签标题 */
            paddingBottom: 12,
            boxSizing: "border-box",
          }}
        >
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
                borderRight: "1px solid var(--wl-border-sidebar)",
                backgroundColor: activeTabId === t.id ? "var(--wl-bg-control)" : "transparent",
                color: activeTabId === t.id ? "var(--wl-text-heading)" : "var(--wl-text-secondary)",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <span>
                {t.type === "shell"
                  ? `Shell: ${t.title}`
                  : t.type === "logs"
                    ? `Logs: ${t.title}`
                    : t.type === "edit"
                      ? `${t.yamlKind === "deployment" ? "Deployment" : t.yamlKind === "statefulset" ? "StatefulSet" : t.yamlKind === "ingress" ? "Ingress" : t.yamlKind === "service" ? "Service" : t.yamlKind === "pvc" ? "PVC" : t.yamlKind === "node" ? "Node" : "Pod"}: ${t.pod}`
                      : t.title}
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
                  color: "var(--wl-text-muted)",
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
        <div style={{ display: "flex", gap: 4, padding: "4px 8px", flexShrink: 0, alignItems: "center" }}>
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
                backgroundColor: tab.type === "shell" ? "var(--wl-bg-table)" : undefined,
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

                  {/* 右侧文件面板：新建 Shell 标签默认展开（state 尚未写入首帧同效）；用户操作后按记忆恢复 */}
                  {(shellFilePanelByTab[tab.id]?.isExpanded ?? true) ? (
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
                          background: fileDragging ? "var(--wl-bg-control)" : "transparent",
                          borderLeft: "1px solid var(--wl-border-subtle)",
                          borderRight: "1px solid var(--wl-border-subtle)",
                        }}
                      />
                      <div
                        style={{
                          width: fileWidthByTab[tab.id] ?? 520,
                          minWidth: 300,
                          maxWidth: 780,
                          display: "flex",
                          flexDirection: "column",
                          backgroundColor: "var(--wl-bg-table)",
                          borderLeft: "1px solid var(--wl-border-sidebar)",
                        }}
                      >
                        <div
                          className={
                            filePanelIntroVisualByTab[tab.id] ? "wl-file-panel-header-intro" : undefined
                          }
                          onAnimationEnd={(e) => {
                            if (e.animationName !== "wl-file-panel-header-intro") return;
                            setFilePanelIntroVisualByTab((prev) => {
                              if (!prev[tab.id]) return prev;
                              const n = { ...prev };
                              delete n[tab.id];
                              return n;
                            });
                          }}
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid var(--wl-border-sidebar)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: "var(--wl-bg-table)",
                            flexShrink: 0,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                              minWidth: 0,
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--wl-text-heading)" }}>文件管理</div>
                            {filePanelIntroVisualByTab[tab.id] && (
                              <span style={{ fontSize: 11, color: "var(--wl-text-muted)", fontWeight: 400 }}>
                                支持上传 / 下载与目录操作
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setShellFilePanelByTab((prev) => {
                                const cur = prev[tab.id] ?? {
                                  isExpanded: true,
                                  hasUserInteracted: false,
                                  hasShownHint: false,
                                };
                                return {
                                  ...prev,
                                  [tab.id]: {
                                    ...cur,
                                    isExpanded: false,
                                    hasUserInteracted: true,
                                  },
                                };
                              })
                            }
                            title="收起文件窗口"
                            style={{
                              padding: "2px 6px",
                              borderRadius: 6,
                              border: "1px solid var(--wl-border-strong)",
                              backgroundColor: "var(--wl-bg-control)",
                              color: "var(--wl-text-heading)",
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
                        borderLeft: "1px solid var(--wl-border-sidebar)",
                        backgroundColor: "var(--wl-bg-table)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setShellFilePanelByTab((prev) => {
                            const cur = prev[tab.id] ?? {
                              isExpanded: false,
                              hasUserInteracted: false,
                              hasShownHint: false,
                            };
                            return {
                              ...prev,
                              [tab.id]: {
                                ...cur,
                                isExpanded: true,
                                hasUserInteracted: true,
                              },
                            };
                          })
                        }
                        title="展开文件窗口"
                        style={{
                          width: 20,
                          height: 48,
                          borderRadius: 10,
                          border: "1px solid var(--wl-border-strong)",
                          backgroundColor: "var(--wl-bg-control)",
                          color: "var(--wl-text-heading)",
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
                  yamlKind={tab.yamlKind ?? "pod"}
                  onClose={() => onCloseTab(tab.id)}
                  onSaved={(result) => onEditSaved?.(tab, result)}
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
  border: "1px solid var(--wl-border-strong)",
  backgroundColor: "var(--wl-bg-control)",
  color: "var(--wl-text-secondary)",
  cursor: "pointer",
  fontSize: 12,
};
