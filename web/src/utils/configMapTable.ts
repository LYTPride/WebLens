import type { ConfigMap, ConfigMapDescribeView, Pod } from "../api";
import { creationTimestampToAgeSeconds } from "./k8sCreationTimestamp";

export type ConfigMapListRow = ConfigMap;

export type ConfigMapReferenceKind = "Pod" | "Deployment" | "StatefulSet" | "DaemonSet" | "Other";
export type ConfigMapReferenceMethod = "volume" | "envFrom" | "env";

export type ConfigMapReference = {
  kind: ConfigMapReferenceKind;
  namespace: string;
  name: string;
  method: ConfigMapReferenceMethod;
  containerName?: string;
  keyName?: string;
  volumeName?: string;
};

export type ConfigMapReferenceSummary = {
  pods: number;
  deployments: number;
  statefulSets: number;
  daemonSets: number;
  others: number;
  totalResources: number;
  totalReferences: number;
  references: ConfigMapReference[];
};

export type ConfigMapSizeSummary = {
  dataKeys: number;
  binaryDataKeys: number;
  totalKeys: number;
  totalBytes: number;
  display: string;
};

export type ConfigMapRiskLabel = "健康" | "未引用" | "空配置" | "超大配置" | "疑似敏感配置" | "高影响范围";
export type ConfigMapRiskLevel = "success" | "info" | "warning" | "danger";

export type ConfigMapRisk = {
  label: ConfigMapRiskLabel;
  level: ConfigMapRiskLevel;
  rank: number;
  reason: string;
};

export type ConfigMapKeyRow = {
  key: string;
  source: "data" | "binaryData";
  sizeBytes: number;
  sizeDisplay: string;
  lineCount: string;
  detectedType: string;
  risky: boolean;
};

const SENSITIVE_KEYWORDS = [
  "password",
  "passwd",
  "secret",
  "token",
  "access_key",
  "accesskey",
  "private_key",
  "privatekey",
  "credential",
  "credentials",
  "api_key",
  "apikey",
];

