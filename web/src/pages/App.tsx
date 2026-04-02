import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  watchResourceList,
  fetchPodDescribe,
  fetchDeploymentDescribe,
  type PodDescribe,
  type DeploymentDescribe,
  scaleDeployment,
  restartDeployment,
  deleteDeployment,
  fetchStatefulSetDescribe,
  fetchIngressDescribe,
  fetchServiceDescribe,
  type StatefulSetDescribe,
  type IngressDescribe,
  type ServiceDescribe,
  scaleStatefulSet,
  restartStatefulSet,
  deleteStatefulSet,
  deleteIngress,
  deleteService,
  fetchPvcDescribe,
  deletePvc,
  type PvcDescribe,
  fetchNodeDescribe,
  type NodeDescribe,
} from "../api";
import { Sidebar } from "../components/Sidebar";
import { ResourceTable, type Column } from "../components/ResourceTable";
import { BottomPanel, type PanelTab } from "../components/BottomPanel";
import { ResizableTh } from "../components/ResizableTh";
import { ResourceSortArrows } from "../components/ResourceSortArrows";
import {
  sortByState,
  comparePodsForSort,
  compareDeploymentsForSort,
  compareStatefulSetsForSort,
  compareIngressesForSort,
  compareServicesForSort,
  comparePvcsForSort,
  compareNodesForSort,
  isPodSortableColumnKey,
  isDeploymentSortableColumnKey,
  isStatefulSetSortableColumnKey,
  isIngressSortableColumnKey,
  isServiceSortableColumnKey,
  buildStatefulSetSortStats,
  type ResourceListSortState,
  type PodSortKey,
  type DeploymentSortKey,
  type StatefulSetSortKey,
  type StatefulSetSortRow,
  type IngressSortKey,
  type IngressSortStats,
  type ServiceSortKey,
  type ServiceSortRow,
  type ServiceSortStats,
  type PvcSortKey,
  type PvcSortRow,
  type PvcSortStats,
  type NodeSortKey,
  type NodeSortRow,
  type NodeSortStats,
} from "../utils/resourceListSort";
import {
  deriveIngressListSummary,
  ingressMatchesNameOrHostFilter,
} from "../utils/ingressTable";
import {
  buildIngressTroubleshoot,
  buildIngressTroubleshootFromDescribeView,
} from "../utils/ingressTroubleshoot";
import { buildServiceListDiagnostics, formatEndpointColumnSummary } from "../utils/serviceTroubleshoot";
import {
  deriveServiceEndpointExpandRows,
  deriveServicePortExpandRows,
  formatServiceClusterIP,
  formatServicePortsSummary,
  formatServiceSelectorSummary,
  serviceMatchesNameFilter,
  type ServiceListRow,
} from "../utils/serviceTable";
import {
  pvcMatchesNameFilter,
  derivePvcStatusSummary,
  podsUsingPvcClaim,
  formatPvcVolumeName,
  formatPvcCapacity,
  formatPvcStorageClass,
  type PvcListRow,
} from "../utils/pvcTable";
import {
  countPodsOnNode,
  deriveNodeStatusSummary,
  formatNodeCpuMemoryCapacity,
  formatNodeInternalIP,
  formatNodeKubeletVersion,
  formatNodeRoles,
  nodeMatchesNameFilter,
  type NodeListRow,
} from "../utils/nodeTable";
import {
  podsOwnedByStatefulSet,
  ordinalFromStsPodName,
  formatOrdinalSummary,
  aggregatePodHealthLabel,
  podReadyColumn,
  sortStsPodsTroubleshootFirst,
  findSmallestOrdinalAbnormalPod,
  stsTroubleshootSummaryLine,
  podPersistentVolumeClaimNames,
  isPodHealthAbnormal,
  isHighRestartInStsGroup,
} from "../utils/statefulsetPods";
import { getPodStatusInfo } from "../utils/podTableStatus";
import { ClearableSearchInput } from "../components/ClearableSearchInput";
import { PodHealthPill, PodListStatusPill } from "../components/PodStatusPills";
import {
  WL_SEARCHABLE_DROPDOWN_INPUT_STYLE,
  WL_SEARCHABLE_DROPDOWN_PANEL_STYLE,
  WL_SEARCHABLE_DROPDOWN_SEARCH_MARGIN_STYLE,
  WL_SEARCHABLE_DROPDOWN_SCROLL_STYLE,
  SearchableDropdownTwoColumnRow,
  clusterOptionColumns,
  kubeconfigDisplayFileName,
} from "../components/SearchableDropdownPrimitives";
import { useFocusInputWhenOpen } from "../hooks/useFocusInputWhenOpen";
import { DescribeEventsSection } from "../components/describe/DescribeEventsSection";
import { DeploymentDescribeContent } from "../components/describe/DeploymentDescribeContent";
import { StatefulSetDescribeContent } from "../components/describe/StatefulSetDescribeContent";
import { IngressDescribeContent } from "../components/describe/IngressDescribeContent";
import { ServiceDescribeContent } from "../components/describe/ServiceDescribeContent";
import { PvcDescribeContent } from "../components/describe/PvcDescribeContent";
import { NodeDescribeContent } from "../components/describe/NodeDescribeContent";
import { ServicesListTable } from "../components/ServicesListTable";
import { PVC_COLUMN_KEYS, PVC_COLUMN_DEFAULTS, PVCListTable } from "../components/PVCListTable";
import { NODE_COLUMN_KEYS, NODE_COLUMN_DEFAULTS, NodesListTable } from "../components/NodesListTable";
import { ResourceJumpChip } from "../components/ResourceJumpChip";
import { ResourceNameWithCopy } from "../components/ResourceNameWithCopy";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useResourceListColumnResize } from "../resourceList/useResourceListColumnResize";
import { useSortedRowPositionChangeHighlight } from "../hooks/useSortedRowPositionChangeHighlight";
import { useNowTick } from "../hooks/useNowTick";
import {
  applyK8sClusterScopedWatchEvent,
  applyK8sNamespacedWatchEvent,
  applyPodWatchEvent,
} from "../resourceList/watchEventReducer";
import {
  mergeClusterScopedItemsWithListSnapshot,
  mergeNamespacedItemsWithListSnapshot,
  mergePodsWithListSnapshot,
} from "../resourceList/mergeListSnapshot";
import { formatAgeFromMetadata, readCreationTimestampFromMetadata } from "../utils/k8sCreationTimestamp";
import { ResourceAccessDeniedState } from "../components/ResourceAccessDeniedState";
import { isK8sAccessDeniedError, k8sAccessDeniedSummary } from "../utils/k8sAccessErrors";
import {
  clearResourceAccessDecision,
  getResourceAccessDecision,
  setResourceAccessDecision,
} from "../utils/resourceAccessCache";
import {
  CLOCK_SKEW_WARN_THRESHOLD_MS,
  getClockSkewMs,
  getCurrentServerNow,
  newServerClockSnapshot,
  type ServerClockSnapshot,
} from "../utils/serverClock";
import copyIcon from "../assets/icon-copy.png";

const ALL_NAMESPACES = "";

/** 与 resourceAccessCache / API ResourceKind 对齐，用于 Nodes 权限缓存键 */
const NODES_RESOURCE_KEY = "nodes";

/** 调试：localStorage `weblens_debug_pod_age=1` 时，每个 uid 在 Pods 表首次渲染打一次 */
const loggedPodAgeRowByUid = new Set<string>();

const POD_COLUMN_KEYS = [
  "name",
  "namespace",
  "node",
  "age",
  "health",
  "status",
  "restarts",
  "containers",
  "actions",
] as const;
const POD_COLUMN_DEFAULTS: Record<(typeof POD_COLUMN_KEYS)[number], number> = {
  name: 180,
  namespace: 120,
  node: 140,
  age: 90,
  health: 100,
  status: 80,
  restarts: 70,
  containers: 70,
  actions: 80,
};

const MIN_COL_WIDTH = 40;

/** 列表多选主键：namespace/name（与 watch 更新无关，Pod 重建改名后原 key 自然失效） */
function nsNameRowKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

function parseNsNameRowKey(key: string): { namespace: string; name: string } {
  const i = key.indexOf("/");
  if (i < 0) return { namespace: "", name: key };
  return { namespace: key.slice(0, i), name: key.slice(i + 1) };
}

/** 行首勾选列宽度（不参与列宽拖拽） */
const LIST_SELECT_COL_WIDTH = 40;

const DEPLOY_COLUMN_KEYS = [
  "name",
  "namespace",
  "pods",
  "replicas",
  "age",
  "conditions",
  "actions",
] as const;
const DEPLOY_COLUMN_DEFAULTS: Record<(typeof DEPLOY_COLUMN_KEYS)[number], number> = {
  name: 200,
  namespace: 120,
  pods: 72,
  replicas: 96,
  age: 88,
  conditions: 240,
  actions: 84,
};

function deployColumnMinWidth(key: string): number {
  const m: Record<string, number> = {
    name: 100,
    namespace: 72,
    pods: 56,
    replicas: 72,
    age: 56,
    conditions: 120,
    actions: 52,
  };
  return m[key] ?? MIN_COL_WIDTH;
}

const STS_COLUMN_KEYS = [
  "name",
  "namespace",
  "pods",
  "ready",
  "ordinals",
  "age",
  "health",
  "actions",
] as const;
const STS_COLUMN_DEFAULTS: Record<(typeof STS_COLUMN_KEYS)[number], number> = {
  name: 200,
  namespace: 110,
  pods: 52,
  ready: 72,
  ordinals: 80,
  age: 80,
  health: 100,
  actions: 84,
};

function stsColumnMinWidth(key: string): number {
  const m: Record<string, number> = {
    name: 100,
    namespace: 72,
    pods: 48,
    ready: 56,
    ordinals: 56,
    age: 56,
    health: 72,
    actions: 52,
  };
  return m[key] ?? MIN_COL_WIDTH;
}

const INGRESS_COLUMN_KEYS = [
  "name",
  "namespace",
  "hosts",
  "paths",
  "backends",
  "health",
  "summary",
  "age",
  "actions",
] as const;

const INGRESS_COLUMN_DEFAULTS: Record<(typeof INGRESS_COLUMN_KEYS)[number], number> = {
  name: 200,
  namespace: 100,
  hosts: 152,
  paths: 56,
  backends: 72,
  health: 88,
  summary: 200,
  age: 80,
  actions: 84,
};

function ingressColumnMinWidth(key: string): number {
  const m: Record<string, number> = {
    name: 120,
    namespace: 72,
    hosts: 96,
    paths: 48,
    backends: 56,
    health: 72,
    summary: 120,
    age: 56,
    actions: 52,
  };
  return m[key] ?? MIN_COL_WIDTH;
}

const INGRESS_COLUMN_LABELS: Record<(typeof INGRESS_COLUMN_KEYS)[number], string> = {
  name: "Name",
  namespace: "Namespace",
  hosts: "Hosts",
  paths: "Rules",
  backends: "Backends",
  health: "状态",
  summary: "异常摘要",
  age: "存活时间",
  actions: "操作",
};

const INGRESS_COLUMN_SORT: Partial<Record<(typeof INGRESS_COLUMN_KEYS)[number], IngressSortKey>> = {
  name: "name",
  hosts: "hosts",
  paths: "paths",
  backends: "backends",
  health: "health",
  age: "age",
};

const SERVICE_COLUMN_KEYS = [
  "name",
  "namespace",
  "type",
  "clusterIP",
  "ports",
  "selector",
  "endpoints",
  "health",
  "age",
  "actions",
] as const;

const SERVICE_COLUMN_DEFAULTS: Record<(typeof SERVICE_COLUMN_KEYS)[number], number> = {
  name: 200,
  namespace: 100,
  type: 100,
  clusterIP: 120,
  ports: 100,
  selector: 160,
  endpoints: 120,
  health: 88,
  age: 80,
  actions: 84,
};

function serviceColumnMinWidth(key: string): number {
  const m: Record<string, number> = {
    name: 120,
    namespace: 72,
    type: 72,
    clusterIP: 88,
    ports: 72,
    selector: 100,
    endpoints: 88,
    health: 72,
    age: 56,
    actions: 52,
  };
  return m[key] ?? MIN_COL_WIDTH;
}

const SERVICE_COLUMN_LABELS: Record<(typeof SERVICE_COLUMN_KEYS)[number], string> = {
  name: "Name",
  namespace: "Namespace",
  type: "Type",
  clusterIP: "Cluster IP",
  ports: "Ports",
  selector: "Selector",
  endpoints: "Endpoints / 状态",
  health: "状态",
  age: "存活时间",
  actions: "操作",
};

const SERVICE_COLUMN_SORT: Partial<Record<(typeof SERVICE_COLUMN_KEYS)[number], ServiceSortKey>> = {
  name: "name",
  namespace: "namespace",
  type: "type",
  endpoints: "endpoints",
  health: "health",
  age: "age",
};

function pvcColumnMinWidth(key: string): number {
  const m: Record<string, number> = {
    name: 120,
    namespace: 72,
    status: 72,
    volume: 100,
    capacity: 64,
    accessModes: 72,
    storageClass: 88,
    usedBy: 88,
    opsHint: 72,
    age: 56,
    actions: 52,
  };
  return m[key] ?? MIN_COL_WIDTH;
}

function nodeColumnMinWidth(key: string): number {
  const m: Record<string, number> = {
    name: 120,
    status: 88,
    roles: 100,
    version: 72,
    internalIP: 100,
    pods: 48,
    cpuMemory: 96,
    age: 56,
    actions: 52,
  };
  return m[key] ?? MIN_COL_WIDTH;
}

function mergeDeploymentIntoList(items: K8sItem[], updated: unknown): K8sItem[] {
  const u = updated as K8sItem;
  if (!u?.metadata?.name) return items;
  const key = `${u.metadata.namespace ?? ""}/${u.metadata.name}`;
  return items.map((it) => {
    const k = `${it.metadata?.namespace ?? ""}/${it.metadata?.name}`;
    return k === key ? ({ ...it, ...u } as K8sItem) : it;
  });
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #1f2937",
  fontSize: 12,
  color: "#9ca3af",
};

/** 与 ResizableTh 默认 sticky 表头一致（定位、背景、底边），供首列勾选 th 使用，避免滚动时与表头脱节 */
const stickyHeaderThCheckbox: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  backgroundColor: "#0f172a",
  boxShadow: "0 1px 0 0 #1f2937",
  boxSizing: "border-box",
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

/** Deployment 列表行（来自 K8s List API 的 item） */
type DeploymentRow = K8sItem & {
  metadata: K8sItem["metadata"] & { creationTimestamp?: string };
  spec?: { replicas?: number };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
};

/** StatefulSet 列表行 */
type StatefulSetRow = K8sItem & {
  metadata: K8sItem["metadata"] & { creationTimestamp?: string };
  spec?: { replicas?: number; serviceName?: string };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    currentReplicas?: number;
    updatedReplicas?: number;
  };
};

/** Ingress 列表行（spec 形状由 networking.k8s.io/v1 决定，此处保持宽松） */
type IngressRow = K8sItem & {
  metadata: K8sItem["metadata"] & { creationTimestamp?: string };
  spec?: Record<string, unknown>;
};

/** 排序位移追踪 / 高亮用行 id（与表格行 key 策略一致） */
function podTableSortRowId(p: Pod): string {
  return p.metadata.uid;
}

function deploymentTableSortRowId(row: K8sItem): string {
  const m = row.metadata;
  return (m.uid as string) || `${m.namespace ?? ""}/${m.name}`;
}

function serviceTableSortRowId(row: K8sItem): string {
  const m = row.metadata;
  return (m.uid as string) || `${m.namespace ?? ""}/${m.name}`;
}

function deploymentPodsColumn(d: DeploymentRow): string {
  const desired = typeof d.spec?.replicas === "number" ? d.spec!.replicas! : 0;
  const ready = typeof d.status?.readyReplicas === "number" ? d.status!.readyReplicas! : 0;
  return `${ready}/${desired}`;
}

/** Replicas 列：当前副本数 / 期望副本数 */
function deploymentReplicasColumn(d: DeploymentRow): string {
  const desired = d.spec?.replicas;
  const current = d.status?.replicas;
  if (typeof desired === "number") {
    return `${typeof current === "number" ? current : 0} / ${desired}`;
  }
  return typeof current === "number" ? `${current}` : "-";
}

