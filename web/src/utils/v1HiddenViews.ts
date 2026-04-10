import type { ResourceKind } from "../api";

/**
 * v1.0.0 侧栏与正式 UI 不暴露的资源视图；会话恢复与事件跳转需统一收敛。
 * 后续恢复某资源时，仅改此处与侧栏配置即可。
 */
export const V1_HIDDEN_VIEWS: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  /** 暂不在 v1 侧栏暴露；逻辑与 API 保留，恢复时移出此集合并改 Sidebar 菜单即可 */
  "nodes",
  "daemonsets",
  "jobs",
  "cronjobs",
  "configmaps",
  "secrets",
]);

const SESSION_LEGACY_NAMESPACE_VIEW = "namespaces";

/** localStorage 会话恢复：旧视图与 v1 隐藏视图回落到 pods */
export function normalizeSessionViewForV1(raw: string): ResourceKind {
  if (raw === SESSION_LEGACY_NAMESPACE_VIEW || V1_HIDDEN_VIEWS.has(raw as ResourceKind)) {
    return "pods";
  }
  return raw as ResourceKind;
}

/**
 * Event InvolvedObject.kind（任意大小写）→ 与侧栏一致的列表视图 key。
 * 未实现、无法列表展示或 v1 已隐藏的 kind 返回 null（不跳转、不展示快捷入口）。
 */
export function resolveInvolvedKindToListView(kind: string | undefined | null): ResourceKind | null {
  if (kind == null || kind === "") return null;
  const k = kind.trim().toLowerCase();
  let view: ResourceKind | null = null;
  if (k === "pod") view = "pods";
  else if (k === "persistentvolumeclaim") view = "persistentvolumeclaims";
  else if (k === "service") view = "services";
  else if (k === "ingress") view = "ingresses";
  else if (k === "node") view = "nodes";
  else if (k === "deployment") view = "deployments";
  else if (k === "statefulset") view = "statefulsets";
  else if (k === "daemonset") view = "daemonsets";
  else if (k === "job") view = "jobs";
  else if (k === "cronjob") view = "cronjobs";
  else if (k === "configmap") view = "configmaps";
  else if (k === "secret") view = "secrets";
  if (!view) return null;
  if (V1_HIDDEN_VIEWS.has(view)) return null;
  return view;
}
