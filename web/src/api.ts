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
    reason?: string;
    podIP?: string;
    hostIP?: string;
    containerStatuses?: Array<{
      name: string;
      restartCount: number;
      ready: boolean;
      state?: {
        waiting?: { reason?: string; message?: string };
        terminated?: { reason?: string; message?: string };
      };
    }>;
    initContainerStatuses?: Array<{
      name: string;
      restartCount: number;
      ready: boolean;
      state?: {
        waiting?: { reason?: string; message?: string };
        terminated?: { reason?: string; message?: string };
      };
    }>;
  };
  spec?: {
    nodeName?: string;
    containers?: Array<{ name: string }>;
  };
  // 后端计算得到的健康信息，仅用于前端标签展示与解释
  healthLabel?: "健康" | "关注" | "警告" | "严重";
  healthReasons?: string[];
  healthScore?: number;
}

export interface ContainerFileEntry {
  name: string;
  type: "file" | "dir";
  /** bytes; -1 表示未知 */
  size: number;
}

export interface ListContainerFilesResponse {
  path: string;
  items: ContainerFileEntry[];
}

export interface K8sEvent {
  metadata: {
    uid?: string;
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
  };
  type?: string;
  reason?: string;
  message?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  count?: number;
  source?: {
    component?: string;
    host?: string;
  };
}

export interface PodDescribe {
  pod: Pod;
  events: K8sEvent[];
}

/** Deployment Describe 视图块（与后端 DeploymentDescribeView 对齐） */
export interface EnvDescribeView {
  name: string;
  value?: string;
  from?: string;
}

export interface ContainerDescribeView {
  name: string;
  image: string;
  ports?: string[];
  requests?: Record<string, string>;
  limits?: Record<string, string>;
  env?: EnvDescribeView[];
  volumeMounts?: string[];
}

export interface VolumeDescribeView {
  name: string;
  kind: string;
}

