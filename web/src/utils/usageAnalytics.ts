/**
 * v1 轻量使用埋点：POST 单行 JSON 到后端写入 logs/analytics.log（或 WEBLENS_ANALYTICS_LOG）。
 * 失败静默忽略，不阻塞主流程。
 */
export type UsageAnalyticsFields = {
  event: string;
  resource?: string;
  scope_alias?: string;
  cluster_id?: string;
  namespace?: string;
  target?: string;
  extra?: Record<string, unknown>;
};

export function trackUsage(fields: UsageAnalyticsFields): void {
  if (typeof window === "undefined") return;
  try {
    const url = `${window.location.origin}/api/analytics/events`;
    const body = JSON.stringify(fields);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (ok) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