const DeploymentConditionsCell: React.FC<{ d: DeploymentRow }> = ({ d }) => {
  const conditions = d.status?.conditions ?? [];
  if (!conditions.length) {
    return <span style={{ color: "#64748b" }}>-</span>;
  }
  const priority = (t: string) => {
    if (t === "Available") return 0;
    if (t === "Progressing") return 1;
    if (t === "ReplicaFailure") return 2;
    return 10;
  };
  const sorted = [...conditions].sort((a, b) => priority(a.type) - priority(b.type));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {sorted.map((c) => {
        const ok = c.status === "True";
        const failType = c.type === "ReplicaFailure";
        let bg = "rgba(22,163,74,0.15)";
        let border = "rgba(22,163,74,0.55)";
        let color = "#6ee7b7";
        if (failType || !ok) {
          bg = "rgba(185,28,28,0.18)";
          border = "rgba(248,113,113,0.65)";
          color = "#fecaca";
        } else if (c.type === "Progressing") {
          bg = "rgba(6,182,212,0.12)";
          border = "rgba(34,211,238,0.45)";
          color = "#a5f3fc";
        }
        return (
          <span
            key={`${c.type}-${c.status}`}
            title={[c.reason, c.message].filter(Boolean).join(" — ") || undefined}
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              backgroundColor: bg,
              border: `1px solid ${border}`,
              color,
              maxWidth: 140,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.type}
            {!ok ? ` · ${c.status}` : ""}
          </span>
        );
      })}
    </div>
  );
};

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
  /** Deployments 专用列表（与其它通用 resourceItems 隔离，便于 Pods ⇄ Deployments 切换时缓存） */
  const [deploymentItems, setDeploymentItems] = useState<K8sItem[]>([]);
  const [statefulsetItems, setStatefulsetItems] = useState<K8sItem[]>([]);
  const [ingressItems, setIngressItems] = useState<K8sItem[]>([]);
  const [serviceItems, setServiceItems] = useState<K8sItem[]>([]);
  const [pvcItems, setPvcItems] = useState<K8sItem[]>([]);
  const [serviceEndpointItems, setServiceEndpointItems] = useState<K8sItem[]>([]);
  /** Ingress 排障：同作用域 Service 列表（仅 Ingress 视图拉取 + watch，与通用 resourceItems 隔离） */
  const [ingressAuxServices, setIngressAuxServices] = useState<K8sItem[]>([]);
  const ingressAuxWatchCancelRef = useRef<(() => void) | null>(null);
  const endpointsWatchCancelRef = useRef<(() => void) | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [deploymentLoading, setDeploymentLoading] = useState(false);
  const [statefulsetLoading, setStatefulsetLoading] = useState(false);
  const [ingressLoading, setIngressLoading] = useState(false);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [pvcLoading, setPvcLoading] = useState(false);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeItems, setNodeItems] = useState<K8sItem[]>([]);
  /** Nodes：RBAC 拒绝时走受限态，不整页 setError */
  const [nodesAccessDenied, setNodesAccessDenied] = useState(false);
  const [nodesAccessTechnicalSummary, setNodesAccessTechnicalSummary] = useState<string | null>(null);
  const [serverClockSnapshot, setServerClockSnapshot] = useState<ServerClockSnapshot | null>(null);
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
  /** 平台配置 · 集群选择：自定义下拉 + 搜索 */
  const [configClusterPickOpen, setConfigClusterPickOpen] = useState(false);
  const [configClusterSearchKeyword, setConfigClusterSearchKeyword] = useState("");
  const configClusterSearchRef = useRef<HTMLInputElement>(null);
  const clusterComboSearchRef = useRef<HTMLInputElement>(null);
  /** 集群组合选择：当前选中的组合（待应用） + 已应用组合 */
  const [activeComboId, setActiveComboId] = useState<string | null>(null);
  const [effectiveComboId, setEffectiveComboId] = useState<string | null>(null);
  /** 当前打开操作菜单的 Pod（namespace/name），null 表示未打开 */
  const [podMenuOpenKey, setPodMenuOpenKey] = useState<string | null>(null);
  /** Deployments 行三点菜单：namespace/name */
  const [deploymentMenuOpenKey, setDeploymentMenuOpenKey] = useState<string | null>(null);
  const [statefulsetMenuOpenKey, setStatefulsetMenuOpenKey] = useState<string | null>(null);
  /** 点击「刷新列表」递增，仅强制重拉当前视图数据，不改变集群/命名空间作用域 */
  const [podsListNonce, setPodsListNonce] = useState(0);
  const [deploymentsListNonce, setDeploymentsListNonce] = useState(0);
  const [statefulsetsListNonce, setStatefulsetsListNonce] = useState(0);
  const [ingressesListNonce, setIngressesListNonce] = useState(0);
  const [servicesListNonce, setServicesListNonce] = useState(0);
  const [pvcsListNonce, setPvcsListNonce] = useState(0);
  const [nodesListNonce, setNodesListNonce] = useState(0);
  /** Deployment / StatefulSet Scale 弹窗 */
  const [deployScaleModal, setDeployScaleModal] = useState<{
    namespace: string;
    name: string;
    current: number;
    resource: "deployment" | "statefulset";
  } | null>(null);
  const [deployScaleInput, setDeployScaleInput] = useState("");
  const [deployScaleSaving, setDeployScaleSaving] = useState(false);
  /** Pods / Deployments 多选（全局，跨搜索排序；与 listScopeKey、刷新列表联动清空） */
  const [selectedPodKeys, setSelectedPodKeys] = useState<Set<string>>(() => new Set());
  const [selectedDeploymentKeys, setSelectedDeploymentKeys] = useState<Set<string>>(() => new Set());
  const podTableHeaderSelectRef = useRef<HTMLInputElement>(null);
  const deployTableHeaderSelectRef = useRef<HTMLInputElement>(null);
  const [batchConfirm, setBatchConfirm] = useState<{
    kind: "pods-delete" | "deployments-delete" | "deployments-restart";
    keys: string[];
  } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  /** 单行/单次危险操作统一确认（替代 window.confirm） */
  const [actionConfirm, setActionConfirm] = useState<{
    title: string;
    description?: string;
    items: string[];
    variant: "danger" | "primary";
    onConfirm: () => Promise<void>;
  } | null>(null);
  const actionConfirmRef = useRef(actionConfirm);
  actionConfirmRef.current = actionConfirm;
  /** Deployment 行上异步操作（restart/delete） */
  const [deploymentRowBusyKey, setDeploymentRowBusyKey] = useState<string | null>(null);
  const [statefulsetRowBusyKey, setStatefulsetRowBusyKey] = useState<string | null>(null);
  const [ingressRowBusyKey, setIngressRowBusyKey] = useState<string | null>(null);
  const [ingressMenuOpenKey, setIngressMenuOpenKey] = useState<string | null>(null);
  const [expandedIngressKeys, setExpandedIngressKeys] = useState<Set<string>>(() => new Set());
  const [serviceRowBusyKey, setServiceRowBusyKey] = useState<string | null>(null);
  const [pvcRowBusyKey, setPvcRowBusyKey] = useState<string | null>(null);
  const [nodeMenuOpenKey, setNodeMenuOpenKey] = useState<string | null>(null);
  const [nodeRowBusyKey, setNodeRowBusyKey] = useState<string | null>(null);
  const [serviceMenuOpenKey, setServiceMenuOpenKey] = useState<string | null>(null);
  const [pvcMenuOpenKey, setPvcMenuOpenKey] = useState<string | null>(null);
  const [expandedServiceKeys, setExpandedServiceKeys] = useState<Set<string>>(() => new Set());
  const [expandedStatefulSetKeys, setExpandedStatefulSetKeys] = useState<Set<string>>(() => new Set());
  /** 列表区按 Name 关键字搜索（Pods / Deployments / Ingresses 等共用） */
  const [nameFilter, setNameFilter] = useState("");
  /** 列表单列排序：按视图分别记忆，仅「刷新列表」清空 */
  const [podsListSort, setPodsListSort] = useState<ResourceListSortState<PodSortKey>>(null);
  const [deploymentsListSort, setDeploymentsListSort] = useState<ResourceListSortState<DeploymentSortKey>>(null);
  const [statefulsetsListSort, setStatefulsetsListSort] = useState<ResourceListSortState<StatefulSetSortKey>>(null);
  const [ingressesListSort, setIngressesListSort] = useState<ResourceListSortState<IngressSortKey>>(null);
  const [servicesListSort, setServicesListSort] = useState<ResourceListSortState<ServiceSortKey>>(null);
  const [pvcsListSort, setPvcsListSort] = useState<ResourceListSortState<PvcSortKey>>(null);
  const [nodesListSort, setNodesListSort] = useState<ResourceListSortState<NodeSortKey>>(null);
  /** Pod / Deployments / StatefulSets / Ingresses 表列宽（统一由 useResourceListColumnResize 管理） */
  const {
    columnWidths: podColumnWidths,
    beginResize: beginResizePod,
    totalDataWidth: podDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: POD_COLUMN_KEYS,
    defaults: POD_COLUMN_DEFAULTS,
    minWidthForKey: () => MIN_COL_WIDTH,
  });
  const {
    columnWidths: deployColumnWidths,
    beginResize: beginResizeDeploy,
    totalDataWidth: deployDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: DEPLOY_COLUMN_KEYS,
    defaults: DEPLOY_COLUMN_DEFAULTS,
    minWidthForKey: deployColumnMinWidth,
  });
  const {
    columnWidths: stsColumnWidths,
    beginResize: beginResizeSts,
    totalDataWidth: stsDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: STS_COLUMN_KEYS,
    defaults: STS_COLUMN_DEFAULTS,
    minWidthForKey: stsColumnMinWidth,
  });
  const {
    columnWidths: ingressColumnWidths,
    beginResize: beginResizeIngress,
    totalDataWidth: ingressDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: INGRESS_COLUMN_KEYS,
    defaults: INGRESS_COLUMN_DEFAULTS,
    minWidthForKey: ingressColumnMinWidth,
  });
  const {
    columnWidths: serviceColumnWidths,
    beginResize: beginResizeService,
    totalDataWidth: serviceDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: SERVICE_COLUMN_KEYS,
    defaults: SERVICE_COLUMN_DEFAULTS,
    minWidthForKey: serviceColumnMinWidth,
  });
  const {
    columnWidths: pvcColumnWidths,
    beginResize: beginResizePvc,
    totalDataWidth: pvcDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: PVC_COLUMN_KEYS,
    defaults: PVC_COLUMN_DEFAULTS,
    minWidthForKey: pvcColumnMinWidth,
  });
  const {
    columnWidths: nodeColumnWidths,
    beginResize: beginResizeNode,
    totalDataWidth: nodeDataColumnsWidth,
  } = useResourceListColumnResize({
    columnKeys: NODE_COLUMN_KEYS,
    defaults: NODE_COLUMN_DEFAULTS,
    minWidthForKey: nodeColumnMinWidth,
  });
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
  /** 已应用作用域下最近一次成功 HTTP 列表拉取（用于 Pods / Deployments 切换时跳过重复请求） */
  const lastPodsListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  const lastDeploymentsListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  const lastStatefulsetsListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  const lastIngressesListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  const lastServicesListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  const lastPvcsListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  const lastNodesListFetchRef = useRef<{ scope: string; nonce: number } | null>(null);
  /** 「刷新列表」点击后用于在 HTTP 完成时显示成功/失败 toast，避免与普通列表加载混淆 */
  const podsManualRefreshToastRef = useRef(false);
  const deploymentsManualRefreshToastRef = useRef(false);
  const statefulsetsManualRefreshToastRef = useRef(false);
  const ingressesManualRefreshToastRef = useRef(false);
  const servicesManualRefreshToastRef = useRef(false);
  const pvcsManualRefreshToastRef = useRef(false);
  const nodesManualRefreshToastRef = useRef(false);
  /** watch 断线重连 / 可见性恢复时 list 合并补齐的节流（毫秒时间戳） */
  const lastPodsWatchGapFillAtRef = useRef(0);
  const lastDeploymentsWatchGapFillAtRef = useRef(0);
  const lastStsWatchGapFillAtRef = useRef(0);
  const lastIngressWatchGapFillAtRef = useRef(0);
  const lastPvcsWatchGapFillAtRef = useRef(0);
  const lastNodesWatchGapFillAtRef = useRef(0);
  const lastServicesWatchGapFillAtRef = useRef(0);
  const prevPageVisibleForGapFillRef = useRef(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const currentViewRef = useRef<ResourceKind>("pods");
  /** 左侧边栏是否收起 */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Describe 右侧弹层：Pod 或 Deployment */
  const [describeTarget, setDescribeTarget] = useState<{
    kind: "pod" | "deployment" | "statefulset" | "ingress" | "service" | "pvc" | "node";
    clusterId: string;
    namespace: string;
    name: string;
  } | null>(null);
  const [describePodData, setDescribePodData] = useState<PodDescribe | null>(null);
  const [describeDeploymentData, setDescribeDeploymentData] = useState<DeploymentDescribe | null>(null);
  const [describeStatefulSetData, setDescribeStatefulSetData] = useState<StatefulSetDescribe | null>(null);
  const [describeIngressData, setDescribeIngressData] = useState<IngressDescribe | null>(null);
  const [describeServiceData, setDescribeServiceData] = useState<ServiceDescribe | null>(null);
  const [describePvcData, setDescribePvcData] = useState<PvcDescribe | null>(null);
  const [describeNodeData, setDescribeNodeData] = useState<NodeDescribe | null>(null);
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
  const listScopeKey = useMemo(
    () => `${effectiveClusterId ?? ""}|${effectiveNamespace}|${applyRevision}`,
    [effectiveClusterId, effectiveNamespace, applyRevision],
  );

  const nodesListScopeKey = useMemo(
    () => `${effectiveClusterId ?? ""}|${applyRevision}`,
    [effectiveClusterId, applyRevision],
  );

  useEffect(() => {
    setNodesAccessDenied(false);
    setNodesAccessTechnicalSummary(null);
  }, [effectiveClusterId]);

  const listAgeTickActive =
    !!effectiveClusterId &&
    (currentView === "pods" ||
      currentView === "deployments" ||
      currentView === "statefulsets" ||
      currentView === "ingresses" ||
      currentView === "services" ||
      currentView === "persistentvolumeclaims" ||
      currentView === "nodes" ||
      describeTarget !== null);

  const clientNowTick = useNowTick(1000, listAgeTickActive);
  const listAgeNow = useMemo(
    () => getCurrentServerNow(serverClockSnapshot, clientNowTick),
    [serverClockSnapshot, clientNowTick],
  );
  const serverClockSkewMs = useMemo(() => Math.round(getClockSkewMs(listAgeNow)), [listAgeNow]);
  const showServerClockSkewHint = Math.abs(serverClockSkewMs) > CLOCK_SKEW_WARN_THRESHOLD_MS;

  useEffect(() => {
    loggedPodAgeRowByUid.clear();
    setSelectedPodKeys(new Set());
    setSelectedDeploymentKeys(new Set());
  }, [listScopeKey]);

  useEffect(() => {
    setSelectedPodKeys((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(pods.map((p) => nsNameRowKey(p.metadata.namespace, p.metadata.name)));
      const next = new Set<string>();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [pods]);

  useEffect(() => {
    setSelectedDeploymentKeys((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(
        deploymentItems.map((it) => nsNameRowKey(it.metadata.namespace ?? "", it.metadata.name)),
      );
      const next = new Set<string>();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [deploymentItems]);

  useFocusInputWhenOpen(clusterDropdownOpen, clusterComboSearchRef, true);
  useFocusInputWhenOpen(configClusterPickOpen, configClusterSearchRef, true);

  useEffect(() => {
    if (!configModalOpen) {
      setConfigClusterPickOpen(false);
      setConfigClusterSearchKeyword("");
    }
  }, [configModalOpen]);

  useEffect(() => {
    if (configActiveTab !== "combos") {
      setConfigClusterPickOpen(false);
    }
  }, [configActiveTab]);

  const configClusterPickFiltered = useMemo(() => {
    const k = configClusterSearchKeyword.trim().toLowerCase();
    return clusters.filter((c) => {
      if (!k) return true;
      const f = kubeconfigDisplayFileName(c.filePath).toLowerCase();
      return f.includes(k) || c.name.toLowerCase().includes(k) || c.id.toLowerCase().includes(k);
    });
  }, [clusters, configClusterSearchKeyword]);

  const clusterComboDropdownFiltered = useMemo(() => {
    const k = clusterSearchKeyword.trim().toLowerCase();
    return clusterCombos.filter((combo) => {
      if (!k) return true;
      const cluster = clusters.find((c) => c.id === combo.clusterId);
      const fileName = kubeconfigDisplayFileName(cluster?.filePath ?? "");
      const text = [cluster?.name, fileName, combo.namespace, combo.alias]
        .join(" ")
        .toLowerCase();
      return text.includes(k);
    });
  }, [clusterCombos, clusters, clusterSearchKeyword]);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  /** Ingress 辅助 Service list 异步回调用，避免 describe 关闭后仍用陈旧闭包 */
  const ingressAuxNeededRef = useRef(false);
  useEffect(() => {
    ingressAuxNeededRef.current =
      currentView === "ingresses" || describeTarget?.kind === "ingress";
  }, [currentView, describeTarget?.kind]);

  /** Services 页 Endpoints watch 用 */
  const serviceEndpointsNeededRef = useRef(false);
  useEffect(() => {
    serviceEndpointsNeededRef.current =
      currentView === "services" || describeTarget?.kind === "service";
  }, [currentView, describeTarget?.kind]);

  useEffect(() => {
    setPodMenuOpenKey(null);
    setPodMenuSubmenu(null);
    setDeploymentMenuOpenKey(null);
    setStatefulsetMenuOpenKey(null);
    setIngressMenuOpenKey(null);
    setServiceMenuOpenKey(null);
    setPvcMenuOpenKey(null);
    setNodeMenuOpenKey(null);
  }, [currentView]);

  useEffect(() => {
    if (
      !podMenuOpenKey &&
      !deploymentMenuOpenKey &&
      !statefulsetMenuOpenKey &&
      !ingressMenuOpenKey &&
      !serviceMenuOpenKey &&
      !pvcMenuOpenKey &&
      !nodeMenuOpenKey
    )
      return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPodMenuOpenKey(null);
        setPodMenuSubmenu(null);
        setDeploymentMenuOpenKey(null);
        setStatefulsetMenuOpenKey(null);
        setIngressMenuOpenKey(null);
        setServiceMenuOpenKey(null);
        setPvcMenuOpenKey(null);
        setNodeMenuOpenKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    podMenuOpenKey,
    deploymentMenuOpenKey,
    statefulsetMenuOpenKey,
    ingressMenuOpenKey,
    serviceMenuOpenKey,
    pvcMenuOpenKey,
    nodeMenuOpenKey,
  ]);

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

  const refreshDescribe = useCallback(() => {
    if (!describeTarget) return;
    setDescribeLoading(true);
    setDescribeError(null);
    if (describeTarget.kind === "pod") {
      setDescribePodData(null);
      fetchPodDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
        .then((data) => {
          setDescribePodData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribePodData(null);
            setDescribeError("Pod 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    } else if (describeTarget.kind === "deployment") {
      setDescribeDeploymentData(null);
      fetchDeploymentDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
        .then((data) => {
          setDescribeDeploymentData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribeDeploymentData(null);
            setDescribeError("Deployment 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    } else if (describeTarget.kind === "statefulset") {
      setDescribeStatefulSetData(null);
      fetchStatefulSetDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
        .then((data) => {
          setDescribeStatefulSetData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribeStatefulSetData(null);
            setDescribeError("StatefulSet 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    } else if (describeTarget.kind === "ingress") {
      setDescribeIngressData(null);
      fetchIngressDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
        .then((data) => {
          setDescribeIngressData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribeIngressData(null);
            setDescribeError("Ingress 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    } else if (describeTarget.kind === "service") {
      setDescribeServiceData(null);
      fetchServiceDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
        .then((data) => {
          setDescribeServiceData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribeServiceData(null);
            setDescribeError("Service 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    } else if (describeTarget.kind === "node") {
      setDescribeNodeData(null);
      fetchNodeDescribe(describeTarget.clusterId, describeTarget.name)
        .then((data) => {
          setDescribeNodeData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribeNodeData(null);
            setDescribeError("Node 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    } else {
      setDescribePvcData(null);
      fetchPvcDescribe(describeTarget.clusterId, describeTarget.namespace, describeTarget.name)
        .then((data) => {
          setDescribePvcData(data);
          setDescribeError(null);
        })
        .catch((e: any) => {
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error;
          if (status === 404) {
            setDescribePvcData(null);
            setDescribeError("PVC 已不存在或已被删除");
          } else {
            setDescribeError(backendMsg ?? e?.message ?? "加载 Describe 失败");
          }
        })
        .finally(() => setDescribeLoading(false));
    }
  }, [describeTarget]);

  // Describe：打开或切换目标时拉取；不跟随 Watch，仅打开/刷新时请求
  useEffect(() => {
    if (!describeTarget) {
      setDescribePodData(null);
      setDescribeDeploymentData(null);
      setDescribeStatefulSetData(null);
      setDescribeIngressData(null);
      setDescribeServiceData(null);
      setDescribePvcData(null);
      setDescribeNodeData(null);
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

  const openEditDeploymentTab = (d: DeploymentRow) => {
    if (!effectiveClusterId) return;
    const ns = d.metadata.namespace ?? "";
    const name = d.metadata.name;
    const id = `edit-deploy-${ns}-${name}`;
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
        title: `${name} (Deployment)`,
        containers: [],
        yamlKind: "deployment",
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setDeploymentMenuOpenKey(null);
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
      kind: "pod",
      clusterId: effectiveClusterId,
      namespace: pod.metadata.namespace,
      name: pod.metadata.name,
    });
  };

  const openDescribeForDeployment = (d: DeploymentRow) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      kind: "deployment",
      clusterId: effectiveClusterId,
      namespace: d.metadata.namespace ?? "",
      name: d.metadata.name,
    });
  };

  const openDescribeForStatefulSet = (s: StatefulSetRow) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      kind: "statefulset",
      clusterId: effectiveClusterId,
      namespace: s.metadata.namespace ?? "",
      name: s.metadata.name,
    });
  };

  const openEditStatefulSetTab = (s: StatefulSetRow) => {
    if (!effectiveClusterId) return;
    const ns = s.metadata.namespace ?? "";
    const name = s.metadata.name;
    const id = `edit-sts-${ns}-${name}`;
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
        title: `${name} (StatefulSet)`,
        containers: [],
        yamlKind: "statefulset",
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setStatefulsetMenuOpenKey(null);
  };

  const openDescribeForIngress = (ing: IngressRow) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      kind: "ingress",
      clusterId: effectiveClusterId,
      namespace: ing.metadata.namespace ?? "",
      name: ing.metadata.name,
    });
  };

  const openEditIngressTab = (ing: IngressRow) => {
    if (!effectiveClusterId) return;
    const ns = ing.metadata.namespace ?? "";
    const name = ing.metadata.name;
    const id = `edit-ing-${ns}-${name}`;
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
        title: `${name} (Ingress)`,
        containers: [],
        yamlKind: "ingress",
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setIngressMenuOpenKey(null);
  };

  const openDescribeForService = (svc: ServiceListRow) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      kind: "service",
      clusterId: effectiveClusterId,
      namespace: svc.metadata?.namespace ?? "",
      name: svc.metadata?.name ?? "",
    });
  };

  const openEditServiceTab = (svc: ServiceListRow) => {
    if (!effectiveClusterId) return;
    const ns = svc.metadata?.namespace ?? "";
    const name = svc.metadata?.name ?? "";
    const id = `edit-svc-${ns}-${name}`;
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
        title: `${name} (Service)`,
        containers: [],
        yamlKind: "service",
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setServiceMenuOpenKey(null);
  };

  const openDescribeForPvc = (pvc: PvcListRow) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      kind: "pvc",
      clusterId: effectiveClusterId,
      namespace: pvc.metadata?.namespace ?? "",
      name: pvc.metadata?.name ?? "",
    });
  };

  const openEditPvcTab = (pvc: PvcListRow) => {
    if (!effectiveClusterId) return;
    const ns = pvc.metadata?.namespace ?? "";
    const name = pvc.metadata?.name ?? "";
    const id = `edit-pvc-${ns}-${name}`;
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
        title: `${name} (PVC)`,
        containers: [],
        yamlKind: "pvc",
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setPvcMenuOpenKey(null);
  };

  const openDescribeForNode = (n: NodeListRow) => {
    if (!effectiveClusterId) return;
    setDescribeTarget({
      kind: "node",
      clusterId: effectiveClusterId,
      namespace: "",
      name: n.metadata?.name ?? "",
    });
  };

  const openEditNodeTab = (n: NodeListRow) => {
    if (!effectiveClusterId) return;
    const name = n.metadata?.name ?? "";
    const id = `edit-node-${name}`;
    setPanelTabs((prev) => {
      const exists = prev.some((t) => t.id === id);
      if (exists) return prev;
      const tab: PanelTab = {
        id,
        type: "edit",
        clusterId: effectiveClusterId,
        namespace: "",
        pod: name,
        container: "",
        title: `${name} (Node)`,
        containers: [],
        yamlKind: "node",
      };
      return [...prev, tab];
    });
    setActivePanelTabId(id);
    setNodeMenuOpenKey(null);
  };

  /** Ingress 排障联动：跳转 Services / Pods 列表并带关键字（当前集群+命名空间作用域不变） */
  const jumpIngressToServices = useCallback((serviceName: string) => {
    setDescribeTarget(null);
    setIngressMenuOpenKey(null);
    setCurrentView("services");
    queueMicrotask(() => setNameFilter(serviceName));
  }, []);

  const jumpIngressToPods = useCallback((hint: string) => {
    setDescribeTarget(null);
    setIngressMenuOpenKey(null);
    setCurrentView("pods");
    queueMicrotask(() => setNameFilter(hint));
  }, []);

  const jumpServiceToPods = useCallback((hint: string) => {
    setDescribeTarget(null);
    setServiceMenuOpenKey(null);
    setCurrentView("pods");
    queueMicrotask(() => setNameFilter(hint));
  }, []);

  const jumpServiceToIngress = useCallback((ingressName: string) => {
    setDescribeTarget(null);
    setServiceMenuOpenKey(null);
    setCurrentView("ingresses");
    queueMicrotask(() => setNameFilter(ingressName));
  }, []);

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

  // 必须稳定引用：否则 Pods 的 useEffect 在每次任意 state 重渲染时都会 cleanup+重连 watch，
  // 造成 ADDED/MODIFIED 丢失，新 Pod 只能等下一次 HTTP list 才出现且 Age 已偏大。
  const syncServerClock = useCallback((serverTimeMs?: number) => {
    if (typeof serverTimeMs !== "number" || !Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
    setServerClockSnapshot(newServerClockSnapshot(serverTimeMs));
  }, []);

  const loadPods = useCallback(async (clusterId: string, namespace: string) => {
    const requestedNs = namespace || undefined;
    const { items, serverTimeMs } = await fetchPods(clusterId, requestedNs);
    syncServerClock(serverTimeMs);
    const cur = activeClusterNsRef.current;
    if (cur.clusterId !== clusterId || (cur.namespace || "") !== (requestedNs ?? "")) {
      return;
    }
    setPods(items);
    setApplyingSelection(false);
    setError(null);
  }, [syncServerClock]);

  const confirmBatchAction = useCallback(async () => {
    if (!batchConfirm || !effectiveClusterId) return;
    const keys = batchConfirm.keys;
    const kind = batchConfirm.kind;
    setBatchBusy(true);
    setError(null);
    try {
      const nsApi = effectiveNamespace || undefined;
      if (kind === "pods-delete") {
        for (const key of keys) {
          const { namespace, name } = parseNsNameRowKey(key);
          await deletePod(effectiveClusterId, namespace, name);
        }
        setSelectedPodKeys(new Set());
        setBatchConfirm(null);
        setToastMessage(`已删除 ${keys.length} 个 Pod`);
        // 不调用 loadPods：全表覆盖会与 watch 竞态并抹掉刚 ADDED 的新 Pod；删除增量交给 watch。
      } else if (kind === "deployments-delete") {
        for (const key of keys) {
          const { namespace, name } = parseNsNameRowKey(key);
          await deleteDeployment(effectiveClusterId, namespace, name);
        }
        setSelectedDeploymentKeys(new Set());
        setBatchConfirm(null);
        setToastMessage(`已删除 ${keys.length} 个 Deployment`);
        setDeploymentItems((prev) =>
          prev.filter((it) => {
            const k = nsNameRowKey(it.metadata.namespace ?? "", it.metadata.name);
            return !keys.includes(k);
          }),
        );
      } else {
        for (const key of keys) {
          const { namespace, name } = parseNsNameRowKey(key);
          await restartDeployment(effectiveClusterId, namespace, name);
        }
        setBatchConfirm(null);
        setToastMessage(`已触发 ${keys.length} 个 Deployment 重启`);
        const { items: refreshed, serverTimeMs } = await fetchResourceList<K8sItem>(
          effectiveClusterId,
          "deployments",
          nsApi,
        );
        syncServerClock(serverTimeMs);
        setDeploymentItems(refreshed as K8sItem[]);
      }
    } catch (e: any) {
      setToastMessage(e?.response?.data?.error ?? e?.message ?? "批量操作失败");
      throw e;
    } finally {
      setBatchBusy(false);
    }
  }, [batchConfirm, effectiveClusterId, effectiveNamespace, syncServerClock]);

  const loadResourceList = useCallback(async () => {
    if (!effectiveClusterId) return;
    setResourceLoading(true);
    const ns =
      currentView === "nodes" || currentView === "namespaces" ? undefined : (effectiveNamespace || undefined);
    fetchResourceList(effectiveClusterId, currentView, ns)
      .then(({ items, serverTimeMs }) => {
        syncServerClock(serverTimeMs);
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
  }, [effectiveClusterId, currentView, effectiveNamespace, syncServerClock]);

  const WATCH_GAP_FILL_MIN_MS = 2500;

  const runPodsWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    const ns = effectiveNamespace;
    if (!cid || !pageVisible) return;
    const viewOk =
      currentViewRef.current === "pods" ||
      currentViewRef.current === "statefulsets" ||
      currentViewRef.current === "deployments" ||
      currentViewRef.current === "ingresses" ||
      currentViewRef.current === "services" ||
      currentViewRef.current === "persistentvolumeclaims" ||
      currentViewRef.current === "nodes";
    if (!viewOk) return;
    const t = Date.now();
    if (t - lastPodsWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastPodsWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchPods(cid, ns || undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid || (cur.namespace || "") !== (ns || "")) return;
      setPods((prev) => mergePodsWithListSnapshot(prev, items, ns));
    } catch {
      /* 静默补齐，避免打断 watch 主链路 */
    }
  }, [effectiveClusterId, effectiveNamespace, pageVisible, syncServerClock]);

  const runDeploymentsWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    const ns = effectiveNamespace;
    if (!cid || !pageVisible || currentViewRef.current !== "deployments") return;
    const t = Date.now();
    if (t - lastDeploymentsWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastDeploymentsWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchResourceList<K8sItem>(cid, "deployments", ns || undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid || (cur.namespace || "") !== (ns || "")) return;
      if (currentViewRef.current !== "deployments") return;
      setDeploymentItems((prev) => mergeNamespacedItemsWithListSnapshot(prev, items as K8sItem[], ns));
    } catch {
      /* silent */
    }
  }, [effectiveClusterId, effectiveNamespace, pageVisible, syncServerClock]);

  const runStatefulsetsWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    const ns = effectiveNamespace;
    if (!cid || !pageVisible || currentViewRef.current !== "statefulsets") return;
    const t = Date.now();
    if (t - lastStsWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastStsWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchResourceList<K8sItem>(cid, "statefulsets", ns || undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid || (cur.namespace || "") !== (ns || "")) return;
      if (currentViewRef.current !== "statefulsets") return;
      setStatefulsetItems((prev) => mergeNamespacedItemsWithListSnapshot(prev, items as K8sItem[], ns));
    } catch {
      /* silent */
    }
  }, [effectiveClusterId, effectiveNamespace, pageVisible, syncServerClock]);

  const runIngressesWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    const ns = effectiveNamespace;
    if (!cid || !pageVisible || currentViewRef.current !== "ingresses") return;
    const t = Date.now();
    if (t - lastIngressWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastIngressWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchResourceList<K8sItem>(cid, "ingresses", ns || undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid || (cur.namespace || "") !== (ns || "")) return;
      if (currentViewRef.current !== "ingresses") return;
      setIngressItems((prev) => mergeNamespacedItemsWithListSnapshot(prev, items as K8sItem[], ns));
    } catch {
      /* silent */
    }
  }, [effectiveClusterId, effectiveNamespace, pageVisible, syncServerClock]);

  const runServicesWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    const ns = effectiveNamespace;
    if (!cid || !pageVisible || currentViewRef.current !== "services") return;
    const t = Date.now();
    if (t - lastServicesWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastServicesWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchResourceList<K8sItem>(cid, "services", ns || undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid || (cur.namespace || "") !== (ns || "")) return;
      if (currentViewRef.current !== "services") return;
      setServiceItems((prev) => mergeNamespacedItemsWithListSnapshot(prev, items as K8sItem[], ns));
    } catch {
      /* silent */
    }
  }, [effectiveClusterId, effectiveNamespace, pageVisible, syncServerClock]);

  const runPvcsWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    const ns = effectiveNamespace;
    if (!cid || !pageVisible || currentViewRef.current !== "persistentvolumeclaims") return;
    const t = Date.now();
    if (t - lastPvcsWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastPvcsWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchResourceList<K8sItem>(cid, "persistentvolumeclaims", ns || undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid || (cur.namespace || "") !== (ns || "")) return;
      if (currentViewRef.current !== "persistentvolumeclaims") return;
      setPvcItems((prev) => mergeNamespacedItemsWithListSnapshot(prev, items as K8sItem[], ns));
    } catch {
      /* silent */
    }
  }, [effectiveClusterId, effectiveNamespace, pageVisible, syncServerClock]);

  const runNodesWatchGapFill = useCallback(async () => {
    const cid = effectiveClusterId;
    if (!cid || !pageVisible || currentViewRef.current !== "nodes") return;
    if (getResourceAccessDecision(cid, NODES_RESOURCE_KEY) === "denied") return;
    const t = Date.now();
    if (t - lastNodesWatchGapFillAtRef.current < WATCH_GAP_FILL_MIN_MS) return;
    lastNodesWatchGapFillAtRef.current = t;
    try {
      const { items, serverTimeMs } = await fetchResourceList<K8sItem>(cid, "nodes", undefined);
      syncServerClock(serverTimeMs);
      const cur = activeClusterNsRef.current;
      if (cur.clusterId !== cid) return;
      if (currentViewRef.current !== "nodes") return;
      setNodeItems((prev) => mergeClusterScopedItemsWithListSnapshot(prev, items as K8sItem[]));
    } catch (e) {
      if (isK8sAccessDeniedError(e)) {
        setResourceAccessDecision(cid, NODES_RESOURCE_KEY, "denied");
        setNodesAccessDenied(true);
        setNodesAccessTechnicalSummary(k8sAccessDeniedSummary(e));
        setNodeItems([]);
      }
    }
  }, [effectiveClusterId, pageVisible, syncServerClock]);

  useEffect(() => {
    const wasVisible = prevPageVisibleForGapFillRef.current;
    prevPageVisibleForGapFillRef.current = pageVisible;
    if (!effectiveClusterId || !pageVisible || wasVisible) return;
    const needsPodsData =
      currentView === "pods" ||
      currentView === "statefulsets" ||
      currentView === "deployments" ||
      currentView === "ingresses" ||
      currentView === "services" ||
      currentView === "persistentvolumeclaims" ||
      currentView === "nodes";
    if (needsPodsData) void runPodsWatchGapFill();
    if (currentView === "deployments") void runDeploymentsWatchGapFill();
    if (currentView === "statefulsets") void runStatefulsetsWatchGapFill();
    if (currentView === "ingresses") void runIngressesWatchGapFill();
    if (currentView === "services") void runServicesWatchGapFill();
    if (currentView === "persistentvolumeclaims") void runPvcsWatchGapFill();
    if (currentView === "nodes") void runNodesWatchGapFill();
  }, [
    pageVisible,
    effectiveClusterId,
    currentView,
    runPodsWatchGapFill,
    runDeploymentsWatchGapFill,
    runStatefulsetsWatchGapFill,
    runIngressesWatchGapFill,
    runServicesWatchGapFill,
    runPvcsWatchGapFill,
    runNodesWatchGapFill,
  ]);

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
      setDeploymentItems([]);
      setIngressItems([]);
      setIngressAuxServices([]);
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

  // Pods：Watch + 可选跳过重复 HTTP 列表（同一已应用 cluster+namespace 下 Pods ⇄ Deployments 切换时复用内存）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    // Deployments / Ingresses / PVC 等页也保持 Pods watch：副本状态、Ingress 后端、PVC Used By 推导等同作用域依赖
    const needsPodsData =
      currentView === "pods" ||
      currentView === "statefulsets" ||
      currentView === "deployments" ||
      currentView === "ingresses" ||
      currentView === "persistentvolumeclaims" ||
      currentView === "nodes";

    if (!needsPodsData && podsWatchCancelRef.current) {
      podsWatchCancelRef.current();
      podsWatchCancelRef.current = null;
    }
    // 仅在纯 Pods 视图下清理 resourceWatch：避免切断 Deployments / StatefulSets 正在使用的同 ref watch
    if (needsPodsData && resourceWatchCancelRef.current && currentView === "pods") {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    if (!needsPodsData) return;

    if (podsWatchCancelRef.current) {
      podsWatchCancelRef.current();
      podsWatchCancelRef.current = null;
    }

    const scopeKey = listScopeKey;
    const last = lastPodsListFetchRef.current;
    const needPodsHttp = !last || last.scope !== scopeKey || last.nonce !== podsListNonce;

    if (!needPodsHttp) {
      setApplyingSelection(false);
    }

    if (needPodsHttp) {
      loadPods(effectiveClusterId, effectiveNamespace)
        .then(() => {
          const cur = activeClusterNsRef.current;
          // 与当前视图无关：在 Deployments 等页后台 loadPods 成功后也要更新 ref，
          // 否则切回 Pods 会误判「从未 list」而重复全量请求，列表体感滞后。
          if (cur.clusterId === effectiveClusterId && (cur.namespace || "") === (effectiveNamespace || "")) {
            lastPodsListFetchRef.current = { scope: scopeKey, nonce: podsListNonce };
          }
          if (podsManualRefreshToastRef.current) {
            podsManualRefreshToastRef.current = false;
            if (currentViewRef.current === "pods" || currentViewRef.current === "statefulsets") {
              setToastMessage("列表已刷新");
            }
          }
        })
        .catch((e: any) => {
          if (podsManualRefreshToastRef.current) {
            podsManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = e?.response?.status;
          const backendMsg = e?.response?.data?.error as string | undefined;

          if (
            status === 500 &&
            backendMsg &&
            backendMsg.includes("namespaces") &&
            backendMsg.includes("not found")
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

          setApplyingSelection(false);
        });
    }

    const cancel = watchPods(effectiveClusterId, effectiveNamespace || undefined, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setPods((prev) => applyPodWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error("pods watch error:", err);
        setError(err?.message || "Pods Watch 失败，请检查集群权限或稍后重试");
      },
      onConnectionEstablished: () => {
        void runPodsWatchGapFill();
      },
    });
    podsWatchCancelRef.current = cancel;

    return () => {
      if (podsWatchCancelRef.current) {
        podsWatchCancelRef.current();
        podsWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    podsListNonce,
    loadPods,
    runPodsWatchGapFill,
    syncServerClock,
  ]);

  // Deployments：独立列表状态 + 与 Pods 相同的「作用域内跳过重复 HTTP」策略
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView !== "deployments") return;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    const scopeKey = listScopeKey;
    const last = lastDeploymentsListFetchRef.current;
    const needDeploymentsHttp = !last || last.scope !== scopeKey || last.nonce !== deploymentsListNonce;

    const ns = effectiveNamespace || undefined;

    if (!needDeploymentsHttp) {
      setApplyingSelection(false);
    }

    if (needDeploymentsHttp) {
      setDeploymentLoading(true);
      setError(null);
      fetchResourceList<K8sItem>(effectiveClusterId, "deployments", ns)
        .then(({ items, serverTimeMs }) => {
          syncServerClock(serverTimeMs);
          const cur = activeClusterNsRef.current;
          if (currentViewRef.current !== "deployments") {
            if (deploymentsManualRefreshToastRef.current) deploymentsManualRefreshToastRef.current = false;
            return;
          }
          if (cur.clusterId !== effectiveClusterId || (cur.namespace || "") !== (effectiveNamespace || "")) {
            if (deploymentsManualRefreshToastRef.current) deploymentsManualRefreshToastRef.current = false;
            return;
          }
          setDeploymentItems(items as K8sItem[]);
          setError(null);
          lastDeploymentsListFetchRef.current = { scope: scopeKey, nonce: deploymentsListNonce };
          if (deploymentsManualRefreshToastRef.current) {
            deploymentsManualRefreshToastRef.current = false;
            setToastMessage("列表已刷新");
          }
        })
        .catch((err: any) => {
          if (deploymentsManualRefreshToastRef.current) {
            deploymentsManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "加载失败，请稍后重试");
        })
        .finally(() => {
          setDeploymentLoading(false);
          setApplyingSelection(false);
        });
    }

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "deployments", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setDeploymentItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error("deployments watch error:", err);
        fetchResourceList<K8sItem>(effectiveClusterId, "deployments", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (currentViewRef.current !== "deployments") return;
            setDeploymentItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
      onConnectionEstablished: () => {
        void runDeploymentsWatchGapFill();
      },
    });
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    deploymentsListNonce,
    runDeploymentsWatchGapFill,
    syncServerClock,
  ]);

  // StatefulSets：独立列表 + Watch；不关闭 Pods Watch（实例数据复用 Pods 缓存）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView !== "statefulsets") return;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    const scopeKey = listScopeKey;
    const last = lastStatefulsetsListFetchRef.current;
    const needStsHttp = !last || last.scope !== scopeKey || last.nonce !== statefulsetsListNonce;
    const ns = effectiveNamespace || undefined;

    if (!needStsHttp) {
      setApplyingSelection(false);
    }

    if (needStsHttp) {
      setStatefulsetLoading(true);
      setError(null);
      fetchResourceList<K8sItem>(effectiveClusterId, "statefulsets", ns)
        .then(({ items, serverTimeMs }) => {
          syncServerClock(serverTimeMs);
          const cur = activeClusterNsRef.current;
          if (currentViewRef.current !== "statefulsets") {
            if (statefulsetsManualRefreshToastRef.current) statefulsetsManualRefreshToastRef.current = false;
            return;
          }
          if (cur.clusterId !== effectiveClusterId || (cur.namespace || "") !== (effectiveNamespace || "")) {
            if (statefulsetsManualRefreshToastRef.current) statefulsetsManualRefreshToastRef.current = false;
            return;
          }
          setStatefulsetItems(items as K8sItem[]);
          setError(null);
          lastStatefulsetsListFetchRef.current = { scope: scopeKey, nonce: statefulsetsListNonce };
          if (statefulsetsManualRefreshToastRef.current) {
            statefulsetsManualRefreshToastRef.current = false;
            setToastMessage("列表已刷新");
          }
        })
        .catch((err: any) => {
          if (statefulsetsManualRefreshToastRef.current) {
            statefulsetsManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "加载失败，请稍后重试");
        })
        .finally(() => {
          setStatefulsetLoading(false);
          setApplyingSelection(false);
        });
    }

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "statefulsets", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setStatefulsetItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error("statefulsets watch error:", err);
        fetchResourceList<K8sItem>(effectiveClusterId, "statefulsets", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (currentViewRef.current !== "statefulsets") return;
            setStatefulsetItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
      onConnectionEstablished: () => {
        void runStatefulsetsWatchGapFill();
      },
    });
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    statefulsetsListNonce,
    runStatefulsetsWatchGapFill,
    syncServerClock,
  ]);

  // Ingresses：独立列表 + Watch（与 Deployments / StatefulSets 一致的作用域缓存策略）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView !== "ingresses") return;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    const scopeKey = listScopeKey;
    const last = lastIngressesListFetchRef.current;
    const needIngressHttp = !last || last.scope !== scopeKey || last.nonce !== ingressesListNonce;
    const ns = effectiveNamespace || undefined;

    if (!needIngressHttp) {
      setApplyingSelection(false);
    }

    if (needIngressHttp) {
      setIngressLoading(true);
      setError(null);
      fetchResourceList<K8sItem>(effectiveClusterId, "ingresses", ns)
        .then(({ items, serverTimeMs }) => {
          syncServerClock(serverTimeMs);
          const cur = activeClusterNsRef.current;
          if (currentViewRef.current !== "ingresses") {
            if (ingressesManualRefreshToastRef.current) ingressesManualRefreshToastRef.current = false;
            return;
          }
          if (cur.clusterId !== effectiveClusterId || (cur.namespace || "") !== (effectiveNamespace || "")) {
            if (ingressesManualRefreshToastRef.current) ingressesManualRefreshToastRef.current = false;
            return;
          }
          setIngressItems(items as K8sItem[]);
          setError(null);
          lastIngressesListFetchRef.current = { scope: scopeKey, nonce: ingressesListNonce };
          if (ingressesManualRefreshToastRef.current) {
            ingressesManualRefreshToastRef.current = false;
            setToastMessage("列表已刷新");
          }
        })
        .catch((err: any) => {
          if (ingressesManualRefreshToastRef.current) {
            ingressesManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "加载失败，请稍后重试");
        })
        .finally(() => {
          setIngressLoading(false);
          setApplyingSelection(false);
        });
    }

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "ingresses", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setIngressItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error("ingresses watch error:", err);
        fetchResourceList<K8sItem>(effectiveClusterId, "ingresses", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (currentViewRef.current !== "ingresses") return;
            setIngressItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
      onConnectionEstablished: () => {
        void runIngressesWatchGapFill();
      },
    });
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    ingressesListNonce,
    runIngressesWatchGapFill,
    syncServerClock,
  ]);

  // Services：独立列表 + Watch（与 Ingress 一致的作用域缓存）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView !== "services") return;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    const scopeKey = listScopeKey;
    const last = lastServicesListFetchRef.current;
    const needHttp = !last || last.scope !== scopeKey || last.nonce !== servicesListNonce;
    const ns = effectiveNamespace || undefined;

    if (!needHttp) {
      setApplyingSelection(false);
    }

    if (needHttp) {
      setServiceLoading(true);
      setError(null);
      fetchResourceList<K8sItem>(effectiveClusterId, "services", ns)
        .then(({ items, serverTimeMs }) => {
          syncServerClock(serverTimeMs);
          const cur = activeClusterNsRef.current;
          if (currentViewRef.current !== "services") {
            if (servicesManualRefreshToastRef.current) servicesManualRefreshToastRef.current = false;
            return;
          }
          if (cur.clusterId !== effectiveClusterId || (cur.namespace || "") !== (effectiveNamespace || "")) {
            if (servicesManualRefreshToastRef.current) servicesManualRefreshToastRef.current = false;
            return;
          }
          setServiceItems(items as K8sItem[]);
          setError(null);
          lastServicesListFetchRef.current = { scope: scopeKey, nonce: servicesListNonce };
          if (servicesManualRefreshToastRef.current) {
            servicesManualRefreshToastRef.current = false;
            setToastMessage("列表已刷新");
          }
        })
        .catch((err: any) => {
          if (servicesManualRefreshToastRef.current) {
            servicesManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "加载失败，请稍后重试");
        })
        .finally(() => {
          setServiceLoading(false);
          setApplyingSelection(false);
        });
    }

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "services", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setServiceItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error("services watch error:", err);
        fetchResourceList<K8sItem>(effectiveClusterId, "services", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (currentViewRef.current !== "services") return;
            setServiceItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
      onConnectionEstablished: () => {
        void runServicesWatchGapFill();
      },
    });
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    servicesListNonce,
    runServicesWatchGapFill,
    syncServerClock,
  ]);

  // PersistentVolumeClaims：独立列表 + Watch
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView !== "persistentvolumeclaims") return;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    const scopeKey = listScopeKey;
    const last = lastPvcsListFetchRef.current;
    const needHttp = !last || last.scope !== scopeKey || last.nonce !== pvcsListNonce;
    const ns = effectiveNamespace || undefined;

    if (!needHttp) {
      setApplyingSelection(false);
    }

    if (needHttp) {
      setPvcLoading(true);
      setError(null);
      fetchResourceList<K8sItem>(effectiveClusterId, "persistentvolumeclaims", ns)
        .then(({ items, serverTimeMs }) => {
          syncServerClock(serverTimeMs);
          const cur = activeClusterNsRef.current;
          if (currentViewRef.current !== "persistentvolumeclaims") {
            if (pvcsManualRefreshToastRef.current) pvcsManualRefreshToastRef.current = false;
            return;
          }
          if (cur.clusterId !== effectiveClusterId || (cur.namespace || "") !== (effectiveNamespace || "")) {
            if (pvcsManualRefreshToastRef.current) pvcsManualRefreshToastRef.current = false;
            return;
          }
          setPvcItems(items as K8sItem[]);
          setError(null);
          lastPvcsListFetchRef.current = { scope: scopeKey, nonce: pvcsListNonce };
          if (pvcsManualRefreshToastRef.current) {
            pvcsManualRefreshToastRef.current = false;
            setToastMessage("列表已刷新");
          }
        })
        .catch((err: any) => {
          if (pvcsManualRefreshToastRef.current) {
            pvcsManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "加载失败，请稍后重试");
        })
        .finally(() => {
          setPvcLoading(false);
          setApplyingSelection(false);
        });
    }

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "persistentvolumeclaims", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setPvcItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: (err) => {
        // eslint-disable-next-line no-console
        console.error("pvc watch error:", err);
        fetchResourceList<K8sItem>(effectiveClusterId, "persistentvolumeclaims", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (currentViewRef.current !== "persistentvolumeclaims") return;
            setPvcItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
      onConnectionEstablished: () => {
        void runPvcsWatchGapFill();
      },
    });
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    pvcsListNonce,
    runPvcsWatchGapFill,
    syncServerClock,
  ]);

  // Nodes：集群级列表 + Watch（与命名空间选择无关，缓存键仅用 cluster + applyRevision）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (currentView !== "nodes") return;

    const cid = effectiveClusterId;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    if (getResourceAccessDecision(cid, NODES_RESOURCE_KEY) === "denied") {
      setError(null);
      setNodesAccessDenied(true);
      setNodeItems([]);
      setNodeLoading(false);
      setApplyingSelection(false);
      return;
    }

    const scopeKey = nodesListScopeKey;
    const last = lastNodesListFetchRef.current;
    const needHttp = !last || last.scope !== scopeKey || last.nonce !== nodesListNonce;

    if (!needHttp) {
      setApplyingSelection(false);
    }

    if (needHttp) {
      setNodeLoading(true);
      setError(null);
      setNodesAccessDenied(false);
      setNodesAccessTechnicalSummary(null);
      fetchResourceList<K8sItem>(cid, "nodes", undefined)
        .then(({ items, serverTimeMs }) => {
          syncServerClock(serverTimeMs);
          const cur = activeClusterNsRef.current;
          if (currentViewRef.current !== "nodes") {
            if (nodesManualRefreshToastRef.current) nodesManualRefreshToastRef.current = false;
            return;
          }
          if (cur.clusterId !== cid) {
            if (nodesManualRefreshToastRef.current) nodesManualRefreshToastRef.current = false;
            return;
          }
          setResourceAccessDecision(cid, NODES_RESOURCE_KEY, "granted");
          setNodesAccessDenied(false);
          setNodesAccessTechnicalSummary(null);
          setNodeItems(items as K8sItem[]);
          setError(null);
          lastNodesListFetchRef.current = { scope: scopeKey, nonce: nodesListNonce };
          if (nodesManualRefreshToastRef.current) {
            nodesManualRefreshToastRef.current = false;
            setToastMessage("列表已刷新");
          }
        })
        .catch((err: any) => {
          if (isK8sAccessDeniedError(err)) {
            setResourceAccessDecision(cid, NODES_RESOURCE_KEY, "denied");
            setNodesAccessDenied(true);
            setNodesAccessTechnicalSummary(k8sAccessDeniedSummary(err));
            setNodeItems([]);
            setError(null);
            if (nodesManualRefreshToastRef.current) nodesManualRefreshToastRef.current = false;
            resourceWatchCancelRef.current?.();
            resourceWatchCancelRef.current = null;
            return;
          }
          if (nodesManualRefreshToastRef.current) {
            nodesManualRefreshToastRef.current = false;
            setToastMessage("刷新失败，请稍后重试");
          }
          const status = err?.response?.status;
          const backendMsg = err?.response?.data?.error;
          if (status === 404) setError("当前集群不存在，请点击「刷新」重载 kubeconfig 目录");
          else if (status === 500 && backendMsg) setError(`集群 API 调用失败：${backendMsg}`);
          else if (status === 500) setError("当前集群不可用，请检查 kubeconfig 与集群连通性，或点击「刷新」重试");
          else setError(err?.message || "加载失败，请稍后重试");
        })
        .finally(() => {
          setNodeLoading(false);
          setApplyingSelection(false);
        });
    }

    const cancel = watchResourceList<K8sItem>(cid, "nodes", undefined, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setNodeItems((prev) => applyK8sClusterScopedWatchEvent(prev, ev));
      },
      onError: (err) => {
        if (isK8sAccessDeniedError(err)) {
          setResourceAccessDecision(cid, NODES_RESOURCE_KEY, "denied");
          setNodesAccessDenied(true);
          setNodesAccessTechnicalSummary((prev) => prev ?? k8sAccessDeniedSummary(err));
          setNodeItems([]);
          setError(null);
          resourceWatchCancelRef.current?.();
          resourceWatchCancelRef.current = null;
          return;
        }
        // eslint-disable-next-line no-console
        console.error("nodes watch error:", err);
        fetchResourceList<K8sItem>(cid, "nodes", undefined)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (currentViewRef.current !== "nodes") return;
            setNodeItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
      shouldReconnect: (err, httpStatus) => {
        if (httpStatus === 401 || httpStatus === 403) return false;
        return !isK8sAccessDeniedError(err);
      },
      onConnectionEstablished: () => {
        void runNodesWatchGapFill();
      },
    });
    resourceWatchCancelRef.current = cancel;

    return () => {
      if (resourceWatchCancelRef.current) {
        resourceWatchCancelRef.current();
        resourceWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    currentView,
    pageVisible,
    nodesListScopeKey,
    nodesListNonce,
    runNodesWatchGapFill,
    syncServerClock,
  ]);

  // Ingress 排障辅助：同作用域 Services list + watch（独立 cancel ref，不打断 Ingress 主 watch）
  useEffect(() => {
    if (!effectiveClusterId || !pageVisible) {
      if (ingressAuxWatchCancelRef.current) {
        ingressAuxWatchCancelRef.current();
        ingressAuxWatchCancelRef.current = null;
      }
      return;
    }
    const keepAux =
      currentView === "ingresses" || describeTarget?.kind === "ingress";
    if (!keepAux) {
      if (ingressAuxWatchCancelRef.current) {
        ingressAuxWatchCancelRef.current();
        ingressAuxWatchCancelRef.current = null;
      }
      setIngressAuxServices([]);
      return;
    }

    if (ingressAuxWatchCancelRef.current) {
      ingressAuxWatchCancelRef.current();
      ingressAuxWatchCancelRef.current = null;
    }

    const ns = effectiveNamespace || undefined;
    fetchResourceList<K8sItem>(effectiveClusterId, "services", ns)
      .then(({ items, serverTimeMs }) => {
        syncServerClock(serverTimeMs);
        if (!ingressAuxNeededRef.current) return;
        setIngressAuxServices(items as K8sItem[]);
      })
      .catch(() => {});

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "services", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setIngressAuxServices((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: () => {
        fetchResourceList<K8sItem>(effectiveClusterId, "services", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (!ingressAuxNeededRef.current) return;
            setIngressAuxServices(items as K8sItem[]);
          })
          .catch(() => {});
      },
    });
    ingressAuxWatchCancelRef.current = cancel;

    return () => {
      if (ingressAuxWatchCancelRef.current) {
        ingressAuxWatchCancelRef.current();
        ingressAuxWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    syncServerClock,
    describeTarget?.kind,
  ]);

  // Services 排障：Endpoints list + watch（独立 cancel ref）
  useEffect(() => {
    if (!effectiveClusterId || !pageVisible) {
      if (endpointsWatchCancelRef.current) {
        endpointsWatchCancelRef.current();
        endpointsWatchCancelRef.current = null;
      }
      return;
    }
    if (!serviceEndpointsNeededRef.current) {
      if (endpointsWatchCancelRef.current) {
        endpointsWatchCancelRef.current();
        endpointsWatchCancelRef.current = null;
      }
      setServiceEndpointItems([]);
      return;
    }

    if (endpointsWatchCancelRef.current) {
      endpointsWatchCancelRef.current();
      endpointsWatchCancelRef.current = null;
    }

    const ns = effectiveNamespace || undefined;
    fetchResourceList<K8sItem>(effectiveClusterId, "endpoints", ns)
      .then(({ items, serverTimeMs }) => {
        syncServerClock(serverTimeMs);
        if (!serviceEndpointsNeededRef.current) return;
        setServiceEndpointItems(items as K8sItem[]);
      })
      .catch(() => {});

    const cancel = watchResourceList<K8sItem>(effectiveClusterId, "endpoints", ns, {
      onEvent: (ev) => {
        syncServerClock(ev.serverTimeMs);
        setServiceEndpointItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
      },
      onError: () => {
        fetchResourceList<K8sItem>(effectiveClusterId, "endpoints", ns)
          .then(({ items, serverTimeMs }) => {
            syncServerClock(serverTimeMs);
            if (!serviceEndpointsNeededRef.current) return;
            setServiceEndpointItems(items as K8sItem[]);
          })
          .catch(() => {});
      },
    });
    endpointsWatchCancelRef.current = cancel;

    return () => {
      if (endpointsWatchCancelRef.current) {
        endpointsWatchCancelRef.current();
        endpointsWatchCancelRef.current = null;
      }
    };
  }, [
    effectiveClusterId,
    effectiveNamespace,
    currentView,
    pageVisible,
    listScopeKey,
    syncServerClock,
    describeTarget?.kind,
  ]);

  // 其它非 Pods、非 Deployments 资源：沿用原 Watch + HTTP 列表逻辑（每次进入视图仍拉取，保持改动最小）
  useEffect(() => {
    if (!effectiveClusterId) return;
    if (!pageVisible) return;
    if (
      currentView === "pods" ||
      currentView === "deployments" ||
      currentView === "statefulsets" ||
      currentView === "ingresses" ||
      currentView === "services" ||
      currentView === "persistentvolumeclaims" ||
      currentView === "nodes"
    )
      return;

    if (resourceWatchCancelRef.current) {
      resourceWatchCancelRef.current();
      resourceWatchCancelRef.current = null;
    }

    loadResourceList();

    const cancel = watchResourceList<K8sItem>(
      effectiveClusterId,
      currentView,
      currentView === "nodes" || currentView === "namespaces" ? undefined : effectiveNamespace || undefined,
      {
        onEvent: (ev) => {
          syncServerClock(ev.serverTimeMs);
          setResourceItems((prev) => applyK8sNamespacedWatchEvent(prev, ev, effectiveNamespace));
        },
        onError: (err) => {
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
  }, [effectiveClusterId, effectiveNamespace, currentView, pageVisible, loadResourceList, applyRevision, syncServerClock]);

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
    persistentvolumeclaims: "Persistent Volume Claims",
    endpoints: "Endpoints",
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

  // Pods 全局提示：只要存在任意非“健康”标签就提示
  const hasNonHealthyPods = useMemo(
    () =>
      pods.some((p) => {
        const label = p.healthLabel || "健康";
        return label !== "健康";
      }),
    [pods],
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

  const filteredDeployments = useMemo(() => {
    const k = nameFilter.trim().toLowerCase();
    if (!k) return deploymentItems;
    return deploymentItems.filter((i) => (i.metadata?.name ?? "").toLowerCase().includes(k));
  }, [deploymentItems, nameFilter]);

  const filteredStatefulSets = useMemo(() => {
    const k = nameFilter.trim().toLowerCase();
    if (!k) return statefulsetItems;
    return statefulsetItems.filter((i) => (i.metadata?.name ?? "").toLowerCase().includes(k));
  }, [statefulsetItems, nameFilter]);

  const filteredIngresses = useMemo(() => {
    const k = nameFilter.trim();
    if (!k) return ingressItems;
    return ingressItems.filter((i) => ingressMatchesNameOrHostFilter(i, k));
  }, [ingressItems, nameFilter]);

  /** Ingress 排障模型（按全量 ingressItems 计算，供排序/主表/顶部提示复用） */
  const ingressTroubleshootByKey = useMemo(() => {
    const m = new Map<string, ReturnType<typeof buildIngressTroubleshoot>>();
    for (const raw of ingressItems) {
      const row = raw as IngressRow;
      const key = `${row.metadata.namespace ?? ""}/${row.metadata.name}`;
      m.set(key, buildIngressTroubleshoot(row, ingressAuxServices, pods));
    }
    return m;
  }, [ingressItems, ingressAuxServices, pods]);

  const hasNonHealthyIngresses = useMemo(
    () => [...ingressTroubleshootByKey.values()].some((d) => d.label !== "健康"),
    [ingressTroubleshootByKey],
  );

  const ingressSortStatsByKey = useMemo(() => {
    const m = new Map<string, IngressSortStats>();
    for (const raw of filteredIngresses) {
      const row = raw as IngressRow;
      const key = `${row.metadata.namespace ?? ""}/${row.metadata.name}`;
      const s = deriveIngressListSummary(row);
      const diag = ingressTroubleshootByKey.get(key);
      m.set(key, {
        hostCount: s.hostCount,
        pathCount: s.pathCount,
        backendCount: diag?.backendServiceCount ?? 0,
        healthRank: diag?.healthRank ?? 0,
      });
    }
    return m;
  }, [filteredIngresses, ingressTroubleshootByKey]);

  const sortedIngresses = useMemo(() => {
    const getStats = (row: IngressRow) => {
      const k = `${row.metadata.namespace ?? ""}/${row.metadata.name}`;
      return (
        ingressSortStatsByKey.get(k) ?? {
          hostCount: 0,
          pathCount: 0,
          backendCount: 0,
          healthRank: 0,
        }
      );
    };
    const byAge = ingressesListSort?.key === "age";
    return sortByState(
      filteredIngresses as IngressRow[],
      ingressesListSort,
      byAge
        ? (a, b, key) => compareIngressesForSort(a, b, key, getStats, listAgeNow)
        : (a, b, key) => compareIngressesForSort(a, b, key, getStats),
    );
  }, [
    filteredIngresses,
    ingressesListSort,
    ingressSortStatsByKey,
    ingressesListSort?.key === "age" ? listAgeNow : 0,
  ]);

  const serviceEndpointsByKey = useMemo(() => {
    const m = new Map<string, K8sItem>();
    for (const ep of serviceEndpointItems) {
      const n = ep.metadata?.name;
      const ns = ep.metadata?.namespace ?? "";
      if (n) m.set(`${ns}/${n}`, ep);
    }
    return m;
  }, [serviceEndpointItems]);

  const filteredServices = useMemo(() => {
    const k = nameFilter.trim();
    if (!k) return serviceItems;
    return serviceItems.filter((i) => serviceMatchesNameFilter(i, k));
  }, [serviceItems, nameFilter]);

  const hasRiskyServices = useMemo(() => {
    for (const raw of serviceItems) {
      const key = `${raw.metadata.namespace ?? ""}/${raw.metadata.name}`;
      const ep = serviceEndpointsByKey.get(key);
      const d = buildServiceListDiagnostics(raw, ep, pods);
      if (d.label === "严重" || d.label === "警告") return true;
    }
    return false;
  }, [serviceItems, serviceEndpointsByKey, pods]);

  const serviceSortStatsByKey = useMemo(() => {
    const m = new Map<string, ServiceSortStats>();
    for (const raw of filteredServices) {
      const row = raw as ServiceSortRow;
      const key = `${row.metadata?.namespace ?? ""}/${row.metadata?.name}`;
      const ep = serviceEndpointsByKey.get(key);
      const d = buildServiceListDiagnostics(raw, ep, pods);
      m.set(key, {
        type: row.spec?.type ?? "",
        endpointTotal: d.readyEp + d.notReadyEp,
        healthRank: d.healthRank,
      });
    }
    return m;
  }, [filteredServices, serviceEndpointsByKey, pods]);

  const sortedServices = useMemo(() => {
    const getStats = (row: ServiceSortRow) => {
      const k = `${row.metadata.namespace ?? ""}/${row.metadata.name}`;
      return (
        serviceSortStatsByKey.get(k) ?? {
          type: "",
          endpointTotal: 0,
          healthRank: 0,
        }
      );
    };
    const byAge = servicesListSort?.key === "age";
    return sortByState(
      filteredServices as ServiceSortRow[],
      servicesListSort,
      byAge
        ? (a, b, key) => compareServicesForSort(a, b, key, getStats, listAgeNow)
        : (a, b, key) => compareServicesForSort(a, b, key, getStats),
    );
  }, [
    filteredServices,
    servicesListSort,
    serviceSortStatsByKey,
    servicesListSort?.key === "age" ? listAgeNow : 0,
  ]);

  const filteredPvcs = useMemo(() => {
    const k = nameFilter.trim();
    if (!k) return pvcItems;
    return pvcItems.filter((i) => pvcMatchesNameFilter(i as PvcListRow, k));
  }, [pvcItems, nameFilter]);

  const hasRiskyPvcs = useMemo(() => {
    for (const raw of pvcItems) {
      const s = derivePvcStatusSummary(raw as PvcListRow);
      if (s.label !== "健康") return true;
    }
    return false;
  }, [pvcItems]);

  const pvcSortStatsByKey = useMemo(() => {
    const m = new Map<string, PvcSortStats>();
    for (const raw of filteredPvcs) {
      const row = raw as PvcSortRow;
      const ns = row.metadata.namespace ?? "";
      const name = row.metadata.name;
      const key = `${ns}/${name}`;
      const st = derivePvcStatusSummary(raw as PvcListRow);
      const used = podsUsingPvcClaim(pods, ns, name).length;
      const pr = raw as PvcListRow;
      m.set(key, {
        statusRank: st.healthRank,
        volume: formatPvcVolumeName(pr),
        capacity: formatPvcCapacity(pr),
        storageClass: formatPvcStorageClass(pr),
        usedByCount: used,
      });
    }
    return m;
  }, [filteredPvcs, pods]);

  const sortedPvcs = useMemo(() => {
    const getStats = (row: PvcSortRow) => {
      const k = `${row.metadata.namespace ?? ""}/${row.metadata.name}`;
      return (
        pvcSortStatsByKey.get(k) ?? {
          statusRank: 0,
          volume: "",
          capacity: "",
          storageClass: "",
          usedByCount: 0,
        }
      );
    };
    const byAge = pvcsListSort?.key === "age";
    return sortByState(
      filteredPvcs as PvcSortRow[],
      pvcsListSort,
      byAge
        ? (a, b, key) => comparePvcsForSort(a, b, key, getStats, listAgeNow)
        : (a, b, key) => comparePvcsForSort(a, b, key, getStats),
    );
  }, [filteredPvcs, pvcsListSort, pvcSortStatsByKey, pvcsListSort?.key === "age" ? listAgeNow : 0]);

  const filteredNodes = useMemo(() => {
    const k = nameFilter.trim();
    if (!k) return nodeItems;
    return nodeItems.filter((i) => nodeMatchesNameFilter(i as NodeListRow, k));
  }, [nodeItems, nameFilter]);

  const nodeSortStatsByKey = useMemo(() => {
    const m = new Map<string, NodeSortStats>();
    for (const raw of filteredNodes) {
      const row = raw as NodeSortRow;
      const nname = row.metadata.name;
      const st = deriveNodeStatusSummary(raw as NodeListRow);
      m.set(nname, {
        statusRank: st.sortRank,
        roles: formatNodeRoles(raw as NodeListRow),
        version: formatNodeKubeletVersion(raw as NodeListRow),
        internalIP: formatNodeInternalIP(raw as NodeListRow),
        podsCount: countPodsOnNode(pods, nname),
        cpuMemory: formatNodeCpuMemoryCapacity(raw as NodeListRow),
      });
    }
    return m;
  }, [filteredNodes, pods]);

  const sortedNodes = useMemo(() => {
    const getStats = (row: NodeSortRow) =>
      nodeSortStatsByKey.get(row.metadata.name) ?? {
        statusRank: 0,
        roles: "",
        version: "",
        internalIP: "",
        podsCount: 0,
        cpuMemory: "",
      };
    const byAge = nodesListSort?.key === "age";
    return sortByState(
      filteredNodes as NodeSortRow[],
      nodesListSort,
      byAge
        ? (a, b, key) => compareNodesForSort(a, b, key, getStats, listAgeNow)
        : (a, b, key) => compareNodesForSort(a, b, key, getStats),
    );
  }, [filteredNodes, nodesListSort, nodeSortStatsByKey, nodesListSort?.key === "age" ? listAgeNow : 0]);

  const nodesPermissionDenied = useMemo(() => {
    if (!effectiveClusterId || currentView !== "nodes") return false;
    if (getResourceAccessDecision(effectiveClusterId, NODES_RESOURCE_KEY) === "denied") return true;
    return nodesAccessDenied;
  }, [effectiveClusterId, currentView, nodesAccessDenied]);

  const statefulsetStsStatsByKey = useMemo(() => {
    const m = new Map<string, { owned: Pod[]; stats: ReturnType<typeof buildStatefulSetSortStats> }>();
    for (const raw of filteredStatefulSets) {
      const s = raw as StatefulSetRow;
      const ns = s.metadata.namespace ?? "";
      const name = s.metadata.name;
      const key = `${ns}/${name}`;
      const owned = podsOwnedByStatefulSet(pods, name, ns);
      m.set(key, { owned, stats: buildStatefulSetSortStats(s, owned) });
    }
    return m;
  }, [filteredStatefulSets, pods]);

  const sortedStatefulSets = useMemo(() => {
    const getStats = (row: StatefulSetRow) => {
      const k = `${row.metadata.namespace ?? ""}/${row.metadata.name}`;
      return statefulsetStsStatsByKey.get(k)?.stats ?? buildStatefulSetSortStats(row, []);
    };
    const byAge = statefulsetsListSort?.key === "age";
    return sortByState(
      filteredStatefulSets as StatefulSetSortRow[],
      statefulsetsListSort,
      byAge
        ? (a, b, key) => compareStatefulSetsForSort(a, b, key, getStats, listAgeNow)
        : (a, b, key) => compareStatefulSetsForSort(a, b, key, getStats),
    );
  }, [
    filteredStatefulSets,
    statefulsetsListSort,
    statefulsetStsStatsByKey,
    statefulsetsListSort?.key === "age" ? listAgeNow : 0,
  ]);

  const hasNonHealthyStatefulSets = useMemo(() => {
    for (const raw of statefulsetItems) {
      const s = raw as StatefulSetRow;
      const ns = s.metadata.namespace ?? "";
      const name = s.metadata.name;
      const owned = podsOwnedByStatefulSet(pods, name, ns);
      if (aggregatePodHealthLabel(owned) !== "健康") return true;
    }
    return false;
  }, [statefulsetItems, pods]);

  const describeStsChildPods = useMemo(() => {
    if (!describeTarget || describeTarget.kind !== "statefulset") return [] as Pod[];
    return podsOwnedByStatefulSet(pods, describeTarget.name, describeTarget.namespace);
  }, [describeTarget, pods]);

  const ingressDescribeTroubleshoot = useMemo(() => {
    if (!describeIngressData?.view) return null;
    return buildIngressTroubleshootFromDescribeView(describeIngressData.view, ingressAuxServices, pods);
  }, [describeIngressData?.view, ingressAuxServices, pods]);

  const sortedPods = useMemo(() => {
    const byAge = podsListSort?.key === "age";
    return sortByState(
      filteredPods,
      podsListSort,
      byAge ? (a, b, k) => comparePodsForSort(a, b, k, listAgeNow) : comparePodsForSort,
    );
  }, [filteredPods, podsListSort, podsListSort?.key === "age" ? listAgeNow : 0]);

  const sortedDeployments = useMemo(() => {
    const byAge = deploymentsListSort?.key === "age";
    return sortByState(
      filteredDeployments,
      deploymentsListSort,
      byAge ? (a, b, k) => compareDeploymentsForSort(a, b, k, listAgeNow) : compareDeploymentsForSort,
    );
  }, [filteredDeployments, deploymentsListSort, deploymentsListSort?.key === "age" ? listAgeNow : 0]);

  const visiblePodKeysSet = useMemo(
    () => new Set(sortedPods.map((p) => nsNameRowKey(p.metadata.namespace, p.metadata.name))),
    [sortedPods],
  );
  const podSelectedNotVisibleCount = useMemo(
    () => [...selectedPodKeys].filter((k) => !visiblePodKeysSet.has(k)).length,
    [selectedPodKeys, visiblePodKeysSet],
  );

  const visibleDeploymentKeysSet = useMemo(
    () =>
      new Set(
        sortedDeployments.map((d) =>
          nsNameRowKey((d as DeploymentRow).metadata.namespace ?? "", (d as DeploymentRow).metadata.name),
        ),
      ),
    [sortedDeployments],
  );
  const deploymentSelectedNotVisibleCount = useMemo(
    () => [...selectedDeploymentKeys].filter((k) => !visibleDeploymentKeysSet.has(k)).length,
    [selectedDeploymentKeys, visibleDeploymentKeysSet],
  );

  const podSortMembershipKey = useMemo(
    () =>
      [...filteredPods]
        .map((p) => podTableSortRowId(p))
        .filter(Boolean)
        .sort()
        .join("|"),
    [filteredPods],
  );

  const podsSortSpecKey = podsListSort ? `${podsListSort.key}:${podsListSort.direction}` : "";

  const podsSortMoveHighlight = useSortedRowPositionChangeHighlight({
    sortedRows: sortedPods,
    sortActive: !!podsListSort,
    getId: podTableSortRowId,
    membershipKey: podSortMembershipKey,
    sortSpecKey: podsSortSpecKey,
    viewActive: currentView === "pods",
  });

  const deploymentSortMembershipKey = useMemo(
    () =>
      [...filteredDeployments]
        .map((d) => deploymentTableSortRowId(d))
        .filter(Boolean)
        .sort()
        .join("|"),
    [filteredDeployments],
  );

  const deploymentsSortSpecKey = deploymentsListSort
    ? `${deploymentsListSort.key}:${deploymentsListSort.direction}`
    : "";

  const deploymentsSortMoveHighlight = useSortedRowPositionChangeHighlight({
    sortedRows: sortedDeployments,
    sortActive: !!deploymentsListSort,
    getId: deploymentTableSortRowId,
    membershipKey: deploymentSortMembershipKey,
    sortSpecKey: deploymentsSortSpecKey,
    viewActive: currentView === "deployments",
  });

  const podTableTotalWidth = useMemo(
    () => LIST_SELECT_COL_WIDTH + podDataColumnsWidth,
    [podDataColumnsWidth],
  );

  const deployTableTotalWidth = useMemo(
    () => LIST_SELECT_COL_WIDTH + deployDataColumnsWidth,
    [deployDataColumnsWidth],
  );

  useEffect(() => {
    const el = podTableHeaderSelectRef.current;
    if (!el) return;
    const vis = sortedPods.map((p) => nsNameRowKey(p.metadata.namespace, p.metadata.name));
    if (vis.length === 0) {
      el.checked = false;
      el.indeterminate = false;
      return;
    }
    const nSel = vis.filter((k) => selectedPodKeys.has(k)).length;
    el.checked = nSel === vis.length;
    el.indeterminate = nSel > 0 && nSel < vis.length;
  }, [sortedPods, selectedPodKeys]);

  useEffect(() => {
    const el = deployTableHeaderSelectRef.current;
    if (!el) return;
    const vis = sortedDeployments.map((d) =>
      nsNameRowKey((d as DeploymentRow).metadata.namespace ?? "", (d as DeploymentRow).metadata.name),
    );
    if (vis.length === 0) {
      el.checked = false;
      el.indeterminate = false;
      return;
    }
    const nSel = vis.filter((k) => selectedDeploymentKeys.has(k)).length;
    el.checked = nSel === vis.length;
    el.indeterminate = nSel > 0 && nSel < vis.length;
  }, [sortedDeployments, selectedDeploymentKeys]);

  const stsTableTotalWidth = useMemo(() => stsDataColumnsWidth, [stsDataColumnsWidth]);

  const ingressTableTotalWidth = useMemo(() => ingressDataColumnsWidth, [ingressDataColumnsWidth]);

  const serviceTableTotalWidth = useMemo(() => serviceDataColumnsWidth, [serviceDataColumnsWidth]);
  const pvcTableTotalWidth = useMemo(() => pvcDataColumnsWidth, [pvcDataColumnsWidth]);
  const nodeTableTotalWidth = useMemo(() => nodeDataColumnsWidth, [nodeDataColumnsWidth]);

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
          key={toastMessage}
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
      {deployScaleModal && effectiveClusterId && (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 180,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
          onClick={() => {
            if (!deployScaleSaving) setDeployScaleModal(null);
          }}
        >
          <div
            role="dialog"
            aria-modal
            aria-labelledby="deploy-scale-title"
            style={{
              width: 360,
              maxWidth: "90vw",
              padding: 20,
              borderRadius: 10,
              border: "1px solid #334155",
              backgroundColor: "#0f172a",
              boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="deploy-scale-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#e2e8f0" }}>
              调整副本数（{deployScaleModal.resource === "statefulset" ? "StatefulSet" : "Deployment"}）
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
              {deployScaleModal.namespace}/{deployScaleModal.name} · 当前 {deployScaleModal.current}
            </div>
            <input
              type="number"
              min={0}
              step={1}
              value={deployScaleInput}
              onChange={(e) => setDeployScaleInput(e.target.value)}
              disabled={deployScaleSaving}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                backgroundColor: "#020617",
                color: "#e5e7eb",
                fontSize: 14,
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                disabled={deployScaleSaving}
                onClick={() => {
                  if (!deployScaleSaving) setDeployScaleModal(null);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  backgroundColor: "transparent",
                  color: "#94a3b8",
                  cursor: deployScaleSaving ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={deployScaleSaving}
                onClick={() => {
                  const n = parseInt(deployScaleInput, 10);
                  if (Number.isNaN(n) || n < 0) {
                    setToastMessage("请输入非负整数副本数");
                    return;
                  }
                  setDeployScaleSaving(true);
                  const scaleFn =
                    deployScaleModal.resource === "statefulset"
                      ? scaleStatefulSet(
                          effectiveClusterId,
                          deployScaleModal.namespace,
                          deployScaleModal.name,
                          n,
                        )
                      : scaleDeployment(
                          effectiveClusterId,
                          deployScaleModal.namespace,
                          deployScaleModal.name,
                          n,
                        );
                  scaleFn
                    .then((data) => {
                      if (deployScaleModal.resource === "statefulset") {
                        setStatefulsetItems((prev) => mergeDeploymentIntoList(prev, data));
                      } else {
                        setDeploymentItems((prev) => mergeDeploymentIntoList(prev, data));
                      }
                      setDeployScaleModal(null);
                      setToastMessage("副本数已更新");
                      setError(null);
                    })
                    .catch((err: any) => {
                      setToastMessage(err?.response?.data?.error ?? err?.message ?? "扩缩容失败");
                    })
                    .finally(() => setDeployScaleSaving(false));
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: deployScaleSaving ? "#334155" : "#0d9488",
                  color: "#fff",
                  cursor: deployScaleSaving ? "not-allowed" : "pointer",
                  fontSize: 13,
                }}
              >
                {deployScaleSaving ? "提交中…" : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!batchConfirm && !!effectiveClusterId}
        title={
          batchConfirm?.kind === "pods-delete"
            ? `确认删除 ${batchConfirm.keys.length} 个 Pod？`
            : batchConfirm?.kind === "deployments-delete"
              ? `确认删除 ${batchConfirm.keys.length} 个 Deployment？`
              : batchConfirm?.kind === "deployments-restart"
                ? `确认重启 ${batchConfirm.keys.length} 个 Deployment？`
                : ""
        }
        description={
          batchConfirm?.kind === "deployments-restart"
            ? "将触发滚动更新，Pod 会按策略逐步重建。"
            : batchConfirm?.kind === "deployments-delete"
              ? "删除后不可恢复。"
              : undefined
        }
        items={batchConfirm?.keys ?? []}
        variant={batchConfirm?.kind === "deployments-restart" ? "primary" : "danger"}
        busy={batchBusy}
        busyText="执行中…"
        onClose={() => {
          if (!batchBusy) setBatchConfirm(null);
        }}
        onConfirm={confirmBatchAction}
      />
      <ConfirmDialog
        open={!!actionConfirm}
        title={actionConfirm?.title ?? ""}
        description={actionConfirm?.description}
        items={actionConfirm?.items ?? []}
        variant={actionConfirm?.variant ?? "danger"}
        onClose={() => setActionConfirm(null)}
        onConfirm={async () => {
          const ac = actionConfirmRef.current;
          if (!ac) return;
          await ac.onConfirm();
        }}
      />
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
                    // 如果已加载过组合，优先展示现有列表，再后台刷新，避免长时间空白
                    if (clusterCombos.length === 0) {
                      setClusterCombosLoading(true);
                    }
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
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setConfigClusterPickOpen((o) => !o)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid #1f2937",
                          backgroundColor: "#0f172a",
                          color: "#e5e7eb",
                          fontSize: 13,
                          minWidth: 280,
                          maxWidth: 420,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        {(() => {
                          if (!comboClusterId) return "请选择集群";
                          const c = clusters.find((cl) => cl.id === comboClusterId);
                          if (!c) return `集群 id：${comboClusterId}`;
                          const { left, right } = clusterOptionColumns(c);
                          return `${left} · ${right}`;
                        })()}
                      </button>
                      {configClusterPickOpen && (
                        <>
                          <div
                            style={{ position: "fixed", inset: 0, zIndex: 105 }}
                            onClick={() => setConfigClusterPickOpen(false)}
                            aria-hidden
                          />
                          <div
                            style={{
                              ...WL_SEARCHABLE_DROPDOWN_PANEL_STYLE,
                              zIndex: 106,
                              minWidth: 360,
                              maxWidth: "min(92vw, 520px)",
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div style={WL_SEARCHABLE_DROPDOWN_SEARCH_MARGIN_STYLE}>
                              <ClearableSearchInput
                                ref={configClusterSearchRef}
                                value={configClusterSearchKeyword}
                                onChange={setConfigClusterSearchKeyword}
                                placeholder="搜索 kubeconfig 文件名 / 集群名"
                                style={{ width: "100%", boxSizing: "border-box" }}
                                inputStyle={WL_SEARCHABLE_DROPDOWN_INPUT_STYLE}
                              />
                            </div>
                            <div style={WL_SEARCHABLE_DROPDOWN_SCROLL_STYLE}>
                              {clusters.length === 0 && (
                                <div style={{ padding: 12, fontSize: 12, color: "#9ca3af" }}>
                                  暂无集群，请先配置 kubeconfig 目录并刷新。
                                </div>
                              )}
                              {clusters.length > 0 &&
                                configClusterPickFiltered.length === 0 && (
                                  <div style={{ padding: 12, fontSize: 12, color: "#9ca3af" }}>
                                    无匹配的集群，请调整关键字或点击「刷新」更新列表。
                                  </div>
                                )}
                              {configClusterPickFiltered.map((c, idx, arr) => {
                                const { left, right } = clusterOptionColumns(c);
                                return (
                                  <SearchableDropdownTwoColumnRow
                                    key={c.id}
                                    left={left}
                                    right={right}
                                    selected={c.id === comboClusterId}
                                    borderBottom={idx < arr.length - 1}
                                    onClick={() => {
                                      setComboClusterId(c.id);
                                      setConfigClusterPickOpen(false);
                                    }}
                                  />
                                );
                              })}
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

                <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#9ca3af" }}>已添加组合</span>
                  <ClearableSearchInput
                    value={comboSearchKeyword}
                    onChange={setComboSearchKeyword}
                    placeholder="搜索 kubeconfig 文件名 / 命名空间 / 别名 关键字"
                    style={{ minWidth: 220, flex: 1, maxWidth: 420 }}
                    inputStyle={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #1f2937",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 12,
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
                      {clusterCombosLoading && clusterCombos.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ ...tdStyle, textAlign: "center" }}>
                            加载组合中…
                          </td>
                        </tr>
                      )}
                      {clusterCombos
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
              width: 24,
              minWidth: 24,
              height: 64,
              margin: "auto 0",
              border: "none",
              outline: "none",
              backgroundColor: "#020617",
              borderRight: "1px solid #1e293b",
              color: "#e5e7eb",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              borderRadius: 999,
              boxShadow: "0 0 0 1px rgba(15,23,42,0.8)",
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
            {error &&
              !(currentView === "nodes" && nodesPermissionDenied) && (
                <div style={{ color: "#f97373", marginBottom: 8 }}>错误：{error}</div>
              )}
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
                          style={{ ...WL_SEARCHABLE_DROPDOWN_PANEL_STYLE, zIndex: 41 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div style={WL_SEARCHABLE_DROPDOWN_SEARCH_MARGIN_STYLE}>
                            <ClearableSearchInput
                              ref={clusterComboSearchRef}
                              value={clusterSearchKeyword}
                              onChange={setClusterSearchKeyword}
                              placeholder="搜索 kubeconfig 文件名 / 命名空间 / 组合别名关键字"
                              style={{ width: "100%", boxSizing: "border-box" }}
                              inputStyle={WL_SEARCHABLE_DROPDOWN_INPUT_STYLE}
                            />
                          </div>
                          <div style={WL_SEARCHABLE_DROPDOWN_SCROLL_STYLE}>
                            {clusterCombos.length === 0 && (
                              <div style={{ padding: 12, fontSize: 12, color: "#9ca3af" }}>
                                暂未添加组合，请先在右上角“平台配置 · 集群组合设置”中添加。
                              </div>
                            )}
                            {clusterCombos.length > 0 && clusterComboDropdownFiltered.length === 0 && (
                              <div style={{ padding: 12, fontSize: 12, color: "#9ca3af" }}>
                                无匹配组合，请调整关键字。
                              </div>
                            )}
                            {clusterComboDropdownFiltered.map((combo, idx, arr) => {
                              const cluster = clusters.find((c) => c.id === combo.clusterId);
                              const fileName = cluster
                                ? kubeconfigDisplayFileName(cluster.filePath)
                                : `集群未找到：${combo.clusterId}`;
                              const ns = combo.namespace || "所有命名空间";
                              const name = cluster?.name ?? combo.clusterId;
                              const right = combo.alias
                                ? `${combo.alias} · ${name} · ${ns}`
                                : `${name} · ${ns}`;
                              return (
                                <SearchableDropdownTwoColumnRow
                                  key={combo.id}
                                  left={fileName}
                                  right={right}
                                  selected={combo.id === activeComboId}
                                  borderBottom={idx < arr.length - 1}
                                  onClick={() => {
                                    setActiveComboId(combo.id);
                                    setClusterDropdownOpen(false);
                                    setClusterSearchKeyword("");
                                  }}
                                />
                              );
                            })}
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
                      {viewTitle[currentView]}
                      {currentView !== "nodes" && currentView !== "namespaces" && (
                        effectiveNamespace && effectiveNamespace !== ""
                          ? ` · ${effectiveNamespace}`
                          : " · 所有命名空间"
                      )}{" "}
                      /{" "}
                      {currentView === "pods"
                        ? filteredPods.length
                        : currentView === "deployments"
                          ? filteredDeployments.length
                          : currentView === "statefulsets"
                            ? filteredStatefulSets.length
                            : currentView === "ingresses"
                              ? filteredIngresses.length
                              : currentView === "services"
                                ? filteredServices.length
                                : currentView === "persistentvolumeclaims"
                                  ? filteredPvcs.length
                                  : currentView === "nodes"
                                    ? filteredNodes.length
                                    : filteredResourceItems.length}
                    </h3>
                    {(currentView === "pods" ||
                      currentView === "deployments" ||
                      currentView === "statefulsets" ||
                      currentView === "ingresses" ||
                      currentView === "services" ||
                      currentView === "persistentvolumeclaims" ||
                      currentView === "nodes") && (
                      <button
                        type="button"
                        onClick={() => {
                          setToastMessage("正在刷新列表...");
                          if (currentView === "pods") {
                            podsManualRefreshToastRef.current = true;
                            setPodsListSort(null);
                            setSelectedPodKeys(new Set());
                            setPodsListNonce((n) => n + 1);
                          } else if (currentView === "deployments") {
                            deploymentsManualRefreshToastRef.current = true;
                            setDeploymentsListSort(null);
                            setSelectedDeploymentKeys(new Set());
                            setDeploymentsListNonce((n) => n + 1);
                          } else if (currentView === "statefulsets") {
                            statefulsetsManualRefreshToastRef.current = true;
                            setStatefulsetsListSort(null);
                            setStatefulsetsListNonce((n) => n + 1);
                          } else if (currentView === "ingresses") {
                            ingressesManualRefreshToastRef.current = true;
                            setIngressesListSort(null);
                            setIngressesListNonce((n) => n + 1);
                          } else if (currentView === "services") {
                            servicesManualRefreshToastRef.current = true;
                            setServicesListSort(null);
                            setServicesListNonce((n) => n + 1);
                          } else if (currentView === "persistentvolumeclaims") {
                            pvcsManualRefreshToastRef.current = true;
                            setPvcsListSort(null);
                            setPvcsListNonce((n) => n + 1);
                          } else if (currentView === "nodes") {
                            if (effectiveClusterId) {
                              clearResourceAccessDecision(effectiveClusterId, NODES_RESOURCE_KEY);
                            }
                            setNodesAccessDenied(false);
                            setNodesAccessTechnicalSummary(null);
                            nodesManualRefreshToastRef.current = true;
                            setNodesListSort(null);
                            setNodesListNonce((n) => n + 1);
                          }
                        }}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid #334155",
                          backgroundColor: "#1e293b",
                          color: "#e5e7eb",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                        title="仅重新拉取当前列表，不影响另一资源类型的缓存"
                      >
                        刷新列表
                      </button>
                    )}
                    {currentView === "pods" && selectedPodKeys.size > 0 && (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid #334155",
                          backgroundColor: "#1e293b",
                          fontSize: 12,
                          color: "#e2e8f0",
                        }}
                      >
                        <span>
                          已选 {selectedPodKeys.size} 项
                          {podSelectedNotVisibleCount > 0 && (
                            <span style={{ color: "#94a3b8" }}>
                              {" "}
                              （其中 {podSelectedNotVisibleCount} 项当前未显示）
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={!effectiveClusterId}
                          onClick={() =>
                            setBatchConfirm({
                              kind: "pods-delete",
                              keys: [...selectedPodKeys].sort(),
                            })
                          }
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            border: "1px solid #7f1d1d",
                            backgroundColor: "rgba(127,29,29,0.35)",
                            color: "#fecaca",
                            cursor: effectiveClusterId ? "pointer" : "not-allowed",
                            fontSize: 11,
                          }}
                        >
                          删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedPodKeys(new Set())}
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            border: "1px solid #334155",
                            backgroundColor: "transparent",
                            color: "#94a3b8",
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          取消选择
                        </button>
                      </div>
                    )}
                    {currentView === "deployments" && selectedDeploymentKeys.size > 0 && (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid #334155",
                          backgroundColor: "#1e293b",
                          fontSize: 12,
                          color: "#e2e8f0",
                        }}
                      >
                        <span>
                          已选 {selectedDeploymentKeys.size} 项
                          {deploymentSelectedNotVisibleCount > 0 && (
                            <span style={{ color: "#94a3b8" }}>
                              {" "}
                              （其中 {deploymentSelectedNotVisibleCount} 项当前未显示）
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={!effectiveClusterId}
                          onClick={() =>
                            setBatchConfirm({
                              kind: "deployments-delete",
                              keys: [...selectedDeploymentKeys].sort(),
                            })
                          }
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            border: "1px solid #7f1d1d",
                            backgroundColor: "rgba(127,29,29,0.35)",
                            color: "#fecaca",
                            cursor: effectiveClusterId ? "pointer" : "not-allowed",
                            fontSize: 11,
                          }}
                        >
                          删除
                        </button>
                        <button
                          type="button"
                          disabled={!effectiveClusterId}
                          onClick={() =>
                            setBatchConfirm({
                              kind: "deployments-restart",
                              keys: [...selectedDeploymentKeys].sort(),
                            })
                          }
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            border: "1px solid #334155",
                            backgroundColor: "rgba(13,148,136,0.25)",
                            color: "#99f6e4",
                            cursor: effectiveClusterId ? "pointer" : "not-allowed",
                            fontSize: 11,
                          }}
                        >
                          重启
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedDeploymentKeys(new Set())}
                          style={{
                            padding: "3px 10px",
                            borderRadius: 4,
                            border: "1px solid #334155",
                            backgroundColor: "transparent",
                            color: "#94a3b8",
                            cursor: "pointer",
                            fontSize: 11,
                          }}
                        >
                          取消选择
                        </button>
                      </div>
                    )}
                    {applyingSelection && (
                      <span style={{ fontSize: 12, color: "#38bdf8" }}>
                        正在根据新的集群与命名空间加载资源…
                      </span>
                    )}
                    {!applyingSelection &&
                      (currentView === "pods" ||
                        currentView === "deployments" ||
                        currentView === "statefulsets" ||
                        currentView === "ingresses" ||
                        currentView === "services" ||
                        currentView === "persistentvolumeclaims") &&
                      showServerClockSkewHint && (
                        <span
                          title={`本地与服务端时间偏差约 ${Math.abs(serverClockSkewMs)}ms`}
                          style={{
                            fontSize: 12,
                            color: "#fbbf24",
                            marginLeft: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>
                            ⏱
                          </span>
                          本地时间与集群时间存在偏差，Age 已按服务端时间校准
                        </span>
                      )}
                    {!applyingSelection && currentView === "pods" && hasNonHealthyPods && (
                      <span
                        style={{
                          fontSize: 13,
                          color: "#f87171",
                          marginLeft: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textShadow: "0 0 10px rgba(248,113,113,0.2)",
                        }}
                      >
                        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                          ⚠
                        </span>
                        当前范围内存在非“健康”状态的 Pod，可按状态标签排序快速定位。
                      </span>
                    )}
                    {!applyingSelection && currentView === "statefulsets" && hasNonHealthyStatefulSets && (
                      <span
                        style={{
                          fontSize: 13,
                          color: "#f87171",
                          marginLeft: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textShadow: "0 0 10px rgba(248,113,113,0.2)",
                        }}
                      >
                        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                          ⚠
                        </span>
                        当前范围内存在异常 StatefulSet，请重点关注实例健康状态与存储情况。
                      </span>
                    )}
                    {!applyingSelection && currentView === "ingresses" && hasNonHealthyIngresses && (
                      <span
                        style={{
                          fontSize: 13,
                          color: "#f87171",
                          marginLeft: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textShadow: "0 0 10px rgba(248,113,113,0.2)",
                        }}
                      >
                        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                          ⚠
                        </span>
                        当前范围内存在非健康 Ingress，可按「状态」列排序；展开行查看规则与后端，并可跳转 Service / Pods。
                      </span>
                    )}
                    {!applyingSelection && currentView === "persistentvolumeclaims" && hasRiskyPvcs && (
                      <span
                        style={{
                          fontSize: 13,
                          color: "#f87171",
                          marginLeft: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textShadow: "0 0 10px rgba(248,113,113,0.2)",
                        }}
                      >
                        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                          ⚠
                        </span>
                        当前范围内存在未就绪或异常的 PVC，可按「状态」排序后点击 Name 打开 Describe 核对绑定与关联 Pod。
                      </span>
                    )}
                    {!applyingSelection && currentView === "services" && hasRiskyServices && (
                      <span
                        style={{
                          fontSize: 13,
                          color: "#f87171",
                          marginLeft: 12,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textShadow: "0 0 10px rgba(248,113,113,0.2)",
                        }}
                      >
                        <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                          ⚠
                        </span>
                        当前范围内存在警告或严重级 Service，请查看 Endpoints/状态列并展开核对端口与后端。
                      </span>
                    )}
                  </div>
                  <ClearableSearchInput
                    value={nameFilter}
                    onChange={setNameFilter}
                    placeholder={
                      currentView === "ingresses"
                        ? "按 Name / Host 关键字过滤"
                        : currentView === "services"
                          ? "按 Service 名称过滤"
                          : currentView === "persistentvolumeclaims"
                            ? "按 PVC 名称过滤"
                            : currentView === "nodes"
                              ? "按 Node 名称过滤"
                              : "按 Name 关键字过滤"
                    }
                    style={{ minWidth: 160 }}
                    inputStyle={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #1f2937",
                      backgroundColor: "#020617",
                      color: "#e5e7eb",
                      fontSize: 12,
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
                      width: podTableTotalWidth,
                      minWidth: "100%",
                      borderCollapse: "collapse",
                      backgroundColor: "#020617",
                      tableLayout: "fixed",
                    }}
                  >
                    <colgroup>
                      <col style={{ width: LIST_SELECT_COL_WIDTH }} />
                      {POD_COLUMN_KEYS.map((key) => (
                        <col key={key} style={{ width: podColumnWidths[key] ?? POD_COLUMN_DEFAULTS[key] }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          className="wl-table-sticky-head"
                          style={{
                            ...thStyle,
                            ...stickyHeaderThCheckbox,
                            width: LIST_SELECT_COL_WIDTH,
                            maxWidth: LIST_SELECT_COL_WIDTH,
                            minWidth: LIST_SELECT_COL_WIDTH,
                            textAlign: "center",
                            verticalAlign: "middle",
                          }}
                        >
                          <input
                            ref={podTableHeaderSelectRef}
                            type="checkbox"
                            aria-label="全选当前可见 Pod"
                            onChange={() => {
                              const vis = sortedPods.map((p) =>
                                nsNameRowKey(p.metadata.namespace, p.metadata.name),
                              );
                              setSelectedPodKeys((prev) => {
                                const next = new Set(prev);
                                const allOn = vis.length > 0 && vis.every((k) => next.has(k));
                                if (allOn) vis.forEach((k) => next.delete(k));
                                else vis.forEach((k) => next.add(k));
                                return next;
                              });
                            }}
                          />
                        </th>
                        {(
                          ["Name", "Namespace", "Node", "存活时间", "状态标签", "Status", "Restarts", "容器数", "操作"] as const
                        ).map((label, i) => {
                          const key = POD_COLUMN_KEYS[i];
                          const w = podColumnWidths[key] ?? POD_COLUMN_DEFAULTS[key];
                          return (
                            <ResizableTh
                              key={key}
                              label={label}
                              sortTrailing={
                                isPodSortableColumnKey(key) ? (
                                  <ResourceSortArrows
                                    activeDirection={podsListSort?.key === key ? podsListSort.direction : null}
                                    onPickAsc={() => setPodsListSort({ key, direction: "asc" })}
                                    onPickDesc={() => setPodsListSort({ key, direction: "desc" })}
                                  />
                                ) : undefined
                              }
                              width={w}
                              thBase={thStyle}
                              onResizeStart={beginResizePod(key)}
                            />
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="wl-table-body">
                      {sortedPods.map((p) => {
                        const { text: statusText, restarts } = getPodStatusInfo(p);
                        const node = p.spec?.nodeName ?? "-";
                        const age = formatAgeFromMetadata(p.metadata, listAgeNow);
                        if (
                          typeof localStorage !== "undefined" &&
                          localStorage.getItem("weblens_debug_pod_age") === "1"
                        ) {
                          const u = p.metadata.uid;
                          if (u && !loggedPodAgeRowByUid.has(u)) {
                            loggedPodAgeRowByUid.add(u);
                            // eslint-disable-next-line no-console
                            console.debug("[weblens pod row first render]", {
                              name: p.metadata.name,
                              uid: u,
                              eventHint: "pods-table",
                              creationTimestamp: readCreationTimestampFromMetadata(p.metadata),
                              ageLabel: age,
                            });
                          }
                        }
                        const containerCount = getPodContainerNames(p).length;
                        const menuKey = `${p.metadata.namespace}/${p.metadata.name}`;
                        const containers = getPodContainerNames(p);
                        const isMenuOpen = podMenuOpenKey === menuKey;
                        const baseCellStyle: React.CSSProperties = {
                          ...tdStyle,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 0,
                        };
                        const baseCellNoWrap: React.CSSProperties = baseCellStyle;

                        const healthLabel = p.healthLabel || "健康";
                        const reasonsText = (p.healthReasons || []).join("；");
                        const podRowSelectKey = nsNameRowKey(p.metadata.namespace, p.metadata.name);
                          return (
                          <tr
                            key={p.metadata.uid}
                            className={`wl-table-row${
                              podsSortMoveHighlight.has(p.metadata.uid) ? " wl-row-sort-position-changed" : ""
                            }`}
                          >
                            <td
                              style={{ ...tdStyle, width: LIST_SELECT_COL_WIDTH, textAlign: "center" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={selectedPodKeys.has(podRowSelectKey)}
                                aria-label={`选择 Pod ${podRowSelectKey}`}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const on = e.target.checked;
                                  setSelectedPodKeys((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(podRowSelectKey);
                                    else next.delete(podRowSelectKey);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td style={baseCellNoWrap} title={p.metadata.name}>
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
                            <td style={baseCellNoWrap} title={p.metadata.namespace}>{p.metadata.namespace}</td>
                            <td style={baseCellNoWrap} title={node}>{node}</td>
                            <td style={baseCellNoWrap} title={age}>{age}</td>
                            <td style={baseCellNoWrap}>
                              <PodHealthPill label={healthLabel} title={reasonsText || undefined} />
                            </td>
                            <td style={baseCellNoWrap}>
                              <PodListStatusPill text={statusText} />
                            </td>
                            <td style={baseCellNoWrap}>{restarts}</td>
                            <td style={baseCellNoWrap}>{containerCount}</td>
                            <td style={{ ...tdStyle, overflow: "visible" }}>
                              <div style={{ position: "relative" }}>
                                <button
                                  type="button"
                                  className="wl-table-menu-trigger"
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
                                      className="wl-table-dropdown-menu"
                                      style={{
                                        position: "absolute",
                                        right: 0,
                                        top: "100%",
                                        marginTop: 4,
                                        minWidth: 140,
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
                                            setPodMenuOpenKey(null);
                                            setPodMenuSubmenu(null);
                                            if (!effectiveClusterId) return;
                                            const ns = p.metadata.namespace;
                                            const name = p.metadata.name;
                                            setActionConfirm({
                                              title: "确认删除 1 个 Pod？",
                                              description: "删除后 Pod 将终止并从集群移除。",
                                              items: [`${ns}/${name}`],
                                              variant: "danger",
                                              onConfirm: async () => {
                                                try {
                                                  await deletePod(effectiveClusterId, ns, name);
                                                  setError(null);
                                                } catch (err: any) {
                                                  setError(err?.response?.data?.error ?? err?.message ?? "删除失败");
                                                  throw err;
                                                }
                                              },
                                            });
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
              ) : currentView === "deployments" ? (
                <>
                  <table
                    style={{
                      width: deployTableTotalWidth,
                      minWidth: "100%",
                      borderCollapse: "collapse",
                      backgroundColor: "#020617",
                      tableLayout: "fixed",
                    }}
                  >
                    <colgroup>
                      <col style={{ width: LIST_SELECT_COL_WIDTH }} />
                      {DEPLOY_COLUMN_KEYS.map((k) => (
                        <col key={k} style={{ width: deployColumnWidths[k] ?? DEPLOY_COLUMN_DEFAULTS[k] }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th
                          className="wl-table-sticky-head"
                          style={{
                            ...thStyle,
                            ...stickyHeaderThCheckbox,
                            width: LIST_SELECT_COL_WIDTH,
                            maxWidth: LIST_SELECT_COL_WIDTH,
                            minWidth: LIST_SELECT_COL_WIDTH,
                            textAlign: "center",
                            verticalAlign: "middle",
                          }}
                        >
                          <input
                            ref={deployTableHeaderSelectRef}
                            type="checkbox"
                            aria-label="全选当前可见 Deployment"
                            onChange={() => {
                              const vis = sortedDeployments.map((raw) => {
                                const d = raw as DeploymentRow;
                                return nsNameRowKey(d.metadata.namespace ?? "", d.metadata.name);
                              });
                              setSelectedDeploymentKeys((prev) => {
                                const next = new Set(prev);
                                const allOn = vis.length > 0 && vis.every((k) => next.has(k));
                                if (allOn) vis.forEach((k) => next.delete(k));
                                else vis.forEach((k) => next.add(k));
                                return next;
                              });
                            }}
                          />
                        </th>
                        {(
                          [
                            { label: "Name", key: "name" as const },
                            { label: "Namespace", key: "namespace" as const },
                            { label: "Pods", key: "pods" as const },
                            { label: "Replicas", key: "replicas" as const },
                            { label: "存活时间", key: "age" as const },
                            { label: "Conditions", key: "conditions" as const },
                            { label: "操作", key: "actions" as const },
                          ] as const
                        ).map(({ label, key }) => (
                          <ResizableTh
                            key={key}
                            label={label}
                            sortTrailing={
                              isDeploymentSortableColumnKey(key) ? (
                                <ResourceSortArrows
                                  activeDirection={
                                    deploymentsListSort?.key === key ? deploymentsListSort.direction : null
                                  }
                                  onPickAsc={() => setDeploymentsListSort({ key, direction: "asc" })}
                                  onPickDesc={() => setDeploymentsListSort({ key, direction: "desc" })}
                                />
                              ) : undefined
                            }
                            width={deployColumnWidths[key] ?? DEPLOY_COLUMN_DEFAULTS[key]}
                            thBase={thStyle}
                            onResizeStart={beginResizeDeploy(key)}
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody className="wl-table-body">
                      {deploymentLoading && deploymentItems.length === 0 && (
                        <tr className="wl-table-row">
                          <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                            加载中…
                          </td>
                        </tr>
                      )}
                      {!deploymentLoading && sortedDeployments.length === 0 && (
                        <tr className="wl-table-row">
                          <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                            暂无 Deployment
                          </td>
                        </tr>
                      )}
                      {sortedDeployments.map((raw) => {
                        const d = raw as DeploymentRow;
                        const menuKey = `${d.metadata.namespace ?? ""}/${d.metadata.name}`;
                        const deploySortRowId = deploymentTableSortRowId(d);
                        const isMenuOpen = deploymentMenuOpenKey === menuKey;
                        const rowBusy = deploymentRowBusyKey === menuKey;
                        const baseCell: React.CSSProperties = {
                          ...tdStyle,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 0,
                        };
                        const age = formatAgeFromMetadata(d.metadata, listAgeNow);
                        const ns = d.metadata.namespace ?? "";
                        const dname = d.metadata.name;
                        const deployRowSelectKey = nsNameRowKey(ns, dname);
                        return (
                          <tr
                            key={(d.metadata.uid as string) || menuKey}
                            className={`wl-table-row${
                              deploymentsSortMoveHighlight.has(deploySortRowId)
                                ? " wl-row-sort-position-changed"
                                : ""
                            }`}
                          >
                            <td
                              style={{ ...tdStyle, width: LIST_SELECT_COL_WIDTH, textAlign: "center" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={selectedDeploymentKeys.has(deployRowSelectKey)}
                                aria-label={`选择 Deployment ${deployRowSelectKey}`}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const on = e.target.checked;
                                  setSelectedDeploymentKeys((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(deployRowSelectKey);
                                    else next.delete(deployRowSelectKey);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td style={baseCell} title={d.metadata.name}>
                              <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
                                <button
                                  type="button"
                                  onClick={() => openDescribeForDeployment(d)}
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
                                  {d.metadata.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyName(d.metadata.name)}
                                  style={copyNameButtonStyle}
                                  title="复制名称"
                                >
                                  <img
                                    src={copyIcon}
                                    alt="复制"
                                    style={{ height: 14, width: "auto", display: "block" }}
                                  />
                                </button>
                              </span>
                            </td>
                            <td style={baseCell} title={d.metadata.namespace}>
                              {d.metadata.namespace ?? "-"}
                            </td>
                            <td style={baseCell} title={deploymentPodsColumn(d)}>
                              {deploymentPodsColumn(d)}
                            </td>
                            <td style={baseCell} title={deploymentReplicasColumn(d)}>
                              {deploymentReplicasColumn(d)}
                            </td>
                            <td style={baseCell} title={age}>
                              {age}
                            </td>
                            <td style={{ ...tdStyle, overflow: "hidden" }}>
                              <DeploymentConditionsCell d={d} />
                            </td>
                            <td style={{ ...tdStyle, overflow: "visible" }}>
                              <div style={{ position: "relative" }}>
                                <button
                                  type="button"
                                  className="wl-table-menu-trigger"
                                  disabled={rowBusy || !effectiveClusterId}
                                  onClick={() =>
                                    setDeploymentMenuOpenKey((k) => (k === menuKey ? null : menuKey))
                                  }
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: "50%",
                                    cursor: rowBusy ? "not-allowed" : "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 16,
                                    lineHeight: 1,
                                    opacity: rowBusy ? 0.5 : 1,
                                  }}
                                  title="操作"
                                >
                                  ⋮
                                </button>
                                {isMenuOpen && (
                                  <>
                                    <div
                                      style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                      onClick={() => setDeploymentMenuOpenKey(null)}
                                      aria-hidden
                                    />
                                    <div
                                      className="wl-table-dropdown-menu"
                                      style={{
                                        position: "absolute",
                                        right: 0,
                                        top: "100%",
                                        marginTop: 4,
                                        minWidth: 160,
                                        zIndex: 41,
                                        padding: "4px 0",
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        className="wl-menu-item"
                                        style={menuItemStyleForDropdown}
                                        disabled={rowBusy}
                                        onClick={() => {
                                          setDeploymentMenuOpenKey(null);
                                          setDeployScaleInput(String(d.spec?.replicas ?? 0));
                                          setDeployScaleModal({
                                            namespace: ns,
                                            name: dname,
                                            current: d.spec?.replicas ?? 0,
                                            resource: "deployment",
                                          });
                                        }}
                                      >
                                        <span style={{ marginRight: 8 }}>⇅</span> Scale
                                      </button>
                                      <button
                                        type="button"
                                        className="wl-menu-item"
                                        style={menuItemStyleForDropdown}
                                        disabled={rowBusy || !effectiveClusterId}
                                        onClick={() => {
                                          setDeploymentMenuOpenKey(null);
                                          if (!effectiveClusterId) return;
                                          setActionConfirm({
                                            title: "确认重启 1 个 Deployment？",
                                            description: "将触发滚动更新，Pod 会按策略逐步重建。",
                                            items: [`${ns}/${dname}`],
                                            variant: "primary",
                                            onConfirm: async () => {
                                              setDeploymentRowBusyKey(menuKey);
                                              try {
                                                const data = await restartDeployment(effectiveClusterId, ns, dname);
                                                setDeploymentItems((prev) => mergeDeploymentIntoList(prev, data));
                                                setToastMessage("已触发重启");
                                                setError(null);
                                              } catch (err: any) {
                                                setToastMessage(
                                                  err?.response?.data?.error ?? err?.message ?? "重启失败",
                                                );
                                                throw err;
                                              } finally {
                                                setDeploymentRowBusyKey(null);
                                              }
                                            },
                                          });
                                        }}
                                      >
                                        <span style={{ marginRight: 8 }}>↻</span> Restart
                                      </button>
                                      <button
                                        type="button"
                                        className="wl-menu-item"
                                        style={menuItemStyleForDropdown}
                                        disabled={rowBusy}
                                        onClick={() => openEditDeploymentTab(d)}
                                      >
                                        <span style={{ marginRight: 8 }}>✎</span> Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="wl-menu-item wl-menu-item-danger"
                                        style={menuItemStyleForDropdown}
                                        disabled={rowBusy || !effectiveClusterId}
                                        onClick={() => {
                                          setDeploymentMenuOpenKey(null);
                                          if (!effectiveClusterId) return;
                                          setActionConfirm({
                                            title: "确认删除 1 个 Deployment？",
                                            description: "删除后不可恢复。",
                                            items: [`${ns}/${dname}`],
                                            variant: "danger",
                                            onConfirm: async () => {
                                              setDeploymentRowBusyKey(menuKey);
                                              try {
                                                await deleteDeployment(effectiveClusterId, ns, dname);
                                                setDeploymentItems((prev) =>
                                                  prev.filter(
                                                    (it) =>
                                                      !(
                                                        it.metadata?.name === dname &&
                                                        (it.metadata?.namespace ?? "") === ns
                                                      ),
                                                  ),
                                                );
                                                setToastMessage("已删除 Deployment");
                                                setError(null);
                                              } catch (err: any) {
                                                setToastMessage(
                                                  err?.response?.data?.error ?? err?.message ?? "删除失败",
                                                );
                                                throw err;
                                              } finally {
                                                setDeploymentRowBusyKey(null);
                                              }
                                            },
                                          });
                                        }}
                                      >
                                        <span style={{ marginRight: 8 }}>🗑</span> Delete
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
                </>
              ) : currentView === "statefulsets" ? (
                <>
                  <table
                    style={{
                      width: stsTableTotalWidth,
                      minWidth: "100%",
                      borderCollapse: "collapse",
                      backgroundColor: "#020617",
                      tableLayout: "fixed",
                    }}
                  >
                    <colgroup>
                      {STS_COLUMN_KEYS.map((k) => (
                        <col key={k} style={{ width: stsColumnWidths[k] ?? STS_COLUMN_DEFAULTS[k] }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {(
                          [
                            { label: "Name", key: "name" as const },
                            { label: "Namespace", key: "namespace" as const },
                            { label: "Pods", key: "pods" as const },
                            { label: "Ready", key: "ready" as const },
                            { label: "Ordinals", key: "ordinals" as const },
                            { label: "存活时间", key: "age" as const },
                            { label: "状态标签", key: "health" as const },
                            { label: "操作", key: "actions" as const },
                          ] as const
                        ).map(({ label, key }) => (
                          <ResizableTh
                            key={key}
                            label={label}
                            sortTrailing={
                              isStatefulSetSortableColumnKey(key) ? (
                                <ResourceSortArrows
                                  activeDirection={
                                    statefulsetsListSort?.key === key ? statefulsetsListSort.direction : null
                                  }
                                  onPickAsc={() => setStatefulsetsListSort({ key, direction: "asc" })}
                                  onPickDesc={() => setStatefulsetsListSort({ key, direction: "desc" })}
                                />
                              ) : undefined
                            }
                            width={stsColumnWidths[key] ?? STS_COLUMN_DEFAULTS[key]}
                            thBase={thStyle}
                            onResizeStart={beginResizeSts(key)}
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody className="wl-table-body">
                      {statefulsetLoading && statefulsetItems.length === 0 && (
                        <tr className="wl-table-row">
                          <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                            加载中…
                          </td>
                        </tr>
                      )}
                      {!statefulsetLoading && sortedStatefulSets.length === 0 && (
                        <tr className="wl-table-row">
                          <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                            暂无 StatefulSet
                          </td>
                        </tr>
                      )}
                      {sortedStatefulSets.map((raw) => {
                        const s = raw as StatefulSetRow;
                        const menuKey = `${s.metadata.namespace ?? ""}/${s.metadata.name}`;
                        const isMenuOpen = statefulsetMenuOpenKey === menuKey;
                        const rowBusy = statefulsetRowBusyKey === menuKey;
                        const owned =
                          statefulsetStsStatsByKey.get(menuKey)?.owned ??
                          podsOwnedByStatefulSet(pods, s.metadata.name, s.metadata.namespace ?? "");
                        const baseCell: React.CSSProperties = {
                          ...tdStyle,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 0,
                        };
                        const age = formatAgeFromMetadata(s.metadata, listAgeNow);
                        const ns = s.metadata.namespace ?? "";
                        const sname = s.metadata.name;
                        const expanded = expandedStatefulSetKeys.has(menuKey);
                        const podCount =
                          typeof s.status?.replicas === "number" ? s.status.replicas : owned.length;
                        const desired = s.spec?.replicas ?? 0;
                        const readyN = s.status?.readyReplicas ?? 0;
                        const readyStr = `${readyN}/${desired}`;
                        const ordinalNums = owned
                          .map((p) => ordinalFromStsPodName(sname, p.metadata.name))
                          .filter((x): x is number => x != null);
                        const ordinalsStr = formatOrdinalSummary(ordinalNums);
                        const stsHealthLabel = aggregatePodHealthLabel(owned);
                        const stsReasonsText = owned
                          .flatMap((p) => (p.healthReasons || []).map((r) => `${p.metadata.name}: ${r}`))
                          .join("；");
                        let stsHealthBg = "rgba(22,163,74,0.15)";
                        let stsHealthBorder = "rgba(22,163,74,0.6)";
                        let stsHealthColor = "#bbf7d0";
                        if (stsHealthLabel === "关注") {
                          stsHealthBg = "rgba(202,138,4,0.18)";
                          stsHealthBorder = "rgba(234,179,8,0.7)";
                          stsHealthColor = "#facc15";
                        } else if (stsHealthLabel === "警告") {
                          stsHealthBg = "rgba(249,115,22,0.2)";
                          stsHealthBorder = "rgba(249,115,22,0.75)";
                          stsHealthColor = "#fed7aa";
                        } else if (stsHealthLabel === "严重") {
                          stsHealthBg = "rgba(185,28,28,0.25)";
                          stsHealthBorder = "rgba(248,113,113,0.85)";
                          stsHealthColor = "#fecaca";
                        }
                        const childPodsSorted = sortStsPodsTroubleshootFirst(owned, sname);
                        const primaryAbnormalPod = findSmallestOrdinalAbnormalPod(owned, sname);
                        const stsExpandSummary = stsTroubleshootSummaryLine(owned, sname);
                        return (
                          <Fragment key={(s.metadata.uid as string) || menuKey}>
                            <tr
                              className="wl-table-row"
                              onClick={() => {
                                setExpandedStatefulSetKeys((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(menuKey)) n.delete(menuKey);
                                  else n.add(menuKey);
                                  return n;
                                });
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <td style={baseCell} title={s.metadata.name}>
                                <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedStatefulSetKeys((prev) => {
                                        const n = new Set(prev);
                                        if (n.has(menuKey)) n.delete(menuKey);
                                        else n.add(menuKey);
                                        return n;
                                      });
                                    }}
                                    style={{
                                      marginRight: 4,
                                      padding: "0 4px",
                                      border: "none",
                                      background: "none",
                                      color: "#94a3b8",
                                      cursor: "pointer",
                                      flexShrink: 0,
                                      fontSize: 12,
                                    }}
                                    title={expanded ? "收起实例" : "展开实例"}
                                    aria-expanded={expanded}
                                  >
                                    {expanded ? "▾" : "▸"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDescribeForStatefulSet(s);
                                    }}
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
                                      minWidth: 0,
                                    }}
                                  >
                                    {s.metadata.name}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyName(s.metadata.name);
                                    }}
                                    style={copyNameButtonStyle}
                                    title="复制名称"
                                  >
                                    <img
                                      src={copyIcon}
                                      alt="复制"
                                      style={{ height: 14, width: "auto", display: "block" }}
                                    />
                                  </button>
                                </span>
                              </td>
                              <td style={baseCell} title={s.metadata.namespace}>
                                {s.metadata.namespace ?? "-"}
                              </td>
                              <td style={baseCell} title={String(podCount)}>
                                {podCount}
                              </td>
                              <td style={baseCell} title={readyStr}>
                                {readyStr}
                              </td>
                              <td style={baseCell} title={ordinalsStr}>
                                {ordinalsStr}
                              </td>
                              <td style={baseCell} title={age}>
                                {age}
                              </td>
                              <td style={baseCell} onClick={(e) => e.stopPropagation()}>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    backgroundColor: stsHealthBg,
                                    border: `1px solid ${stsHealthBorder}`,
                                    color: stsHealthColor,
                                    fontSize: 11,
                                    maxWidth: "100%",
                                    boxSizing: "border-box",
                                    cursor: stsReasonsText ? "default" : "inherit",
                                  }}
                                  title={stsReasonsText || undefined}
                                >
                                  {stsHealthLabel}
                                </span>
                              </td>
                              <td style={{ ...tdStyle, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                                <div style={{ position: "relative" }}>
                                  <button
                                    type="button"
                                    className="wl-table-menu-trigger"
                                    disabled={rowBusy || !effectiveClusterId}
                                    onClick={() =>
                                      setStatefulsetMenuOpenKey((k) => (k === menuKey ? null : menuKey))
                                    }
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: "50%",
                                      cursor: rowBusy ? "not-allowed" : "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 16,
                                      lineHeight: 1,
                                      opacity: rowBusy ? 0.5 : 1,
                                    }}
                                    title="操作"
                                  >
                                    ⋮
                                  </button>
                                  {isMenuOpen && (
                                    <>
                                      <div
                                        style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                        onClick={() => setStatefulsetMenuOpenKey(null)}
                                        aria-hidden
                                      />
                                      <div
                                        className="wl-table-dropdown-menu"
                                        style={{
                                          position: "absolute",
                                          right: 0,
                                          top: "100%",
                                          marginTop: 4,
                                          minWidth: 160,
                                          zIndex: 41,
                                          padding: "4px 0",
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          className="wl-menu-item"
                                          style={menuItemStyleForDropdown}
                                          disabled={rowBusy}
                                          onClick={() => {
                                            setStatefulsetMenuOpenKey(null);
                                            setDeployScaleInput(String(s.spec?.replicas ?? 0));
                                            setDeployScaleModal({
                                              namespace: ns,
                                              name: sname,
                                              current: s.spec?.replicas ?? 0,
                                              resource: "statefulset",
                                            });
                                          }}
                                        >
                                          <span style={{ marginRight: 8 }}>⇅</span> Scale
                                        </button>
                                        <button
                                          type="button"
                                          className="wl-menu-item"
                                          style={menuItemStyleForDropdown}
                                          disabled={rowBusy || !effectiveClusterId}
                                          onClick={() => {
                                            setStatefulsetMenuOpenKey(null);
                                            if (!effectiveClusterId) return;
                                            setActionConfirm({
                                              title: "确认重启 1 个 StatefulSet？",
                                              description: "将按策略滚动更新 Pod。",
                                              items: [`${ns}/${sname}`],
                                              variant: "primary",
                                              onConfirm: async () => {
                                                setStatefulsetRowBusyKey(menuKey);
                                                try {
                                                  const data = await restartStatefulSet(
                                                    effectiveClusterId,
                                                    ns,
                                                    sname,
                                                  );
                                                  setStatefulsetItems((prev) =>
                                                    mergeDeploymentIntoList(prev, data),
                                                  );
                                                  setToastMessage("已触发重启");
                                                  setError(null);
                                                } catch (err: any) {
                                                  setToastMessage(
                                                    err?.response?.data?.error ?? err?.message ?? "重启失败",
                                                  );
                                                  throw err;
                                                } finally {
                                                  setStatefulsetRowBusyKey(null);
                                                }
                                              },
                                            });
                                          }}
                                        >
                                          <span style={{ marginRight: 8 }}>↻</span> Restart
                                        </button>
                                        <button
                                          type="button"
                                          className="wl-menu-item"
                                          style={menuItemStyleForDropdown}
                                          disabled={rowBusy}
                                          onClick={() => openEditStatefulSetTab(s)}
                                        >
                                          <span style={{ marginRight: 8 }}>✎</span> Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="wl-menu-item wl-menu-item-danger"
                                          style={menuItemStyleForDropdown}
                                          disabled={rowBusy || !effectiveClusterId}
                                          onClick={() => {
                                            setStatefulsetMenuOpenKey(null);
                                            if (!effectiveClusterId) return;
                                            setActionConfirm({
                                              title: "确认删除 1 个 StatefulSet？",
                                              description: "删除后不可恢复。",
                                              items: [`${ns}/${sname}`],
                                              variant: "danger",
                                              onConfirm: async () => {
                                                setStatefulsetRowBusyKey(menuKey);
                                                try {
                                                  await deleteStatefulSet(effectiveClusterId, ns, sname);
                                                  setStatefulsetItems((prev) =>
                                                    prev.filter(
                                                      (it) =>
                                                        !(
                                                          it.metadata?.name === sname &&
                                                          (it.metadata?.namespace ?? "") === ns
                                                        ),
                                                    ),
                                                  );
                                                  setToastMessage("已删除 StatefulSet");
                                                  setError(null);
                                                } catch (err: any) {
                                                  setToastMessage(
                                                    err?.response?.data?.error ?? err?.message ?? "删除失败",
                                                  );
                                                  throw err;
                                                } finally {
                                                  setStatefulsetRowBusyKey(null);
                                                }
                                              },
                                            });
                                          }}
                                        >
                                          <span style={{ marginRight: 8 }}>🗑</span> Delete
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="wl-table-row">
                                <td
                                  colSpan={8}
                                  style={{
                                    ...tdStyle,
                                    padding: "8px 12px 12px",
                                    backgroundColor: "#0f172a",
                                    cursor: "default",
                                    borderBottom: "1px solid #111827",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      marginBottom: 8,
                                      fontWeight: 600,
                                    }}
                                  >
                                    实例列表（异常优先）
                                  </div>
                                  {stsExpandSummary && (
                                    <div
                                      style={{
                                        marginBottom: 10,
                                        padding: "8px 10px",
                                        borderRadius: 6,
                                        border: "1px solid rgba(234,179,8,0.35)",
                                        backgroundColor: "rgba(234,179,8,0.08)",
                                        fontSize: 12,
                                        color: "#e2e8f0",
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      <div>{stsExpandSummary}</div>
                                      <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
                                        Ordinal 顺序提示：建议先核对较小序号实例；下表已将异常实例置顶并按严重度排序。
                                      </div>
                                    </div>
                                  )}
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      backgroundColor: "#020617",
                                      tableLayout: "fixed",
                                    }}
                                  >
                                    <thead>
                                      <tr style={{ color: "#9ca3af", fontSize: 12, textAlign: "left" }}>
                                        <th style={{ ...thStyle, width: "7%" }}>Ordinal</th>
                                        <th style={{ ...thStyle, width: "18%" }}>Pod Name</th>
                                        <th style={{ ...thStyle, width: "10%" }}>状态标签</th>
                                        <th style={{ ...thStyle, width: "8%" }}>Ready</th>
                                        <th style={{ ...thStyle, width: "7%" }}>Restarts</th>
                                        <th style={{ ...thStyle, width: "14%" }}>PVC</th>
                                        <th style={{ ...thStyle, width: "14%" }}>Node</th>
                                        <th style={{ ...thStyle, width: "22%" }}>操作</th>
                                      </tr>
                                    </thead>
                                    <tbody className="wl-table-body">
                                      {childPodsSorted.length === 0 ? (
                                        <tr>
                                          <td colSpan={8} style={{ ...tdStyle, color: "#64748b" }}>
                                            暂无关联 Pod（等待 Pods 列表同步或副本为 0）
                                          </td>
                                        </tr>
                                      ) : (
                                        childPodsSorted.map((p) => {
                                          const ord = ordinalFromStsPodName(sname, p.metadata.name);
                                          const { restarts } = getPodStatusInfo(p);
                                          const highRestart = isHighRestartInStsGroup(
                                            p,
                                            childPodsSorted,
                                            (pp) => getPodStatusInfo(pp).restarts,
                                          );
                                          const pvcNames = podPersistentVolumeClaimNames(p);
                                          const pvcTitle = pvcNames.length ? pvcNames.join(", ") : "—";
                                          const abnormalRow = isPodHealthAbnormal(p);
                                          const isPrimaryAbnormal =
                                            !!primaryAbnormalPod && p.metadata.uid === primaryAbnormalPod.metadata.uid;
                                          const pMenuKey = `${p.metadata.namespace}/${p.metadata.name}`;
                                          const pContainers = getPodContainerNames(p);
                                          const pMenuOpen = podMenuOpenKey === pMenuKey;
                                          const hl = p.healthLabel || "健康";
                                          const reasonsText = (p.healthReasons || []).join("；");
                                          let hBg = "rgba(22,163,74,0.15)";
                                          let hBr = "rgba(22,163,74,0.6)";
                                          let hCol = "#bbf7d0";
                                          if (hl === "关注") {
                                            hBg = "rgba(202,138,4,0.18)";
                                            hBr = "rgba(234,179,8,0.7)";
                                            hCol = "#facc15";
                                          } else if (hl === "警告") {
                                            hBg = "rgba(249,115,22,0.2)";
                                            hBr = "rgba(249,115,22,0.75)";
                                            hCol = "#fed7aa";
                                          } else if (hl === "严重") {
                                            hBg = "rgba(185,28,28,0.25)";
                                            hBr = "rgba(248,113,113,0.85)";
                                            hCol = "#fecaca";
                                          }
                                          const rowShell: React.CSSProperties = {
                                            backgroundColor: abnormalRow ? "rgba(248,113,113,0.06)" : undefined,
                                            boxShadow: isPrimaryAbnormal
                                              ? "inset 3px 0 0 rgba(250,204,21,0.9)"
                                              : abnormalRow
                                                ? "inset 3px 0 0 rgba(249,115,22,0.45)"
                                                : undefined,
                                          };
                                          return (
                                            <tr key={p.metadata.uid} className="wl-table-row" style={rowShell}>
                                              <td style={tdStyle}>
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                                  <span>{ord ?? "—"}</span>
                                                  {isPrimaryAbnormal && (
                                                    <span
                                                      style={{
                                                        fontSize: 9,
                                                        fontWeight: 700,
                                                        padding: "1px 5px",
                                                        borderRadius: 4,
                                                        backgroundColor: "rgba(234,179,8,0.2)",
                                                        border: "1px solid rgba(250,204,21,0.55)",
                                                        color: "#facc15",
                                                        flexShrink: 0,
                                                      }}
                                                      title="ordinal 最小的异常实例"
                                                    >
                                                      优先检查
                                                    </span>
                                                  )}
                                                </span>
                                              </td>
                                              <td style={{ ...tdStyle, overflow: "hidden" }}>
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                                  <button
                                                    type="button"
                                                    onClick={() => openDescribeForPod(p)}
                                                    style={{
                                                      padding: 0,
                                                      border: "none",
                                                      background: "none",
                                                      color: "#e5e7eb",
                                                      cursor: "pointer",
                                                      textAlign: "left",
                                                      overflow: "hidden",
                                                      textOverflow: "ellipsis",
                                                      whiteSpace: "nowrap",
                                                    }}
                                                    title={p.metadata.name}
                                                  >
                                                    {p.metadata.name}
                                                  </button>
                                                  {ord != null && (
                                                    <span
                                                      style={{
                                                        fontSize: 10,
                                                        color: "#64748b",
                                                        flexShrink: 0,
                                                      }}
                                                    >
                                                      #{ord}
                                                    </span>
                                                  )}
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
                                              <td style={tdStyle}>
                                                <span
                                                  style={{
                                                    display: "inline-flex",
                                                    padding: "2px 8px",
                                                    borderRadius: 999,
                                                    backgroundColor: hBg,
                                                    border: `1px solid ${hBr}`,
                                                    color: hCol,
                                                    fontSize: 11,
                                                  }}
                                                  title={reasonsText || undefined}
                                                >
                                                  {hl}
                                                </span>
                                              </td>
                                              <td style={tdStyle}>{podReadyColumn(p)}</td>
                                              <td
                                                style={{
                                                  ...tdStyle,
                                                  color: highRestart ? "#fb923c" : undefined,
                                                  fontWeight: highRestart ? 600 : undefined,
                                                }}
                                                title={highRestart ? "本组内重启偏高，建议结合日志排查" : undefined}
                                              >
                                                {restarts}
                                              </td>
                                              <td
                                                style={{
                                                  ...tdStyle,
                                                  overflow: "hidden",
                                                  textOverflow: "ellipsis",
                                                  whiteSpace: "nowrap",
                                                }}
                                                title={pvcTitle}
                                              >
                                                {pvcNames.length ? pvcNames.join(", ") : "—"}
                                              </td>
                                              <td
                                                style={{ ...tdStyle, overflow: "hidden", textOverflow: "ellipsis" }}
                                                title={p.spec?.nodeName ?? "-"}
                                              >
                                                {p.spec?.nodeName ?? "-"}
                                              </td>
                                              <td style={{ ...tdStyle, overflow: "visible" }}>
                                                <div style={{ position: "relative" }}>
                                                  <button
                                                    type="button"
                                                    className="wl-table-menu-trigger"
                                                    onClick={() =>
                                                      setPodMenuOpenKey((k) =>
                                                        k === pMenuKey ? null : pMenuKey,
                                                      )
                                                    }
                                                    style={{
                                                      width: 28,
                                                      height: 28,
                                                      borderRadius: "50%",
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
                                                  {pMenuOpen && (
                                                    <>
                                                      <div
                                                        style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                                        onClick={() => {
                                                          setPodMenuOpenKey(null);
                                                          setPodMenuSubmenu(null);
                                                        }}
                                                        aria-hidden
                                                      />
                                                      <div
                                                        className="wl-table-dropdown-menu"
                                                        style={{
                                                          position: "absolute",
                                                          right: 0,
                                                          top: "100%",
                                                          marginTop: 4,
                                                          minWidth: 140,
                                                          zIndex: 41,
                                                          padding: "4px 0",
                                                          display: "flex",
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        <div
                                                          style={{
                                                            padding: "4px 0",
                                                            borderRight: podMenuSubmenu ? "1px solid #334155" : undefined,
                                                          }}
                                                        >
                                                          <button
                                                            type="button"
                                                            onClick={() =>
                                                              setPodMenuSubmenu((sub) =>
                                                                sub === "shell" ? null : "shell",
                                                              )
                                                            }
                                                            className={`wl-menu-item${podMenuSubmenu === "shell" ? " is-active" : ""}`}
                                                            style={{
                                                              ...menuItemStyleForDropdown,
                                                              display: "flex",
                                                              alignItems: "center",
                                                              justifyContent: "space-between",
                                                              width: "100%",
                                                            }}
                                                          >
                                                            <span>
                                                              <span style={{ marginRight: 8 }}>⌘</span> Shell
                                                            </span>
                                                            <span style={{ fontSize: 10 }}>▸</span>
                                                          </button>
                                                          <button
                                                            type="button"
                                                            onClick={() =>
                                                              setPodMenuSubmenu((sub) =>
                                                                sub === "logs" ? null : "logs",
                                                              )
                                                            }
                                                            className={`wl-menu-item${podMenuSubmenu === "logs" ? " is-active" : ""}`}
                                                            style={{
                                                              ...menuItemStyleForDropdown,
                                                              display: "flex",
                                                              alignItems: "center",
                                                              justifyContent: "space-between",
                                                              width: "100%",
                                                            }}
                                                          >
                                                            <span>
                                                              <span style={{ marginRight: 8 }}>≡</span> Logs
                                                            </span>
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
                                                              setPodMenuOpenKey(null);
                                                              setPodMenuSubmenu(null);
                                                              if (!effectiveClusterId) return;
                                                              const ns0 = p.metadata.namespace;
                                                              const name0 = p.metadata.name;
                                                              setActionConfirm({
                                                                title: "确认删除 1 个 Pod？",
                                                                description: "删除后 Pod 将终止并从集群移除。",
                                                                items: [`${ns0}/${name0}`],
                                                                variant: "danger",
                                                                onConfirm: async () => {
                                                                  try {
                                                                    await deletePod(
                                                                      effectiveClusterId,
                                                                      ns0,
                                                                      name0,
                                                                    );
                                                                    setError(null);
                                                                  } catch (err: any) {
                                                                    setError(
                                                                      err?.response?.data?.error ??
                                                                        err?.message ??
                                                                        "删除失败",
                                                                    );
                                                                    throw err;
                                                                  }
                                                                },
                                                              });
                                                            }}
                                                            className="wl-menu-item wl-menu-item-danger"
                                                            style={menuItemStyleForDropdown}
                                                          >
                                                            <span style={{ marginRight: 8 }}>🗑</span> Delete
                                                          </button>
                                                        </div>
                                                        {podMenuSubmenu && (
                                                          <div style={{ minWidth: 100, padding: "4px 0" }}>
                                                            {pContainers.map((c) => (
                                                              <button
                                                                key={c}
                                                                type="button"
                                                                onClick={() =>
                                                                  openPanelTab(podMenuSubmenu, p, c)
                                                                }
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
                                        })
                                      )}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              ) : currentView === "ingresses" ? (
                <>
                  <table
                    style={{
                      width: ingressTableTotalWidth,
                      minWidth: "100%",
                      borderCollapse: "collapse",
                      backgroundColor: "#020617",
                      tableLayout: "fixed",
                    }}
                  >
                    <colgroup>
                      {INGRESS_COLUMN_KEYS.map((k) => (
                        <col
                          key={k}
                          style={{
                            width: ingressColumnWidths[k] ?? INGRESS_COLUMN_DEFAULTS[k],
                          }}
                        />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {INGRESS_COLUMN_KEYS.map((k) => {
                          const sk = INGRESS_COLUMN_SORT[k];
                          return (
                            <ResizableTh
                              key={k}
                              label={INGRESS_COLUMN_LABELS[k]}
                              sortTrailing={
                                sk != null && isIngressSortableColumnKey(sk) ? (
                                  <ResourceSortArrows
                                    activeDirection={
                                      ingressesListSort?.key === sk ? ingressesListSort.direction : null
                                    }
                                    onPickAsc={() => setIngressesListSort({ key: sk, direction: "asc" })}
                                    onPickDesc={() => setIngressesListSort({ key: sk, direction: "desc" })}
                                  />
                                ) : undefined
                              }
                              width={ingressColumnWidths[k] ?? INGRESS_COLUMN_DEFAULTS[k]}
                              thBase={thStyle}
                              onResizeStart={beginResizeIngress(k)}
                            />
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="wl-table-body">
                      {ingressLoading && ingressItems.length === 0 && (
                        <tr className="wl-table-row">
                          <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                            加载中…
                          </td>
                        </tr>
                      )}
                      {!ingressLoading && sortedIngresses.length === 0 && (
                        <tr className="wl-table-row">
                          <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                            暂无 Ingress
                          </td>
                        </tr>
                      )}
                      {sortedIngresses.map((raw) => {
                        const ing = raw as IngressRow;
                        const menuKey = `${ing.metadata.namespace ?? ""}/${ing.metadata.name}`;
                        const expanded = expandedIngressKeys.has(menuKey);
                        const isMenuOpen = ingressMenuOpenKey === menuKey;
                        const rowBusy = ingressRowBusyKey === menuKey;
                        const summ = deriveIngressListSummary(ing);
                        const diag =
                          ingressTroubleshootByKey.get(menuKey) ??
                          buildIngressTroubleshoot(ing, ingressAuxServices, pods);
                        const expandRows = diag.ruleRows;
                        const baseCell: React.CSSProperties = {
                          ...tdStyle,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 0,
                        };
                        const age = formatAgeFromMetadata(ing.metadata, listAgeNow);
                        const ns = ing.metadata.namespace ?? "";
                        const iname = ing.metadata.name;
                        return (
                          <Fragment key={(ing.metadata.uid as string) || menuKey}>
                            <tr
                              className="wl-table-row"
                              onClick={() => {
                                setExpandedIngressKeys((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(menuKey)) n.delete(menuKey);
                                  else n.add(menuKey);
                                  return n;
                                });
                              }}
                              style={{ cursor: "pointer" }}
                            >
                              <td style={baseCell} title={iname}>
                                <span style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedIngressKeys((prev) => {
                                        const n = new Set(prev);
                                        if (n.has(menuKey)) n.delete(menuKey);
                                        else n.add(menuKey);
                                        return n;
                                      });
                                    }}
                                    style={{
                                      marginRight: 4,
                                      padding: "0 4px",
                                      border: "none",
                                      background: "none",
                                      color: "#94a3b8",
                                      cursor: "pointer",
                                      flexShrink: 0,
                                      fontSize: 12,
                                    }}
                                    title={expanded ? "收起规则" : "展开规则"}
                                    aria-expanded={expanded}
                                  >
                                    {expanded ? "▾" : "▸"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openDescribeForIngress(ing);
                                    }}
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
                                      minWidth: 0,
                                    }}
                                  >
                                    {iname}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyName(iname);
                                    }}
                                    style={copyNameButtonStyle}
                                    title="复制名称"
                                  >
                                    <img
                                      src={copyIcon}
                                      alt="复制"
                                      style={{ height: 14, width: "auto", display: "block" }}
                                    />
                                  </button>
                                </span>
                              </td>
                              <td style={baseCell} title={ns}>
                                {ns || "—"}
                              </td>
                              <td style={baseCell} title={summ.hostsLabel}>
                                {summ.hostsLabel}
                              </td>
                              <td style={baseCell} title={String(summ.pathCount)}>
                                {summ.pathCount}
                              </td>
                              <td style={baseCell} title={`${diag.backendServiceCount} 个 backend Service`}>
                                {diag.backendServiceCount}
                              </td>
                              <td style={baseCell} onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const hl = diag.label;
                                  let ingHealthBg = "rgba(22,163,74,0.15)";
                                  let ingHealthBorder = "rgba(22,163,74,0.6)";
                                  let ingHealthColor = "#bbf7d0";
                                  if (hl === "关注") {
                                    ingHealthBg = "rgba(202,138,4,0.18)";
                                    ingHealthBorder = "rgba(234,179,8,0.7)";
                                    ingHealthColor = "#facc15";
                                  } else if (hl === "警告") {
                                    ingHealthBg = "rgba(249,115,22,0.2)";
                                    ingHealthBorder = "rgba(249,115,22,0.75)";
                                    ingHealthColor = "#fed7aa";
                                  } else if (hl === "严重") {
                                    ingHealthBg = "rgba(185,28,28,0.25)";
                                    ingHealthBorder = "rgba(248,113,113,0.85)";
                                    ingHealthColor = "#fecaca";
                                  }
                                  return (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        padding: "2px 8px",
                                        borderRadius: 999,
                                        backgroundColor: ingHealthBg,
                                        border: `1px solid ${ingHealthBorder}`,
                                        color: ingHealthColor,
                                        fontSize: 11,
                                        maxWidth: "100%",
                                        boxSizing: "border-box",
                                      }}
                                      title={diag.summary}
                                    >
                                      {hl}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td
                                style={{
                                  ...baseCell,
                                  whiteSpace: "normal",
                                  maxWidth: 0,
                                  lineHeight: 1.35,
                                  fontSize: 12,
                                  color: diag.label === "健康" ? "#64748b" : "#e2e8f0",
                                }}
                                title={diag.summary}
                              >
                                {diag.label === "健康" ? "正常" : diag.summary}
                              </td>
                              <td style={baseCell} title={age}>
                                {age}
                              </td>
                              <td style={{ ...tdStyle, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                                <div style={{ position: "relative" }}>
                                  <button
                                    type="button"
                                    className="wl-table-menu-trigger"
                                    disabled={rowBusy || !effectiveClusterId}
                                    onClick={() => setIngressMenuOpenKey((k) => (k === menuKey ? null : menuKey))}
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: "50%",
                                      cursor: rowBusy ? "not-allowed" : "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 16,
                                      lineHeight: 1,
                                      opacity: rowBusy ? 0.5 : 1,
                                    }}
                                    title="操作"
                                  >
                                    ⋮
                                  </button>
                                  {isMenuOpen && (
                                    <>
                                      <div
                                        style={{ position: "fixed", inset: 0, zIndex: 40 }}
                                        onClick={() => setIngressMenuOpenKey(null)}
                                        aria-hidden
                                      />
                                      <div
                                        className="wl-table-dropdown-menu"
                                        style={{
                                          position: "absolute",
                                          right: 0,
                                          top: "100%",
                                          marginTop: 4,
                                          minWidth: 160,
                                          zIndex: 41,
                                          padding: "4px 0",
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          className="wl-menu-item"
                                          style={menuItemStyleForDropdown}
                                          disabled={rowBusy}
                                          onClick={() => openEditIngressTab(ing)}
                                        >
                                          <span style={{ marginRight: 8 }}>✎</span> Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="wl-menu-item wl-menu-item-danger"
                                          style={menuItemStyleForDropdown}
                                          disabled={rowBusy || !effectiveClusterId}
                                          onClick={() => {
                                            setIngressMenuOpenKey(null);
                                            if (!effectiveClusterId) return;
                                            setActionConfirm({
                                              title: "确认删除 1 个 Ingress？",
                                              description: "删除后不可恢复。",
                                              items: [`${ns}/${iname}`],
                                              variant: "danger",
                                              onConfirm: async () => {
                                                setIngressRowBusyKey(menuKey);
                                                try {
                                                  await deleteIngress(effectiveClusterId, ns, iname);
                                                  setIngressItems((prev) =>
                                                    prev.filter(
                                                      (it) =>
                                                        !(
                                                          it.metadata?.name === iname &&
                                                          (it.metadata?.namespace ?? "") === ns
                                                        ),
                                                    ),
                                                  );
                                                  setToastMessage("已删除 Ingress");
                                                  setError(null);
                                                } catch (err: any) {
                                                  setToastMessage(
                                                    err?.response?.data?.error ?? err?.message ?? "删除失败",
                                                  );
                                                  throw err;
                                                } finally {
                                                  setIngressRowBusyKey(null);
                                                }
                                              },
                                            });
                                          }}
                                        >
                                          <span style={{ marginRight: 8 }}>🗑</span> Delete
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="wl-table-row">
                                <td
                                  colSpan={9}
                                  style={{
                                    ...tdStyle,
                                    padding: "8px 12px 12px",
                                    backgroundColor: "#0f172a",
                                    cursor: "default",
                                    borderBottom: "1px solid #111827",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: "#94a3b8",
                                      marginBottom: 8,
                                      fontWeight: 600,
                                    }}
                                  >
                                    规则排障（异常优先；TLS Secret 存在性未校验）
                                  </div>
                                  {expandRows.length === 0 ? (
                                    <div style={{ fontSize: 12, color: "#64748b" }}>无规则行（无 path 且无 default backend）</div>
                                  ) : (
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      backgroundColor: "#020617",
                                      tableLayout: "fixed",
                                    }}
                                  >
                                    <thead>
                                      <tr>
                                        {[
                                          "Host",
                                          "Path",
                                          "Path Type",
                                          "Backend Service",
                                          "Port",
                                          "TLS",
                                          "状态",
                                          "异常说明",
                                          "联动",
                                        ].map((h) => (
                                          <th
                                            key={h}
                                            style={{
                                              textAlign: "left",
                                              padding: "6px 8px",
                                              borderBottom: "1px solid #1f2937",
                                              fontSize: 11,
                                              color: "#94a3b8",
                                            }}
                                          >
                                            {h}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandRows.map((r, ri) => {
                                        const rowShell: React.CSSProperties =
                                          r.severityRank >= 3
                                            ? { backgroundColor: "rgba(185,28,28,0.08)" }
                                            : r.severityRank >= 2
                                              ? { backgroundColor: "rgba(249,115,22,0.06)" }
                                              : {};
                                        const canLinkSvc =
                                          r.serviceName &&
                                          r.serviceName !== "—" &&
                                          r.status !== "Service 不存在";
                                        return (
                                          <tr key={ri} className="wl-table-row" style={rowShell}>
                                            <td
                                              style={{
                                                ...tdStyle,
                                                fontSize: 12,
                                                wordBreak: "break-word",
                                                whiteSpace: "normal",
                                              }}
                                            >
                                              {r.host}
                                            </td>
                                            <td
                                              style={{
                                                ...tdStyle,
                                                fontSize: 12,
                                                wordBreak: "break-all",
                                                whiteSpace: "normal",
                                              }}
                                            >
                                              {r.path}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: 12 }}>{r.pathType}</td>
                                            <td
                                              style={{
                                                ...tdStyle,
                                                fontSize: 12,
                                                wordBreak: "break-word",
                                                whiteSpace: "normal",
                                              }}
                                            >
                                              {r.serviceName && r.serviceName !== "—" ? (
                                                <ResourceNameWithCopy
                                                  name={r.serviceName}
                                                  onCopy={copyName}
                                                  fontSize={12}
                                                />
                                              ) : (
                                                r.serviceName ?? "—"
                                              )}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: 12 }}>{r.portDisplay}</td>
                                            <td style={{ ...tdStyle, fontSize: 12 }}>{r.tlsHint}</td>
                                            <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600 }}>
                                              {r.status}
                                            </td>
                                            <td
                                              style={{
                                                ...tdStyle,
                                                fontSize: 11,
                                                color: "#94a3b8",
                                                whiteSpace: "normal",
                                                wordBreak: "break-word",
                                              }}
                                            >
                                              {r.detail}
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: 11 }}>
                                              {canLinkSvc ? (
                                                <div
                                                  style={{
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: 4,
                                                    alignItems: "flex-start",
                                                  }}
                                                >
                                                  <ResourceJumpChip
                                                    label="Services"
                                                    compact
                                                    onClick={() => jumpIngressToServices(r.serviceName)}
                                                    title="打开 Services 列表并过滤此名称"
                                                  />
                                                  <ResourceJumpChip
                                                    label="Pods"
                                                    compact
                                                    onClick={() => jumpIngressToPods(r.serviceName)}
                                                    title="打开 Pods 列表并过滤此名称"
                                                  />
                                                </div>
                                              ) : (
                                                "—"
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              ) : currentView === "services" ? (
                <>
                  <ServicesListTable
                    sortedRows={sortedServices}
                    serviceLoading={serviceLoading}
                    listSort={servicesListSort}
                    setListSort={setServicesListSort}
                    columnWidths={serviceColumnWidths}
                    beginResize={beginResizeService}
                    totalWidth={serviceTableTotalWidth}
                    expandedKeys={expandedServiceKeys}
                    setExpandedKeys={setExpandedServiceKeys}
                    endpointsByKey={serviceEndpointsByKey}
                    pods={pods}
                    listAgeNow={listAgeNow}
                    effectiveClusterId={effectiveClusterId}
                    menuOpenKey={serviceMenuOpenKey}
                    setMenuOpenKey={setServiceMenuOpenKey}
                    rowBusyKey={serviceRowBusyKey}
                    setRowBusyKey={setServiceRowBusyKey}
                    openDescribe={openDescribeForService}
                    openEditTab={openEditServiceTab}
                    jumpToPods={jumpServiceToPods}
                    copyName={copyName}
                    setActionConfirm={setActionConfirm}
                    onDeletedOne={(ns, name) => {
                      setServiceItems((prev) =>
                        prev.filter(
                          (it) => !((it.metadata?.namespace ?? "") === ns && it.metadata?.name === name),
                        ),
                      );
                    }}
                    setToastMessage={setToastMessage}
                    setError={setError}
                    deleteServiceApi={deleteService}
                  />
                </>
              ) : currentView === "persistentvolumeclaims" ? (
                <>
                  <PVCListTable
                    sortedRows={sortedPvcs as PvcListRow[]}
                    pvcLoading={pvcLoading}
                    listSort={pvcsListSort}
                    setListSort={setPvcsListSort}
                    columnWidths={pvcColumnWidths}
                    beginResize={beginResizePvc}
                    totalWidth={pvcTableTotalWidth}
                    pods={pods}
                    listAgeNow={listAgeNow}
                    effectiveClusterId={effectiveClusterId}
                    menuOpenKey={pvcMenuOpenKey}
                    setMenuOpenKey={setPvcMenuOpenKey}
                    rowBusyKey={pvcRowBusyKey}
                    setRowBusyKey={setPvcRowBusyKey}
                    openDescribe={openDescribeForPvc}
                    openEditTab={openEditPvcTab}
                    copyName={copyName}
                    setActionConfirm={setActionConfirm}
                    onDeletedOne={(ns, name) => {
                      setPvcItems((prev) =>
                        prev.filter(
                          (it) => !((it.metadata?.namespace ?? "") === ns && it.metadata?.name === name),
                        ),
                      );
                    }}
                    setToastMessage={setToastMessage}
                    setError={setError}
                    deletePvcApi={deletePvc}
                  />
                </>
              ) : currentView === "nodes" ? (
                <>
                  {nodesPermissionDenied ? (
                    <ResourceAccessDeniedState
                      resourceLabel="Nodes"
                      title="当前身份无权查看 Nodes"
                      description={
                        <>
                          <p style={{ margin: "0 0 10px" }}>
                            当前集群身份没有查看 Nodes（集群级资源）的权限。
                          </p>
                          <p style={{ margin: "0 0 10px" }}>
                            如需使用此功能，请联系集群管理员为当前 kubeconfig
                            授予相应的只读权限（例如对 <code style={{ color: "#cbd5e1" }}>nodes</code>{" "}
                            资源的 list/get/watch）。
                          </p>
                          <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                            Nodes 属于集群级资源，通常需要额外的 RBAC 配置。
                          </p>
                        </>
                      }
                      technicalSummary={nodesAccessTechnicalSummary ?? undefined}
                    />
                  ) : (
                    <NodesListTable
                      sortedRows={sortedNodes as NodeListRow[]}
                      nodesLoading={nodeLoading}
                      listSort={nodesListSort}
                      setListSort={setNodesListSort}
                      columnWidths={nodeColumnWidths}
                      beginResize={beginResizeNode}
                      totalWidth={nodeTableTotalWidth}
                      pods={pods}
                      listAgeNow={listAgeNow}
                      effectiveClusterId={effectiveClusterId}
                      menuOpenKey={nodeMenuOpenKey}
                      setMenuOpenKey={setNodeMenuOpenKey}
                      rowBusyKey={nodeRowBusyKey}
                      setRowBusyKey={setNodeRowBusyKey}
                      openDescribe={openDescribeForNode}
                      openEditTab={openEditNodeTab}
                      copyName={copyName}
                    />
                  )}
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
        onEditSaved={(tab, result) => {
          if (tab.yamlKind === "deployment" && result) {
            setDeploymentItems((prev) => mergeDeploymentIntoList(prev, result));
          }
          if (tab.yamlKind === "statefulset" && result) {
            setStatefulsetItems((prev) => mergeDeploymentIntoList(prev, result));
          }
          if (tab.yamlKind === "ingress" && result) {
            setIngressItems((prev) => mergeDeploymentIntoList(prev, result));
          }
          if (tab.yamlKind === "service" && result) {
            setServiceItems((prev) => mergeDeploymentIntoList(prev, result));
          }
          if (tab.yamlKind === "pvc" && result) {
            setPvcItems((prev) => mergeDeploymentIntoList(prev, result));
          }
          if (tab.yamlKind === "node" && result) {
            setNodeItems((prev) => mergeDeploymentIntoList(prev, result));
          }
        }}
      />

      {/* Describe 右侧弹层（Pod / Deployment 共用容器） */}
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

            {/* 标题栏 */}
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
                  {describeTarget.kind === "deployment"
                    ? "Deployment"
                    : describeTarget.kind === "statefulset"
                      ? "StatefulSet"
                      : describeTarget.kind === "ingress"
                        ? "Ingress"
                        : describeTarget.kind === "service"
                          ? "Service"
                          : describeTarget.kind === "pvc"
                            ? "PersistentVolumeClaim"
                            : describeTarget.kind === "node"
                              ? "Node"
                              : "Pod"}
                  :{" "}
                  {describeTarget.kind === "node"
                    ? describeTarget.name
                    : `${describeTarget.namespace}/${describeTarget.name}`}
                </span>
                {describeError && (
                  <span style={{ fontSize: 12, color: "#f97373", marginTop: 2 }}>错误：{describeError}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    copyName(
                      describeTarget.kind === "node"
                        ? describeTarget.name
                        : `${describeTarget.namespace}/${describeTarget.name}`,
                    )
                  }
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #334155",
                    backgroundColor: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  title={
                    describeTarget.kind === "node" ? "复制节点名称" : "复制 Namespace/资源名称"
                  }
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
              {!describeLoading && describeTarget.kind === "pod" && describePodData && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <section>
                    <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>基本信息</h4>
                    <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.6 }}>
                      <div>Namespace：{describePodData.pod.metadata.namespace}</div>
                      <div>Name：{describePodData.pod.metadata.name}</div>
                      <div>
                        Node：{describePodData.pod.spec?.nodeName ?? "-"}
                        {describePodData.pod.status?.hostIP ? ` (${describePodData.pod.status.hostIP})` : ""}
                      </div>
                      <div>Pod IP：{describePodData.pod.status?.podIP ?? "-"}</div>
                      <div>Phase：{describePodData.pod.status?.phase ?? "-"}</div>
                    </div>
                  </section>

                  {(describePodData.pod.metadata.labels || describePodData.pod.metadata.annotations) && (
                    <section>
                      <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>Labels & Annotations</h4>
                      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, lineHeight: 1.6 }}>
                        {describePodData.pod.metadata.labels && (
                          <div>
                            <div style={{ marginBottom: 4, color: "#9ca3af" }}>Labels</div>
                            {Object.entries(describePodData.pod.metadata.labels).map(([k, v]) => (
                              <div key={k}>
                                <span style={{ color: "#9ca3af" }}>{k}</span>: {v}
                              </div>
                            ))}
                          </div>
                        )}
                        {describePodData.pod.metadata.annotations && (
                          <div>
                            <div style={{ marginBottom: 4, color: "#9ca3af" }}>Annotations</div>
                            {Object.entries(describePodData.pod.metadata.annotations).map(([k, v]) => (
                              <div key={k}>
                                <span style={{ color: "#9ca3af" }}>{k}</span>: {v}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {describePodData.pod.spec?.containers && describePodData.pod.spec.containers.length > 0 && (
                    <section>
                      <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#e5e7eb" }}>Containers</h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                        {describePodData.pod.spec.containers.map((c) => (
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

                  <DescribeEventsSection events={describePodData.events ?? []} />
                </div>
              )}
              {!describeLoading && describeTarget.kind === "deployment" && describeDeploymentData && (
                <DeploymentDescribeContent
                  view={describeDeploymentData.view}
                  events={describeDeploymentData.events ?? []}
                  ageLabel={formatAgeFromMetadata(
                    { creationTimestamp: describeDeploymentData.view.creationTimestamp },
                    listAgeNow,
                  )}
                />
              )}
              {!describeLoading && describeTarget.kind === "statefulset" && describeStatefulSetData && (
                <StatefulSetDescribeContent
                  view={describeStatefulSetData.view}
                  events={describeStatefulSetData.events ?? []}
                  ageLabel={formatAgeFromMetadata(
                    { creationTimestamp: describeStatefulSetData.view.creationTimestamp },
                    listAgeNow,
                  )}
                  childPods={describeStsChildPods}
                  stsName={describeTarget.name}
                />
              )}
              {!describeLoading && describeTarget.kind === "ingress" && (
                <IngressDescribeContent
                  view={describeIngressData?.view}
                  events={describeIngressData?.events ?? []}
                  ageLabel={formatAgeFromMetadata(
                    { creationTimestamp: describeIngressData?.view?.creationTimestamp },
                    listAgeNow,
                  )}
                  troubleshoot={ingressDescribeTroubleshoot}
                  onJumpServices={jumpIngressToServices}
                  onJumpPods={jumpIngressToPods}
                  onCopyName={copyName}
                />
              )}
              {!describeLoading && describeTarget.kind === "service" && (
                <ServiceDescribeContent
                  view={describeServiceData?.view}
                  events={describeServiceData?.events ?? []}
                  ageLabel={formatAgeFromMetadata(
                    { creationTimestamp: describeServiceData?.view?.creationTimestamp },
                    listAgeNow,
                  )}
                  onJumpPods={jumpServiceToPods}
                  onJumpIngress={jumpServiceToIngress}
                  onCopyName={copyName}
                />
              )}
              {!describeLoading && describeTarget.kind === "pvc" && (
                <PvcDescribeContent
                  view={describePvcData?.view}
                  events={describePvcData?.events ?? []}
                  ageLabel={formatAgeFromMetadata(
                    { creationTimestamp: describePvcData?.view?.creationTimestamp },
                    listAgeNow,
                  )}
                  pods={pods}
                  onCopyName={copyName}
                  onJumpPods={jumpServiceToPods}
                />
              )}
              {!describeLoading && describeTarget.kind === "node" && (
                <NodeDescribeContent
                  view={describeNodeData?.view}
                  events={describeNodeData?.events ?? []}
                  ageLabel={formatAgeFromMetadata(
                    { creationTimestamp: describeNodeData?.view?.creationTimestamp },
                    listAgeNow,
                  )}
                  pods={pods}
                />
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
