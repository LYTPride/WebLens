import React, { useEffect, useState } from "react";
import { ClusterSummary, fetchClusters, fetchPods, Pod, fetchPodLogs } from "../api";

export const App: React.FC = () => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [pods, setPods] = useState<Pod[]>([]);
  const [selectedPod, setSelectedPod] = useState<Pod | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadClusters = async () => {
    const items = await fetchClusters();
    setClusters(items);
    setError(null);
    if (!activeClusterId && items.length > 0) {
      setActiveClusterId(items[0].id);
    }
  };

  const reloadClusters = async () => {
    setReloading(true);
    try {
      // 只重新从 /api/clusters 读取即可，后端 reload 有单独按钮
      const items = await fetchClusters();
      setClusters(items);
      if (items.length > 0 && !items.find((c) => c.id === activeClusterId)) {
        setActiveClusterId(items[0].id);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to reload clusters");
    } finally {
      setReloading(false);
    }
  };

  const loadPods = async (clusterId: string) => {
    const items = await fetchPods(clusterId);
    setPods(items);
  };

  const openPodLogs = async (pod: Pod) => {
    if (!activeClusterId) return;
    setSelectedPod(pod);
    try {
      const text = await fetchPodLogs(
        activeClusterId,
        pod.metadata.namespace,
        pod.metadata.name,
        undefined,
        false,
      );
      setLogs(text);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load pod logs");
    }
  };

  useEffect(() => {
    loadClusters()
      .catch((err: any) => setError(err?.message || "Failed to load clusters"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeClusterId) {
      loadPods(activeClusterId).catch((err: any) =>
        setError(err?.message || "Failed to load pods"),
      );
    } else {
      setPods([]);
    }
  }, [activeClusterId]);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#111827",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #1f2937",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>WebLens</div>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>
          简易集群列表（后续扩展为 Freelens 风格界面）
        </div>
      </header>
      <main style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>集群列表</h2>
          <button
            onClick={reloadClusters}
            disabled={loading || reloading}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #1f2937",
              backgroundColor: reloading ? "#0b1220" : "#0f172a",
              color: "#e5e7eb",
              cursor: loading || reloading ? "not-allowed" : "pointer",
            }}
            title="当 kubeconfig 目录增删改后，点击手动刷新"
          >
            {reloading ? "刷新中..." : "刷新"}
          </button>
        </div>
        {loading && <div>加载中...</div>}
        {error && (
          <div style={{ color: "#f97373", marginBottom: 12 }}>错误：{error}</div>
        )}
        {!loading && !error && clusters.length === 0 && (
          <div>未发现任何集群，请检查 kubeconfig 目录配置。</div>
        )}
        {!loading && clusters.length > 0 && (
          <>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                backgroundColor: "#020617",
                marginBottom: 20,
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>名称 (Context)</th>
                  <th style={thStyle}>配置文件</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setActiveClusterId(c.id)}
                    style={{
                      cursor: "pointer",
                      backgroundColor:
                        c.id === activeClusterId ? "#1e293b" : "transparent",
                    }}
                  >
                    <td style={tdStyle}>{c.id}</td>
                    <td style={tdStyle}>{c.name}</td>
                    <td style={tdStyle}>{c.filePath}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ fontSize: 15, marginBottom: 8 }}>
              Pods（当前集群：{activeClusterId ?? "未选择"}）
            </h3>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                backgroundColor: "#020617",
              }}
            >
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
                  const restarts =
                    p.status?.containerStatuses?.reduce(
                      (sum, cs) => sum + cs.restartCount,
                      0,
                    ) ?? 0;
                return (
                  <tr key={p.metadata.uid}>
                    <td style={tdStyle}>{p.metadata.name}</td>
                    <td style={tdStyle}>{p.metadata.namespace}</td>
                    <td style={tdStyle}>{node}</td>
                    <td style={tdStyle}>{status}</td>
                    <td style={tdStyle}>{restarts}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => openPodLogs(p)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid #1f2937",
                          backgroundColor: "#0f172a",
                          color: "#e5e7eb",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        日志
                      </button>
                    </td>
                  </tr>
                )})}
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
                    Pod 日志：{selectedPod.metadata.namespace}/
                    {selectedPod.metadata.name}
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPod(null);
                      setLogs("");
                    }}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      border: "1px solid #1f2937",
                      backgroundColor: "#0f172a",
                      color: "#e5e7eb",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
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
        )}
      </main>
    </div>
  );
};

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

