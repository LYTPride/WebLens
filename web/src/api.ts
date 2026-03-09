import axios from "axios";

export interface ClusterSummary {
  id: string;
  name: string;
  filePath: string;
  context: string;
  /** kubeconfig context 中的默认命名空间，无集群级 list namespaces 权限时可作为唯一选项 */
  defaultNamespace?: string;
}

export interface Pod {
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    creationTimestamp?: string;
  };
  status?: {
    phase?: string;
    podIP?: string;
    hostIP?: string;
    containerStatuses?: Array<{
      name: string;
      restartCount: number;
      ready: boolean;
    }>;
  };
  spec?: {
    nodeName?: string;
    containers?: Array<{ name: string }>;
  };
}

/** 从 Pod 取容器名列表（用于 Shell/Logs 子菜单），优先 spec.containers，否则 status.containerStatuses */
export function getPodContainerNames(pod: Pod): string[] {
  const fromSpec = pod.spec?.containers?.map((c) => c.name) ?? [];
  const fromStatus = pod.status?.containerStatuses?.map((c) => c.name) ?? [];
  if (fromSpec.length > 0) return fromSpec;
  return fromStatus.length > 0 ? fromStatus : ["default"];
}

// 与后端同源部署时，直接使用当前站点 origin（协议+主机+端口），避免写死 IP/端口。
// 如果前端被独立静态服务器托管到另一个端口，那么需要用反向代理把 /api 转发到后端。
const baseURL = typeof window !== "undefined" ? window.location.origin : "";

const api = axios.create({
  baseURL,
});

export async function fetchClusters() {
  const res = await api.get<{ items: ClusterSummary[] }>("/api/clusters");
  return res.data.items;
}

/** 重新扫描 kubeconfig 目录并返回最新集群列表（用于「刷新」按钮） */
export async function reloadClustersFromBackend() {
  const res = await api.post<{ items: ClusterSummary[] }>("/api/clusters/reload");
  return res.data.items;
}

/** 获取平台配置（当前 kubeconfig 目录） */
export async function fetchConfig(): Promise<{ kubeconfigDir: string }> {
  const res = await api.get<{ kubeconfigDir: string }>("/api/config");
  return res.data;
}

/** 设置 kubeconfig 存放目录并重载集群；目录不存在时后端返回 400 */
export async function saveConfig(kubeconfigDir: string): Promise<{ kubeconfigDir: string; items: ClusterSummary[] }> {
  const res = await api.post<{ kubeconfigDir: string; items: ClusterSummary[] }>("/api/config", {
    kubeconfigDir: kubeconfigDir.trim(),
  });
  return res.data;
}

/** 获取指定集群下的命名空间列表（用于命名空间下拉框） */
export async function fetchNamespaces(clusterId: string): Promise<string[]> {
  const res = await api.get<{ items: Array<{ metadata: { name: string } }> }>(
    `/api/clusters/${encodeURIComponent(clusterId)}/namespaces`,
  );
  return (res.data.items || []).map((n) => n.metadata.name).sort();
}

export async function fetchPods(clusterId: string, namespace?: string) {
  const res = await api.get<{ items: Pod[] }>(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods`,
    { params: namespace ? { namespace } : {} },
  );
  return res.data.items;
}

export async function fetchPodLogs(
  clusterId: string,
  namespace: string,
  pod: string,
  container?: string,
  follow = false,
) {
  const res = await api.get<string>(
    `/api/clusters/${encodeURIComponent(
      clusterId,
    )}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs`,
    {
      params: {
        container,
        follow,
      },
      responseType: "text",
    },
  );
  return res.data;
}

/**
 * 实时 follow Pod 日志流；返回取消函数，组件卸载时调用。
 */
export function streamPodLogs(
  clusterId: string,
  namespace: string,
  pod: string,
  opts: {
    container?: string;
    tailLines?: number;
    onChunk: (text: string) => void;
    onError?: (err: Error) => void;
  },
): () => void {
  const ac = new AbortController();
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = new URL(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs`,
    base,
  );
  url.searchParams.set("follow", "true");
  if (opts.container) url.searchParams.set("container", opts.container);
  if (opts.tailLines != null) url.searchParams.set("tailLines", String(opts.tailLines));

  fetch(url.toString(), { signal: ac.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(res.statusText);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No body");
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        opts.onChunk(decoder.decode(value, { stream: true }));
      }
    })
    .catch((err) => {
      if (err?.name === "AbortError") return;
      opts.onError?.(err);
    });

  return () => ac.abort();
}

/** 获取 Pod 原始 YAML（用于编辑） */
export async function fetchPodYaml(
  clusterId: string,
  namespace: string,
  pod: string,
): Promise<string> {
  const res = await api.get<string>(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/yaml`,
    { responseType: "text" },
  );
  return res.data;
}

/** 应用 Pod YAML 更新 */
export async function applyPodYaml(
  clusterId: string,
  namespace: string,
  pod: string,
  yamlBody: string,
): Promise<void> {
  await api.put(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}`,
    yamlBody,
    { headers: { "Content-Type": "text/yaml" } },
  );
}

/** 删除 Pod */
export async function deletePod(clusterId: string, namespace: string, pod: string): Promise<void> {
  await api.delete(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}`,
  );
}

/** 通用：按资源路径拉取 items（用于 Deployments / StatefulSets / ...） */
export async function fetchResourceList<T = unknown>(
  clusterId: string,
  resourcePath: string,
  namespace?: string,
): Promise<T[]> {
  const res = await api.get<{ items: T[] }>(
    `/api/clusters/${encodeURIComponent(clusterId)}/${resourcePath}`,
    { params: namespace ? { namespace } : {} },
  );
  return res.data.items || [];
}

export type ResourceKind =
  | "pods"
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "jobs"
  | "cronjobs"
  | "events"
  | "configmaps"
  | "secrets"
  | "services"
  | "ingresses"
  | "nodes"
  | "namespaces";

/** 返回某资源的 API 路径（不含 /api/clusters/:id/） */
export function resourcePath(kind: ResourceKind): string {
  return kind;
}

/** 构建 Pod Exec WebSocket URL（同源） */
export function podExecWsUrl(
  clusterId: string,
  namespace: string,
  pod: string,
  container?: string,
): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const u = new URL(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/exec`,
    origin,
  );
  if (container) u.searchParams.set("container", container);
  return (u.protocol === "https:" ? "wss:" : "ws:") + "//" + u.host + u.pathname + u.search;
}