export interface K8sTolerationLoose {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

export interface DeploymentReplicaStatusView {
  desired: number;
  updated: number;
  ready: number;
  available: number;
  unavailable: number;
}

export interface RollingUpdateDescribeView {
  maxUnavailable?: string;
  maxSurge?: string;
}

export interface DeploymentConditionView {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  lastUpdateTime?: string;
}

export interface DeploymentPodTemplateView {
  containers: ContainerDescribeView[];
  initContainers?: ContainerDescribeView[];
  volumes?: VolumeDescribeView[];
  serviceAccount?: string;
  nodeSelector?: Record<string, string>;
  tolerations?: K8sTolerationLoose[];
}

export interface DeploymentDescribeView {
  name: string;
  namespace: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selector?: string;
  replicas: DeploymentReplicaStatusView;
  conditions?: DeploymentConditionView[];
  podTemplate: DeploymentPodTemplateView;
  strategyType: string;
  rollingUpdate?: RollingUpdateDescribeView;
  progressDeadlineSeconds?: number | null;
}

export interface DeploymentDescribe {
  view: DeploymentDescribeView;
  events: K8sEvent[];
}

export interface ClusterCombo {
  id: string;
  clusterId: string;
  namespace: string;
  alias?: string;
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

/** 获取所有预设的集群组合（clusterId + namespace） */
export async function fetchClusterCombos(): Promise<ClusterCombo[]> {
  const res = await api.get<{ items: ClusterCombo[] }>("/api/cluster-combos");
  return res.data.items;
}

/** 新增或更新一个集群组合 */
export async function addClusterCombo(
  clusterId: string,
  namespace: string,
  alias: string,
): Promise<ClusterCombo[]> {
  const res = await api.post<{ items: ClusterCombo[] }>("/api/cluster-combos", {
    clusterId,
    namespace,
    alias,
  });
  return res.data.items;
}

/** 更新组合别名 */
export async function updateClusterComboAlias(id: string, alias: string): Promise<ClusterCombo[]> {
  const res = await api.put<{ items: ClusterCombo[] }>(`/api/cluster-combos/${encodeURIComponent(id)}`, {
    alias,
  });
  return res.data.items;
}

/** 删除一个组合 */
export async function deleteClusterComboApi(id: string): Promise<ClusterCombo[]> {
  const res = await api.delete<{ items: ClusterCombo[] }>(`/api/cluster-combos/${encodeURIComponent(id)}`);
  return res.data.items;
}

/** 测试组合可用性（返回 ok + 可选错误信息） */
export async function testClusterCombo(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await api.post<{ ok: boolean; error?: string }>(
    `/api/cluster-combos/${encodeURIComponent(id)}/test`,
    {},
  );
  return res.data;
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

export async function listContainerFiles(
  clusterId: string,
  namespace: string,
  pod: string,
  container: string,
  path: string,
): Promise<ListContainerFilesResponse> {
  const res = await api.get<ListContainerFilesResponse>(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/files`,
    {
      params: {
        container,
        path,
      },
    },
  );
  return res.data;
}

export async function mkdirInContainer(
  clusterId: string,
  namespace: string,
  pod: string,
  container: string,
  path: string,
): Promise<void> {
  await api.post(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/files/mkdir`,
    { path },
    { params: { container } },
  );
}

export async function renameInContainer(
  clusterId: string,
  namespace: string,
  pod: string,
  container: string,
  from: string,
  to: string,
): Promise<void> {
  await api.post(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/files/rename`,
    { from, to },
    { params: { container } },
  );
}

export async function deleteInContainer(
  clusterId: string,
  namespace: string,
  pod: string,
  container: string,
  paths: string[],
): Promise<void> {
  await api.post(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/files/delete`,
    { paths },
    { params: { container } },
  );
}

export function downloadContainerFilesUrl(
  clusterId: string,
  namespace: string,
  pod: string,
  container: string,
  paths: string[],
): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = new URL(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/files/download`,
    base,
  );
  url.searchParams.set("container", container);
  paths.forEach((p) => url.searchParams.append("path", p));
  return url.toString();
}

export async function uploadContainerFile(
  clusterId: string,
  namespace: string,
  pod: string,
  container: string,
  dstPath: string,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.set("path", dstPath);
  form.set("file", file);
  await api.post(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/files/upload`,
    form,
    {
      params: { container },
      headers: { "Content-Type": "multipart/form-data" },
    },
  );
}

export type PodWatchEventType = "ADDED" | "MODIFIED" | "DELETED" | "ERROR";

export interface PodWatchEvent {
  type: PodWatchEventType;
  object: Pod;
}

export interface ResourceWatchEvent<T = any> {
  type: PodWatchEventType;
  object: T;
}

/**
 * 使用后端封装的 Kubernetes Watch API 做 Pod 实时变更监听。
 * 基于 fetch + ReadableStream 逐行读取 JSON 事件。
 */
export function watchPods(
  clusterId: string,
  namespace: string | undefined,
  opts: {
    onEvent: (ev: PodWatchEvent) => void;
    onError?: (err: Error) => void;
  },
): () => void {
  const ac = new AbortController();
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = new URL(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/watch`,
    base,
  );
  if (namespace && namespace !== "") {
    url.searchParams.set("namespace", namespace);
  }

  fetch(url.toString(), { signal: ac.signal })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(res.statusText || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        // 按行分割，每行一个 JSON 事件
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as PodWatchEvent;
            if (ev && ev.object && ev.object.metadata) {
              opts.onEvent(ev);
            }
          } catch (e) {
            // 单条事件解析失败不影响后续
            // eslint-disable-next-line no-console
            console.warn("Failed to parse pods watch event:", e);
          }
        }
      }
    })
    .catch((err) => {
      if (err?.name === "AbortError") return;
      opts.onError?.(err);
    });

  return () => ac.abort();
}

/**
 * 通用资源 Watch：基于 `/api/clusters/:id/:resourcePath/watch` 的 JSON 行流。
 * 用于 Deployments / StatefulSets / ... 等列表。
 */
export function watchResourceList<T = any>(
  clusterId: string,
  kind: ResourceKind,
  namespace: string | undefined,
  opts: {
    onEvent: (ev: ResourceWatchEvent<T>) => void;
    onError?: (err: Error) => void;
  },
): () => void {
  const ac = new AbortController();
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const path = resourcePath(kind);
  const url = new URL(
    `/api/clusters/${encodeURIComponent(clusterId)}/${path}/watch`,
    base,
  );
  if (namespace && namespace !== "") {
    url.searchParams.set("namespace", namespace);
  }

  fetch(url.toString(), { signal: ac.signal })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(res.statusText || `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as ResourceWatchEvent<T>;
            if (ev && ev.object) {
              opts.onEvent(ev);
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("Failed to parse resource watch event:", e);
          }
        }
      }
    })
    .catch((err) => {
      if (err?.name === "AbortError") return;
      opts.onError?.(err);
    });

  return () => ac.abort();
}

