import React from "react";
import { ResizableTh } from "./ResizableTh";
import { ResourceSortArrows } from "./ResourceSortArrows";
import {
  isEventSortableColumnKey,
  type EventSortRow,
  type ResourceListSortState,
  type EventSortKey,
  buildEventSortStats,
} from "../utils/resourceListSort";
import { formatAgeFromMetadata } from "../utils/k8sCreationTimestamp";
import {
  formatEventInvolved,
  involvedKindToView,
  involvedObjectFilterName,
  eventIsWarning,
} from "../utils/eventTable";
import type { ResourceKind } from "../api";
import { ResourceJumpChip } from "./ResourceJumpChip";

export const EVENT_COLUMN_KEYS = [
  "type",
  "reason",
  "message",
  "involved",
  "namespace",
  "count",
  "lastSeen",
  "age",
] as const;

export const EVENT_COLUMN_DEFAULTS: Record<(typeof EVENT_COLUMN_KEYS)[number], number> = {
  type: 100,
  reason: 140,
  message: 320,
  involved: 200,
  namespace: 120,
  count: 64,
  lastSeen: 152,
  age: 88,
};

const EVENT_COLUMN_SORT: Partial<Record<(typeof EVENT_COLUMN_KEYS)[number], EventSortKey>> = {
  type: "type",
  reason: "reason",
  message: "message",
  involved: "involved",
  namespace: "namespace",
  count: "count",
  lastSeen: "lastSeen",
  age: "age",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #1f2937",
  fontSize: 12,
  color: "#9ca3af",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #111827",
  fontSize: 13,
};

function typePillStyle(warning: boolean): React.CSSProperties {
  if (warning) {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 10px",
      borderRadius: 999,
      backgroundColor: "rgba(185,28,28,0.22)",
      border: "1px solid rgba(248,113,113,0.85)",
      color: "#fecaca",
      fontSize: 11,
      fontWeight: 700,
      boxSizing: "border-box" as const,
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 10px",
    borderRadius: 999,
    backgroundColor: "rgba(30,41,59,0.85)",
    border: "1px solid #475569",
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 600,
    boxSizing: "border-box" as const,
  };
}

function formatLastSeenCell(row: EventSortRow): string {
  const st = buildEventSortStats(row);
  if (st.lastSeenMs) {
    try {
      return new Date(st.lastSeenMs).toLocaleString();
    } catch {
      return "—";
    }
  }
  if (row.lastTimestamp) return row.lastTimestamp;
  if (row.eventTime) return row.eventTime;
  return "—";
}

export type EventsListTableProps = {
  sortedRows: EventSortRow[];
  eventsLoading: boolean;
  listSort: ResourceListSortState<EventSortKey>;
  setListSort: (s: ResourceListSortState<EventSortKey>) => void;
  columnWidths: Partial<Record<(typeof EVENT_COLUMN_KEYS)[number], number>>;
  beginResize: (key: (typeof EVENT_COLUMN_KEYS)[number]) => (e: React.MouseEvent) => void;
  totalWidth: number;
  listAgeNow: number;
  openDescribe: (row: EventSortRow) => void;
  onJumpToResource: (involvedKind: string | undefined, nameFilter: string) => void;
  nodesNavBlocked?: boolean;
};

