import React, { useRef } from "react";
import { ResizableTh } from "./ResizableTh";
import { ResourceSortArrows } from "./ResourceSortArrows";
import {
  isPvcSortableColumnKey,
  type ResourceListSortState,
  type PvcSortKey,
} from "../utils/resourceListSort";
import {
  derivePvcOpsHint,
  derivePvcStatusSummary,
  formatPvcAccessModes,
  formatPvcCapacity,
  formatPvcStorageClass,
  formatPvcUsedByCountSummary,
  formatPvcVolumeName,
  PVC_USED_BY_DESCRIBE_HINT,
  type PvcListRow,
} from "../utils/pvcTable";
import type { Pod } from "../api";
import { formatAgeFromMetadata } from "../utils/k8sCreationTimestamp";
import { CopyIcon } from "./icons/CopyIcon";
import { DropdownMenuPortal } from "./DropdownMenuPortal";

export const PVC_COLUMN_KEYS = [
  "name",
  "namespace",
  "status",
  "volume",
  "capacity",
  "accessModes",
  "storageClass",
  "usedBy",
  "opsHint",
  "age",
  "actions",
] as const;

export const PVC_COLUMN_DEFAULTS: Record<(typeof PVC_COLUMN_KEYS)[number], number> = {
  name: 200,
  namespace: 100,
  status: 100,
  volume: 160,
  capacity: 88,
  accessModes: 100,
  storageClass: 120,
  usedBy: 100,
  opsHint: 108,
  age: 80,
  actions: 84,
};

export const PVC_COLUMN_LABELS: Record<(typeof PVC_COLUMN_KEYS)[number], string> = {
  name: "Name",
  namespace: "Namespace",
  status: "Status",
  volume: "Volume",
  capacity: "Capacity",
  accessModes: "Access Modes",
  storageClass: "StorageClass",
  usedBy: "Used By",
  opsHint: "提示",
  age: "存活时间",
  actions: "操作",
};

const PVC_COLUMN_SORT: Partial<Record<(typeof PVC_COLUMN_KEYS)[number], PvcSortKey>> = {
  name: "name",
  namespace: "namespace",
  status: "status",
  volume: "volume",
  capacity: "capacity",
  storageClass: "storageClass",
  usedBy: "usedBy",
  age: "age",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-header)",
  fontSize: 12,
  color: "var(--wl-text-table-header)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 13,
};

const menuItemStyleForDropdown: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};

