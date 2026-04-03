/**
 * PVC 列表：状态摘要、容量/访问模式等从 raw PersistentVolumeClaim 派生；Used By 由同命名空间 Pods 推导。
 */

import type { Pod } from "../api";
import { getPodStatusInfo } from "./podTableStatus";

export type PvcListRow = {
  metadata?: { name?: string; namespace?: string; deletionTimestamp?: string; creationTimestamp?: string };
  spec?: {
    volumeName?: string;
    storageClassName?: string;
    accessModes?: string[];
    volumeMode?: string;
    resources?: { requests?: Record<string, string> };
  };
  status?: {
    phase?: string;
    capacity?: Record<string, string>;
  };
  [k: string]: unknown;
};

export type PvcStatusSummary = {
  /** 主表展示文案：Bound / Pending / Lost / Terminating */
  display: string;
  /** 与 WebLens 健康标签色系一致 */
  label: "健康" | "警告" | "严重" | "删除中";
  /** 排序用：健康=0 删除中=1 警告=2 严重=3 */
  healthRank: number;
};

export function derivePvcStatusSummary(row: PvcListRow): PvcStatusSummary {
  const del = row.metadata?.deletionTimestamp;
  if (del != null && del !== "") {
    return { display: "Terminating", label: "删除中", healthRank: 1 };
  }
  const phase = (row.status?.phase ?? "").trim();
  const p = phase.toLowerCase();
  if (p === "bound") {
    return { display: "Bound", label: "健康", healthRank: 0 };
  }
  if (p === "pending") {
    return { display: "Pending", label: "警告", healthRank: 2 };
  }
  if (p === "lost") {
    return { display: "Lost", label: "严重", healthRank: 3 };
  }
  if (phase) {
    return { display: phase, label: "警告", healthRank: 2 };
  }
  return { display: "—", label: "警告", healthRank: 2 };
}

export function formatPvcVolumeName(row: PvcListRow): string {
  const v = row.spec?.volumeName;
  if (v != null && v !== "") return v;
  return "—";
}

export function formatPvcCapacity(row: PvcListRow): string {
  const cap = row.status?.capacity;
  if (cap && typeof cap === "object") {
    const s = cap.storage ?? cap.Storage;
    if (s != null && String(s) !== "") return String(s);
  }
  const req = row.spec?.resources?.requests?.storage;
  if (req != null && req !== "") return String(req);
  return "—";
}

export function formatPvcAccessModes(row: PvcListRow): string {
  const modes = row.spec?.accessModes;
  if (!Array.isArray(modes) || modes.length === 0) return "—";
  return modes.map((m) => String(m).replace(/^.*\//, "")).join(", ");
}

export function formatPvcStorageClass(row: PvcListRow): string {
  const sc = row.spec?.storageClassName;
  if (sc != null && sc !== "") return sc;
  return "—";
}

/** 挂载了该 PVC 的 Pod（同 namespace 下 claimName 匹配） */
export function podsUsingPvcClaim(pods: Pod[], pvcNamespace: string, claimName: string): Pod[] {
  if (!claimName) return [];
  return pods.filter((p) => {
    if ((p.metadata.namespace || "") !== pvcNamespace) return false;
    const vols = p.spec?.volumes;
    if (!Array.isArray(vols)) return false;
    return vols.some((v) => v?.persistentVolumeClaim?.claimName === claimName);
  });
}

/** Used By 列：仅显示数量摘要（1 Pod / N Pods / —） */
export function formatPvcUsedByCountSummary(pods: Pod[], pvcNamespace: string, claimName: string): string {
  const n = podsUsingPvcClaim(pods, pvcNamespace, claimName).length;
  if (n === 0) return "—";
  if (n === 1) return "1 Pod";
  return `${n} Pods`;
}

/** hover：引导去 Describe 看完整 Pod 列表 */
export const PVC_USED_BY_DESCRIBE_HINT = "在 Describe 面板查看全部关联 Pod";

export function podIsHealthAbnormal(p: Pod): boolean {
  const h = p.healthLabel;
  if (h && h !== "健康") return true;
  const ph = (p.status?.phase ?? "").trim();
  if (ph === "Failed" || ph === "Unknown") return true;
  return false;
}

/** 主表运维摘要：未使用 / 异常 Pod 占用 / StorageClass 轻量提示 */
export function derivePvcOpsHint(row: PvcListRow, pods: Pod[], pvcNamespace: string, claimName: string): {
  text: string;
  title: string;
} {
  const used = podsUsingPvcClaim(pods, pvcNamespace, claimName);
  if (used.length === 0) {
    return {
      text: "未使用",
      title: "同命名空间下无 Pod 挂载此 PVC；详情见 Describe",
    };
  }
  const abnormal = used.filter(podIsHealthAbnormal);
  if (abnormal.length > 0) {
    return {
      text: abnormal.length === 1 ? "被异常 Pod 使用" : `${abnormal.length} 个异常 Pod`,
      title: "存在非「健康」或 Phase 异常的挂载 Pod；请在 Describe 中查看并跳转 Pods",
    };
  }
  const sc = row.spec?.storageClassName;
  const hasSc = sc != null && String(sc).trim() !== "";
  const st = derivePvcStatusSummary(row);
  if (!hasSc && (st.display === "Pending" || st.display === "—")) {
    return {
      text: "无 StorageClass",
      title: "未指定 storageClassName；动态供给依赖 StorageClass，请在 Describe 核对与集群默认类",
    };
  }
  return { text: "—", title: "" };
}

/** Describe / 文案：StorageClass 一行说明 */
export function describePvcStorageClassNote(row: PvcListRow): string {
  const sc = formatPvcStorageClass(row);
  if (sc === "—") {
    return "未在 spec 中指定 StorageClass；若集群无默认 StorageClass，动态卷可能无法供给。";
  }
  return `当前 StorageClass：${sc}（名称来自 PVC spec，未校验集群内是否存在该对象）。`;
}

export type PvcExpandBinding = {
  pv: string;
  storageClass: string;
  requested: string;
  capacity: string;
  accessModes: string;
  volumeMode: string;
};

export function derivePvcExpandBinding(row: PvcListRow): PvcExpandBinding {
  const vm = row.spec?.volumeMode;
  return {
    pv: formatPvcVolumeName(row),
    storageClass: formatPvcStorageClass(row),
    requested:
      row.spec?.resources?.requests?.storage != null && row.spec.resources.requests.storage !== ""
        ? String(row.spec.resources.requests.storage)
        : "—",
    capacity: formatPvcCapacity(row),
    accessModes: formatPvcAccessModes(row),
    volumeMode: vm != null && vm !== "" ? String(vm) : "Filesystem",
  };
}

export type PvcExpandUsedByRow = {
  podName: string;
  healthLabel: string;
  healthReasonsText: string;
  /** 与 Pods 列表 Status 列一致（getPodStatusInfo） */
  statusText: string;
  node: string;
  note: string;
};

export function derivePvcExpandUsedByRows(pods: Pod[], pvcNamespace: string, claimName: string): PvcExpandUsedByRow[] {
  return podsUsingPvcClaim(pods, pvcNamespace, claimName).map((p) => {
    const { text: statusText } = getPodStatusInfo(p);
    return {
      podName: p.metadata.name,
      healthLabel: p.healthLabel || "健康",
      healthReasonsText: (p.healthReasons || []).join("；"),
      statusText,
      node: p.spec?.nodeName || "—",
      note: "",
    };
  });
}

export function pvcMatchesNameFilter(row: PvcListRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const name = (row.metadata?.name ?? "").toLowerCase();
  return name.includes(k);
}
