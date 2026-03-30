import type { Pod, PodWatchEvent, ResourceWatchEvent } from "../api";

/**
 * Watch 事件归约：把 ADDED/MODIFIED/DELETED 合并进当前作用域内的「原始列表」。
 * 列表项应保持为 API / apiserver 形状（必要时带服务端附加字段如 Pod 的 healthLabel），
 * 不要在 reducer 里写展示用 displayStatus；表格列在渲染时从 raw 派生。
 *
 * @param effectiveNamespace 已应用的命名空间；空字符串表示「所有命名空间」不过滤
 */

export function applyPodWatchEvent(prev: Pod[], ev: PodWatchEvent, effectiveNamespace: string): Pod[] {
  const obj = ev.object;
  if (!obj?.metadata?.uid) return prev;
  const uid = obj.metadata.uid;
  const ns = obj.metadata.namespace;
  if (effectiveNamespace && effectiveNamespace !== "" && ns !== effectiveNamespace) {
    return prev;
  }
  if (ev.type === "DELETED") {
    return prev.filter((p) => p.metadata.uid !== uid);
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
