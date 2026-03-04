import axios from "axios";

export interface ClusterSummary {
  id: string;
  name: string;
  filePath: string;
  context: string;
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
  };
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

