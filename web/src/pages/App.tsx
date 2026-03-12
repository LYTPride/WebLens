import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  fetchClusterCombos,
  addClusterCombo,
  updateClusterComboAlias,
  deleteClusterComboApi,
  testClusterCombo,
  type ClusterCombo,
  deletePod,
  type ResourceKind,
  watchPods,
  type PodWatchEvent,
  watchResourceList,
  type ResourceWatchEvent,
  fetchPodDescribe,
  type PodDescribe,
} from "../api";
import { Sidebar } from "../components/Sidebar";
import { ResourceTable, type Column } from "../components/ResourceTable";
import { BottomPanel, type PanelTab } from "../components/BottomPanel";
import copyIcon from "../assets/icon-copy.png";

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

const copyNameButtonStyle: React.CSSProperties = {
  marginLeft: 4,
  width: 18,
  height: 18,
  padding: 0,
  border: "none",
  background: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

type K8sItem = { metadata: { name: string; namespace?: string; uid?: string }; [k: string]: unknown };

export const App: React.FC = () => {
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  /** 集群下拉当前选中的集群（待应用） */
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  /** 实际用于加载数据的集群（点击「应用」后才生效） */
  const [effectiveClusterId, setEffectiveClusterId] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  /** 命名空间下拉当前选中的命名空间（待应用） */
  const [activeNamespace, setActiveNamespace] = useState<string>(ALL_NAMESPACES);
  /** 实际用于加载数据的命名空间（点击「应用」后才生效） */
  const [effectiveNamespace, setEffectiveNamespace] = useState<string>(ALL_NAMESPACES);
  const [currentView, setCurrentView] = useState<ResourceKind>("pods");
  const [pods, setPods] = useState<Pod[]>([]);
  const [resourceItems, setResourceItems] = useState<K8sItem[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  /** 正在应用新的集群/命名空间选择，用于全局 loading 提示 */
  const [applyingSelection, setApplyingSelection] = useState(false);
  /** 顶部全局提示（复制成功 / 测试结果 / 组合操作等） */
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
  const [configActiveTab, setConfigActiveTab] = useState<"kubeconfig" | "combos">("kubeconfig");
  const [configKubeconfigDir, setConfigKubeconfigDir] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false);
  /** 集群组合配置 */
  const [clusterCombos, setClusterCombos] = useState<ClusterCombo[]>([]);
  const [clusterCombosLoading, setClusterCombosLoading] = useState(false);
  const [comboClusterId, setComboClusterId] = useState<string>("");
  const [comboNamespace, setComboNamespace] = useState("");
  const [comboSearchKeyword, setComboSearchKeyword] = useState("");
  const [comboAliasDrafts, setComboAliasDrafts] = useState<Record<string, string>>({});
  /** 集群下拉：展开状态与搜索关键字 */
  const [clusterDropdownOpen, setClusterDropdownOpen] = useState(false);
  const [clusterSearchKeyword, setClusterSearchKeyword] = useState("");
  /** 集群组合选择：当前选中的组合（待应用） + 已应用组合 */
  const [activeComboId, setActiveComboId] = useState<string | null>(null);
  const [effectiveComboId, setEffectiveComboId] = useState<string | null>(null);
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
  /** Pods Watch 取消函数，切换集群/命名空间/视图或标签页隐藏时终止 Watch 流 */
  const podsWatchCancelRef = useRef<(() => void) | null>(null);
  /** 通用资源 Watch 取消函数（非 Pods） */
  const resourceWatchCancelRef = useRef<(() => void) | null>(null);
  /** 左侧边栏是否收起 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Pod Describe 右侧弹层：当前选中的 Pod key 及数据 */
  const [describeTarget, setDescribeTarget] = useState<{ clusterId: string; namespace: string; name: string } | null>(
    null,
  );
  const [describeData, setDescribeData] = useState<PodDescribe | null>(null);
  const [describeLoading, setDescribeLoading] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [describeWidthRatio, setDescribeWidthRatio] = useState(0.5);
  const [describeDragging, setDescribeDragging] = useState(false);
  const describeDragStartX = useRef(0);
  const describeDragStartRatio = useRef(0);
  /** 是否正在从 sessionStorage 恢复页面状态（cluster/namespace/view/filter） */
  const [restoringSession, setRestoringSession] = useState(true);
  /** 每次点击“应用”都会自增，用于在 cluster/namespace 不变时也强制重新加载 Pods/资源 */
  const [applyRevision, setApplyRevision] = useState(0);
  useEffect(() => {
    activeClusterNsRef.current = { clusterId: effectiveClusterId, namespace: effectiveNamespace };
  }, [effectiveClusterId, effectiveNamespace]);

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
    if (restoringSession) return;
    setNameFilter("");
  }, [effectiveClusterId, effectiveNamespace, currentView, restoringSession]);

  // 将当前页面会话状态写入 sessionStorage，便于用户切换页面/集群后回到原上下文
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (restoringSession) return;
    const payload = {
      ts: Date.now(),
      clusterId: effectiveClusterId,
      namespace: effectiveNamespace,
      view: currentView,
      nameFilter,
    };
    try {
      window.sessionStorage.setItem("weblens_session_v1", JSON.stringify(payload));
    } catch {
      // ignore quota / privacy errors
    }
  }, [effectiveClusterId, effectiveNamespace, currentView, nameFilter]);

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

  const refreshDescribe = useCallback(() => {
    if (!describeTarget) return;
    setDescribeLoading(true);
    setDescribeError(null);
    fetchPodDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
      .then((data) => {
        setDescribeData(data);
        setDescribeError(null);
      })
      .catch((e: any) => {
        const status = e?.response?.status;
        const backendMsg = e?.response?.data?.error;
        if (status === 404) {
          setDescribeData(null);
          setDescribeError("Pod 已不存在或已被删除");
        } else {
          setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
        }
      })
      .finally(() => setDescribeLoading(false));
  }, [describeTarget]);

  // Pod Describe：加载选中 Pod 的详细信息（Pod + Events），不跟随 Watch 变化，只在打开/刷新时请求一次
  useEffect(() => {
    if (!describeTarget) {
      setDescribeData(null);
      setDescribeError(null);
      setDescribeLoading(false);
      return;
    }
    refreshDescribe();
  }, [describeTarget, refreshDescribe]);

  // Pod Describe：拖拽宽度
  useEffect(() => {
    if (!describeDragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = describeDragStartX.current - e.clientX;
      const deltaRatio = delta / window.innerWidth;
      let next = describeDragStartRatio.current + deltaRatio;
      next = Math.max(0.25, Math.min(0.8, next));
      setDescribeWidthRatio(next);
    };
    const onUp = () => setDescribeDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [describeDragging]);

  const openPanelTab = (type: "shell" | "logs", pod: Pod, container: string) => {
    if (!effectiveClusterId) return;
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
        clusterId: effectiveClusterId,
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
    if (!effectiveClusterId) return;
    const ns = pod.metadata.namespace;
    const name = pod.metadata.name;
    const id = `edit-${ns}-${name}`;
    setPanelTabs((prev) => {
      const exists = prev.some((t) => t.id === id);
      if (exists) return prev;
      const tab: PanelTab = {
        id,
        type: "edit",
        clusterId: effectiveClusterId,
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

  const openDescribeForPod = (pod: Pod) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      clusterId: effectiveClusterId,
      namespace: pod.metadata.namespace,
      name: pod.metadata.name,
    });
  };

  const loadClusters = async () => {
    const items = await fetchClusters();
    setClusters(items);
    setError(null);
  };

  const reloadClusters = async () => {
    setReloading(true);
    try {
      const items = await reloadClustersFromBackend();
      setClusters(items);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to reload clusters");
    } finally {
      setReloading(false);
    }
  };

  const copyName = (value: string) => {
    const v = value?.trim();
    if (!v) return;

    const fallbackExecCommand = () => {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = v;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(textarea);
        setToastMessage(ok ? `已复制 ${v}` : "复制失败");
      } catch {
        setToastMessage("复制失败");
      }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(v)
        .then(() => setToastMessage(`已复制 ${v}`))
        .catch(() => fallbackExecCommand());
    } else {
      fallbackExecCommand();
    }
  };

  /** 应用当前选中的“集群组合”，内部仍然映射为 effectiveClusterId / effectiveNamespace */
  const applyClusterAndNamespace = () => {
    if (!activeComboId) {
      setError("请先选择一个集群组合后再点击「应用」");
      return;
    }
    const combo = clusterCombos.find((c) => c.id === activeComboId);
    if (!combo) {
      setError("当前选择的组合已不存在，请重新选择");
      return;
    }
    const nsToApply = combo.namespace || ALL_NAMESPACES;
    setApplyingSelection(true);
    setEffectiveClusterId(combo.clusterId);
    setEffectiveNamespace(nsToApply);
    setEffectiveComboId(combo.id);
    setActiveClusterId(combo.clusterId);
    setActiveNamespace(nsToApply);
    setError(null);
    // 记录一次新的“应用”动作，即便组合未变化也会触发重新加载
    setApplyRevision((v) => v + 1);
  };

  const loadPods = async (clusterId: string, namespace: string) => {
    const requestedNs = namespace || undefined;
    const items = await fetchPods(clusterId, requestedNs);
    const cur = activeClusterNsRef.current;
    if (cur.clusterId !== clusterId || (cur.namespace || "") !== (requestedNs ?? "")) {
      return;
    }
    setPods(items);
    setApplyingSelection(false);
    setError(null);
  };

  const loadResourceList = useCallback(async () => {
    if (!effectiveClusterId) return;
    setResourceLoading(true);
    const ns =
      currentView === "nodes" || currentView === "namespaces" ? undefined : (effectiveNamespace || undefined);
    fetchResourceList(effectiveClusterId, currentView, ns)
      .then((items) => {
        setResourceItems(items as K8sItem[]);
        setError(null);
      })
      .catch((err: any) => {
        const status = err?.response?.status;
        const backendMsg = err?.response?.data?.error;
        if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
        else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
        else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
        else setError(err?.message || "加载失败，请稍后重试");
      })
      .finally(() => {
        setResourceLoading(false);
        setApplyingSelection(false);
      });
  }, [effectiveClusterId, currentView, effectiveNamespace]);

  useEffect(() => {
    loadClusters().catch((e: any) => setError(e?.message || "Failed to load clusters")).finally(() => setLoading(false));
  }, []);

  // 初始化时加载已配置的集群组合
  useEffect(() => {
    fetchClusterCombos()
      .then((items) => setClusterCombos(items))
      .catch(() => {
        // 组合配置缺失不影响主流程，静默忽略
      });
  }, []);

  // 从 sessionStorage 恢复上次的页面会话状态（cluster / namespace / view / filter），提升回访体验
  useEffect(() => {
    if (typeof window === "undefined") {
      setRestoringSession(false);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem("weblens_session_v1");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        ts: number;
        clusterId?: string | null;
        namespace?: string;
        view?: ResourceKind;
        nameFilter?: string;
      };
      // 过期保护：超过 30 分钟视为无效
      if (!parsed || !parsed.ts || Date.now() - parsed.ts > 30 * 60 * 1000) {
        return;
      }
      if (parsed.clusterId != null) {
        setActiveClusterId(parsed.clusterId);
        setEffectiveClusterId(parsed.clusterId);
      }
      if (parsed.namespace != null) {
        setActiveNamespace(parsed.namespace);
        setEffectiveNamespace(parsed.namespace);
      }
      if (parsed.view) {
        setCurrentView(parsed.view);
      }
      if (parsed.nameFilter != null) {
        setNameFilter(parsed.nameFilter);
      }
    } catch {
      // ignore parse errors
    } finally {
      setRestoringSession(false);
    }
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

  // Pods 使用 Kubernetes Watch API 做 Resource Watch（基于「已应用」的 effectiveClusterId/effectiveNamespace）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    const isPods = currentView === "pods";

    // 切换视图时先清理对应的 Watch
    if (!isPods && podsWatchCancelRef.current) {
      podsWatchCancelRef.current();
      podsWatchCancelRef.current = null;
    }
    if (isPods && resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    if (!isPods) return;

    // 如果存在旧的 Watch，先关闭
    if (podsWatchCancelRef.current) {
      podsWatchCancelRef.current();
      podsWatchCancelRef.current = null;
    }

    // 切换集群/命名空间/视图时先获取一次当前列表，再通过 Watch 增量更新
    loadPods(effectiveClusterId, effectiveNamespace).catch((e: any) => {
      const status = e?.response?.status;
      const backendMsg = e?.response?.data?.error as string | undefined;

      // 命名空间不存在或无法访问：给出明确提示，并回退到“所有命名空间”以避免持续错误
      if (
        status === 500 &&
        backendMsg &&
        (backendMsg.includes("namespaces") && backendMsg.includes("not found"))
      ) {
        setError("当前命名空间在该集群中不存在或不可访问，请检查 cluster + namespace 组合。已回退到所有命名空间。");
        setActiveNamespace(ALL_NAMESPACES);
        setEffectiveNamespace(ALL_NAMESPACES);
      } else if (status === 404) {
        setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
      } else if (status === 500 && backendMsg) {
        setError(`集群 API 调用失败：${backendMsg}`);
      } else if (status === 500) {
        setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
      } else {
        setError(e?.message || "加载 Pods 失败，请稍后重试");
      }

      // 保留上一状态下的 Pods 列表，只展示错误提示，并结束“正在应用”状态
      setApplyingSelection(false);
    });

    const applyEvent = (prev: Pod[], ev: PodWatchEvent): Pod[] => {
      const obj = ev.object;
      if (!obj?.metadata?.uid) return prev;
      const uid = obj.metadata.uid;
      const ns = obj.metadata.namespace;
      // 仅应用当前命名空间（或「所有命名空间」）下的事件
      if (activeNamespace && activeNamespace !== "" && ns !== activeNamespace) {
        return prev;
      }
      if (ev.type === "DELETED") {
        return prev.filter((p) => p.metadata.uid !== uid);
      }
      // ADDED / MODIFIED：按 uid 覆盖或追加
      let replaced = false;
      const next = prev.map((p) => {
        if (p.metadata.uid === uid) {
          replaced = true;
          return obj;
        }
        return p;
      });
      if (!replaced) {
        next.push(obj);
      }
      return next;
    };

    const cancel = watchPods(effectiveClusterId, effectiveNamespace || undefined, {
      onEvent: (ev) => {
        setPods((prev) => applyEvent(prev, ev));
      },
      onError: (err) => {
        // Watch 失败时仅记录错误并提示，不再重复触发列表加载，避免在无权限场景下形成错误风暴
        // eslint-disable-next-line no-console
        console.error("pods watch error:", err);
        setError(err?.message || "Pods Watch 失败，请检查集群权限或稍后重试");
      },
    });
    podsWatchCancelRef.current = cancel;

    return () => {
      if (podsWatchCancelRef.current) {
        podsWatchCancelRef.current();
        podsWatchCancelRef.current = null;
      }
    };
  }, [effectiveClusterId, effectiveNamespace, currentView, pageVisible, loadPods, applyRevision]);

  // 非 Pods 资源统一通过 Watch API 实时监听
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView === "pods") return;

    // 清理旧的 Watch
    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    // 切换集群/命名空间/视图时先获取一次当前资源列表，再通过 Watch 增量更新
    loadResourceList();

    const applyEvent = (prev: K8sItem[], ev: ResourceWatchEvent<K8sItem>): K8sItem[] => {
      const obj = ev.object as K8sItem;
      const meta = (obj as any).metadata || {};
      const name: string = meta.name;
      const ns: string | undefined = meta.namespace;
      if (!name) return prev;
      // 按已应用的命名空间过滤（Nodes / Namespaces 等无 namespace 的资源会全部保留）
      if (effectiveNamespace && effectiveNamespace !== "" && ns && ns !== effectiveNamespace) {
        return prev;
      }
      const key = `${ns || ""}/${name}`;
      if (ev.type === "DELETED") {
        return prev.filter((i) => {
          const m = (i as any).metadata || {};
          const k = `${m.namespace || ""}/${m.name}`;
          return k !== key;
        });
      }
      let replaced = false;
      const next = prev.map((i) => {
        const m = (i as any).metadata || {};
        const k = `${m.namespace || ""}/${m.name}`;
        if (k === key) {
          replaced = true;
          return obj;
        }
        return i;
      });
      if (!replaced) {
        next.push(obj);
      }
      return next;
    };

    const cancel = watchResourceList<K8sItem>(
      effectiveClusterId,
      currentView,
      currentView === "nodes" || currentView === "namespaces" ? undefined : effectiveNamespace || undefined,
      {
        onEvent: (ev) => {
          setResourceItems((prev) => applyEvent(prev, ev));
        },
        onError: (err) => {
          // Watch 失败时退回一次性加载当前资源列表
          // eslint-disable-next-line no-console
          console.error("resource watch error:", err);
          loadResourceList();
        },
      },
    );
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [effectiveClusterId, effectiveNamespace, currentView, pageVisible, loadResourceList, applyRevision]);

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

  const filteredPods = useMemo(
    () =>
      pods.filter((p) => {
        const k = nameFilter.trim().toLowerCase();
        if (!k) return true;
        return p.metadata.name.toLowerCase().includes(k);
      }),
    [pods, nameFilter],
  );

  const filteredResourceItems = useMemo(
    () =>
      nameFilter.trim()
        ? resourceItems.filter((i) =>
            (i.metadata?.name ?? "").toLowerCase().includes(nameFilter.trim().toLowerCase()),
          )
        : resourceItems,
    [resourceItems, nameFilter],
  );

  const describeEvents = describeData?.events ?? [];

  const genericColumns: Column<K8sItem>[] = [
    {
      key: "name",
      title: "Name",
      render: (i) => {
        const name = i.metadata?.name ?? "-";
        const canCopy = !!i.metadata?.name;
        return (
          <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            {canCopy && (
              <button
                type="button"
                onClick={() => copyName(i.metadata.name as string)}
                style={copyNameButtonStyle}
                title="复制名称"
              >
                <img
                  src={copyIcon}
                  alt="复制"
                  style={{ height: 14, width: "auto", display: "block" }}
                />
              </button>
            )}
          </span>
        );
      },
    },
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
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 14px",
            borderRadius: 999,
            backgroundColor: "rgba(15,23,42,0.95)",
            color: "#e5e7eb",
            fontSize: 12,
            zIndex: 200,
            boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
            animation: "wl-toast-fadeout 3s ease-out forwards",
          }}
          onAnimationEnd={() => setToastMessage(null)}
        >
          {toastMessage}
        </div>
      )}
      <header
        style={{
          flexShrink: 0,
          borderBottom: "1px solid #1f2937",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "12px 20px",
          }}
        >
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
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "stretch",
            marginLeft: "auto",
            marginRight: 0,
            backgroundColor: "#020617",
            borderLeft: "1px solid #1f2937",
          }}
        >
          <button
            type="button"
            onClick={() => setPlatformMenuOpen((o) => !o)}
            style={{
              padding: "0 18px",
              borderRadius: 0,
              border: "none",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            平台配置
          </button>
          {platformMenuOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
                onClick={() => setPlatformMenuOpen(false)}
                aria-hidden
              />
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 4,
                  minWidth: 180,
                  backgroundColor: "#020617",
                  border: "1px solid #1e293b",
                  borderRadius: 8,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
                  zIndex: 41,
                  padding: 4,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setPlatformMenuOpen(false);
                    setConfigActiveTab("kubeconfig");
                    setConfigModalOpen(true);
                    setConfigError(null);
                    fetchConfig()
                      .then((c) => setConfigKubeconfigDir(c.kubeconfigDir))
                      .catch(() => setConfigKubeconfigDir(""));
                  }}
                  style={{
                    ...menuItemStyle,
                    borderBottom: "1px solid rgba(248,250,252,0.16)",
                  }}
                >
                  kubeconfig目录
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setPlatformMenuOpen(false);
                    setConfigActiveTab("combos");
                    setConfigModalOpen(true);
                    setConfigError(null);
                    setClusterCombosLoading(true);
                    try {
                      const items = await fetchClusterCombos();
                      setClusterCombos(items);
                    } catch (e: any) {
                      setConfigError(e?.message || "加载集群组合失败");
                    } finally {
                      setClusterCombosLoading(false);
                    }
                  }}
                  style={menuItemStyle}
                >
                  集群设置
                </button>
              </div>
            </>
          )}
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
              minWidth: 520,
              maxWidth: "90vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>
              平台配置 · {configActiveTab === "kubeconfig" ? "kubeconfig 存放目录" : "集群组合设置"}
            </h3>

            {configActiveTab === "kubeconfig" && (
              <>
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
              </>
            )}

            {configActiveTab === "combos" && (
              <>
                <div style={{ marginBottom: 12, fontSize: 13, color: "#9ca3af" }}>
                  通过预设 “集群 + 命名空间” 组合，简化主界面切换操作。
                </div>
                <div
                  style={{
                    borderRadius: 8,
                    border: "1px solid #1e293b",
                    padding: 12,
                    marginBottom: 12,
                    backgroundColor: "#020617",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "#9ca3af" }}>集群选择</span>
                    <select
                      value={comboClusterId}
                      onChange={(e) => setComboClusterId(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #1f2937",
                        backgroundColor: "#0f172a",
                        color: "#e5e7eb",
                        fontSize: 13,
                        minWidth: 220,
                      }}
                    >
                      <option value="">请选择集群</option>
                      {clusters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}（{c.filePath.replace(/^.*[/\\]/, "")}）
                        </option>
                      ))}
                    </select>
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
                    >
                      {reloading ? "刷新中..." : "刷新"}
                    </button>
                    <span style={{ fontSize: 13, color: "#9ca3af" }}>命名空间</span>
                    <input
                      type="text"
                      value={comboNamespace}
                      onChange={(e) => setComboNamespace(e.target.value)}
                      placeholder="请填写命名空间"
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #1f2937",
                        backgroundColor: "#0f172a",
                        color: "#e5e7eb",
                        fontSize: 13,
                        minWidth: 180,
                      }}
                    />
                    <button
                      type="button"
                      disabled={!comboClusterId || !comboNamespace.trim()}
                      onClick={async () => {
                        if (!comboClusterId || !comboNamespace.trim()) return;
                        try {
                          const list = await addClusterCombo(comboClusterId, comboNamespace.trim(), "");
                          setClusterCombos(list);
                          setToastMessage("组合已添加");
                          setComboNamespace("");
                        } catch (e: any) {
                          setConfigError(e?.response?.data?.error ?? e?.message ?? "添加组合失败");
                        }
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid #334155",
                        backgroundColor:
                          !comboClusterId || !comboNamespace.trim() ? "#020617" : "#1e293b",
                        color: "#e5e7eb",
                        cursor:
                          !comboClusterId || !comboNamespace.trim() ? "not-allowed" : "pointer",
                        fontSize: 13,
                      }}
                    >
                      添加
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    集群不存在或命名空间无权限时，可先通过“测试”按钮验证。
                  </div>
                </div>

                <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "#9ca3af" }}>已添加组合</span>
                  <input
                    type="text"
                    value={comboSearchKeyword}
                    onChange={(e) => setComboSearchKeyword(e.target.value)}
                    placeholder="搜索 kubeconfig 文件名 / 命名空间 / 别名 关键字"
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #1f2937",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 12,
                      minWidth: 220,
                    }}
                  />
                </div>

                <div
                  style={{
                    maxHeight: 260,
                    overflowY: "auto",
                    borderRadius: 6,
                    border: "1px solid #1f2937",
                    backgroundColor: "#020617",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, position: "sticky", top: 0, backgroundColor: "#020617" }}>
                          集群 kubeconfig
                        </th>
                        <th style={{ ...thStyle, position: "sticky", top: 0, backgroundColor: "#020617" }}>
                          命名空间
                        </th>
                        <th style={{ ...thStyle, position: "sticky", top: 0, backgroundColor: "#020617" }}>
                          别名
                        </th>
                        <th style={{ ...thStyle, position: "sticky", top: 0, backgroundColor: "#020617" }}>
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {clusterCombosLoading && (
                        <tr>
                          <td colSpan={4} style={{ ...tdStyle, textAlign: "center" }}>
                            加载组合中…
                          </td>
                        </tr>
                      )}
                      {!clusterCombosLoading &&
                        clusterCombos
                          .filter((combo) => {
                            const k = comboSearchKeyword.trim().toLowerCase();
                            if (!k) return true;
                            const cluster = clusters.find((c) => c.id === combo.clusterId);
                            const fileName = cluster?.filePath.replace(/^.*[/\\]/, "") || "";
                            const text = [
                              cluster?.name,
                              fileName,
                              combo.namespace,
                              combo.alias,
                            ]
                              .join(" ")
                              .toLowerCase();
                            return text.includes(k);
                          })
                          .map((combo) => {
                            const cluster = clusters.find((c) => c.id === combo.clusterId);
                            const fileName = cluster?.filePath.replace(/^.*[/\\]/, "") || "";
                            const aliasDraft = comboAliasDrafts[combo.id] ?? combo.alias ?? "";
                            return (
                              <tr key={combo.id}>
                                <td style={tdStyle}>
                                  {cluster ? (
                                    <>
                                      <div>{cluster.name}</div>
                                      <div style={{ fontSize: 11, color: "#64748b" }}>{fileName}</div>
                                    </>
                                  ) : (
                                    <span style={{ color: "#f97373" }}>集群未找到：{combo.clusterId}</span>
                                  )}
                                </td>
                                <td style={tdStyle}>{combo.namespace}</td>
                                <td style={tdStyle}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <input
                                      type="text"
                                      value={aliasDraft}
                                      onChange={(e) =>
                                        setComboAliasDrafts((prev) => ({
                                          ...prev,
                                          [combo.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="可选：为组合起个别名"
                                      style={{
                                        flex: 1,
                                        padding: "4px 6px",
                                        borderRadius: 4,
                                        border: "1px solid #1f2937",
                                        backgroundColor: "#020617",
                                        color: "#e5e7eb",
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const list = await updateClusterComboAlias(combo.id, aliasDraft.trim());
                                          setClusterCombos(list);
                                          setToastMessage("别名已保存");
                                        } catch (e: any) {
                                          setConfigError(
                                            e?.response?.data?.error ?? e?.message ?? "保存别名失败",
                                          );
                                        }
                                      }}
                                      style={{
                                        ...btnStyle,
                                        padding: "2px 6px",
                                        marginRight: 0,
                                      }}
                                    >
                                      ✓
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const list = await updateClusterComboAlias(combo.id, "");
                                          setClusterCombos(list);
                                          setComboAliasDrafts((prev) => {
                                            const next = { ...prev };
                                            delete next[combo.id];
                                            return next;
                                          });
                                          setToastMessage("别名已清除");
                                        } catch (e: any) {
                                          setConfigError(
                                            e?.response?.data?.error ?? e?.message ?? "清除别名失败",
                                          );
                                        }
                                      }}
                                      style={{
                                        ...btnStyle,
                                        padding: "2px 6px",
                                        marginRight: 0,
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </td>
                                <td style={tdStyle}>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const res = await testClusterCombo(combo.id);
                                          if (res.ok) {
                                            setToastMessage("测试通过，组合可用");
                                          } else {
                                            setToastMessage(
                                              `组合不可用，请删除后重新添加：${res.error || ""}`,
                                            );
                                          }
                                        } catch (e: any) {
                                          setToastMessage(
                                            `组合不可用，请删除后重新添加：${
                                              e?.response?.data?.error ?? e?.message ?? ""
                                            }`,
                                          );
                                        }
                                      }}
                                      style={btnStyle}
                                    >
                                      测试
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const list = await deleteClusterComboApi(combo.id);
                                          setClusterCombos(list);
                                          setToastMessage("组合已删除");
                                        } catch (e: any) {
                                          setToastMessage(
                                            `删除失败：${
                                              e?.response?.data?.error ?? e?.message ?? "未知错误"
                                            }`,
                                          );
                                        }
                                      }}
                                      style={btnStyle}
                                    >
                                      删除
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      {!clusterCombosLoading && clusterCombos.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ ...tdStyle, textAlign: "center" }}>
                            暂未添加任何组合
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
            {!loading && clusters.length > 0 && (
              <>
                {/* 组合选择：只需选中预设的“集群 + 命名空间”组合 */}
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
                  <span style={{ fontSize: 14, color: "#9ca3af" }}>组合选择：</span>
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
                        minWidth: 260,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      {activeComboId
                        ? (() => {
                            const combo = clusterCombos.find((c) => c.id === activeComboId);
                            if (!combo) return "请选择集群组合";
                            const cluster = clusters.find((cl) => cl.id === combo.clusterId);
                            const name = cluster?.name ?? combo.clusterId;
                            const ns = combo.namespace || "所有命名空间";
                            return combo.alias ? `${combo.alias}（${name} · ${ns}）` : `${name} · ${ns}`;
                          })()
                        : "请选择集群组合"}
                    </button>
                    {clusterDropdownOpen && (
                      <>
                        <div
                          style={{ position: "fixed", inset: 0, zIndex: 40 }}
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
                            zIndex: 41,
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
                            placeholder="搜索 kubeconfig 文件名 / 命名空间 / 组合别名关键字"
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
                            {clusterCombos
                              .filter((combo) => {
                                const k = clusterSearchKeyword.trim().toLowerCase();
                                if (!k) return true;
                                const cluster = clusters.find((c) => c.id === combo.clusterId);
                                const fileName = cluster?.filePath.replace(/^.*[/\\]/, "") || "";
                                const text = [
                                  cluster?.name,
                                  fileName,
                                  combo.namespace,
                                  combo.alias,
                                ]
                                  .join(" ")
                                  .toLowerCase();
                                return text.includes(k);
                              })
                              .map((combo) => {
                                const cluster = clusters.find((c) => c.id === combo.clusterId);
                                const fileName = cluster?.filePath.replace(/^.*[/\\]/, "") || "";
                                const ns = combo.namespace || "所有命名空间";
                                const title = combo.alias
                                  ? `${combo.alias}（${cluster?.name ?? combo.clusterId} · ${ns}）`
                                  : `${cluster?.name ?? combo.clusterId} · ${ns}`;
                                return (
                                  <button
                                    key={combo.id}
                                    type="button"
                                    onClick={() => {
                                      setActiveComboId(combo.id);
                                      setClusterDropdownOpen(false);
                                      setClusterSearchKeyword("");
                                    }}
                                    style={{
                                      display: "block",
                                      width: "100%",
                                      padding: "8px 12px",
                                      textAlign: "left",
                                      fontSize: 13,
                                      color: combo.id === activeComboId ? "#38bdf8" : "#e2e8f0",
                                      backgroundColor: combo.id === activeComboId ? "#1e293b" : "transparent",
                                      border: "none",
                                      cursor: "pointer",
                                      borderBottom: "1px solid #1e293b",
                                    }}
                                  >
                                    <div>{title}</div>
                                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                                      {cluster ? fileName : `集群未找到：${combo.clusterId}`}
                                    </div>
                                  </button>
                                );
                              })}
                            {clusterCombos.length === 0 && (
                              <div style={{ padding: 12, fontSize: 12, color: "#9ca3af" }}>
                                暂未添加组合，请先在右上角“平台配置 · 集群组合设置”中添加。
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={applyClusterAndNamespace}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid #334155",
                      backgroundColor: "#1e293b",
                      color: "#e5e7eb",
                      cursor: !activeComboId ? "not-allowed" : "pointer",
                      fontSize: 13,
                    }}
                    title="点击后，选中的组合才会真正生效"
                    disabled={!activeComboId}
                  >
                    应用
                  </button>
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
                    {reloading ? "刷新中..." : "刷新集群列表"}
                  </button>
                </div>

                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                  集群与命名空间 · 当前：
                  {effectiveComboId
                    ? (() => {
                        const combo = clusterCombos.find((c) => c.id === effectiveComboId);
                        if (!combo) return "未应用";
                        const cluster = clusters.find((c) => c.id === combo.clusterId);
                        const name = cluster?.name ?? combo.clusterId;
                        const ns = combo.namespace || "所有命名空间";
                        return combo.alias ? `${combo.alias}（${name} · ${ns}）` : `${name} · ${ns}`;
                      })()
                    : "未应用"}
                  {" "}（仅点击「应用」后才生效）
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
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: 15, margin: 0 }}>
                      {viewTitle[currentView]}（{effectiveClusterId ?? "未应用"}）
                      {currentView !== "nodes" && currentView !== "namespaces" && (
                        effectiveNamespace && effectiveNamespace !== ""
                          ? ` · ${effectiveNamespace}`
                          : " · 所有命名空间"
                      )}{" "}
                      / {currentView === "pods" ? filteredPods.length : filteredResourceItems.length}
                    </h3>
                    {applyingSelection && (
                      <span style={{ fontSize: 12, color: "#38bdf8" }}>
                        正在根据新的集群与命名空间加载资源…
                      </span>
                    )}
                  </div>
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
                      {filteredPods.map((p) => {
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
                            <td style={cellStyle} title={p.metadata.name}>
                              <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
                                <button
                                  type="button"
                                  onClick={() => openDescribeForPod(p)}
                                  style={{
                                    padding: 0,
                                    margin: 0,
                                    border: "none",
                                    background: "none",
                                    color: "inherit",
                                    cursor: "pointer",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {p.metadata.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyName(p.metadata.name)}
                                  style={copyNameButtonStyle}
                                  title="复制 Pod 名称"
                                >
                                  <img
                                    src={copyIcon}
                                    alt="复制"
                                    style={{ height: 14, width: "auto", display: "block" }}
                                  />
                                </button>
                              </span>
                            </td>
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
                                            if (!effectiveClusterId || !window.confirm(`确定删除 Pod ${p.metadata.namespace}/${p.metadata.name}？`)) {
                                              setPodMenuOpenKey(null); setPodMenuSubmenu(null);
                                              return;
                                            }
                                            deletePod(effectiveClusterId, p.metadata.namespace, p.metadata.name)
                                              .then(() => {
                                                setPodMenuOpenKey(null); setPodMenuSubmenu(null);
                                                setError(null);
                                                loadPods(effectiveClusterId!, effectiveNamespace);
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
                  items={filteredResourceItems}
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

      {/* Pod Describe 右侧弹层 */}
      {describeTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 150,
            pointerEvents: "none",
          }}
        >
          {/* 半透明遮罩，点击关闭 Describe 视图 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.45)",
              pointerEvents: "auto",
            }}
            onClick={() => setDescribeTarget(null)}
          />

          {/* 可拖拽调整宽度的 Describe 面板 */}
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: `${Math.round(describeWidthRatio * 100)}vw`,
              backgroundColor: "#020617",
              borderLeft: "1px solid #1e293b",
              pointerEvents: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* 左侧拖拽条 */}
            <div
              role="presentation"
              onMouseDown={(e) => {
                e.preventDefault();
                setDescribeDragging(true);
                describeDragStartX.current = e.clientX;
                describeDragStartRatio.current = describeWidthRatio;
              }}
              style={{
                position: "absolute",
                left: -4,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: "ew-resize",
              }}
              title="拖拽调整宽度"
            />

            {/* 标题栏：Pod 名称 + 关闭按钮 */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                padding: "10px 16px",
                borderBottom: "1px solid #1e293b",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "#020617",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  Pod: {describeTarget.namespace}/{describeTarget.name}
                </span>
                {describeError && (
                  <span style={{ fontSize: 12, color: "#f97373", marginTop: 2 }}>错误：{describeError}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => copyName(`${describeTarget.namespace}/${describeTarget.name}`)}
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  title="复制 Namespace/Pod 名称"
                >
                  复制
                </button>
                <button
                  type="button"
                  onClick={refreshDescribe}
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    color: "#e5e7eb",
                    cursor: describeLoading ? "not-allowed" : "pointer",
                    fontSize: 12,
                  }}
                  disabled={describeLoading}
                  title="手动刷新 Describe 信息"
                >
                  {describeLoading ? "刷新中…" : "刷新"}
                </button>
                <button
                  type="button"
                  onClick={() => setDescribeTarget(null)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #334155",
                    backgroundColor: "#1e293b",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  关闭
                </button>
              </div>
            </div>

            {/* 内容区：可滚动 */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "10px 16px 16px",
              }}
            >
              {describeLoading && <div style={{ color: "#9ca3af" }}>加载 Describe 中…</div>}
              {!describeLoading && describeData && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* 基本信息 */}
                  <section>
                    <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>基本信息</h4>
                    <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
                      <div>Namespace：{describeData.pod.metadata.namespace}</div>
                      <div>Name：{describeData.pod.metadata.name}</div>
                      <div>
                        Node：{describeData.pod.spec?.nodeName ?? "-"}
                        {describeData.pod.status?.hostIP ? ` (${describeData.pod.status.hostIP})` : ""}
                      </div>
                      <div>Pod IP：{describeData.pod.status?.podIP ?? "-"}</div>
                      <div>Phase：{describeData.pod.status?.phase ?? "-"}</div>
                    </div>
                  </section>

                  {/* 标签 / 注解 */}
                  {(describeData.pod.metadata.labels || describeData.pod.metadata.annotations) && (
                    <section>
                      <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>Labels & Annotations</h4>
                      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, lineHeight: 1.6 }}>
                        {describeData.pod.metadata.labels && (
                          <div>
                            <div style={{ marginBottom: 4, color: "#9ca3af" }}>Labels</div>
                            {Object.entries(describeData.pod.metadata.labels).map(([k, v]) => (
                              <div key={k}>
                                <span style={{ color: "#9ca3af" }}>{k}</span>: {v}
                              </div>
                            ))}
                          </div>
                        )}
                        {describeData.pod.metadata.annotations && (
                          <div>
                            <div style={{ marginBottom: 4, color: "#9ca3af" }}>Annotations</div>
                            {Object.entries(describeData.pod.metadata.annotations).map(([k, v]) => (
                              <div key={k}>
                                <span style={{ color: "#9ca3af" }}>{k}</span>: {v}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {/* 容器 */}
                  {describeData.pod.spec?.containers && describeData.pod.spec.containers.length > 0 && (
                    <section>
                      <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>Containers</h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                        {describeData.pod.spec.containers.map((c) => (
                          <div
                            key={c.name}
                            style={{
                              border: "1px solid #1f2937",
                              borderRadius: 6,
                              padding: 8,
                              backgroundColor: "#020617",
                            }}
                          >
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{c.name}</div>
                            <div style={{ color: "#cbd5f5", lineHeight: 1.6 }}>
                              <div>Image：{c.image ?? "-"}</div>
                              {c.ports && c.ports.length > 0 && (
                                <div>
                                  Ports：{" "}
                                  {c.ports
                                    .map((p) => `${p.containerPort}/${p.protocol ?? "TCP"}`)
                                    .join(", ")}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Events */}
                  <section>
                    <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>Events</h4>
                    {describeEvents.length === 0 && (
                      <div style={{ fontSize: 12, color: "#64748b" }}>暂无 Events</div>
                    )}
                    {describeEvents.length > 0 && (
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        {describeEvents.map((ev) => {
                          const isWarning =
                            (ev.type && ev.type.toLowerCase() === "warning") ||
                            (ev.reason && ev.reason.toLowerCase().includes("fail"));
                          return (
                            <div
                              key={ev.metadata.uid || `${ev.lastTimestamp}-${ev.reason}-${ev.message}`}
                              style={{
                                padding: "4px 6px",
                                borderRadius: 4,
                                marginBottom: 4,
                                backgroundColor: isWarning ? "rgba(127,29,29,0.2)" : "transparent",
                              }}
                            >
                              <div>
                                <span
                                  style={{
                                    fontWeight: isWarning ? 700 : 500,
                                    color: isWarning ? "#f97373" : "#e5e7eb",
                                  }}
                                >
                                  {ev.type ?? "-"} {ev.reason ?? ""}
                                </span>{" "}
                                <span style={{ color: "#9ca3af" }}>
                                  {ev.lastTimestamp ?? ev.firstTimestamp ?? ""}
                                </span>
                              </div>
                              <div style={{ whiteSpace: "pre-wrap", color: isWarning ? "#fecaca" : "#cbd5f5" }}>
                                {ev.message}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
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
