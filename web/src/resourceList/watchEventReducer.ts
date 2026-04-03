import type { Pod, PodWatchEvent, ResourceWatchEvent } from "../api";
import { readCreationTimestampFromMetadata } from "../utils/k8sCreationTimestamp";

/**
 * apiserver 的 watch JSON 里 metadata.creationTimestamp 常带 omitempty；
 * MODIFIED 若未带该字段，整对象替换会「洗掉」创建时间，Age 会错用后续来源或显示异常。
 * 同一 uid 下若新对象缺少 creationTimestamp，则保留列表中已有的值。
 */
function withPreservedCreationTimestamp(prev: Pod[], incoming: Pod, uid: string): Pod {
  const incTs = readCreationTimestampFromMetadata(incoming.metadata);
  if (incTs) return incoming;
  const prevPod = prev.find((p) => p.metadata.uid === uid);
  const oldTs = prevPod ? readCreationTimestampFromMetadata(prevPod.metadata) : undefined;
  if (oldTs) {
    return {
      ...incoming,
      metadata: { ...incoming.metadata, creationTimestamp: oldTs },
    };
  }
  return incoming;
}

/**
 * Watch 事件归约：把 ADDED/MODIFIED/DELETED 合并进当前作用域内的「原始列表」。
 * 列表项应保持为 API / apiserver 形状（必要时带服务端附加字段如 Pod 的 healthLabel），
 * 不要在 reducer 里写展示用 displayStatus；表格列在渲染时从 raw 派生。
 *
 * @param effectiveNamespace 已应用的命名空间；空字符串表示「所有命名空间」不过滤
 */

export function applyPodWatchEvent(prev: Pod[], ev: PodWatchEvent, effectiveNamespace: string): Pod[] {
  // apiserver 在 AllowWatchBookmarks 时会下发 BOOKMARK；ERROR 等也不应写入列表
  if (ev.type !== "ADDED" && ev.type !== "MODIFIED" && ev.type !== "DELETED") {
    return prev;
  }
  let obj = ev.object;
  if (!obj?.metadata?.uid) return prev;
  const uid = obj.metadata.uid;
  const ns = obj.metadata.namespace;
  if (effectiveNamespace && effectiveNamespace !== "" && ns !== effectiveNamespace) {
    return prev;
  }
  if (ev.type === "DELETED") {
    return prev.filter((p) => p.metadata.uid !== uid);
  }
  obj = withPreservedCreationTimestamp(prev, obj, uid);
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem("weblens_debug_pod_age") === "1" &&
    (ev.type === "ADDED" || ev.type === "MODIFIED")
  ) {
    // eslint-disable-next-line no-console
    console.debug("[weblens reducer pod merge]", ev.type, {
      uid,
      name: obj.metadata?.name,
      creationTimestampAfterPreserve: readCreationTimestampFromMetadata(obj.metadata),
    });
  }
  let replaced = false;
  const next = prev.map((p) => {
    if (p.metadata.uid === uid) {
      replaced = true;
      return obj;
    }
    return p;
  });
  if (!replaced) {
    next.push(obj);
  }
  return next;
}

/**
 * Deployments / StatefulSets / 多数带 metadata.name + namespace 的列表资源。
 * 与 apiserver watch 对象对齐；若某资源更可靠使用 uid，可另写按 uid 的 reducer。
 */
export function applyK8sNamespacedWatchEvent<T>(
  prev: T[],
  ev: ResourceWatchEvent<T>,
  effectiveNamespace: string,
): T[] {
  if (ev.type !== "ADDED" && ev.type !== "MODIFIED" && ev.type !== "DELETED") {
    return prev;
  }
  const obj = ev.object as T;
  const meta = (obj as { metadata?: { name?: string; namespace?: string } }).metadata || {};
  const name = meta.name;
  const itemNs: string | undefined = meta.namespace;
  if (!name) return prev;
  if (effectiveNamespace && effectiveNamespace !== "" && itemNs && itemNs !== effectiveNamespace) {
    return prev;
  }
  const key = `${itemNs || ""}/${name}`;
  if (ev.type === "DELETED") {
    return prev.filter((i) => {
      const m = (i as { metadata?: { name?: string; namespace?: string } }).metadata || {};
      const k = `${m.namespace || ""}/${m.name}`;
      return k !== key;
    });
  }
  let replaced = false;
  const next = prev.map((i) => {
    const m = (i as { metadata?: { name?: string; namespace?: string } }).metadata || {};
    const k = `${m.namespace || ""}/${m.name}`;
    if (k === key) {
      replaced = true;
      return obj;
    }
    return i;
  });
  if (!replaced) {
    next.push(obj);
  }
  return next;
}

type ClusterScopedMeta = {
  metadata?: { uid?: string; name?: string; creationTimestamp?: string };
};

function withPreservedClusterScopedCreationTimestamp<T extends ClusterScopedMeta>(
  prev: T[],
  incoming: T,
  uid: string,
): T {
  const incTs = readCreationTimestampFromMetadata(incoming.metadata);
  if (incTs) return incoming;
  const prevItem = prev.find((x) => (x.metadata?.uid || "") === uid);
  const oldTs = prevItem ? readCreationTimestampFromMetadata(prevItem.metadata) : undefined;
  if (oldTs) {
    return {
      ...incoming,
      metadata: { ...incoming.metadata, creationTimestamp: oldTs },
    };
  }
  return incoming;
}

/** Nodes / 其它集群级资源：按 metadata.uid 合并，保留 creationTimestamp */
export function applyK8sClusterScopedWatchEvent<T extends ClusterScopedMeta>(
  prev: T[],
  ev: ResourceWatchEvent<T>,
): T[] {
  if (ev.type !== "ADDED" && ev.type !== "MODIFIED" && ev.type !== "DELETED") {
    return prev;
  }
  let obj = ev.object as T;
  const uid = obj.metadata?.uid;
  const name = obj.metadata?.name;
  if (!uid || !name) return prev;
  if (ev.type === "DELETED") {
    return prev.filter((i) => (i.metadata?.uid || "") !== uid);
  }
  obj = withPreservedClusterScopedCreationTimestamp(prev, obj, uid);
  let replaced = false;
  const next = prev.map((i) => {
    if ((i.metadata?.uid || "") === uid) {
      replaced = true;
      return obj;
    }
    return i;
  });
  if (!replaced) {
    next.push(obj);
  }
  return next;
}