/** 获取 Pod Describe 数据（Pod + Events） */
export async function fetchPodDescribe(
  clusterId: string,
  namespace: string,
  pod: string,
): Promise<PodDescribe> {
  const res = await api.get<PodDescribe>(
    `/api/clusters/${encodeURIComponent(clusterId)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/describe`,
  );
  return res.data;
}

export async function fetchDeploymentDescribe(
  clusterId: string,
  namespace: string,
  name: string,
): Promise<DeploymentDescribe> {
  const res = await api.get<DeploymentDescribe>(
    `/api/clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/describe`,
  );
  return res.data;
}

export async function fetchPodLogs(
  clusterId: string,
  namespace: string,
  pod: string,
  container?: string,
  follow = false,
  previous = false,
  timestamps = false,
  sinceTime?: string,
) {
  const res = await api.get<string>(
    `/api/clusters/${encodeURIComponent(
      clusterId,
    )}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}/logs`,
    {
      params: {
        container,
        follow,
        previous,
        timestamps,
        ...(sinceTime ? { sinceTime } : {}),
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
    previous?: boolean;
    timestamps?: boolean;
    sinceTime?: string;
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
  if (opts.previous) url.searchParams.set("previous", "true");
  if (opts.timestamps) url.searchParams.set("timestamps", "true");
   if (opts.sinceTime) url.searchParams.set("sinceTime", opts.sinceTime);

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

/** Deployment YAML（编辑） */
export async function fetchDeploymentYaml(
  clusterId: string,
  namespace: string,
  name: string,
): Promise<string> {
  const res = await api.get<string>(
    `/api/clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/yaml`,
    { responseType: "text" },
  );
  return res.data;
}

/** 应用 Deployment YAML，返回更新后的对象（JSON） */
export async function applyDeploymentYaml(
  clusterId: string,
  namespace: string,
  name: string,
  yamlBody: string,
): Promise<unknown> {
  const res = await api.put(
    `/api/clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    yamlBody,
    { headers: { "Content-Type": "text/yaml" } },
  );
  return res.data;
}

export async function scaleDeployment(
  clusterId: string,
  namespace: string,
  name: string,
  replicas: number,
): Promise<unknown> {
  const res = await api.patch(
    `/api/clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/scale`,
    { replicas },
  );
  return res.data;
}

export async function restartDeployment(
  clusterId: string,
  namespace: string,
  name: string,
): Promise<unknown> {
  const res = await api.post(
    `/api/clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`,
  );
  return res.data;
}

export async function deleteDeployment(
  clusterId: string,
  namespace: string,
  name: string,
): Promise<void> {
  await api.delete(
    `/api/clusters/${encodeURIComponent(clusterId)}/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
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