export function configMapKey(namespace: string | undefined, name: string | undefined): string {
  return `${namespace ?? ""}/${name ?? ""}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function formatConfigMapBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function summarizeConfigMapSize(cm: Pick<ConfigMap, "data" | "binaryData">): ConfigMapSizeSummary {
  const data = cm.data ?? {};
  const binaryData = cm.binaryData ?? {};
  const dataBytes = Object.values(data).reduce((sum, value) => sum + byteLength(String(value ?? "")), 0);
  const binaryBytes = Object.values(binaryData).reduce((sum, value) => sum + byteLength(String(value ?? "")), 0);
  const dataKeys = Object.keys(data).length;
  const binaryDataKeys = Object.keys(binaryData).length;
  const totalKeys = dataKeys + binaryDataKeys;
  const totalBytes = dataBytes + binaryBytes;
  return {
    dataKeys,
    binaryDataKeys,
    totalKeys,
    totalBytes,
    display: `${totalKeys} keys · ${formatConfigMapBytes(totalBytes)}`,
  };
}

export function isSensitiveConfigMapKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some((word) => k.includes(word));
}

export function detectConfigMapKeyType(key: string, source: "data" | "binaryData", value: string): string {
  if (source === "binaryData") return "binary";
  const lower = key.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".properties")) return "properties";
  if (lower.endsWith(".xml")) return "xml";
  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) return "json";
  if (/^[\w.-]+\s*=\s*.+/m.test(value)) return "properties";
  if (/^<\?xml|<\w[\s>]/.test(trimmed)) return "xml";
  if (/^[\w.-]+:\s*.+/m.test(value)) return "yaml";
  return "text";
}

export function deriveConfigMapKeyRows(cm: Pick<ConfigMap, "data" | "binaryData">): ConfigMapKeyRow[] {
  const rows: ConfigMapKeyRow[] = [];
  for (const [key, value] of Object.entries(cm.data ?? {})) {
    const text = String(value ?? "");
    rows.push({
      key,
      source: "data",
      sizeBytes: byteLength(text),
      sizeDisplay: formatConfigMapBytes(byteLength(text)),
      lineCount: text === "" ? "0" : String(text.split(/\r\n|\r|\n/).length),
      detectedType: detectConfigMapKeyType(key, "data", text),
      risky: isSensitiveConfigMapKey(key),
    });
  }
  for (const [key, value] of Object.entries(cm.binaryData ?? {})) {
    const text = String(value ?? "");
    rows.push({
      key,
      source: "binaryData",
      sizeBytes: byteLength(text),
      sizeDisplay: formatConfigMapBytes(byteLength(text)),
      lineCount: "binary",
      detectedType: "binary",
      risky: isSensitiveConfigMapKey(key),
    });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: "base", numeric: true }));
}

function addPodContainerRefs(
  refs: ConfigMapReference[],
  pod: Pod,
  cmNamespace: string,
  cmName: string,
  containers: NonNullable<Pod["spec"]>["containers"],
): void {
  for (const container of containers ?? []) {
    for (const envFrom of container.envFrom ?? []) {
      if (envFrom.configMapRef?.name === cmName) {
        refs.push({ kind: "Pod", namespace: cmNamespace, name: pod.metadata.name, method: "envFrom", containerName: container.name });
      }
    }
    for (const env of container.env ?? []) {
      const ref = env.valueFrom?.configMapKeyRef;
      if (ref?.name === cmName) {
        refs.push({
          kind: "Pod",
          namespace: cmNamespace,
          name: pod.metadata.name,
          method: "env",
          containerName: container.name,
          keyName: ref.key,
        });
      }
    }
  }
}

export function deriveConfigMapReferences(pods: Pod[], cmNamespace: string, cmName: string): ConfigMapReferenceSummary {
  const references: ConfigMapReference[] = [];
  for (const pod of pods) {
    if (pod.metadata.namespace !== cmNamespace) continue;
    for (const volume of pod.spec?.volumes ?? []) {
      if (volume.configMap?.name === cmName) {
        references.push({
          kind: "Pod",
          namespace: cmNamespace,
          name: pod.metadata.name,
          method: "volume",
          volumeName: volume.name,
        });
      }
    }
    addPodContainerRefs(references, pod, cmNamespace, cmName, pod.spec?.containers);
    addPodContainerRefs(references, pod, cmNamespace, cmName, pod.spec?.initContainers);
  }
  const podNames = new Set(references.filter((r) => r.kind === "Pod").map((r) => r.name));
  return {
    pods: podNames.size,
    deployments: 0,
    statefulSets: 0,
    daemonSets: 0,
    others: 0,
    totalResources: podNames.size,
    totalReferences: references.length,
    references,
  };
}

export function formatConfigMapReferenceSummary(summary: ConfigMapReferenceSummary): string {
  const parts: string[] = [];
  if (summary.pods > 0) parts.push(`Pods ${summary.pods}`);
  if (summary.deployments > 0) parts.push(`Deployments ${summary.deployments}`);
  if (summary.statefulSets > 0) parts.push(`StatefulSets ${summary.statefulSets}`);
  if (summary.daemonSets > 0) parts.push(`DaemonSets ${summary.daemonSets}`);
  if (summary.others > 0) parts.push(`Other ${summary.others}`);
  if (parts.length === 0) return "未引用";
  if (parts.length <= 2) return parts.join(" · ");
  return `${summary.totalResources} refs`;
}

export function configMapReferenceTitle(summary: ConfigMapReferenceSummary): string {
  return [
    `Pods: ${summary.pods}`,
    `Deployments: ${summary.deployments}`,
    `StatefulSets: ${summary.statefulSets}`,
    `DaemonSets: ${summary.daemonSets}`,
    `引用位置: ${summary.totalReferences}`,
  ].join("\n");
}

export function deriveConfigMapRisks(cm: Pick<ConfigMap, "data" | "binaryData">, refs: ConfigMapReferenceSummary): ConfigMapRisk[] {
  const size = summarizeConfigMapSize(cm);
  const keyRows = deriveConfigMapKeyRows(cm);
  const sensitiveKeys = keyRows.filter((row) => row.risky).map((row) => row.key);
  const risks: ConfigMapRisk[] = [];
  if (refs.totalResources === 0) {
    risks.push({ label: "未引用", level: "info", rank: 1, reason: "未引用：当前未发现 Pod 或工作负载引用" });
  }
  if (size.totalKeys === 0) {
    risks.push({ label: "空配置", level: "warning", rank: 2, reason: "空配置：data 与 binaryData 都没有 key" });
  }
  if (size.totalBytes > 512 * 1024) {
    risks.push({
      label: "超大配置",
      level: size.totalBytes >= 900 * 1024 ? "danger" : "warning",
      rank: size.totalBytes >= 900 * 1024 ? 5 : 4,
      reason: `超大配置：当前大小 ${formatConfigMapBytes(size.totalBytes)}，接近 Kubernetes 1MiB 限制`,
    });
  }
  if (sensitiveKeys.length > 0) {
    risks.push({
      label: "疑似敏感配置",
      level: "warning",
      rank: 3,
      reason: `疑似敏感配置：发现 key ${sensitiveKeys.slice(0, 6).join("、")}${sensitiveKeys.length > 6 ? "…" : ""}`,
    });
  }
  if (refs.totalResources > 20) {
    risks.push({
      label: "高影响范围",
      level: "danger",
      rank: 5,
      reason: `高影响范围：当前被 ${refs.totalResources} 个资源引用`,
    });
  }
  if (risks.length === 0) {
    risks.push({ label: "健康", level: "success", rank: 0, reason: "健康：未发现未引用、空配置、超大配置或疑似敏感 key" });
  }
  return risks.sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));
}

export function configMapRiskRank(risks: ConfigMapRisk[]): number {
  return risks.reduce((max, risk) => Math.max(max, risk.rank), 0);
}

export function configMapMatchesFilter(
  cm: ConfigMapListRow,
  keyword: string,
  refs: ConfigMapReferenceSummary,
  risks: ConfigMapRisk[],
): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const haystack = [
    cm.metadata.name,
    cm.metadata.namespace ?? "",
    ...Object.keys(cm.data ?? {}),
    ...Object.keys(cm.binaryData ?? {}),
    ...risks.map((r) => r.label),
    refs.pods > 0 ? "pods pod" : "",
    refs.deployments > 0 ? "deployments deployment" : "",
    refs.statefulSets > 0 ? "statefulsets statefulset" : "",
    refs.daemonSets > 0 ? "daemonsets daemonset" : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(k);
}

export type ConfigMapSortKey = "name" | "namespace" | "references" | "size" | "risk" | "age";

export type ConfigMapSortStats = {
  references: number;
  sizeBytes: number;
  riskRank: number;
};

export function compareConfigMapsForSort(
  a: ConfigMapListRow,
  b: ConfigMapListRow,
  key: ConfigMapSortKey,
  getStats: (row: ConfigMapListRow) => ConfigMapSortStats,
  nowMs: number = Date.now(),
): number {
  const sa = getStats(a);
  const sb = getStats(b);
  switch (key) {
    case "name":
      return a.metadata.name.localeCompare(b.metadata.name, undefined, { sensitivity: "base", numeric: true });
    case "namespace":
      return (a.metadata.namespace ?? "").localeCompare(b.metadata.namespace ?? "", undefined, {
        sensitivity: "base",
        numeric: true,
      });
    case "references":
      return sa.references - sb.references;
    case "size":
      return sa.sizeBytes - sb.sizeBytes;
    case "risk":
      return sa.riskRank - sb.riskRank;
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

export function normalizeConfigMapDescribeView(view: ConfigMapDescribeView): ConfigMap {
  return {
    kind: "ConfigMap",
    metadata: {
      name: view.name,
      namespace: view.namespace,
      uid: view.uid,
      creationTimestamp: view.creationTimestamp,
      resourceVersion: view.resourceVersion,
      labels: view.labels,
      annotations: view.annotations,
    },
    data: view.data,
    binaryData: view.binaryData,
  };
}
