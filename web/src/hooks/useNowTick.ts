import { useEffect, useState } from "react";

/**
 * 统一「当前时刻」节拍，供 Age 等相对时间列每秒重算，避免依赖 watch/list 才刷新。
 * 单一定时器；不要在表格每行各自 setInterval。
 *
 * @param intervalMs 默认 1000
 * @param active 为 false 时不跑定时器（省资源）；切回 true 时会先对齐到当前时间再启动
 */
export function useNowTick(intervalMs: number = 1000, active: boolean = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
