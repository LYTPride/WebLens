import React, { useEffect, useRef, useState } from "react";
import {
  ClusterSummary,
  fetchClusters,
  fetchPods,
  Pod,
  getPodContainerNames,
  reloadClustersFromBackend,
  fetchNamespaces,
  fetchResourceList,
  fetchConfig,
  saveConfig,
  deletePod,
  type ResourceKind,
} from "../api";
import { Sidebar } from "../components/Sidebar";
import { ResourceTable, type Column } from "../components/ResourceTable";
import { BottomPanel, type PanelTab } from "../components/BottomPanel";

const ALL_NAMESPACES = "";

const POD_COLUMN_KEYS = ["name", "namespace", "node", "status", "restarts", "containers", "actions"] as const;
const POD_COLUMN_DEFAULTS: Record<(typeof POD_COLUMN_KEYS)[number], number> = {
  name: 180,
  namespace: 120,
  node: 140,
  status: 80,
  restarts: 70,
  containers: 70,
  actions: 80,
};
const MIN_COL_WIDTH = 40;

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #1f2937",
  fontSize: 12,
  color: "#9ca3af",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #111827",
  fontSize: 13,
};

type K8sItem = { metadata: { name: string; namespace?: string; uid?: string }; [k: string]: unknown };

export const App: React.FC = () => {
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [activeNamespace, setActiveNamespace] = useState<string>(ALL_NAMESPACES);
  const [currentView, setCurrentView] = useState<ResourceKind>("pods");
  const [pods, setPods] = useState<Pod[]>([]);
  const [resourceItems, setResourceItems] = useState<K8sItem[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  /** 底部面板：Shell/Logs 多标签 */
  const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
  const [activePanelTabId, setActivePanelTabId] = useState<string | null>(null);
  const [panelHeightRatio, setPanelHeightRatio] = useState(0.4);
  const [panelMinimized, setPanelMinimized] = useState(false);
  /** 三点菜单子菜单：当前展开的是 Shell 还是 Logs */
  const [podMenuSubmenu, setPodMenuSubmenu] = useState<"shell" | "logs" | null>(null);
  const [reloading, setReloading] = useState(false);
  const [namespacesLoading, setNamespacesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 无命名空间列表且无默认命名空间时，用户可手动输入命名空间 */
  const [manualNamespaceInput, setManualNamespaceInput] = useState("");
  /** 平台配置弹窗 */
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [configKubeconfigDir, setConfigKubeconfigDir] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  /** 集群下拉：展开状态与搜索关键字 */
  const [clusterDropdownOpen, setClusterDropdownOpen] = useState(false);
  const [clusterSearchKeyword, setClusterSearchKeyword] = useState("");
  /** 当前打开操作菜单的 Pod（namespace/name），null 表示未打开 */
  const [podMenuOpenKey, setPodMenuOpenKey] = useState<string | null>(null);
  /** 列表区按 Name 关键字搜索（Pods / Deployments / Ingresses 等共用） */
  const [nameFilter, setNameFilter] = useState("");
  /** Pod 表列宽（可拖拽调整） */
  const [podColumnWidths, setPodColumnWidths] = useState<Record<string, number>>(() => ({ ...POD_COLUMN_DEFAULTS }));
  /** 列宽拖拽：当前拖拽的列 key */
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  /** 用户手动输入并点击「应用」的命名空间，避免 namespaces 接口返回后覆盖导致列表消失 */
  const manualNamespaceRef = useRef<{ clusterId: string; namespace: string } | null>(null);
  /** 当前选中的 cluster/namespace，用于 loadPods 返回时丢弃过期响应 */
  const activeClusterNsRef = useRef<{ clusterId: string | null; namespace: string }>({
    clusterId: null,
    namespace: ALL_NAMESPACES,
  });
  /** 页面是否可见，用于在标签页隐藏时暂停轮询，减少不必要请求 */
  const [pageVisible, setPageVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  /** 左侧边栏是否收起 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    activeClusterNsRef.current = { clusterId: activeClusterId, namespace: activeNamespace };
  }, [activeClusterId, activeNamespace]);

  // 监听浏览器标签页可见性变化：隐藏时暂停列表轮询，显示时再恢复
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      setPageVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
    };
  }, []);

  // 切换集群 / 视图 / 命名空间时，重置 Name 关键字搜索，避免带着上一次的关键字影响新视图
  useEffect(() => {
    setNameFilter("");
  }, [activeClusterId, activeNamespace, currentView]);

  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      setPodColumnWidths((prev) => ({
        ...prev,
        [resizingCol]: Math.max(MIN_COL_WIDTH, (resizeStartWidth.current + delta) | 0),
      }));
    };
    const onUp = () => setResizingCol(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingCol]);

  const openPanelTab = (type: "shell" | "logs", pod: Pod, container: string) => {
    if (!activeClusterId) return;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;
    const containers = getPodContainerNames(pod);
    const id = `${type}-${ns}-${name}-${container}`;
    setPanelTabs((prev) => {
      const exists = prev.some((t) => t.id === id);
      if (exists) return prev;
      const tab: PanelTab = {
        id,
        type,
        clusterId: activeClusterId,
        namespace: ns,
        pod: name,
        container,
        title: `${name} / ${container}`,
        containers,
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setPodMenuOpenKey(null);
    setPodMenuSubmenu(null);
  };

  const openEditTab = (pod: Pod) => {
    if (!activeClusterId) return;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;
    const id = `edit-${ns}-${name}`;
    setPanelTabs((prev) => {
      const exists = prev.some((t) => t.id === id);
      if (exists) return prev;
      const tab: PanelTab = {
        id,
        type: "edit",
        clusterId: activeClusterId,
        namespace: ns,
        pod: name,
        container: "",
        title: name,
        containers: getPodContainerNames(pod),
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setPodMenuOpenKey(null);
    setPodMenuSubmenu(null);
  };

  const closePanelTab = (id: string) => {
    setPanelTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activePanelTabId === id) setActivePanelTabId(next[0]?.id ?? null);
      return next;
    });
  };

  const loadClusters = async () => {
    const items = await fetchClusters();
    setClusters(items);
    setError(null);
    if (!activeClusterId && items.length > 0) setActiveClusterId(items[0].id);
  };

  const reloadClusters = async () => {
    setReloading(true);
    try {
      const items = await reloadClustersFromBackend();
      setClusters(items);
      if (items.length > 0 && !items.find((c) => c.id === activeClusterId)) setActiveClusterId(items[0].id);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to reload clusters");
    } finally {
      setReloading(false);
    }
  };

  const loadPods = async (clusterId: string, namespace: string) => {
    const requestedNs = namespace || undefined;
    const items = await fetchPods(clusterId, requestedNs);
    const cur = activeClusterNsRef.current;
    if (cur.clusterId !== clusterId || (cur.namespace || "") !== (requestedNs ?? "")) {
      return;
    }
    setPods(items);
    setError(null);
  };

  const loadResourceList = async () => {
    if (!activeClusterId) return;
    setResourceLoading(true);
    const ns = currentView === "nodes" || currentView === "namespaces" ? undefined : (activeNamespace || undefined);
    fetchResourceList(activeClusterId, currentView, ns)
      .then((items) => {
        setResourceItems(items as K8sItem[]);
        setError(null);
      })
      .catch((err: any) => {
        setResourceItems([]);
        const status = err?.response?.status;
        const backendMsg = err?.response?.data?.error;
        if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
        else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
        else setError(err?.message || "加载失败");
      })
      .finally(() => setResourceLoading(false));
  };

  useEffect(() => {
    loadClusters().catch((e: any) => setError(e?.message || "Failed to load clusters")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeClusterId) {
      manualNamespaceRef.current = null;
      setNamespaces([]);
      setActiveNamespace(ALL_NAMESPACES);
      setPods([]);
      setResourceItems([]);
      return;
    }
    if (manualNamespaceRef.current && manualNamespaceRef.current.clusterId !== activeClusterId) {
      manualNamespaceRef.current = null;
    }
    setNamespacesLoading(true);
    const currentClusterId = activeClusterId;
    const currentCluster = clusters.find((c) => c.id === activeClusterId);
    fetchNamespaces(activeClusterId)
      .then((list) => {
        const manual = manualNamespaceRef.current;
        if (manual && manual.clusterId === currentClusterId) {
          setNamespaces((prev) =>
            prev.includes(manual.namespace) ? prev : [...prev, manual.namespace],
          );
          setActiveNamespace(manual.namespace);
          return;
        }
        if (list.length === 0 && currentCluster?.defaultNamespace) {
          list = [currentCluster.defaultNamespace];
          setNamespaces(list);
          setActiveNamespace(currentCluster.defaultNamespace);
        } else {
          setNamespaces(list);
          setActiveNamespace(ALL_NAMESPACES);
        }
      })
      .catch((e: any) => {
        const manual = manualNamespaceRef.current;
        if (manual && manual.clusterId === currentClusterId) {
          setNamespaces([manual.namespace]);
          setActiveNamespace(manual.namespace);
        } else {
          setNamespaces([]);
          setActiveNamespace(ALL_NAMESPACES);
        }
        setError(e?.message || "Failed to load namespaces");
      })
      .finally(() => setNamespacesLoading(false));
  }, [activeClusterId, clusters]);

  useEffect(() => {
    if (!activeClusterId) return;
    if (!pageVisible) return;

    const loadOnce = () => {
      if (currentView === "pods") {
        loadPods(activeClusterId, activeNamespace).catch((err: any) => {
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "Failed to load pods");
        });
      } else {
        loadResourceList();
      }
    };

    // 初次加载一次
    loadOnce();

    // 对当前选中的 cluster + namespace + 视图 做持续轮询，起到「watch」效果
    // 间隔从 5 秒调整为 3 秒，并在标签页隐藏时暂停（依赖 pageVisible）
    const timer = window.setInterval(loadOnce, 3000);
    return () => window.clearInterval(timer);
  }, [activeClusterId, activeNamespace, currentView, pageVisible]);

  const viewTitle: Record<ResourceKind, string> = {
    pods: "Pods",
    deployments: "Deployments",
    statefulsets: "Stateful Sets",
    daemonsets: "Daemon Sets",
    jobs: "Jobs",
    cronjobs: "Cron Jobs",
    events: "Events",
    configmaps: "Config Maps",
    secrets: "Secrets",
    services: "Services",
    ingresses: "Ingresses",
    nodes: "Nodes",
    namespaces: "Namespaces",
  };

  const genericColumns: Column<K8sItem>[] = [
    { key: "name", title: "Name", render: (i) => i.metadata?.name ?? "-" },
    { key: "namespace", title: "Namespace", render: (i) => (i.metadata?.namespace as string) ?? "-" },
  ];

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "#111827",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        position: "relative",
        pointerEvents: "auto",
      }}
    >
      <header
        style={{
          flexShrink: 0,
          padding: "12px 20px",
          borderBottom: "1px solid #1f2937",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              backgroundColor: "#f9fafb",
              color: "#0f172a",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            Web
          </span>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Lens</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={() => {
              setConfigModalOpen(true);
              setConfigError(null);
              fetchConfig()
                .then((c) => setConfigKubeconfigDir(c.kubeconfigDir))
                .catch(() => setConfigKubeconfigDir(""));
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #334155",
              backgroundColor: "#1e293b",
              color: "#e5e7eb",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            平台配置
          </button>
        </div>
      </header>

      {configModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => !configSaving && setConfigModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              padding: 20,
              minWidth: 400,
              maxWidth: "90vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>平台配置</h3>
            <label style={{ display: "block", fontSize: 13, color: "#9ca3af", marginBottom: 6 }}>
              kubeconfig 存放目录（仅支持绝对路径）
            </label>
            <input
              type="text"
              value={configKubeconfigDir}
              onChange={(e) => setConfigKubeconfigDir(e.target.value)}
              placeholder="例如 /appdata/soft/weblens/kubeconfigs"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #1f2937",
                backgroundColor: "#020617",
                color: "#e5e7eb",
                fontSize: 13,
                marginBottom: 12,
              }}
            />
            {configError && (
              <div style={{ color: "#f97373", fontSize: 13, marginBottom: 12 }}>{configError}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => !configSaving && setConfigModalOpen(false)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "transparent",
                  color: "#e5e7eb",
                  cursor: configSaving ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={configSaving}
                onClick={() => {
                  const dir = configKubeconfigDir.trim();
                  if (!dir) {
                    setConfigError("请填写目录路径");
                    return;
                  }
                  if (!dir.startsWith("/")) {
                    setConfigError("仅支持绝对路径，请填写以 / 开头的完整路径");
                    return;
                  }
                  setConfigSaving(true);
                  setConfigError(null);
                  saveConfig(dir)
                    .then((data) => {
                      setClusters(data.items);
                      setConfigModalOpen(false);
                      setError(null);
                    })
                    .catch((err: any) => {
                      const msg = err?.response?.data?.error ?? err?.message ?? "保存失败";
                      setConfigError(msg);
                    })
                    .finally(() => setConfigSaving(false));
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "#1e293b",
                  color: "#e5e7eb",
                  cursor: configSaving ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                {configSaving ? "保存中…" : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* 左侧边栏：可折叠，收起后主工作区展宽 */}
        <div style={{ display: "flex", flexDirection: "row", height: "100%" }}>
          {!sidebarCollapsed && <Sidebar currentView={currentView} onSelect={setCurrentView} />}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            style={{
              width: 20,
              minWidth: 20,
              border: "none",
              outline: "none",
              backgroundColor: "#020617",
              borderRight: "1px solid #1e293b",
              color: "#64748b",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
            }}
          >
            {sidebarCollapsed ? "▶" : "◀"}
          </button>
        </div>

        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            padding: 20,
            position: "relative",
            zIndex: 1,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* 顶部固定的“集群与命名空间”区 */}
          <div style={{ flexShrink: 0, marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0, marginBottom: 8 }}>集群与命名空间</h2>
            {loading && <div>加载中...</div>}
            {error && <div style={{ color: "#f97373", marginBottom: 8 }}>错误：{error}</div>}
            {!loading && !error && clusters.length === 0 && (
              <div>未发现任何集群，请检查 kubeconfig 目录配置。</div>
            )}
            {!loading && clusters.length > 0 && activeClusterId && (
              <>
                {/* 同一行：当前集群 + 刷新 后紧跟 命名空间，用圆点分隔 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 8,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {/* 当前集群 + 下拉 + 刷新 */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, color: "#9ca3af" }}>当前集群：</span>
                    <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setClusterDropdownOpen((o) => !o)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: "1px solid #1f2937",
                        backgroundColor: "#0f172a",
                        color: "#e5e7eb",
                        fontSize: 13,
                        minWidth: 220,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      {activeClusterId
                        ? (clusters.find((c) => c.id === activeClusterId)?.name ?? activeClusterId)
                        : "请选择集群"}
                    </button>
                    {clusterDropdownOpen && (
                      <>
                        <div
                          style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 50,
                          }}
                          onClick={() => setClusterDropdownOpen(false)}
                          aria-hidden
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            marginTop: 4,
                            minWidth: 320,
                            maxHeight: 320,
                            backgroundColor: "#0f172a",
                            border: "1px solid #1e293b",
                            borderRadius: 8,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                            zIndex: 51,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={clusterSearchKeyword}
                            onChange={(e) => setClusterSearchKeyword(e.target.value)}
                            placeholder="搜索集群名称或 kubeconfig 文件名关键字"
                            style={{
                              margin: 8,
                              padding: "6px 10px",
                              borderRadius: 6,
                              border: "1px solid #1f2937",
                              backgroundColor: "#020617",
                              color: "#e5e7eb",
                              fontSize: 13,
                            }}
                          />
                          <div style={{ overflowY: "auto", flex: 1, maxHeight: 260 }}>
                            {clusters
                              .filter((c) => {
                                const k = clusterSearchKeyword.trim().toLowerCase();
                                if (!k) return true;
                                const fileName = c.filePath.replace(/^.*[/\\]/, "") || c.filePath;
                                const s = [c.id, c.name, c.filePath, fileName].join(" ").toLowerCase();
                                return s.includes(k);
                              })
                              .map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveClusterId(c.id);
                                    setClusterDropdownOpen(false);
                                    setClusterSearchKeyword("");
                                  }}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "8px 12px",
                                    textAlign: "left",
                                    fontSize: 13,
                                    color: c.id === activeClusterId ? "#38bdf8" : "#e2e8f0",
                                    backgroundColor: c.id === activeClusterId ? "#1e293b" : "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    borderBottom: "1px solid #1e293b",
                                  }}
                                >
                                  <div>{c.name}</div>
                                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{c.filePath}</div>
                                </button>
                              ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={reloadClusters}
                    disabled={reloading}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #1f2937",
                      backgroundColor: reloading ? "#0b1220" : "#0f172a",
                      color: "#e5e7eb",
                      cursor: reloading ? "not-allowed" : "pointer",
                      fontSize: 13,
                    }}
                    title="当 kubeconfig 目录增删改后，点击手动刷新"
                  >
                    {reloading ? "刷新中..." : "刷新"}
                  </button>
                </div>
                  <span style={{ color: "#64748b", marginLeft: 4, marginRight: 4 }}>·</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 14, color: "#9ca3af" }}>命名空间：</label>
                  {namespaces.length === 0 &&
                  !namespacesLoading &&
                  !clusters.find((c) => c.id === activeClusterId)?.defaultNamespace ? (
                    <>
                      <input
                        type="text"
                        value={manualNamespaceInput}
                        onChange={(e) => setManualNamespaceInput(e.target.value)}
                        placeholder="输入命名空间（无列表权限时）"
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid #1f2937",
                          backgroundColor: "#0f172a",
                          color: "#e5e7eb",
                          fontSize: 13,
                          minWidth: 200,
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const ns = manualNamespaceInput.trim();
                            if (ns && activeClusterId) {
                              manualNamespaceRef.current = { clusterId: activeClusterId, namespace: ns };
                              setNamespaces([ns]);
                              setActiveNamespace(ns);
                              setError(null);
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const ns = manualNamespaceInput.trim();
                          if (ns && activeClusterId) {
                            manualNamespaceRef.current = { clusterId: activeClusterId, namespace: ns };
                            setNamespaces([ns]);
                            setActiveNamespace(ns);
                            setError(null);
                          }
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid #334155",
                          backgroundColor: "#1e293b",
                          color: "#e5e7eb",
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                      >
                        应用
                      </button>
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>
                        无集群级命名空间权限时，可在此输入后应用
                      </span>
                    </>
                  ) : (
                    <>
                      <select
                        value={activeNamespace}
                        onChange={(e) => setActiveNamespace(e.target.value)}
                        disabled={namespacesLoading}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid #1f2937",
                          backgroundColor: "#0f172a",
                          color: "#e5e7eb",
                          fontSize: 13,
                          minWidth: 180,
                          cursor: namespacesLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        <option value={ALL_NAMESPACES}>所有命名空间</option>
                        {namespaces.map((ns) => (
                          <option key={ns} value={ns}>
                            {ns}
                          </option>
                        ))}
                      </select>
                      {namespacesLoading && (
                        <span style={{ fontSize: 12, color: "#9ca3af" }}>加载命名空间中…</span>
                      )}
                    </>
                  )}
                </div>
                </div>

                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                  集群与命名空间 · 当前：
                  {clusters.find((c) => c.id === activeClusterId)?.name ?? activeClusterId} · 配置文件：
                  {clusters.find((c) => c.id === activeClusterId)?.filePath ?? ""}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <h3 style={{ fontSize: 15, margin: 0 }}>
                    {viewTitle[currentView]}（{activeClusterId ?? "未选择"}）
                    {activeNamespace && currentView !== "nodes" && currentView !== "namespaces"
                      ? ` · ${activeNamespace}`
                      : currentView !== "nodes" && currentView !== "namespaces"
                        ? " · 所有命名空间"
                        : ""}
                  </h3>
                  <input
                    type="text"
                    value={nameFilter}
                    onChange={(e) => setNameFilter(e.target.value)}
                    placeholder="按 Name 关键字过滤"
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #1f2937",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 12,
                      minWidth: 160,
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "auto",
            }}
          >
            {!loading && clusters.length > 0 && activeClusterId && (
              currentView === "pods" ? (
                <>
                  <table
                    style={{
                      width: POD_COLUMN_KEYS.reduce((s, k) => s + (podColumnWidths[k] ?? POD_COLUMN_DEFAULTS[k]), 0),
                      minWidth: "100%",
                      borderCollapse: "collapse",
                      backgroundColor: "#020617",
                      tableLayout: "fixed",
                    }}
                  >
                    <colgroup>
                      {POD_COLUMN_KEYS.map((key) => (
                        <col key={key} style={{ width: podColumnWidths[key] ?? POD_COLUMN_DEFAULTS[key] }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {(["Name", "Namespace", "Node", "Status", "Restarts", "容器数", "操作"] as const).map(
                          (label, i) => {
                            const key = POD_COLUMN_KEYS[i];
                            const w = podColumnWidths[key] ?? POD_COLUMN_DEFAULTS[key];
                            return (
                              <th
                                key={key}
                                style={{
                                  ...thStyle,
                                  position: "sticky",
                                  top: 0,
                                  zIndex: 2,
                                  backgroundColor: "#0f172a",
                                  boxShadow: "0 1px 0 0 #1f2937",
                                  width: w,
                                  maxWidth: w,
                                  minWidth: w,
                                  boxSizing: "border-box",
                                  verticalAlign: "middle",
                                  overflow: "hidden",
                                }}
                              >
                                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                                <div
                                  role="presentation"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setResizingCol(key);
                                    resizeStartX.current = e.clientX;
                                    resizeStartWidth.current = podColumnWidths[key] ?? POD_COLUMN_DEFAULTS[key];
                                  }}
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    right: 0,
                                    width: 6,
                                    bottom: 0,
                                    cursor: "col-resize",
                                    userSelect: "none",
                                  }}
                                  title="拖拽调整列宽"
                                />
                              </th>
                            );
                          },
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pods
                        .filter((p) => {
                          const k = nameFilter.trim().toLowerCase();
                          if (!k) return true;
                          return p.metadata.name.toLowerCase().includes(k);
                        })
                        .map((p) => {
                        const status = p.status?.phase ?? "-";
                        const node = p.spec?.nodeName ?? "-";
                        const restarts = p.status?.containerStatuses?.reduce((s, cs) => s + cs.restartCount, 0) ?? 0;
                        const containerCount = getPodContainerNames(p).length;
                        const menuKey = `${p.metadata.namespace}/${p.metadata.name}`;
                        const containers = getPodContainerNames(p);
                        const isMenuOpen = podMenuOpenKey === menuKey;
                        const cellStyle: React.CSSProperties = { ...tdStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 0 };
                          return (
                          <tr key={p.metadata.uid}>
                            <td style={cellStyle} title={p.metadata.name}>{p.metadata.name}</td>
                            <td style={cellStyle} title={p.metadata.namespace}>{p.metadata.namespace}</td>
                            <td style={cellStyle} title={node}>{node}</td>
                            <td style={cellStyle} title={status}>{status}</td>
                            <td style={cellStyle}>{restarts}</td>
                            <td style={cellStyle}>{containerCount}</td>
                            <td style={{ ...tdStyle, overflow: "visible" }}>
                              <div style={{ position: "relative" }}>
                                <button
                                  type="button"
                                  className="wl-pod-menu-trigger"
                                  onClick={() =>
                                    setPodMenuOpenKey((k) =>
                                      k === `${p.metadata.namespace}/${p.metadata.name}`
                                        ? null
                                        : `${p.metadata.namespace}/${p.metadata.name}`,
                                    )
                                  }
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    border: "1px solid #1f2937",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 16,
                                    lineHeight: 1,
                                  }}
                                  title="操作"
                                >
                                  ⋮
                                </button>
                                {isMenuOpen && (
                                  <>
                                    <div
                                      style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                      onClick={() => { setPodMenuOpenKey(null); setPodMenuSubmenu(null); }}
                                      aria-hidden
                                    />
                                    <div
                                      style={{
                                        position: "absolute",
                                        right: 0,
                                        top: "100%",
                                        marginTop: 4,
                                        minWidth: 140,
                                        backgroundColor: "#1e293b",
                                        border: "1px solid #334155",
                                        borderRadius: 8,
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                                        zIndex: 41,
                                        padding: "4px 0",
                                        display: "flex",
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div style={{ padding: "4px 0", borderRight: podMenuSubmenu ? "1px solid #334155" : undefined }}>
                                        <button
                                          type="button"
                                          onClick={() => setPodMenuSubmenu((s) => (s === "shell" ? null : "shell"))}
                                          className={`wl-menu-item${podMenuSubmenu === "shell" ? " is-active" : ""}`}
                                          style={{
                                            ...menuItemStyleForDropdown,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            width: "100%",
                                          }}
                                        >
                                          <span><span style={{ marginRight: 8 }}>⌘</span> Shell</span>
                                          <span style={{ fontSize: 10 }}>▸</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setPodMenuSubmenu((s) => (s === "logs" ? null : "logs"))}
                                          className={`wl-menu-item${podMenuSubmenu === "logs" ? " is-active" : ""}`}
                                          style={{
                                            ...menuItemStyleForDropdown,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            width: "100%",
                                          }}
                                        >
                                          <span><span style={{ marginRight: 8 }}>≡</span> Logs</span>
                                          <span style={{ fontSize: 10 }}>▸</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => openEditTab(p)}
                                          className="wl-menu-item"
                                          style={menuItemStyleForDropdown}
                                        >
                                          <span style={{ marginRight: 8 }}>✎</span> Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (!activeClusterId || !window.confirm(`确定删除 Pod ${p.metadata.namespace}/${p.metadata.name}？`)) {
                                              setPodMenuOpenKey(null); setPodMenuSubmenu(null);
                                              return;
                                            }
                                            deletePod(activeClusterId, p.metadata.namespace, p.metadata.name)
                                              .then(() => {
                                                setPodMenuOpenKey(null); setPodMenuSubmenu(null);
                                                setError(null);
                                                loadPods(activeClusterId!, activeNamespace);
                                              })
                                              .catch((err: any) => setError(err?.response?.data?.error ?? err?.message ?? "删除失败"));
                                          }}
                                          className="wl-menu-item wl-menu-item-danger"
                                          style={menuItemStyleForDropdown}
                                        >
                                          <span style={{ marginRight: 8 }}>🗑</span> Delete
                                        </button>
                                      </div>
                                      {podMenuSubmenu && (
                                        <div style={{ minWidth: 100, padding: "4px 0" }}>
                                          {containers.map((c) => (
                                            <button
                                              key={c}
                                              type="button"
                                              onClick={() => openPanelTab(podMenuSubmenu, p, c)}
                                              className="wl-menu-item"
                                              style={menuItemStyleForDropdown}
                                            >
                                              {c}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </>
              ) : (
                <ResourceTable
                  title=""
                  columns={genericColumns}
                  items={
                    nameFilter.trim()
                      ? resourceItems.filter((i) =>
                          (i.metadata?.name ?? "").toLowerCase().includes(nameFilter.trim().toLowerCase()),
                        )
                      : resourceItems
                  }
                  getKey={(i) => (i.metadata?.uid as string) ?? i.metadata?.name ?? ""}
                  loading={resourceLoading}
                />
              )
            )}
          </div>
        </main>
      </div>

      <BottomPanel
        tabs={panelTabs}
        activeTabId={activePanelTabId}
        onActiveTab={setActivePanelTabId}
        onCloseTab={closePanelTab}
        onCloseAll={() => { setPanelTabs([]); setActivePanelTabId(null); }}
        heightRatio={panelHeightRatio}
        onHeightRatioChange={setPanelHeightRatio}
        minimized={panelMinimized}
        onMinimizedChange={setPanelMinimized}
      />
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid #1f2937",
  backgroundColor: "#0f172a",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 12,
  marginRight: 6,
};

const menuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  border: "none",
  backgroundColor: "transparent",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};

/** 三点菜单内按钮用此样式，不设 background/color，由 .wl-menu-item 的 CSS 控制悬停高亮 */
const menuItemStyleForDropdown: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};
