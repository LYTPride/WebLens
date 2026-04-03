/**
 * 按「集群 + 资源键」缓存 list 是否因 RBAC 被拒绝，减少重复请求与错误提示。
 * 资源键示例：`nodes`、`persistentvolumeclaims`（与 API path / ResourceKind 对齐即可）
 */

export type ResourceAccessDecision = "granted" | "denied";

const decisionByKey = new Map<string, ResourceAccessDecision>();

export function resourceAccessCacheKey(clusterId: string, resourceKey: string): string {
  return `${clusterId}::${resourceKey}`;
}

export function getResourceAccessDecision(
  clusterId: string,
  resourceKey: string,
): ResourceAccessDecision | undefined {
  if (!clusterId) return undefined;
  return decisionByKey.get(resourceAccessCacheKey(clusterId, resourceKey));
}

export function setResourceAccessDecision(
  clusterId: string,
  resourceKey: string,
  d: ResourceAccessDecision,
): void {
  if (!clusterId) return;
  decisionByKey.set(resourceAccessCacheKey(clusterId, resourceKey), d);
}

export function clearResourceAccessDecision(clusterId: string, resourceKey: string): void {
  if (!clusterId) return;
  decisionByKey.delete(resourceAccessCacheKey(clusterId, resourceKey));
}
