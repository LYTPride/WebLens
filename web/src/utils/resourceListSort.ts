import type { Pod } from "../api";
import { getPodContainerNames } from "../api";
import { creationTimestampToAgeSeconds } from "./k8sCreationTimestamp";
import { aggregatePodHealthLabel } from "./statefulsetPods";

const HEALTH_RANK: Record<string, number> = {
  健康: 0,
  关注: 1,
  警告: 2,
  严重: 3,
};

export type SortDirection = "asc" | "desc";

export type ResourceListSortState<K extends string = string> =
  | {
      key: K;
      direction: SortDirection;
    }
  | null;

/** Pods 表可排序列（不含 Status、操作） */
export const POD_SORT_KEYS = ["name", "namespace", "node", "age", "health", "restarts", "containers"] as const;
export type PodSortKey = (typeof POD_SORT_KEYS)[number];

export function isPodSortableColumnKey(key: string): key is PodSortKey {
  return (POD_SORT_KEYS as readonly string[]).includes(key);
}

/** Deployments 表可排序列（不含 Conditions、操作） */
export const DEPLOYMENT_SORT_KEYS = ["name", "namespace", "pods", "replicas", "age"] as const;
export type DeploymentSortKey = (typeof DEPLOYMENT_SORT_KEYS)[number];

export function isDeploymentSortableColumnKey(key: string): key is DeploymentSortKey {
  return (DEPLOYMENT_SORT_KEYS as readonly string[]).includes(key);
}

/** StatefulSets 表可排序列 */
export const STATEFULSET_SORT_KEYS = ["name", "namespace", "pods", "ready", "age", "health"] as const;
export type StatefulSetSortKey = (typeof STATEFULSET_SORT_KEYS)[number];

export function isStatefulSetSortableColumnKey(key: string): key is StatefulSetSortKey {
  return (STATEFULSET_SORT_KEYS as readonly string[]).includes(key);
}

/** Ingress 表可排序列 */
export const INGRESS_SORT_KEYS = ["name", "hosts", "paths", "backends", "health", "age"] as const;
export type IngressSortKey = (typeof INGRESS_SORT_KEYS)[number];

export function isIngressSortableColumnKey(key: string): key is IngressSortKey {
  return (INGRESS_SORT_KEYS as readonly string[]).includes(key);
}

/** Services 表可排序列 */
export const SERVICE_SORT_KEYS = ["name", "namespace", "type", "endpoints", "health", "age"] as const;
export type ServiceSortKey = (typeof SERVICE_SORT_KEYS)[number];

export function isServiceSortableColumnKey(key: string): key is ServiceSortKey {
  return (SERVICE_SORT_KEYS as readonly string[]).includes(key);
}

/** PVC 表可排序列 */
export const PVC_SORT_KEYS = [
  "name",
  "namespace",
  "status",
  "volume",
  "capacity",
  "storageClass",
  "usedBy",
  "age",
] as const;
export type PvcSortKey = (typeof PVC_SORT_KEYS)[number];

export function isPvcSortableColumnKey(key: string): key is PvcSortKey {
  return (PVC_SORT_KEYS as readonly string[]).includes(key);
}

export type PvcSortRow = {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
};

export type PvcSortStats = {
  statusRank: number;
  volume: string;
  capacity: string;
  storageClass: string;
  usedByCount: number;
};

export function comparePvcsForSort(
  a: PvcSortRow,
  b: PvcSortRow,
  key: PvcSortKey,
  getStats: (row: PvcSortRow) => PvcSortStats,
  nowMs: number = Date.now(),
): number {
  const sa = getStats(a);
  const sb = getStats(b);
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "namespace":
      return (a.metadata.namespace || "").localeCompare(b.metadata.namespace || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "status":
      return sa.statusRank - sb.statusRank;
    case "volume":
      return sa.volume.localeCompare(sb.volume, undefined, { sensitivity: "base", numeric: true });
    case "capacity":
      return sa.capacity.localeCompare(sb.capacity, undefined, { sensitivity: "base", numeric: true });
    case "storageClass":
      return sa.storageClass.localeCompare(sb.storageClass, undefined, { sensitivity: "base", numeric: true });
    case "usedBy":
      return sa.usedByCount - sb.usedByCount;
    case "age": {
      const tsa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const tsb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (tsa === null && tsb === null) return 0;
      if (tsa === null) return 1;
      if (tsb === null) return -1;
      return tsa - tsb;
    }
    default:
      return 0;
  }
}

/** Nodes 表可排序列 */
export const NODE_SORT_KEYS = [
  "name",
  "status",
  "roles",
  "version",
  "internalIP",
  "pods",
  "cpuMemory",
  "age",
] as const;
export type NodeSortKey = (typeof NODE_SORT_KEYS)[number];

export function isNodeSortableColumnKey(key: string): key is NodeSortKey {
  return (NODE_SORT_KEYS as readonly string[]).includes(key);
}

