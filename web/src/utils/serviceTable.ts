/**
 * Service 列表：端口摘要、selector 摘要、行展开行（由 raw Service / Endpoints 派生）
 */

import type { Pod } from "../api";

/** 与 App 内 K8sItem 形状兼容的通用列表行 */
export type ServiceListRow = { metadata?: { name?: string; namespace?: string }; spec?: unknown; [k: string]: unknown };

export type ServicePortExpandRow = {
  name: string;
  protocol: string;
  port: string;
  targetPort: string;
  nodePort: string;
};

export type ServiceEndpointExpandRow = {
  ip: string;
  ports: string;
  ready: boolean;
  podName: string;
  podHealth: string;
  node: string;
  note: string;
};

function specPorts(svc: ServiceListRow): ServicePortExpandRow[] {
  const ports = (svc as { spec?: { ports?: unknown[] } }).spec?.ports;
  if (!Array.isArray(ports)) return [];
  return ports.map((p) => {
    if (!p || typeof p !== "object") {
      return { name: "—", protocol: "—", port: "—", targetPort: "—", nodePort: "—" };
    }
    const o = p as {
      name?: string;
      protocol?: string;
      port?: number;
      targetPort?: unknown;
      nodePort?: number;
    };
    const tp = o.targetPort;
    const targetStr =
      tp == null
        ? "—"
        : typeof tp === "object" && tp !== null && "IntVal" in (tp as object)
          ? String((tp as { IntVal?: number }).IntVal ?? "—")
          : String(tp);
    return {
      name: o.name && o.name !== "" ? o.name : "—",
      protocol: o.protocol ?? "TCP",
      port: o.port != null ? String(o.port) : "—",
      targetPort: targetStr,
      nodePort: o.nodePort != null && o.nodePort > 0 ? String(o.nodePort) : "—",
    };
  });
}

export function deriveServicePortExpandRows(svc: ServiceListRow): ServicePortExpandRow[] {
  return specPorts(svc);
}

function formatPortsFromSubset(sub: { ports?: Array<{ port?: number; protocol?: string }> }): string {
  const ps = sub.ports;
  if (!Array.isArray(ps) || ps.length === 0) return "—";
  return ps.map((p) => `${p.port ?? "?"}/${p.protocol ?? "TCP"}`).join(", ");
}

export function deriveServiceEndpointExpandRows(ep: ServiceListRow | undefined, pods: Pod[]): ServiceEndpointExpandRow[] {
  if (!ep) return [];
  const subsets = (ep as { subsets?: unknown[] }).subsets;
  if (!Array.isArray(subsets)) return [];
  const rows: ServiceEndpointExpandRow[] = [];
  const podByName = new Map(pods.map((p) => [p.metadata.name, p]));

  for (const raw of subsets) {
    if (!raw || typeof raw !== "object") continue;
    const sub = raw as {
      ports?: Array<{ port?: number; protocol?: string }>;
      addresses?: Array<{
        ip?: string;
        nodeName?: string;
        targetRef?: { kind?: string; name?: string };
      }>;
      notReadyAddresses?: Array<{
        ip?: string;
        nodeName?: string;
        targetRef?: { kind?: string; name?: string };
      }>;
    };
    const portsStr = formatPortsFromSubset(sub);
    const addAddr = (
      list: typeof sub.addresses,
      ready: boolean,
      note: string,
    ) => {
      if (!Array.isArray(list)) return;
      for (const a of list) {
        const podName =
          a?.targetRef?.kind === "Pod" && a.targetRef?.name ? a.targetRef.name : "";
        const pod = podName ? podByName.get(podName) : undefined;
        rows.push({
          ip: a?.ip ?? "—",
          ports: portsStr,
          ready,
          podName: podName || "—",
          podHealth: pod ? pod.healthLabel || "健康" : "—",
          node: a?.nodeName ?? "—",
          note,
        });
      }
    };
    addAddr(sub.addresses, true, "");
    addAddr(sub.notReadyAddresses, false, "NotReady");
  }
  return rows;
}

/** 主表 Cluster IP 列 */
export function formatServiceClusterIP(svc: ServiceListRow): string {
  const spec = (svc as { spec?: { type?: string; clusterIP?: string; externalName?: string } }).spec;
  if (!spec) return "—";
  if (spec.type === "ExternalName") {
    const en = spec.externalName ?? "";
    return en.length > 28 ? `${en.slice(0, 26)}…` : en || "—";
  }
  const ip = spec.clusterIP;
  if (ip == null || ip === "") return "None";
  return ip;
}

/** 主表端口摘要 */
export function formatServicePortsSummary(svc: ServiceListRow): string {
  const ports = (svc as { spec?: { ports?: Array<{ port?: number; protocol?: string }> } }).spec?.ports;
  if (!Array.isArray(ports) || ports.length === 0) return "—";
  if (ports.length === 1) {
    const p = ports[0];
    return `${p?.port ?? "?"}/${p?.protocol ?? "TCP"}`;
  }
  if (ports.length === 2) {
    return ports.map((p) => `${p?.port ?? "?"}`).join(", ");
  }
  return `${ports.length} ports`;
}

/** 主表 selector 摘要 */
export function formatServiceSelectorSummary(svc: ServiceListRow, maxLen = 42): string {
  const sel = (svc as { spec?: { selector?: Record<string, string> } }).spec?.selector;
  if (!sel || Object.keys(sel).length === 0) return "无";
  const s = Object.entries(sel)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

export function serviceMatchesNameFilter(svc: ServiceListRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const name = (svc.metadata?.name ?? "").toLowerCase();
  return name.includes(k);
}
