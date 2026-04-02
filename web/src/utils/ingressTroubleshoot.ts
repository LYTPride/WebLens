/**
 * Ingress 排障：结合同命名空间下的 Service / Pod 缓存做异常检测（不校验 TLS Secret 存在性）。
 */

import type { Pod } from "../api";
import type { IngressDescribeView } from "../api";
import type { IngressRow } from "./ingressTable";

/** 与 Pods 表「状态标签」文案对齐 */
export type IngressTrafficLabel = "健康" | "关注" | "警告" | "严重";

const LABEL_RANK: Record<IngressTrafficLabel, number> = {
  健康: 0,
  关注: 1,
  警告: 2,
  严重: 3,
};

export type IngressRuleDiagStatus =
  | "正常"
  | "Service 不存在"
  | "无 selector"
  | "无匹配 Pod"
  | "后端 Pod 异常"
  | "端口可能不匹配"
  | "外部域名"
  | "无 backend";

export type IngressRuleDiagRow = {
  host: string;
  path: string;
  pathType: string;
  serviceName: string;
  portDisplay: string;
  tlsHint: string;
  status: IngressRuleDiagStatus;
  detail: string;
  /** 用于行样式：0 正常 1 关注 2 警告 3 严重 */
  severityRank: number;
};

export type IngressTroubleshootResult = {
  label: IngressTrafficLabel;
  healthRank: number;
  /** 主表一句话 */
  summary: string;
  /** 去重 backend service 数（含 default） */
  backendServiceCount: number;
  /** 有问题的规则条数 */
  badRuleCount: number;
  ruleRows: IngressRuleDiagRow[];
  /** 不存在的 backend service 名（去重） */
  missingServices: string[];
  /** 存在但无匹配 Pod 的 service */
  noPodServices: string[];
};

type ServiceSpec = {
  type?: string;
  clusterIP?: string;
  selector?: Record<string, string>;
  ports?: Array<{ port?: number; name?: string; targetPort?: unknown }>;
};

function serviceKey(ns: string, name: string): string {
  return `${ns}/${name}`;
}

function getService(services: Map<string, unknown>, ns: string, name: string): { item: unknown; spec?: ServiceSpec } | null {
  if (!name) return null;
  const item = services.get(serviceKey(ns, name));
  if (!item || typeof item !== "object") return null;
  const spec = (item as { spec?: ServiceSpec }).spec;
  return { item, spec };
}