export type NodeSortRow = {
  metadata: { name: string; creationTimestamp?: string };
};

export type NodeSortStats = {
  statusRank: number;
  roles: string;
  version: string;
  internalIP: string;
  podsCount: number;
  cpuMemory: string;
};

export function compareNodesForSort(
  a: NodeSortRow,
  b: NodeSortRow,
  key: NodeSortKey,
  getStats: (row: NodeSortRow) => NodeSortStats,
  nowMs: number = Date.now(),
): number {
  const sa = getStats(a);
  const sb = getStats(b);
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "status":
      return sa.statusRank - sb.statusRank;
    case "roles":
      return sa.roles.localeCompare(sb.roles, undefined, { sensitivity: "base", numeric: true });
    case "version":
      return sa.version.localeCompare(sb.version, undefined, { sensitivity: "base", numeric: true });
    case "internalIP":
      return sa.internalIP.localeCompare(sb.internalIP, undefined, { sensitivity: "base", numeric: true });
    case "pods":
      return sa.podsCount - sb.podsCount;
    case "cpuMemory":
      return sa.cpuMemory.localeCompare(sb.cpuMemory, undefined, { sensitivity: "base", numeric: true });
    case "age": {
      const tsa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const tsb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (tsa === null && tsb === null) return 0;
      if (tsa === null) return 1;
      if (tsb === null) return -1;
      return tsa - tsb;
    }
    default:
      return 0;
  }
}

export type ServiceSortRow = {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: { type?: string };
};

export type ServiceSortStats = {
  type: string;
  endpointTotal: number;
  /** 严重=3 警告=2 特殊=1 健康=0，供列表排序 */
  healthRank: number;
};

export function compareServicesForSort(
  a: ServiceSortRow,
  b: ServiceSortRow,
  key: ServiceSortKey,
  getStats: (row: ServiceSortRow) => ServiceSortStats,
  nowMs: number = Date.now(),
): number {
  const sa = getStats(a);
  const sb = getStats(b);
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "namespace":
      return (a.metadata.namespace || "").localeCompare(b.metadata.namespace || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "type":
      return sa.type.localeCompare(sb.type, undefined, { sensitivity: "base", numeric: true });
    case "endpoints":
      return sa.endpointTotal - sb.endpointTotal;
    case "health":
      return sa.healthRank - sb.healthRank;
    case "age": {
      const tsa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const tsb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (tsa === null && tsb === null) return 0;
      if (tsa === null) return 1;
      if (tsb === null) return -1;
      return tsa - tsb;
    }
    default:
      return 0;
  }
}

export type IngressSortRow = {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
};

export type IngressSortStats = {
  hostCount: number;
  pathCount: number;
  backendCount: number;
  /** 0=健康 … 3=严重，与 ingressTroubleshoot healthRank 一致 */
  healthRank: number;
};

/** 由调用方对每行提供 stats（从 raw Ingress + 排障模型派生） */
export function compareIngressesForSort(
  a: IngressSortRow,
  b: IngressSortRow,
  key: IngressSortKey,
  getStats: (row: IngressSortRow) => IngressSortStats,
  nowMs: number = Date.now(),
): number {
  const sa = getStats(a);
  const sb = getStats(b);
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "hosts":
      return sa.hostCount - sb.hostCount;
    case "paths":
      return sa.pathCount - sb.pathCount;
    case "backends":
      return sa.backendCount - sb.backendCount;
    case "health":
      return sa.healthRank - sb.healthRank;
    case "age": {
      const tsa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const tsb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (tsa === null && tsb === null) return 0;
      if (tsa === null) return 1;
      if (tsb === null) return -1;
      return tsa - tsb;
    }
    default:
      return 0;
  }
}

export type StatefulSetSortRow = {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: { replicas?: number };
  status?: { replicas?: number; readyReplicas?: number; currentReplicas?: number };
};

export type StatefulSetSortStats = {
  podCount: number;
  /** 0=健康 … 3=严重 */
  healthRank: number;
};

function stsReadyTuple(row: StatefulSetSortRow): [number, number] {
  const desired = typeof row.spec?.replicas === "number" ? row.spec.replicas : 0;
  const ready = typeof row.status?.readyReplicas === "number" ? row.status.readyReplicas : 0;
  return [ready, desired];
}

/** 由调用方对每行提供 stats（含 pod 数、聚合健康 rank） */
export function compareStatefulSetsForSort(
  a: StatefulSetSortRow,
  b: StatefulSetSortRow,
  key: StatefulSetSortKey,
  getStats: (row: StatefulSetSortRow) => StatefulSetSortStats,
  nowMs: number = Date.now(),
): number {
  const sa = getStats(a);
  const sb = getStats(b);
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "namespace":
      return (a.metadata.namespace || "").localeCompare(b.metadata.namespace || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "pods":
      return sa.podCount - sb.podCount;
    case "ready": {
      const [ra, da] = stsReadyTuple(a);
      const [rb, db] = stsReadyTuple(b);
      if (ra !== rb) return ra - rb;
      return da - db;
    }
    case "age": {
      const tsa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const tsb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (tsa === null && tsb === null) return 0;
      if (tsa === null) return 1;
      if (tsb === null) return -1;
      return tsa - tsb;
    }
    case "health":
      return sa.healthRank - sb.healthRank;
    default:
      return 0;
  }
}

