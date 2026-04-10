/**
 * 次级展开表格列模型：与主表一样走 useResourceListColumnResize + ResizableTh，
 * 避免各页手写 table 导致 table-layout / col 宽与 td 不同步、小屏串列。
 */
export const SECONDARY_EXPAND_MIN_COL_WIDTH = 40;

/** Ingress 规则排障子表 */
export const INGRESS_RULE_EXPAND_KEYS = [
  "host",
  "path",
  "pathType",
  "backendSvc",
  "port",
  "tls",
  "status",
  "detail",
  "links",
] as const;
export type IngressRuleExpandColKey = (typeof INGRESS_RULE_EXPAND_KEYS)[number];

export const INGRESS_RULE_EXPAND_DEFAULTS: Record<IngressRuleExpandColKey, number> = {
  host: 152,
  path: 168,
  pathType: 84,
  backendSvc: 160,
  port: 68,
  tls: 72,
  status: 92,
  detail: 220,
  links: 116,
};

export const INGRESS_RULE_EXPAND_COLUMNS: { key: IngressRuleExpandColKey; label: string }[] = [
  { key: "host", label: "Host" },
  { key: "path", label: "Path" },
  { key: "pathType", label: "Path Type" },
  { key: "backendSvc", label: "Backend Service" },
  { key: "port", label: "Port" },
  { key: "tls", label: "TLS" },
  { key: "status", label: "状态" },
  { key: "detail", label: "异常说明" },
  { key: "links", label: "联动" },
];

/** StatefulSet 展开 Pod 子表 */
export const STS_POD_EXPAND_KEYS = [
  "ordinal",
  "podName",
  "health",
  "ready",
  "restarts",
  "pvc",
  "node",
  "actions",
] as const;
export type StsPodExpandColKey = (typeof STS_POD_EXPAND_KEYS)[number];

export const STS_POD_EXPAND_DEFAULTS: Record<StsPodExpandColKey, number> = {
  ordinal: 72,
  podName: 200,
  health: 104,
  ready: 72,
  restarts: 72,
  pvc: 140,
  node: 128,
  actions: 100,
};

export const STS_POD_EXPAND_COLUMNS: { key: StsPodExpandColKey; label: string }[] = [
  { key: "ordinal", label: "Ordinal" },
  { key: "podName", label: "Pod Name" },
  { key: "health", label: "状态标签" },
  { key: "ready", label: "Ready" },
  { key: "restarts", label: "Restarts" },
  { key: "pvc", label: "PVC" },
  { key: "node", label: "Node" },
  { key: "actions", label: "操作" },
];

/** Service 展开 — Ports 子表 */
export const SERVICE_PORT_EXPAND_KEYS = ["name", "protocol", "port", "targetPort", "nodePort"] as const;
export type ServicePortExpandColKey = (typeof SERVICE_PORT_EXPAND_KEYS)[number];

export const SERVICE_PORT_EXPAND_DEFAULTS: Record<ServicePortExpandColKey, number> = {
  name: 120,
  protocol: 88,
  port: 72,
  targetPort: 120,
  nodePort: 88,
};

export const SERVICE_PORT_EXPAND_COLUMNS: { key: ServicePortExpandColKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "protocol", label: "Protocol" },
  { key: "port", label: "Port" },
  { key: "targetPort", label: "TargetPort" },
  { key: "nodePort", label: "NodePort" },
];

/** Service 展开 — Endpoints 子表 */
export const SERVICE_EP_EXPAND_KEYS = [
  "ip",
  "ports",
  "ready",
  "pod",
  "health",
  "node",
  "note",
  "links",
] as const;
export type ServiceEpExpandColKey = (typeof SERVICE_EP_EXPAND_KEYS)[number];

export const SERVICE_EP_EXPAND_DEFAULTS: Record<ServiceEpExpandColKey, number> = {
  ip: 120,
  ports: 88,
  ready: 64,
  pod: 180,
  health: 80,
  node: 100,
  note: 160,
  links: 96,
};

export const SERVICE_EP_EXPAND_COLUMNS: { key: ServiceEpExpandColKey; label: string }[] = [
  { key: "ip", label: "IP" },
  { key: "ports", label: "Ports" },
  { key: "ready", label: "Ready" },
  { key: "pod", label: "Pod" },
  { key: "health", label: "健康" },
  { key: "node", label: "Node" },
  { key: "note", label: "说明" },
  { key: "links", label: "联动" },
];
