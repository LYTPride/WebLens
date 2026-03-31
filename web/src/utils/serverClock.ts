export type ServerClockSnapshot = {
  serverTimeMs: number;
  syncedPerfNowMs: number;
};

export const CLOCK_SKEW_WARN_THRESHOLD_MS = 5000;

export function parseServerTimeMs(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  return n > 0 ? n : null;
}

export function newServerClockSnapshot(serverTimeMs: number, perfNowMs: number = performance.now()): ServerClockSnapshot {
  return { serverTimeMs, syncedPerfNowMs: perfNowMs };
}

export function getCurrentServerNow(snapshot: ServerClockSnapshot | null, fallbackNowMs: number): number {
  if (!snapshot) return fallbackNowMs;
  const delta = Math.max(0, performance.now() - snapshot.syncedPerfNowMs);
  return snapshot.serverTimeMs + delta;
}

export function getClockSkewMs(serverNowMs: number, clientNowMs: number = Date.now()): number {
  return clientNowMs - serverNowMs;
}

