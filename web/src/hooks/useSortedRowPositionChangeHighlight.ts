import { useEffect, useRef, useState } from "react";

/** 与 `wl-row-sort-position-changed` 动画总时长一致（约 300ms 起势 + 渐隐） */
export const SORT_ROW_MOVE_HIGHLIGHT_MS = 1500;

/**
 * 在「已启用单列排序」且列表为 watch 实时更新时，若某行在排序结果中的 index 相对上一帧发生变化，
 * 则短暂标记该行 id，供表头行 class 做「位置变化」高亮（值变但 index 不变不会标记）。
 */
export function useSortedRowPositionChangeHighlight<T>(options: {
  sortedRows: T[];
  sortActive: boolean;
  getId: (row: T) => string;
  /** 当前列表展示集合身份（如 uid 排序拼接），过滤结果变化时重置上一帧索引，避免误闪 */
  membershipKey: string;
  /** 排序条件序列化，变化时重置上一帧索引 */
  sortSpecKey: string;
  /** 仅当前视图展示该表时为 true */
  viewActive: boolean;
}): Set<string> {
  const { sortedRows, sortActive, getId, membershipKey, sortSpecKey, viewActive } = options;
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const prevIndexRef = useRef<Map<string, number>>(new Map());
  const prevMembershipRef = useRef(membershipKey);
  const prevSortSpecRef = useRef(sortSpecKey);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!viewActive || !sortActive) {
      prevIndexRef.current.clear();
      prevMembershipRef.current = membershipKey;
      prevSortSpecRef.current = sortSpecKey;
      setHighlightIds(new Set());
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      return;
    }

    if (prevMembershipRef.current !== membershipKey || prevSortSpecRef.current !== sortSpecKey) {
      prevMembershipRef.current = membershipKey;
      prevSortSpecRef.current = sortSpecKey;
      prevIndexRef.current.clear();
      const baseline = new Map(sortedRows.map((row, i) => [getId(row), i]));
      prevIndexRef.current = baseline;
      return;
    }

    const curr = new Map(sortedRows.map((row, i) => [getId(row), i]));
    const prev = prevIndexRef.current;
    const moved = new Set<string>();
    if (prev.size > 0) {
      for (const [id, idx] of curr) {
        const oldIdx = prev.get(id);
        if (oldIdx !== undefined && oldIdx !== idx) {
          moved.add(id);
        }
      }
    }
    prevIndexRef.current = curr;

    if (moved.size > 0) {
      const ids = [...moved];
      /* 先摘掉 class 再在下一帧加回，便于同一行短时间内再次位移时重启动画 */
      setHighlightIds((prevSet) => {
        const next = new Set(prevSet);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      requestAnimationFrame(() => {
        setHighlightIds((prevSet) => {
          const next = new Set(prevSet);
          ids.forEach((id) => next.add(id));
          return next;
        });
        ids.forEach((id) => {
          const existing = timersRef.current.get(id);
          if (existing) clearTimeout(existing);
          const t = setTimeout(() => {
            setHighlightIds((prevSet) => {
              const next = new Set(prevSet);
              next.delete(id);
              return next;
            });
            timersRef.current.delete(id);
          }, SORT_ROW_MOVE_HIGHLIGHT_MS);
          timersRef.current.set(id, t);
        });
      });
    }
    // sortedRows：引用随数据更新变化；getId 由调用方保持稳定（useCallback 或模块级函数）
  }, [sortedRows, sortActive, viewActive, membershipKey, sortSpecKey, getId]);

  return highlightIds;
}