function statusPillStyle(label: "健康" | "警告" | "严重" | "删除中") {
  let bg = "var(--wl-pill-success-bg)";
  let border = "var(--wl-pill-success-border)";
  let color = "var(--wl-pill-success-text)";
  if (label === "删除中") {
    bg = "var(--wl-pill-muted-bg)";
    border = "var(--wl-pill-muted-border)";
    color = "var(--wl-pill-muted-text)";
  } else if (label === "警告") {
    bg = "var(--wl-pill-attention-bg)";
    border = "var(--wl-pill-attention-border)";
    color = "var(--wl-pill-attention-text)";
  } else if (label === "严重") {
    bg = "var(--wl-pill-danger-bg)";
    border = "var(--wl-pill-danger-border)";
    color = "var(--wl-pill-danger-text)";
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

export type PVCListTableProps = {
  sortedRows: PvcListRow[];
  pvcLoading: boolean;
  listSort: ResourceListSortState<PvcSortKey>;
  setListSort: (s: ResourceListSortState<PvcSortKey>) => void;
  columnWidths: Partial<Record<(typeof PVC_COLUMN_KEYS)[number], number>>;
  beginResize: (key: (typeof PVC_COLUMN_KEYS)[number]) => (e: React.MouseEvent) => void;
  totalWidth: number;
  pods: Pod[];
  listAgeNow: number;
  effectiveClusterId: string | null;
  menuOpenKey: string | null;
  setMenuOpenKey: (k: string | null) => void;
  rowBusyKey: string | null;
  setRowBusyKey: (k: string | null) => void;
  openDescribe: (row: PvcListRow) => void;
  openEditTab: (row: PvcListRow) => void;
  copyName: (name: string) => void;
  setActionConfirm: React.Dispatch<
    React.SetStateAction<{
      title: string;
      description?: string;
      items: string[];
      variant: "danger" | "primary";
      onConfirm: () => Promise<void>;
    } | null>
  >;
  onDeletedOne: (ns: string, name: string) => void;
  setToastMessage: (m: string | null) => void;
  setError: (e: string | null) => void;
  deletePvcApi: (clusterId: string, ns: string, name: string) => Promise<void>;
};

export function PVCListTable({
  sortedRows,
  pvcLoading,
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
  setActionConfirm,
  onDeletedOne,
  setToastMessage,
  setError,
  deletePvcApi,
}: PVCListTableProps) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const colCount = PVC_COLUMN_KEYS.length;
  return (
    <table
      style={{
        width: totalWidth,
        minWidth: "100%",
        borderCollapse: "collapse",
        backgroundColor: "var(--wl-bg-table)",
        tableLayout: "fixed",
      }}
    >
      <colgroup>
        {PVC_COLUMN_KEYS.map((k) => (
          <col key={k} style={{ width: columnWidths[k] ?? PVC_COLUMN_DEFAULTS[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {PVC_COLUMN_KEYS.map((k) => {
            const sk = PVC_COLUMN_SORT[k];
            return (
              <ResizableTh
                key={k}
                label={PVC_COLUMN_LABELS[k]}
                sortTrailing={
                  sk != null && isPvcSortableColumnKey(sk) ? (
                    <ResourceSortArrows
                      activeDirection={listSort?.key === sk ? listSort.direction : null}
                      onPickAsc={() => setListSort({ key: sk, direction: "asc" })}
                      onPickDesc={() => setListSort({ key: sk, direction: "desc" })}
                    />
                  ) : undefined
                }
                width={columnWidths[k] ?? PVC_COLUMN_DEFAULTS[k]}
                thBase={thStyle}
                onResizeStart={beginResize(k)}
              />
            );
          })}
        </tr>
      </thead>
      <tbody className="wl-table-body">
        {pvcLoading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "var(--wl-text-secondary)" }}>
              加载中…
            </td>
          </tr>
        )}
        {!pvcLoading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "var(--wl-text-secondary)" }}>
              暂无 PersistentVolumeClaim
            </td>
          </tr>
        )}
        {sortedRows.map((raw) => {
          const row = raw as PvcListRow;
          const menuKey = `${row.metadata?.namespace ?? ""}/${row.metadata?.name ?? ""}`;
          const isMenuOpen = menuOpenKey === menuKey;
          const rowBusy = rowBusyKey === menuKey;
          const st = derivePvcStatusSummary(row);
          const ns = row.metadata?.namespace ?? "";
          const pname = row.metadata?.name ?? "";
          const usedBySummary = formatPvcUsedByCountSummary(pods, ns, pname);
          const ops = derivePvcOpsHint(row, pods, ns, pname);
          const baseCell: React.CSSProperties = {
            ...tdStyle,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 0,
          };
          const age = formatAgeFromMetadata(row.metadata as { creationTimestamp?: string }, listAgeNow);
          const usedByTitle =
            usedBySummary !== "—" ? `${PVC_USED_BY_DESCRIBE_HINT}（${usedBySummary}）` : undefined;
          return (
            <tr key={(row.metadata as { uid?: string })?.uid || menuKey} className="wl-table-row">
              <td style={baseCell} title={pname}>
                <span className="wl-table-hover-copy">
                  <span className="wl-table-hover-copy__main">
                    <button
                      type="button"
                      className="wl-table-hover-copy__truncate"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDescribe(row);
                      }}
                      style={{
                        padding: 0,
                        margin: 0,
                        border: "none",
                        background: "none",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {pname}
                    </button>
                  </span>
                  <button
                    type="button"
                    className="wl-table-hover-copy__btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyName(pname);
                    }}
                    title="复制 PVC 名称"
                    aria-label={`复制 PVC 名称：${pname}`}
                  >
                    <CopyIcon />
                  </button>
                </span>
              </td>
              <td style={baseCell} title={ns}>
                {ns || "—"}
              </td>
              <td style={baseCell}>
                <span style={statusPillStyle(st.label)} title={st.display}>
                  {st.display}
                </span>
              </td>
              <td style={baseCell} title={formatPvcVolumeName(row)}>
                {formatPvcVolumeName(row)}
              </td>
              <td style={baseCell} title={formatPvcCapacity(row)}>
                {formatPvcCapacity(row)}
              </td>
              <td style={{ ...baseCell, whiteSpace: "normal" }} title={formatPvcAccessModes(row)}>
                {formatPvcAccessModes(row)}
              </td>
              <td style={baseCell} title={formatPvcStorageClass(row)}>
                {formatPvcStorageClass(row)}
              </td>
              <td style={baseCell} title={usedByTitle}>
                {usedBySummary}
              </td>
              <td style={baseCell} title={ops.title || ops.text}>
                {ops.text}
              </td>
              <td style={baseCell}>{age}</td>
              <td style={{ ...tdStyle, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ position: "relative" }}>
                  <button
                    ref={isMenuOpen ? menuTriggerRef : undefined}
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
                  <DropdownMenuPortal
                    onClose={() => setMenuOpenKey(null)}
                    triggerRef={menuTriggerRef}
                    align="right"
                    surfaceStyle={{ padding: "4px 0", minWidth: 160 }}
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
                    <button
                      type="button"
                      className="wl-menu-item wl-menu-item-danger"
                      style={menuItemStyleForDropdown}
                      disabled={rowBusy || !effectiveClusterId}
                      onClick={() => {
                        setMenuOpenKey(null);
                        if (!effectiveClusterId) return;
                        setActionConfirm({
                          title: "确认删除 1 个 PersistentVolumeClaim？",
                          description: "删除后不可恢复。",
                          items: [`${ns}/${pname}`],
                          variant: "danger",
                          onConfirm: async () => {
                            setRowBusyKey(menuKey);
                            try {
                              await deletePvcApi(effectiveClusterId, ns, pname);
                              onDeletedOne(ns, pname);
                              setToastMessage("已删除 PVC");
                              setError(null);
                            } catch (e: unknown) {
                              const err = e as { response?: { data?: { error?: string } }; message?: string };
                              setToastMessage(err?.response?.data?.error ?? err?.message ?? "删除失败");
                              throw e;
                            } finally {
                              setRowBusyKey(null);
                            }
                          },
                        });
                      }}
                    >
                      <span style={{ marginRight: 8 }}>🗑</span> Delete
                    </button>
                  </DropdownMenuPortal>
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
