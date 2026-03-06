import React, { useEffect, useState } from "react";
import {
  ClusterSummary,
  fetchClusters,
  fetchPods,
  Pod,
  fetchPodLogs,
  reloadClustersFromBackend,
  fetchNamespaces,
  fetchResourceList,
  podExecWsUrl,
  fetchConfig,
  saveConfig,
  deletePod,
  type ResourceKind,
} from "../api";
import { Sidebar } from "../components/Sidebar";
import { ResourceTable, type Column } from "../components/ResourceTable";
import { PodShell } from "../components/PodShell";

const ALL_NAMESPACES = "";

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
  const [selectedPod, setSelectedPod] = useState<Pod | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [shellPod, setShellPod] = useState<{ namespace: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
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
    const items = await fetchPods(clusterId, namespace || undefined);
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

  const openPodLogs = async (pod: Pod) => {
    if (!activeClusterId) return;
    setSelectedPod(pod);
    try {
      const text = await fetchPodLogs(activeClusterId, pod.metadata.namespace, pod.metadata.name, undefined, false);
      setLogs(text);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load pod logs");
    }
  };

  useEffect(() => {
    loadClusters().catch((e: any) => setError(e?.message || "Failed to load clusters")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeClusterId) {
      setNamespaces([]);
      setActiveNamespace(ALL_NAMESPACES);
      setPods([]);
      setResourceItems([]);
      return;
    }
    setNamespacesLoading(true);
    const currentCluster = clusters.find((c) => c.id === activeClusterId);
    fetchNamespaces(activeClusterId)
      .then((list) => {
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
        setNamespaces([]);
        setActiveNamespace(ALL_NAMESPACES);
        setError(e?.message || "Failed to load namespaces");
      })
      .finally(() => setNamespacesLoading(false));
  }, [activeClusterId, clusters]);

  useEffect(() => {
    if (!activeClusterId) return;
    if (currentView === "pods") {
      loadPods(activeClusterId, activeNamespace).catch((err: any) => {
        setPods([]);
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
  }, [activeClusterId, activeNamespace, currentView]);

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
        <Sidebar currentView={currentView} onSelect={setCurrentView} />

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
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
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

                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                  集群与命名空间 · 当前：
                  {clusters.find((c) => c.id === activeClusterId)?.name ?? activeClusterId} · 配置文件：
                  {clusters.find((c) => c.id === activeClusterId)?.filePath ?? ""}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 12,
                    flexWrap: "wrap",
                  }}
                >
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
                            if (ns) {
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
                          if (ns) {
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

                <h3 style={{ fontSize: 15, marginBottom: 8 }}>
                  {viewTitle[currentView]}（{activeClusterId ?? "未选择"}）
                  {activeNamespace && currentView !== "nodes" && currentView !== "namespaces"
                    ? ` · ${activeNamespace}`
                    : currentView !== "nodes" && currentView !== "namespaces"
                      ? " · 所有命名空间"
                      : ""}
                </h3>
              </>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {!loading && clusters.length > 0 && activeClusterId && (
              currentView === "pods" ? (
                <>
                  <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#020617" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Name</th>
                        <th style={thStyle}>Namespace</th>
                        <th style={thStyle}>Node</th>
                        <th style={thStyle}>Status</th>
                        <th style={thStyle}>Restarts</th>
                        <th style={thStyle}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pods.map((p) => {
                        const status = p.status?.phase ?? "-";
                        const node = p.spec?.nodeName ?? "-";
                        const restarts = p.status?.containerStatuses?.reduce((s, cs) => s + cs.restartCount, 0) ?? 0;
                        return (
                          <tr key={p.metadata.uid}>
                            <td style={tdStyle}>{p.metadata.name}</td>
                            <td style={tdStyle}>{p.metadata.namespace}</td>
                            <td style={tdStyle}>{node}</td>
                            <td style={tdStyle}>{status}</td>
                            <td style={tdStyle}>{restarts}</td>
                            <td style={tdStyle}>
                              <div style={{ position: "relative" }}>
                                <button
                                  type="button"
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
                                    backgroundColor: "#1e293b",
                                    color: "#9ca3af",
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
                                {podMenuOpenKey === `${p.metadata.namespace}/${p.metadata.name}` && (
                                  <>
                                    <div
                                      style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                      onClick={() => setPodMenuOpenKey(null)}
                                      aria-hidden
                                    />
                                    <div
                                      style={{
                                        position: "absolute",
                                        right: 0,
                                        top: "100%",
                                        marginTop: 4,
                                        minWidth: 120,
                                        backgroundColor: "#1e293b",
                                        border: "1px solid #334155",
                                        borderRadius: 8,
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                                        zIndex: 41,
                                        padding: "4px 0",
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          openPodLogs(p);
                                          setPodMenuOpenKey(null);
                                        }}
                                        style={menuItemStyle}
                                      >
                                        <span style={{ marginRight: 8 }}>≡</span>
                                        Logs
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setError("编辑功能规划中");
                                          setPodMenuOpenKey(null);
                                        }}
                                        style={menuItemStyle}
                                      >
                                        <span style={{ marginRight: 8 }}>✎</span>
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (
                                            !activeClusterId ||
                                            !window.confirm(`确定删除 Pod ${p.metadata.namespace}/${p.metadata.name}？`)
                                          ) {
                                            setPodMenuOpenKey(null);
                                            return;
                                          }
                                          deletePod(activeClusterId, p.metadata.namespace, p.metadata.name)
                                            .then(() => {
                                              setPodMenuOpenKey(null);
                                              setError(null);
                                              loadPods(activeClusterId!, activeNamespace);
                                            })
                                            .catch((err: any) =>
                                              setError(
                                                err?.response?.data?.error ?? err?.message ?? "删除失败",
                                              ),
                                            );
                                        }}
                                        style={{ ...menuItemStyle, color: "#f97373" }}
                                      >
                                        <span style={{ marginRight: 8 }}>🗑</span>
                                        Delete
                                      </button>
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

                  {selectedPod && (
                    <div
                      style={{
                        marginTop: 20,
                        border: "1px solid #1f2937",
                        borderRadius: 8,
                        padding: 12,
                        backgroundColor: "#020617",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 8,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontSize: 14 }}>
                          Pod 日志：{selectedPod.metadata.namespace}/{selectedPod.metadata.name}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPod(null);
                            setLogs("");
                          }}
                          style={btnStyle}
                        >
                          关闭
                        </button>
                      </div>
                      <pre
                        style={{
                          maxHeight: 320,
                          overflow: "auto",
                          fontSize: 12,
                          backgroundColor: "#020617",
                          padding: 8,
                          borderRadius: 4,
                        }}
                      >
                        {logs || "（暂无日志内容）"}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <ResourceTable
                  title=""
                  columns={genericColumns}
                  items={resourceItems}
                  getKey={(i) => (i.metadata?.uid as string) ?? i.metadata?.name ?? ""}
                  loading={resourceLoading}
                />
              )
            )}
          </div>
        </main>
      </div>

      {shellPod && activeClusterId && (
        <PodShell
          wsUrl={podExecWsUrl(activeClusterId, shellPod.namespace, shellPod.name)}
          podName={shellPod.name}
          namespace={shellPod.namespace}
          onClose={() => setShellPod(null)}
        />
      )}
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