export function EventsListTable({
  sortedRows,
  eventsLoading,
  listSort,
  setListSort,
  columnWidths,
  beginResize,
  totalWidth,
  listAgeNow,
  openDescribe,
  onJumpToResource,
  nodesNavBlocked,
}: EventsListTableProps) {
  const colCount = EVENT_COLUMN_KEYS.length;

  const jumpLabel = (view: ResourceKind): string => {
    if (view === "pods") return "Pods";
    if (view === "persistentvolumeclaims") return "PVC";
    if (view === "services") return "Svc";
    if (view === "ingresses") return "Ing";
    if (view === "nodes") return "Node";
    if (view === "deployments") return "Deploy";
    if (view === "statefulsets") return "STS";
    return "跳转";
  };

  const columnLabel = (k: (typeof EVENT_COLUMN_KEYS)[number]): string => {
    if (k === "type") return "Type";
    if (k === "reason") return "Reason";
    if (k === "message") return "Message";
    if (k === "involved") return "Involved Object";
    if (k === "namespace") return "Namespace";
    if (k === "count") return "Count";
    if (k === "lastSeen") return "Last Seen";
    return "Age";
  };

  return (
    <table
      style={{
        width: totalWidth,
        minWidth: "100%",
        borderCollapse: "collapse",
        backgroundColor: "#020617",
        tableLayout: "fixed",
      }}
    >
      <colgroup>
        {EVENT_COLUMN_KEYS.map((k) => (
          <col key={k} style={{ width: columnWidths[k] ?? EVENT_COLUMN_DEFAULTS[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {EVENT_COLUMN_KEYS.map((k) => {
            const sk = EVENT_COLUMN_SORT[k];
            return (
              <ResizableTh
                key={k}
                label={columnLabel(k)}
                sortTrailing={
                  sk != null && isEventSortableColumnKey(sk) ? (
                    <ResourceSortArrows
                      activeDirection={listSort?.key === sk ? listSort.direction : null}
                      onPickAsc={() => setListSort({ key: sk, direction: "asc" })}
                      onPickDesc={() => setListSort({ key: sk, direction: "desc" })}
                    />
                  ) : undefined
                }
                width={columnWidths[k] ?? EVENT_COLUMN_DEFAULTS[k]}
                thBase={thStyle}
                onResizeStart={beginResize(k)}
              />
            );
          })}
        </tr>
      </thead>
      <tbody className="wl-table-body">
          {eventsLoading && sortedRows.length === 0 && (
            <tr className="wl-table-row">
              <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                加载中…
              </td>
            </tr>
          )}
          {!eventsLoading && sortedRows.length === 0 && (
            <tr className="wl-table-row">
              <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
                当前范围内暂无事件
              </td>
            </tr>
          )}
          {sortedRows.map((row) => {
            const uid = row.metadata?.uid;
            const ns = row.metadata?.namespace ?? "";
            const name = row.metadata?.name ?? "";
            const rowKey = uid || `${ns}/${name}`;
            const warn = eventIsWarning(row);
            const view = involvedKindToView(row.involvedObject?.kind);
            const filterName = involvedObjectFilterName(row);
            const age = formatAgeFromMetadata(row.metadata as { creationTimestamp?: string }, listAgeNow);
            return (
              <tr
                key={rowKey}
                className="wl-table-row"
                style={{ cursor: "pointer" }}
                onClick={() => openDescribe(row)}
              >
                <td style={{ ...tdStyle, verticalAlign: "top" }}>
                  <span style={typePillStyle(warn)}>{row.type || "Normal"}</span>
                </td>
                <td
                  style={{
                    ...tdStyle,
                    verticalAlign: "top",
                    wordBreak: "break-word",
                    whiteSpace: "normal",
                  }}
                  title={row.reason}
                >
                  {row.reason || "—"}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    verticalAlign: "top",
                    wordBreak: "break-word",
                    whiteSpace: "normal",
                  }}
                  title={row.message}
                >
                  {row.message || "—"}
                </td>
                <td
                  style={{ ...tdStyle, verticalAlign: "top", overflow: "visible" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 12, wordBreak: "break-word" }}>
                      {formatEventInvolved(row)}
                    </span>
                    {view && filterName ? (
                      <ResourceJumpChip
                        label={jumpLabel(view)}
                        compact
                        disabled={view === "nodes" && nodesNavBlocked}
                        title={
                          view === "nodes" && nodesNavBlocked
                            ? "当前身份无权查看 Nodes"
                            : `打开 ${jumpLabel(view)} 并过滤「${filterName}」`
                        }
                        onClick={() => {
                          if (view === "nodes" && nodesNavBlocked) return;
                          onJumpToResource(row.involvedObject?.kind, filterName);
                        }}
                      />
                    ) : null}
                  </div>
                </td>
                <td style={{ ...tdStyle, verticalAlign: "top" }}>{row.metadata?.namespace || "—"}</td>
                <td style={{ ...tdStyle, verticalAlign: "top" }}>{buildEventSortStats(row).count}</td>
                <td style={{ ...tdStyle, verticalAlign: "top", fontSize: 12, color: "#94a3b8" }}>
                  {formatLastSeenCell(row)}
                </td>
                <td style={{ ...tdStyle, verticalAlign: "top" }}>{age}</td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}
