import React from "react";
import { ResizableTh } from "./ResizableTh";
import { ResourceSortArrows } from "./ResourceSortArrows";
import {
  isNodeSortableColumnKey,
  type ResourceListSortState,
  type NodeSortKey,
} from "../utils/resourceListSort";
import {
  countPodsOnNode,
  deriveNodeStatusSummary,
  formatNodeCpuMemoryCapacity,
  formatNodeInternalIP,
  formatNodeKubeletVersion,
  formatNodeRoles,
  type NodeListRow,
} from "../utils/nodeTable";
import type { Pod } from "../api";
import { formatAgeFromMetadata } from "../utils/k8sCreationTimestamp";
import copyIcon from "../assets/icon-copy.png";

export const NODE_COLUMN_KEYS = [
  "name",
  "status",
  "roles",
  "version",
  "internalIP",
  "pods",
  "cpuMemory",
  "age",
  "actions",
] as const;

export const NODE_COLUMN_DEFAULTS: Record<(typeof NODE_COLUMN_KEYS)[number], number> = {
  name: 200,
  status: 120,
  roles: 140,
  version: 100,
  internalIP: 120,
  pods: 72,
  cpuMemory: 120,
  age: 80,
  actions: 84,
};

export const NODE_COLUMN_LABELS: Record<(typeof NODE_COLUMN_KEYS)[number], string> = {
  name: "Name",
  status: "Status",
  roles: "Roles",
  version: "Version",
  internalIP: "Internal IP",
  pods: "Pods",
  cpuMemory: "CPU / Memory",
  age: "存活时间",
  actions: "操作",
};

const NODE_COLUMN_SORT: Partial<Record<(typeof NODE_COLUMN_KEYS)[number], NodeSortKey>> = {
  name: "name",
  status: "status",
  roles: "roles",
  version: "version",
  internalIP: "internalIP",
  pods: "pods",
  cpuMemory: "cpuMemory",
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

const menuItemStyleForDropdown: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  border: "none",
  background: "none",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};

function nodeStatusPillStyle(pill: ReturnType<typeof deriveNodeStatusSummary>["pill"]) {
  let bg = "rgba(22,163,74,0.15)";
  let border = "rgba(22,163,74,0.6)";
  let color = "#bbf7d0";
  if (pill === "warn") {
    bg = "rgba(202,138,4,0.18)";
    border = "rgba(234,179,8,0.7)";
    color = "#facc15";
  } else if (pill === "danger") {
    bg = "rgba(185,28,28,0.25)";
    border = "rgba(248,113,113,0.85)";
    color = "#fecaca";
  } else if (pill === "neutral") {
    bg = "rgba(100,116,139,0.2)";
    border = "rgba(148,163,184,0.55)";
    color = "#cbd5e1";
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    color,
    fontSize: 11,
    fontWeight: 600,
    boxSizing: "border-box" as const,
  };
}

export type NodesListTableProps = {
  sortedRows: NodeListRow[];
  nodesLoading: boolean;
  listSort: ResourceListSortState<NodeSortKey>;
  setListSort: (s: ResourceListSortState<NodeSortKey>) => void;
  columnWidths: Partial<Record<(typeof NODE_COLUMN_KEYS)[number], number>>;
  beginResize: (key: (typeof NODE_COLUMN_KEYS)[number]) => (e: React.MouseEvent) => void;
  totalWidth: number;
  pods: Pod[];
  listAgeNow: number;
  effectiveClusterId: string | null;
  menuOpenKey: string | null;
  setMenuOpenKey: (k: string | null) => void;
  rowBusyKey: string | null;
  setRowBusyKey: (k: string | null) => void;
  openDescribe: (row: NodeListRow) => void;
  openEditTab: (row: NodeListRow) => void;
  copyName: (name: string) => void;
};

