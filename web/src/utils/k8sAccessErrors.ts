/**
 * 判断 list/watch 等失败是否属于「当前身份无权访问」类，用于统一受限态而非整页报错。
 */

export function httpStatusFromError(err: unknown): number | undefined {
  const e = err as { response?: { status?: number }; message?: string };
  if (typeof e?.response?.status === "number") return e.response.status;
  const msg = e?.message;
  if (typeof msg === "string") {
    const m = /HTTP (\d{3})/.exec(msg);
    if (m) return parseInt(m[1], 10);
  }
  return undefined;
}

function backendErrorText(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  const raw = e?.response?.data?.error ?? e?.message ?? "";
  return typeof raw === "string" ? raw : String(raw);
}

/**
 * Forbidden / Unauthorized / 常见 500 包装下的 RBAC 拒绝文案（如 nodes is forbidden: User ... cannot list ...）
 */
export function isK8sAccessDeniedError(err: unknown): boolean {
  const status = httpStatusFromError(err);
  if (status === 401 || status === 403) return true;
  const text = backendErrorText(err).toLowerCase();
  if (text.includes("forbidden")) return true;
  if (text.includes("unauthorized")) return true;
  if (text.includes("cannot list resource")) return true;
  if (text.includes("cannot watch resource")) return true;
  if (text.includes("cannot get resource")) return true;
  if (status === 500 && (text.includes("forbidden") || text.includes("unauthorized"))) return true;
  return false;
}

/** 供折叠「技术详情」展示的短摘要，避免整段堆在页面上 */
export function k8sAccessDeniedSummary(err: unknown): string {
  const t = backendErrorText(err).trim();
  if (t.length > 280) return `${t.slice(0, 277)}…`;
  return t || "无更多详情";
}
