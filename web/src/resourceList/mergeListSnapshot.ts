import type { Pod } from "../api";

/**
 * Watch 缺口补齐：用一次 list 快照与内存列表合并（不取代 watch，仅修复漏掉的 ADDED 等）。
 * 约定：list 对「当前查询命名空间」是完整真值；其它命名空间上已有行予以保留。
 *
 * @param effectiveNamespace 空字符串表示「所有命名空间」——此时以 list 全量为准（与 GET /pods 语义一致）
 */
export function mergePodsWithListSnapshot(prev: Pod[], listItems: Pod[], effectiveNamespace: string): Pod[] {
  if (!effectiveNamespace || effectiveNamespace === "") {
    return listItems.slice();
  }
  const other = prev.filter((p) => p.metadata.namespace !== effectiveNamespace);
  return [...other, ...listItems];
}

/** Deployments / StatefulSets / 其它 namespaced 列表项（按 metadata.namespace + name 区分作用域） */
export function mergeNamespacedItemsWithListSnapshot<T extends { metadata?: { name?: string; namespace?: string } }>(
  prev: T[],
  listItems: T[],
  effectiveNamespace: string,
): T[] {
  if (!effectiveNamespace || effectiveNamespace === "") {
    return listItems.slice();
  }
  const other = prev.filter((i) => (i.metadata?.namespace || "") !== effectiveNamespace);
  return [...other, ...listItems];
}