/** 与列表「Restarts」列一致：仅统计工作容器 restartCount */
function podTableRestarts(pod: Pod): number {
  const containerStatuses = pod.status?.containerStatuses || [];
  return (
    containerStatuses.reduce((s, cs) => s + (typeof cs.restartCount === "number" ? cs.restartCount : 0), 0) || 0
  );
}

function podHealthRank(pod: Pod): number {
  const label = pod.healthLabel || "健康";
  return HEALTH_RANK[label] ?? 0;
}

/**
 * 升序语义下的比较（direction 在 sortByState 中统一翻转）。
 * null 值（如无创建时间）排在末尾，保证稳定。
 */
export function comparePodsForSort(a: Pod, b: Pod, key: PodSortKey, nowMs: number = Date.now()): number {
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "namespace":
      return (a.metadata.namespace || "").localeCompare(b.metadata.namespace || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "node":
      return (a.spec?.nodeName || "").localeCompare(b.spec?.nodeName || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "age": {
      const sa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const sb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa - sb;
    }
    case "health": {
      const ra = podHealthRank(a);
      const rb = podHealthRank(b);
      if (ra !== rb) return ra - rb;
      const sca = typeof a.healthScore === "number" ? a.healthScore : null;
      const scb = typeof b.healthScore === "number" ? b.healthScore : null;
      if (sca !== null && scb !== null && sca !== scb) return scb - sca;
      if (sca !== null && scb === null) return -1;
      if (sca === null && scb !== null) return 1;
      return 0;
    }
    case "restarts":
      return podTableRestarts(a) - podTableRestarts(b);
    case "containers":
      return getPodContainerNames(a).length - getPodContainerNames(b).length;
    default:
      return 0;
  }
}

/** Deployment 排序用最小行形状（与列表数据兼容） */
export type DeploymentSortRow = {
  metadata: { name: string; namespace?: string; creationTimestamp?: string };
  spec?: { replicas?: number };
  status?: { replicas?: number; readyReplicas?: number };
};

function deployReadyDesired(row: DeploymentSortRow): [number, number] {
  const desired = typeof row.spec?.replicas === "number" ? row.spec.replicas : 0;
  const ready = typeof row.status?.readyReplicas === "number" ? row.status.readyReplicas : 0;
  return [ready, desired];
}

function deployCurrentDesired(row: DeploymentSortRow): [number, number] {
  const desired = typeof row.spec?.replicas === "number" ? row.spec.replicas : 0;
  const current = typeof row.status?.replicas === "number" ? row.status.replicas : 0;
  return [current, desired];
}

/** 构建 StatefulSet 排序用 stats（依赖当前 Pods 缓存） */
export function buildStatefulSetSortStats(row: StatefulSetSortRow, ownedPods: Pod[]): StatefulSetSortStats {
  void row;
  const label = aggregatePodHealthLabel(ownedPods);
  const healthRank = HEALTH_RANK[label] ?? 0;
  return { podCount: ownedPods.length, healthRank };
}

export function compareDeploymentsForSort(
  a: DeploymentSortRow,
  b: DeploymentSortRow,
  key: DeploymentSortKey,
  nowMs: number = Date.now(),
): number {
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "namespace":
      return (a.metadata.namespace || "").localeCompare(b.metadata.namespace || "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "pods": {
      const [ra, da] = deployReadyDesired(a);
      const [rb, db] = deployReadyDesired(b);
      if (ra !== rb) return ra - rb;
      return da - db;
    }
    case "replicas": {
      const [ca, da] = deployCurrentDesired(a);
      const [cb, db] = deployCurrentDesired(b);
      if (da !== db) return da - db;
      return ca - cb;
    }
    case "age": {
      const sa = creationTimestampToAgeSeconds(a.metadata, nowMs);
      const sb = creationTimestampToAgeSeconds(b.metadata, nowMs);
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sa - sb;
    }
    default:
      return 0;
  }
}

/**
 * 在已有筛选结果上应用单列排序；无排序状态时保持原数组顺序（引用不变）。
 */
export function sortByState<T, K extends string>(
  items: T[],
  state: ResourceListSortState<K> | null,
  compareAsc: (a: T, b: T, key: K) => number,
): T[] {
  if (!state) return items;
  const dir = state.direction === "asc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((A, B) => {
      const raw = compareAsc(A.item, B.item, state.key);
      const c = raw * dir;
      if (c !== 0) return c;
      return A.index - B.index;
    })
    .map(({ item }) => item);
}
