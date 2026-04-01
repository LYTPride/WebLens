/**
 * 从 Ingress List API 原始对象派生列表摘要与行展开规则（与 describe 后端逻辑对齐）
 */

/** 与 App 中 K8sItem 兼容的最小形状 */
export type IngressRow = {
  metadata?: { name?: string; namespace?: string; uid?: string };
  spec?: unknown;
};

export type IngressListSummary = {
  hostCount: number;
  /** 展示用：如 2（a.com +1） */
  hostsLabel: string;
  pathCount: number;
  hasTLS: boolean;
  hasDefaultBackend: boolean;
  /** 主表「默认后端」列短文案 */
  defaultBackendShort: string;
};

type IngressRuleHTTPPath = {
  path?: string;
  pathType?: string;
  backend?: {
    service?: {
      name?: string;
      port?: { name?: string; number?: number };
    };
  };
};

type IngressRule = {
  host?: string;
  http?: { paths?: IngressRuleHTTPPath[] };
};

type IngressSpec = {
  rules?: IngressRule[];
  tls?: { secretName?: string; hosts?: string[] }[];
  defaultBackend?: {
    service?: { name?: string; port?: { name?: string; number?: number } };
  };
};

export type IngressExpandRow = {
  host: string;
  path: string;
  pathType: string;
  service: string;
  port: string;
  tls: string;
};

function formatBackendPort(port?: { name?: string; number?: number }): string {
  if (!port) return "—";
  if (port.name) return port.name;
  if (typeof port.number === "number") return String(port.number);
  return "—";
}

function tlsHintForPath(ruleHost: string, specTLS: NonNullable<IngressSpec["tls"]>): string {
  if (!specTLS.length) return "—";
  const out: string[] = [];
  const seen = new Set<string>();
  const rh = ruleHost;
  for (const t of specTLS) {
    const sn = t.secretName ?? "";
    if (!sn) continue;
    let match = false;
    const hosts = t.hosts ?? [];
    if (hosts.length === 0) match = true;
    else if (rh === "") match = true;
    else if (hosts.includes(rh)) match = true;
    if (match && !seen.has(sn)) {
      seen.add(sn);
      out.push(sn);
    }
  }
  if (!out.length) return "未匹配证书";
  return out.join(", ");
}

function collectHosts(rules: IngressRule[] | undefined): string[] {
  const m = new Map<string, true>();
  for (const r of rules ?? []) {
    m.set(r.host ?? "", true);
  }
  return [...m.keys()];
}

function hostPreview(hosts: string[]): { count: number; label: string } {
  const nonEmpty = hosts.filter((h) => h !== "");
  const count = hosts.length;
  if (count === 0) return { count: 0, label: "—" };
  const first = nonEmpty[0] ?? "任意 Host";
  if (count === 1) return { count: 1, label: first };
  return { count, label: `${first} +${count - 1}` };
}

function pathCountFromSpec(spec: IngressSpec): number {
  let n = 0;
  for (const rule of spec.rules ?? []) {
    n += rule.http?.paths?.length ?? 0;
  }
  return n;
}

export function deriveIngressListSummary(row: IngressRow): IngressListSummary {
  const spec = (row.spec ?? {}) as IngressSpec;
  const rules = spec.rules ?? [];
  const hosts = collectHosts(rules);
  const { count: hostCount, label: hostsLabel } = hostPreview(hosts);
  let pathCount = pathCountFromSpec(spec);
  const hasTLS = (spec.tls?.length ?? 0) > 0;
  const defSvc = spec.defaultBackend?.service;
  const hasDefaultBackend = !!defSvc?.name;
  let defaultBackendShort = "无";
  if (hasDefaultBackend && defSvc) {
    defaultBackendShort = `${defSvc.name}:${formatBackendPort(defSvc.port)}`;
  }
  if (pathCount === 0 && hasDefaultBackend) {
    pathCount = 1;
  }
  return {
    hostCount,
    hostsLabel,
    pathCount,
    hasTLS,
    hasDefaultBackend,
    defaultBackendShort,
  };
}

export function buildIngressExpandRows(row: IngressRow): IngressExpandRow[] {
  const spec = (row.spec ?? {}) as IngressSpec;
  const tls = spec.tls ?? [];
  const rows: IngressExpandRow[] = [];
  for (const rule of spec.rules ?? []) {
    const host = rule.host ?? "";
    for (const p of rule.http?.paths ?? []) {
      const svc = p.backend?.service;
      rows.push({
        host: host === "" ? "（任意 Host / 默认规则）" : host,
        path: p.path ?? "/",
        pathType: p.pathType ?? "—",
        service: svc?.name ?? "—",
        port: formatBackendPort(svc?.port),
        tls: tlsHintForPath(host, tls),
      });
    }
  }
  if (!rows.length && spec.defaultBackend?.service?.name) {
    const db = spec.defaultBackend.service;
    rows.push({
      host: "（仅默认后端）",
      path: "—",
      pathType: "—",
      service: db.name ?? "—",
      port: formatBackendPort(db.port),
      tls: tlsHintForPath("", tls),
    });
  }
  return rows;
}

/** 名称或任一 rule host / tls host 命中关键字 */
export function ingressMatchesNameOrHostFilter(row: IngressRow, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const name = (row.metadata?.name ?? "").toLowerCase();
  if (name.includes(k)) return true;
  const spec = (row.spec ?? {}) as IngressSpec;
  for (const rule of spec.rules ?? []) {
    const h = (rule.host ?? "").toLowerCase();
    if (h.includes(k)) return true;
  }
  for (const t of spec.tls ?? []) {
    for (const h of t.hosts ?? []) {
      if (h.toLowerCase().includes(k)) return true;
    }
  }
  return false;
}
