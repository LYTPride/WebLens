/**
 * Kubernetes metadata.creationTimestamp 的读取与 Age 展示。
 * 仅使用 apiserver 下发的创建时间（RFC3339 字符串）；不使用后端预计算 age 字段。
 */

/** 从 metadata 读取创建时间（兼容 string、极少数中间层嵌套、snake_case） */
export function readCreationTimestampFromMetadata(
  meta: { creationTimestamp?: unknown; creation_timestamp?: unknown } | undefined,
): string | undefined {
  if (!meta) return undefined;
  const raw = meta.creationTimestamp ?? meta.creation_timestamp;
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length ? t : undefined;
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const inner = o.Time ?? o.time;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  return undefined;
}

/**
 * 由 metadata.creationTimestamp 计算存活时间展示串（与 kubectl age 语义一致：相对当前时刻）。
 * @param nowMs 由 useNowTick 等统一传入，避免 Age 仅随 watch 刷新
 */
export function formatAgeFromMetadata(
  meta: { creationTimestamp?: unknown; creation_timestamp?: unknown } | undefined,
  nowMs: number = Date.now(),
): string {
  const ts = readCreationTimestampFromMetadata(meta);
  if (!ts) return "-";
  const start = Date.parse(ts);
  if (Number.isNaN(start)) return "-";
  const sec = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  if (sec < 3600) {
    return `${min}m${remainSec ? `${remainSec}s` : ""}`;
  }
  const h = Math.floor(sec / 3600);
  const remainMin = Math.floor((sec % 3600) / 60);
  if (sec < 24 * 3600) {
    return `${h}h${remainMin ? `${remainMin}m` : ""}`;
  }
  const d = Math.floor(sec / (24 * 3600));
  const remainHour = Math.floor((sec % (24 * 3600)) / 3600);
  return `${d}d${remainHour ? `${remainHour}h` : ""}`;
}

/** 排序用：当前时刻相对创建时间的秒数（与列表 Age 列一致） */
export function creationTimestampToAgeSeconds(
  meta: { creationTimestamp?: unknown; creation_timestamp?: unknown } | undefined,
  nowMs: number = Date.now(),
): number | null {
  const ts = readCreationTimestampFromMetadata(meta);
  if (!ts) return null;
  const start = Date.parse(ts);
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}
