import type { EventSortRow } from "./resourceListSort";
import type { ResourceKind } from "../api";
import { resolveInvolvedKindToListView } from "./v1HiddenViews";

/** 事件 Type 展示用 */
export function eventTypeDisplay(type: string | undefined): "Warning" | "Normal" | string {
  const t = (type || "").trim();
  if (!t) return "Normal";
  if (t.toLowerCase() === "warning") return "Warning";
  if (t.toLowerCase() === "normal") return "Normal";
  return t;
}

export function eventIsWarning(row: EventSortRow): boolean {
  return (row.type || "").toLowerCase() === "warning";
}

/** Involved Object 列展示：Kind / name */
export function formatEventInvolved(row: EventSortRow): string {
  const io = row.involvedObject;
  const k = (io?.kind || "").trim() || "—";
  const n = (io?.name || "").trim() || "—";
  return `${k} / ${n}`;
}

/** 与侧栏 ResourceKind 对齐；v1 隐藏或未实现则 null（与 resolveInvolvedKindToListView 同源） */
export function involvedKindToView(kind: string | undefined): ResourceKind | null {
  return resolveInvolvedKindToListView(kind);
}

/** 跳转时用于名称过滤的字符串（一般为 InvolvedObject.name） */
export function involvedObjectFilterName(row: EventSortRow): string {
  return (row.involvedObject?.name || "").trim();
}

/** Reason / Message / Involved / Namespace / metadata.name 模糊匹配 */
export function eventMatchesFilter(row: EventSortRow, filter: string): boolean {
  const k = filter.trim().toLowerCase();
  if (!k) return true;
  const parts = [
    row.reason,
    row.message,
    formatEventInvolved(row),
    row.metadata?.namespace,
    row.metadata?.name,
    row.involvedObject?.name,
    row.involvedObject?.kind,
  ];
  return parts.some((p) => (p || "").toLowerCase().includes(k));
}