function podsMatchingSelector(pods: Pod[], ns: string, selector: Record<string, string> | undefined): Pod[] {
  if (!selector || Object.keys(selector).length === 0) return [];
  return pods.filter((p) => {
    if ((p.metadata.namespace ?? "") !== ns) return false;
    const labels = p.metadata.labels ?? {};
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

function anyPodRunning(pods: Pod[]): boolean {
  return pods.some((p) => !p.metadata.deletionTimestamp && p.status?.phase === "Running");
}

function ingressBackendPortMatchesService(
  ingPort: { name?: string; number?: number } | undefined,
  svcPorts: ServiceSpec["ports"] | undefined,
): boolean {
  if (!svcPorts?.length) return false;
  if (!ingPort || (!ingPort.name && ingPort.number == null)) return true;
  if (ingPort.name) {
    return svcPorts.some((sp) => sp.name === ingPort.name);
  }
  const n = ingPort.number;
  return svcPorts.some((sp) => {
    if (sp.port === n) return true;
    const tp = sp.targetPort;
    if (typeof tp === "number" && tp === n) return true;
    if (typeof tp === "string" && tp === String(n)) return true;
    return false;
  });
}

type PathBackend = {
  host: string;
  path: string;
  pathType: string;
  svcName: string;
  ingPort?: { name?: string; number?: number };
  tlsHint: string;
};

function tlsHintForRuleHost(ruleHost: string, tls: { secretName?: string; hosts?: string[] }[]): string {
  if (!tls.length) return "—";
  const outN: string[] = [];
  const seen = new Set<string>();
  for (const t of tls) {
    const sn = t.secretName ?? "";
    if (!sn) continue;
    let match = false;
    const hosts = t.hosts ?? [];
    if (hosts.length === 0) match = true;
    else if (ruleHost === "") match = true;
    else if (hosts.includes(ruleHost)) match = true;
    if (match && !seen.has(sn)) {
      seen.add(sn);
      outN.push(sn);
    }
  }
  if (!outN.length) return "未匹配证书";
  return outN.join(", ");
}

function collectPathBackends(row: IngressRow): PathBackend[] {
  const spec = (row.spec ?? {}) as {
    rules?: Array<{
      host?: string;
      http?: {
        paths?: Array<{
          path?: string;
          pathType?: string;
          backend?: { service?: { name?: string; port?: { name?: string; number?: number } } };
        }>;
      };
    }>;
    defaultBackend?: { service?: { name?: string; port?: { name?: string; number?: number } } };
    tls?: { secretName?: string; hosts?: string[] }[];
  };
  const out: PathBackend[] = [];
  const tls = spec.tls ?? [];

  for (const rule of spec.rules ?? []) {
    const h = rule.host ?? "";
    for (const p of rule.http?.paths ?? []) {
      const svc = p.backend?.service;
      out.push({
        host: h === "" ? "（任意 Host）" : h,
        path: p.path ?? "/",
        pathType: p.pathType ?? "—",
        svcName: svc?.name ?? "",
        ingPort: svc?.port,
        tlsHint: tlsHintForRuleHost(h, tls),
      });
    }
  }
  if (!out.length && spec.defaultBackend?.service?.name) {
    const db = spec.defaultBackend.service;
    out.push({
      host: "（默认后端）",
      path: "—",
      pathType: "—",
      svcName: db.name ?? "",
      ingPort: db.port,
      tlsHint: tlsHintForRuleHost("", tls),
    });
  }
  return out;
}

function diagnoseOnePath(
  ns: string,
  pb: PathBackend,
  services: Map<string, unknown>,
  pods: Pod[],
): IngressRuleDiagRow {
  const base = {
    host: pb.host,
    path: pb.path,
    pathType: pb.pathType,
    serviceName: pb.svcName || "—",
    portDisplay:
      pb.ingPort?.name != null && pb.ingPort.name !== ""
        ? pb.ingPort.name
        : pb.ingPort?.number != null
          ? String(pb.ingPort.number)
          : "—",
    tlsHint: pb.tlsHint,
  };

  if (!pb.svcName) {
    return {
      ...base,
      status: "无 backend",
      detail: "规则未配置 Service",
      severityRank: 3,
    };
  }

  const hit = getService(services, ns, pb.svcName);
  if (!hit) {
    return {
      ...base,
      status: "Service 不存在",
      detail: `集群中未找到 Service ${pb.svcName}`,
      severityRank: 3,
    };
  }

  const st = hit.spec?.type;
  if (st === "ExternalName") {
    return {
      ...base,
      status: "外部域名",
      detail: "ExternalName 类型，未校验远端可用性",
      severityRank: 0,
    };
  }

  const sel = hit.spec?.selector;
  if (!sel || Object.keys(sel).length === 0) {
    return {
      ...base,
      status: "无 selector",
      detail: "Service 无 selector，无法关联 Pod",
      severityRank: 2,
    };
  }

  if (!ingressBackendPortMatchesService(pb.ingPort, hit.spec?.ports)) {
    return {
      ...base,
      status: "端口可能不匹配",
      detail: "Ingress 端口与 Service ports 未对齐，请核对",
      severityRank: 2,
    };
  }

  const matched = podsMatchingSelector(pods, ns, sel);
  if (matched.length === 0) {
    return {
      ...base,
      status: "无匹配 Pod",
      detail: `无符合 selector 的 Pod（${pb.svcName}）`,
      severityRank: 3,
    };
  }

  if (!anyPodRunning(matched)) {
    return {
      ...base,
      status: "后端 Pod 异常",
      detail: "有匹配 Pod 但当前无 Running 实例",
      severityRank: 3,
    };
  }

  const wr = podWorstHealthRank(matched);
  if (wr >= 2) {
    return {
      ...base,
      status: "后端 Pod 异常",
      detail: `匹配 Pod ${matched.length} 个，存在非健康实例`,
      severityRank: wr,
    };
  }
  if (wr === 1) {
    return {
      ...base,
      status: "后端 Pod 异常",
      detail: "部分 Pod 为「关注」状态",
      severityRank: 1,
    };
  }

  return {
    ...base,
    status: "正常",
    detail: `后端 ${matched.length} Pod，状态正常`,
    severityRank: 0,
  };
}

function aggregateLabel(rows: IngressRuleDiagRow[]): IngressTrafficLabel {
  let m = 0;
  for (const r of rows) {
    m = Math.max(m, r.severityRank);
  }
  if (m >= 3) return "严重";
  if (m === 2) return "警告";
  if (m === 1) return "关注";
  return "健康";
}

function buildSummary(
  rows: IngressRuleDiagRow[],
  label: IngressTrafficLabel,
  missing: string[],
  noPod: string[],
): string {
  if (label === "健康") return "正常";
  const bad = rows.filter((r) => r.severityRank > 0).length;
  const total = rows.length;
  if (missing.length) {
    return `Service 不存在：${missing.slice(0, 2).join("、")}${missing.length > 2 ? "…" : ""}`;
  }
  if (noPod.length) {
    return `无匹配 Pod：${noPod.slice(0, 2).join("、")}${noPod.length > 2 ? "…" : ""}`;
  }
  if (total > 0 && bad > 0) {
    return `部分路径异常（${bad}/${total}）`;
  }
  return rows.find((r) => r.severityRank > 0)?.detail ?? "存在风险项，请展开查看";
}

/** 从列表页 raw Ingress 构建 */
export function buildIngressTroubleshoot(
  row: IngressRow,
  services: unknown[],
  pods: Pod[],
): IngressTroubleshootResult {
  const ns = row.metadata?.namespace ?? "";
  const svcMap = new Map<string, unknown>();
  for (const s of services) {
    if (!s || typeof s !== "object") continue;
    const m = (s as { metadata?: { name?: string; namespace?: string } }).metadata;
    const n = m?.name;
    const nss = m?.namespace ?? ns;
    if (n) svcMap.set(serviceKey(nss, n), s);
  }

  const paths = collectPathBackends(row);
  const ruleRows = paths.map((pb) => diagnoseOnePath(ns, pb, svcMap, pods));

  if (ruleRows.length === 0) {
    const emptyRow: IngressRuleDiagRow = {
      host: "—",
      path: "—",
      pathType: "—",
      serviceName: "—",
      portDisplay: "—",
      tlsHint: "—",
      status: "无 backend",
      detail: "无 HTTP 规则且无 default backend",
      severityRank: 3,
    };
    return {
      label: "严重",
      healthRank: 3,
      summary: "无有效规则",
      backendServiceCount: 0,
      badRuleCount: 1,
      ruleRows: [emptyRow],
      missingServices: [],
      noPodServices: [],
    };
  }

  const label = aggregateLabel(ruleRows);
  const missingServices = [
    ...new Set(ruleRows.filter((r) => r.status === "Service 不存在").map((r) => r.serviceName)),
  ].filter(Boolean);
  const noPodServices = [
    ...new Set(ruleRows.filter((r) => r.status === "无匹配 Pod").map((r) => r.serviceName)),
  ].filter(Boolean);
  const backends = new Set(
    paths.map((p) => p.svcName).filter(Boolean),
  );
  const badRuleCount = ruleRows.filter((r) => r.severityRank > 0).length;

  return {
    label,
    healthRank: LABEL_RANK[label],
    summary: buildSummary(ruleRows, label, missingServices, noPodServices),
    backendServiceCount: backends.size,
    badRuleCount,
    ruleRows,
    missingServices,
    noPodServices,
  };
}

/** Describe 面板：用 view.rules 按 host 归并 + 同缓存做检测 */
export function buildIngressTroubleshootFromDescribeView(
  view: IngressDescribeView,
  services: unknown[],
  pods: Pod[],
): IngressTroubleshootResult {
  const rulesFlat = Array.isArray(view.rules) ? view.rules : [];
  const byHost = new Map<
    string,
    Array<{
      path: string;
      pathType: string;
      serviceName: string;
      port: string;
    }>
  >();
  for (const r of rulesFlat) {
    const hostKey =
      !r.host || r.host === "（任意 Host）" || r.host === "（任意 Host / 默认规则）" ? "" : r.host;
    if (!byHost.has(hostKey)) byHost.set(hostKey, []);
    byHost.get(hostKey)!.push({
      path: r.path,
      pathType: r.pathType,
      serviceName: r.serviceName,
      port: r.port,
    });
  }
  const specRules = [...byHost.entries()].map(([host, paths]) => ({
    host,
    http: {
      paths: paths.map((p) => ({
        path: p.path === "—" ? "/" : p.path,
        pathType: p.pathType,
        backend: {
          service: {
            name: p.serviceName,
            port: parsePortFromDescribe(p.port),
          },
        },
      })),
    },
  }));

  const row: IngressRow = {
    metadata: { name: view.name, namespace: view.namespace },
    spec: {
      rules: specRules,
      tls: (view.tls ?? []).map((t) => ({ secretName: t.secretName, hosts: t.hosts })),
      defaultBackend: view.defaultBackend
        ? {
            service: {
              name: view.defaultBackend.serviceName,
              port: parsePortFromDescribe(view.defaultBackend.port),
            },
          }
        : undefined,
    },
  };
  return buildIngressTroubleshoot(row, services, pods);
}

function parsePortFromDescribe(port: string): { name?: string; number?: number } | undefined {
  if (!port || port === "—") return undefined;
  const n = Number(port);
  if (!Number.isNaN(n) && String(n) === port.trim()) {
    return { number: n };
  }
  return { name: port };
}
