/**
 * Nodes 列表：从 raw Node 对象派生 Status / Roles / 容量摘要等；Pod 数依赖同集群 Pods 缓存。
 */

import type { Pod } from "../api";

export type NodeListRow = {
  metadata?: { name?: string; uid?: string; creationTimestamp?: string; labels?: Record<string, string> };
  spec?: { unschedulable?: boolean; taints?: { key?: string; value?: string; effect?: string }[] };
  status?: {
    conditions?: { type?: string; status?: string }[];
    addresses?: { type?: string; address?: string }[];
    nodeInfo?: { kubeletVersion?: string };
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
  [k: string]: unknown;
};

export type NodeStatusPill = "ready" | "warn" | "danger" | "neutral";

export function deriveNodeStatusSummary(row: NodeListRow): {
  display: string;
  pill: NodeStatusPill;
  sortRank: number;
} {
  if (row.spec?.unschedulable === true) {
    return { display: "SchedulingDisabled", pill: "warn", sortRank: 1 };
  }
  const conditions = row.status?.conditions ?? [];
  const ready = conditions.find((c) => c.type === "Ready");
  if (!ready) {
    return { display: "Unknown", pill: "neutral", sortRank: 2 };
  }
  if (ready.status === "True") {
    return { display: "Ready", pill: "ready", sortRank: 0 };
  }
  return { display: "NotReady", pill: "danger", sortRank: 3 };
}

export function formatNodeRoles(row: NodeListRow): string {
  const labels = row.metadata?.labels;
  if (!labels) return "worker";
  const roles: string[] = [];
  if (Object.prototype.hasOwnProperty.call(labels, "node-role.kubernetes.io/control-plane")) {
    roles.push("control-plane");
  }
  if (Object.prototype.hasOwnProperty.call(labels, "node-role.kubernetes.io/master")) {
    roles.push("master");
  }
  const kr = labels["kubernetes.io/role"];
  if (kr && kr !== "worker") {
    roles.push(kr);
  } else if (kr === "worker" && roles.length === 0) {
    roles.push("worker");
  }
  if (roles.length === 0) return "worker";
  return [...new Set(roles)].join(", ");
}

export function formatNodeKubeletVersion(row: NodeListRow): string {
  const v = row.status?.nodeInfo?.kubeletVersion;
  if (v != null && v !== "") return v;
  return "—";
}

export function formatNodeInternalIP(row: NodeListRow): string {
  const addrs = row.status?.addresses;
  if (!Array.isArray(addrs)) return "—";
  const ip = addrs.find((a) => a.type === "InternalIP");
  return ip?.address != null && ip.address !== "" ? ip.address : "—";
}

export function formatNodeCpuMemoryCapacity(row: NodeListRow): string {
  const cap = row.status?.capacity;
  if (!cap || typeof cap !== "object") return "—";
  const cpu = cap.cpu ?? cap["cpu"];
  const mem = cap.memory ?? cap["memory"];
  if (!cpu && !mem) return "—";
  const c = cpu != null && String(cpu) !== "" ? String(cpu) : "—";
  const m = mem != null && String(mem) !== "" ? String(mem) : "—";
  return `${c} / ${m}`;
}

export function countPodsOnNode(pods: Pod[], nodeName: string): number {
  if (!nodeName) return 0;
  return pods.filter((p) => (p.spec?.nodeName || "") === nodeName).length;
}

export function nodeMatchesNameFilter(row: NodeListRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const name = (row.metadata?.name ?? "").toLowerCase();
  return name.includes(k);
}
