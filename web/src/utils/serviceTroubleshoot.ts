/**
 * Services 列表：结合 Endpoints 与同作用域 Pod 缓存做运维向状态摘要（与 Pods 健康标签风格对齐）。
 */

import type { Pod } from "../api";

export type ServiceTrafficLabel = "健康" | "警告" | "严重" | "特殊";

/** 列表排序用：严重 > 警告 > 特殊 > 健康 */
export function serviceHealthRankForSort(label: ServiceTrafficLabel): number {
  if (label === "严重") return 3;
  if (label === "警告") return 2;
  if (label === "特殊") return 1;
  return 0;
}

export type ServiceListDiagnostics = {
  label: ServiceTrafficLabel;
  healthRank: number;
  summary: string;
  endpointSummary: string;
  readyEp: number;
  notReadyEp: number;
};

type SvcSpec = {
  type?: string;
  clusterIP?: string;
  externalName?: string;
  selector?: Record<string, string>;
  ports?: Array<{ port?: number; protocol?: string; name?: string }>;
};

function getSpec(svc: unknown): SvcSpec | undefined {
  if (!svc || typeof svc !== "object") return undefined;
  return (svc as { spec?: SvcSpec }).spec;
}

export function countEndpointSubsets(ep: unknown): { ready: number; notReady: number } {
  let ready = 0;
  let notReady = 0;
  if (!ep || typeof ep !== "object") return { ready, notReady };
  const subsets = (ep as { subsets?: unknown[] }).subsets;
  if (!Array.isArray(subsets)) return { ready, notReady };
  for (const sub of subsets) {
    if (!sub || typeof sub !== "object") continue;
    const s = sub as { addresses?: unknown[]; notReadyAddresses?: unknown[] };
    ready += Array.isArray(s.addresses) ? s.addresses.length : 0;
    notReady += Array.isArray(s.notReadyAddresses) ? s.notReadyAddresses.length : 0;
  }
  return { ready, notReady };
}

function selectorKeys(sel: Record<string, string> | undefined): number {
  if (!sel) return 0;
  return Object.keys(sel).length;
}

function podsMatchingSelector(pods: Pod[], ns: string, selector: Record<string, string> | undefined): Pod[] {
  if (!selector || Object.keys(selector).length === 0) return [];
  return pods.filter((p) => {
    if ((p.metadata.namespace ?? "") !== ns) return false;
    const labels = (p.metadata as { labels?: Record<string, string> }).labels ?? {};
    return Object.entries(selector).every(([k, v]) => labels[k] === v);
  });
}

function podWorstHealthRank(pods: Pod[]): number {
  let m = 0;
  const r: Record<string, number> = { 健康: 0, 关注: 1, 警告: 2, 严重: 3 };
  for (const p of pods) {
    const l = p.healthLabel || "健康";
    m = Math.max(m, r[l] ?? 0);
  }
  return m;
}

function isHeadlessClusterIP(spec: SvcSpec | undefined): boolean {
  const ip = spec?.clusterIP ?? "";
  return ip === "None" || ip === "";
}

/** 主表 Endpoints/状态 列展示文案 */
export function formatEndpointColumnSummary(d: ServiceListDiagnostics): string {
  if (d.label === "特殊") {
    if (d.summary.startsWith("ExternalName")) return "ExternalName";
    if (d.summary.includes("无 selector")) return "无 selector";
    return d.summary.slice(0, 24);
  }
  const { readyEp, notReadyEp } = d;
  if (notReadyEp > 0) {
    return `${readyEp} ready / ${notReadyEp} notReady`;
  }
  if (readyEp === 0 && notReadyEp === 0) {
    return "0 endpoints";
  }
  return `${readyEp} endpoints`;
}

/**
 * @param svc 原始 Service 对象
 * @param ep 同名 Endpoints 对象（若无则为 undefined）
 */
export function buildServiceListDiagnostics(svc: unknown, ep: unknown | undefined, pods: Pod[]): ServiceListDiagnostics {
  const meta = (svc as { metadata?: { namespace?: string; name?: string } })?.metadata;
  const ns = meta?.namespace ?? "";
  const spec = getSpec(svc);
  const st = spec?.type ?? "ClusterIP";
  const { ready, notReady } = countEndpointSubsets(ep);
  const selN = selectorKeys(spec?.selector);

  if (st === "ExternalName") {
    const label: ServiceTrafficLabel = "特殊";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: `ExternalName → ${spec?.externalName ?? "—"}`,
      endpointSummary: "ExternalName",
      readyEp: ready,
      notReadyEp: notReady,
    };
  }

  if (selN === 0) {
    const label: ServiceTrafficLabel = "特殊";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: "无 selector（Headless/外部 Endpoint 等场景请结合集群核对）",
      endpointSummary: ready + notReady > 0 ? `${ready + notReady} endpoints` : "0 endpoints",
      readyEp: ready,
      notReadyEp: notReady,
    };
  }

  const matched = podsMatchingSelector(pods, ns, spec?.selector);
  const hasStandardTraffic =
    st === "ClusterIP" || st === "NodePort" || st === "LoadBalancer";

  if (ready === 0 && notReady === 0) {
    if (hasStandardTraffic && !isHeadlessClusterIP(spec)) {
      const label: ServiceTrafficLabel = "严重";
      return {
        label,
        healthRank: serviceHealthRankForSort(label),
        summary: "有 selector 但无 Endpoints，流量无可达后端",
        endpointSummary: "0 endpoints",
        readyEp: 0,
        notReadyEp: 0,
      };
    }
    const label: ServiceTrafficLabel = "警告";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: "当前无 Endpoints（Headless 或尚未就绪）",
      endpointSummary: "0 endpoints",
      readyEp: 0,
      notReadyEp: 0,
    };
  }

  if (ready === 0 && notReady > 0) {
    const label: ServiceTrafficLabel = "严重";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: "仅有 NotReady 地址，无可用后端",
      endpointSummary: `${notReady} notReady`,
      readyEp: 0,
      notReadyEp: notReady,
    };
  }

  const wr = podWorstHealthRank(matched);
  if (wr >= 3) {
    const label: ServiceTrafficLabel = "严重";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: "关联 Pod 存在严重异常",
      endpointSummary: `${ready} endpoints`,
      readyEp: ready,
      notReadyEp: notReady,
    };
  }
  if (wr >= 2 || notReady > 0) {
    const label: ServiceTrafficLabel = "警告";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: notReady > 0 ? "部分 Endpoint 未就绪" : "关联 Pod 存在警告级状态",
      endpointSummary: notReady > 0 ? `${ready} ready / ${notReady} notReady` : `${ready} endpoints`,
      readyEp: ready,
      notReadyEp: notReady,
    };
  }
  if (wr === 1) {
    const label: ServiceTrafficLabel = "警告";
    return {
      label,
      healthRank: serviceHealthRankForSort(label),
      summary: "关联 Pod 存在「关注」状态",
      endpointSummary: `${ready} endpoints`,
      readyEp: ready,
      notReadyEp: notReady,
    };
  }

  const label: ServiceTrafficLabel = "健康";
  return {
    label,
    healthRank: serviceHealthRankForSort(label),
    summary: "Endpoints 与 Pod 状态正常",
    endpointSummary: `${ready} endpoints`,
    readyEp: ready,
    notReadyEp: notReady,
  };
}