export function NodesListTable({
  sortedRows,
  nodesLoading,
  listSort,
  setListSort,
  columnWidths,
  beginResize,
  totalWidth,
  pods,
  listAgeNow,
  effectiveClusterId,
  menuOpenKey,
  setMenuOpenKey,
  rowBusyKey,
  setRowBusyKey,
  openDescribe,
  openEditTab,
  copyName,
}: NodesListTableProps) {
  const colCount = NODE_COLUMN_KEYS.length;
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
        {NODE_COLUMN_KEYS.map((k) => (
          <col key={k} style={{ width: columnWidths[k] ?? NODE_COLUMN_DEFAULTS[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {NODE_COLUMN_KEYS.map((k) => {
            const sk = NODE_COLUMN_SORT[k];
            return (
              <ResizableTh
                key={k}
                label={NODE_COLUMN_LABELS[k]}
                sortTrailing={
                  sk != null && isNodeSortableColumnKey(sk) ? (
                    <ResourceSortArrows
                      activeDirection={listSort?.key === sk ? listSort.direction : null}
                      onPickAsc={() => setListSort({ key: sk, direction: "asc" })}
                      onPickDesc={() => setListSort({ key: sk, direction: "desc" })}
                    />
                  ) : undefined
                }
                width={columnWidths[k] ?? NODE_COLUMN_DEFAULTS[k]}
                thBase={thStyle}
                onResizeStart={beginResize(k)}
              />
            );
          })}
        </tr>
      </thead>
      <tbody className="wl-table-body">
        {nodesLoading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
              加载中…
            </td>
          </tr>
        )}
        {!nodesLoading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
              暂无 Node
            </td>
          </tr>
        )}
        {sortedRows.map((raw) => {
          const row = raw as NodeListRow;
          const nname = row.metadata?.name ?? "";
          const menuKey = nname;
          const isMenuOpen = menuOpenKey === menuKey;
          const rowBusy = rowBusyKey === menuKey;
          const st = deriveNodeStatusSummary(row);
          const baseCell: React.CSSProperties = {
            ...tdStyle,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 0,
          };
          const age = formatAgeFromMetadata(row.metadata as { creationTimestamp?: string }, listAgeNow);
          const podCount = countPodsOnNode(pods, nname);
          return (
            <tr key={(row.metadata as { uid?: string })?.uid || menuKey} className="wl-table-row">
              <td style={baseCell} title={nname}>
                <span className="wl-table-hover-copy">
                  <span className="wl-table-hover-copy__main">
                    <button
                      type="button"
                      onClick={() => openDescribe(row)}
                      style={{
                        padding: 0,
                        margin: 0,
                        border: "none",
                        background: "none",
                        color: "inherit",
                        cursor: "pointer",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                        flex: "1 1 auto",
                        textAlign: "left",
                      }}
                    >
                      {nname}
                    </button>
                  </span>
                  <button
                    type="button"
                    className="wl-table-hover-copy__btn"
                    onClick={() => copyName(nname)}
                    title="复制 Node 名称"
                    aria-label={`复制 Node 名称：${nname}`}
                  >
                    <img src={copyIcon} alt="" style={{ height: 14, width: "auto", display: "block" }} />
                  </button>
                </span>
              </td>
              <td style={baseCell}>
                <span style={nodeStatusPillStyle(st.pill)} title={st.display}>
                  {st.display}
                </span>
              </td>
              <td style={baseCell} title={formatNodeRoles(row)}>
                {formatNodeRoles(row)}
              </td>
              <td style={baseCell} title={formatNodeKubeletVersion(row)}>
                {formatNodeKubeletVersion(row)}
              </td>
              <td style={baseCell} title={formatNodeInternalIP(row)}>
                {formatNodeInternalIP(row)}
              </td>
              <td style={baseCell}>{podCount}</td>
              <td style={baseCell} title={formatNodeCpuMemoryCapacity(row)}>
                {formatNodeCpuMemoryCapacity(row)}
              </td>
              <td style={baseCell}>{age}</td>
              <td style={{ ...tdStyle, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="wl-table-menu-trigger"
                    disabled={rowBusy || !effectiveClusterId}
                    onClick={() => setMenuOpenKey(isMenuOpen ? null : menuKey)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      cursor: rowBusy ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      lineHeight: 1,
                      opacity: rowBusy ? 0.5 : 1,
                    }}
                    title="操作"
                  >
                    ⋮
                  </button>
                  {isMenuOpen && (
                    <>
                      <div
                        style={{ position: "fixed", inset: 0, zIndex: 40 }}
                        onClick={() => setMenuOpenKey(null)}
                        aria-hidden
                      />
                      <div
                        className="wl-table-dropdown-menu"
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "100%",
                          marginTop: 4,
                          minWidth: 160,
                          zIndex: 41,
                          padding: "4px 0",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="wl-menu-item"
                          style={menuItemStyleForDropdown}
                          disabled={rowBusy}
                          onClick={() => {
                            setMenuOpenKey(null);
                            openEditTab(row);
                          }}
                        >
                          <span style={{ marginRight: 8 }}>✎</span> Edit
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
