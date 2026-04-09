import React, { Fragment, useRef } from "react";
import { useResourceListColumnResize } from "../resourceList/useResourceListColumnResize";
import {
  SERVICE_EP_EXPAND_COLUMNS,
  SERVICE_EP_EXPAND_DEFAULTS,
  SERVICE_EP_EXPAND_KEYS,
  SERVICE_PORT_EXPAND_COLUMNS,
  SERVICE_PORT_EXPAND_DEFAULTS,
  SERVICE_PORT_EXPAND_KEYS,
  SECONDARY_EXPAND_MIN_COL_WIDTH,
} from "../resourceList/secondaryExpandTableConfig";
import {
  SecondaryExpandTable,
  secondaryExpandActionsCellStyle,
  secondaryExpandDataCellStyle,
  secondaryExpandTdBase,
} from "./SecondaryExpandTable";
import { ResizableTh } from "./ResizableTh";
import { ResourceSortArrows } from "./ResourceSortArrows";
import {
  isServiceSortableColumnKey,
  type ResourceListSortState,
  type ServiceSortKey,
} from "../utils/resourceListSort";
import { buildServiceListDiagnostics, formatEndpointColumnSummary } from "../utils/serviceTroubleshoot";
import {
  deriveServiceEndpointExpandRows,
  deriveServicePortExpandRows,
  formatServiceClusterIP,
  formatServicePortsSummary,
  formatServiceSelectorSummary,
  type ServiceListRow,
} from "../utils/serviceTable";
import type { Pod } from "../api";
import { formatAgeFromMetadata } from "../utils/k8sCreationTimestamp";
import copyIcon from "../assets/icon-copy.png";
import { ResourceJumpChip } from "./ResourceJumpChip";
import { ResourceNameWithCopy } from "./ResourceNameWithCopy";
import { DropdownMenuPortal } from "./DropdownMenuPortal";

const SERVICE_COLUMN_KEYS = [
  "name",
  "namespace",
  "type",
  "clusterIP",
  "ports",
  "selector",
  "endpoints",
  "health",
  "age",
  "actions",
] as const;

const SERVICE_COLUMN_DEFAULTS: Record<(typeof SERVICE_COLUMN_KEYS)[number], number> = {
  name: 200,
  namespace: 100,
  type: 100,
  clusterIP: 120,
  ports: 100,
  selector: 160,
  endpoints: 120,
  health: 88,
  age: 80,
  actions: 84,
};

const SERVICE_COLUMN_LABELS: Record<(typeof SERVICE_COLUMN_KEYS)[number], string> = {
  name: "Name",
  namespace: "Namespace",
  type: "Type",
  clusterIP: "Cluster IP",
  ports: "Ports",
  selector: "Selector",
  endpoints: "Endpoints / 状态",
  health: "状态",
  age: "存活时间",
  actions: "操作",
};

const SERVICE_COLUMN_SORT: Partial<Record<(typeof SERVICE_COLUMN_KEYS)[number], ServiceSortKey>> = {
  name: "name",
  namespace: "namespace",
  type: "type",
  endpoints: "endpoints",
  health: "health",
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
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
};

export type ServicesListTableProps = {
  sortedRows: ServiceListRow[];
  serviceLoading: boolean;
  listSort: ResourceListSortState<ServiceSortKey>;
  setListSort: (s: ResourceListSortState<ServiceSortKey>) => void;
  columnWidths: Partial<Record<(typeof SERVICE_COLUMN_KEYS)[number], number>>;
  beginResize: (key: (typeof SERVICE_COLUMN_KEYS)[number]) => (e: React.MouseEvent) => void;
  totalWidth: number;
  expandedKeys: Set<string>;
  setExpandedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  endpointsByKey: Map<string, ServiceListRow>;
  pods: Pod[];
  listAgeNow: number;
  effectiveClusterId: string | null;
  menuOpenKey: string | null;
  setMenuOpenKey: (k: string | null) => void;
  rowBusyKey: string | null;
  setRowBusyKey: (k: string | null) => void;
  openDescribe: (svc: ServiceListRow) => void;
  openEditTab: (svc: ServiceListRow) => void;
  jumpToPods: (name: string) => void;
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
  deleteServiceApi: (clusterId: string, ns: string, name: string) => Promise<void>;
};

export function ServicesListTable({
  sortedRows,
  serviceLoading,
  listSort,
  setListSort,
  columnWidths,
  beginResize,
  totalWidth,
  expandedKeys,
  setExpandedKeys,
  endpointsByKey,
  pods,
  listAgeNow,
  effectiveClusterId,
  menuOpenKey,
  setMenuOpenKey,
  rowBusyKey,
  setRowBusyKey,
  openDescribe,
  openEditTab,
  jumpToPods,
  copyName,
  setActionConfirm,
  onDeletedOne,
  setToastMessage,
  setError,
  deleteServiceApi,
}: ServicesListTableProps) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const {
    columnWidths: servicePortExpandWidths,
    beginResize: beginResizeServicePortExpand,
    totalDataWidth: servicePortExpandTotalWidth,
  } = useResourceListColumnResize({
    columnKeys: SERVICE_PORT_EXPAND_KEYS,
    defaults: SERVICE_PORT_EXPAND_DEFAULTS,
    minWidthForKey: () => SECONDARY_EXPAND_MIN_COL_WIDTH,
  });
  const {
    columnWidths: serviceEpExpandWidths,
    beginResize: beginResizeServiceEpExpand,
    totalDataWidth: serviceEpExpandTotalWidth,
  } = useResourceListColumnResize({
    columnKeys: SERVICE_EP_EXPAND_KEYS,
    defaults: SERVICE_EP_EXPAND_DEFAULTS,
    minWidthForKey: () => SECONDARY_EXPAND_MIN_COL_WIDTH,
  });
  const svcSubTd = secondaryExpandDataCellStyle(secondaryExpandTdBase);
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
        {SERVICE_COLUMN_KEYS.map((k) => (
          <col key={k} style={{ width: columnWidths[k] ?? SERVICE_COLUMN_DEFAULTS[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {SERVICE_COLUMN_KEYS.map((k) => {
            const sk = SERVICE_COLUMN_SORT[k];
            return (
              <ResizableTh
                key={k}
                label={SERVICE_COLUMN_LABELS[k]}
                sortTrailing={
                  sk != null && isServiceSortableColumnKey(sk) ? (
                    <ResourceSortArrows
                      activeDirection={listSort?.key === sk ? listSort.direction : null}
                      onPickAsc={() => setListSort({ key: sk, direction: "asc" })}
                      onPickDesc={() => setListSort({ key: sk, direction: "desc" })}
                    />
                  ) : undefined
                }
                width={columnWidths[k] ?? SERVICE_COLUMN_DEFAULTS[k]}
                thBase={thStyle}
                onResizeStart={beginResize(k)}
              />
            );
          })}
        </tr>
      </thead>
      <tbody className="wl-table-body">
        {serviceLoading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
              加载中…
            </td>
          </tr>
        )}
        {!serviceLoading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: "#94a3b8" }}>
              暂无 Service
            </td>
          </tr>
        )}
        {sortedRows.map((raw) => {
          const svc = raw;
          const menuKey = `${svc.metadata?.namespace ?? ""}/${svc.metadata?.name ?? ""}`;
          const expanded = expandedKeys.has(menuKey);
          const isMenuOpen = menuOpenKey === menuKey;
          const rowBusy = rowBusyKey === menuKey;
          const ep = endpointsByKey.get(menuKey);
          const diag = buildServiceListDiagnostics(svc, ep, pods);
          const portRows = deriveServicePortExpandRows(svc);
          const epRows = deriveServiceEndpointExpandRows(ep, pods);
          const baseCell: React.CSSProperties = {
            ...tdStyle,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 0,
          };
          const age = formatAgeFromMetadata(svc.metadata as { creationTimestamp?: string }, listAgeNow);
          const ns = svc.metadata?.namespace ?? "";
          const sname = svc.metadata?.name ?? "";
          const stype = (svc as { spec?: { type?: string } }).spec?.type ?? "—";
          return (
            <Fragment key={(svc.metadata as { uid?: string })?.uid || menuKey}>
              <tr
                className="wl-table-row"
                onClick={() => {
                  setExpandedKeys((prev) => {
                    const n = new Set(prev);
                    if (n.has(menuKey)) n.delete(menuKey);
                    else n.add(menuKey);
                    return n;
                  });
                }}
                style={{ cursor: "pointer" }}
              >
                <td style={baseCell} title={sname}>
                  <span className="wl-table-hover-copy">
                    <span className="wl-table-hover-copy__main">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedKeys((prev) => {
                            const n = new Set(prev);
                            if (n.has(menuKey)) n.delete(menuKey);
                            else n.add(menuKey);
                            return n;
                          });
                        }}
                        style={{
                          marginRight: 4,
                          padding: "0 4px",
                          border: "none",
                          background: "none",
                          color: "#94a3b8",
                          cursor: "pointer",
                          flexShrink: 0,
                          fontSize: 12,
                        }}
                        title={expanded ? "收起详情" : "展开详情"}
                        aria-expanded={expanded}
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDescribe(svc);
                        }}
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
                        {sname}
                      </button>
                    </span>
                    <button
                      type="button"
                      className="wl-table-hover-copy__btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyName(sname);
                      }}
                      title="复制 Service 名称"
                      aria-label={`复制 Service 名称：${sname}`}
                    >
                      <img src={copyIcon} alt="" style={{ height: 14, width: "auto", display: "block" }} />
                    </button>
                  </span>
                </td>
                <td style={baseCell} title={ns}>
                  {ns || "—"}
                </td>
                <td style={baseCell} title={stype}>
                  {stype}
                </td>
                <td style={baseCell} title={formatServiceClusterIP(svc)}>
                  {formatServiceClusterIP(svc)}
                </td>
                <td style={baseCell} title={formatServicePortsSummary(svc)}>
                  {formatServicePortsSummary(svc)}
                </td>
                <td
                  style={{ ...baseCell, whiteSpace: "normal", maxWidth: 0 }}
                  title={formatServiceSelectorSummary(svc, 500)}
                >
                  {formatServiceSelectorSummary(svc)}
                </td>
                <td style={baseCell} title={diag.summary}>
                  {formatEndpointColumnSummary(diag)}
                </td>
                <td style={baseCell} onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const hl = diag.label;
                    let bg = "rgba(22,163,74,0.15)";
                    let border = "rgba(22,163,74,0.6)";
                    let color = "#bbf7d0";
                    if (hl === "警告") {
                      bg = "rgba(249,115,22,0.2)";
                      border = "rgba(249,115,22,0.75)";
                      color = "#fed7aa";
                    } else if (hl === "严重") {
                      bg = "rgba(185,28,28,0.25)";
                      border = "rgba(248,113,113,0.85)";
                      color = "#fecaca";
                    } else if (hl === "特殊") {
                      bg = "rgba(59,130,246,0.15)";
                      border = "rgba(96,165,250,0.65)";
                      color = "#bfdbfe";
                    }
                    return (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 999,
                          backgroundColor: bg,
                          border: `1px solid ${border}`,
                          color,
                          fontSize: 11,
                          maxWidth: "100%",
                          boxSizing: "border-box",
                        }}
                        title={diag.summary}
                      >
                        {hl}
                      </span>
                    );
                  })()}
                </td>
                <td style={baseCell} title={age}>
                  {age}
                </td>
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
                        onClick={() => openEditTab(svc)}
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
                            title: "确认删除 1 个 Service？",
                            description: "删除后不可恢复。",
                            items: [`${ns}/${sname}`],
                            variant: "danger",
                            onConfirm: async () => {
                              setRowBusyKey(menuKey);
                              try {
                                await deleteServiceApi(effectiveClusterId, ns, sname);
                                onDeletedOne(ns, sname);
                                setToastMessage("已删除 Service");
                                setError(null);
                              } catch (err: unknown) {
                                const e = err as { response?: { data?: { error?: string } }; message?: string };
                                setToastMessage(e?.response?.data?.error ?? e?.message ?? "删除失败");
                                throw err;
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
              {expanded && (
                <tr className="wl-table-row">
                  <td
                    colSpan={10}
                    style={{
                      ...tdStyle,
                      padding: "8px 12px 12px",
                      backgroundColor: "#0f172a",
                      cursor: "default",
                      borderBottom: "1px solid #111827",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, fontWeight: 600 }}>
                      端口与 Endpoints（{diag.summary}）
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Ports</div>
                    <div style={{ marginBottom: 12 }}>
                      <SecondaryExpandTable
                        columns={SERVICE_PORT_EXPAND_COLUMNS}
                        columnWidths={servicePortExpandWidths}
                        defaults={SERVICE_PORT_EXPAND_DEFAULTS}
                        beginResize={beginResizeServicePortExpand}
                        totalDataWidth={servicePortExpandTotalWidth}
                      >
                        {portRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={SERVICE_PORT_EXPAND_KEYS.length}
                              style={{ ...svcSubTd, color: "#64748b" }}
                            >
                              无端口
                            </td>
                          </tr>
                        ) : (
                          portRows.map((pr, i) => (
                            <tr key={i} className="wl-table-row">
                              <td style={svcSubTd}>{pr.name}</td>
                              <td style={svcSubTd}>{pr.protocol}</td>
                              <td style={svcSubTd}>{pr.port}</td>
                              <td style={svcSubTd}>{pr.targetPort}</td>
                              <td style={svcSubTd}>{pr.nodePort}</td>
                            </tr>
                          ))
                        )}
                      </SecondaryExpandTable>
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
                      Endpoints / 关联后端
                      {epRows.length === 0 && (
                        <span style={{ color: "#f97316", marginLeft: 8, fontWeight: 600 }}>（0 条地址）</span>
                      )}
                    </div>
                    <SecondaryExpandTable
                      columns={SERVICE_EP_EXPAND_COLUMNS}
                      columnWidths={serviceEpExpandWidths}
                      defaults={SERVICE_EP_EXPAND_DEFAULTS}
                      beginResize={beginResizeServiceEpExpand}
                      totalDataWidth={serviceEpExpandTotalWidth}
                    >
                      {epRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={SERVICE_EP_EXPAND_KEYS.length}
                            style={{ ...svcSubTd, color: "#64748b" }}
                          >
                            无 Endpoints 地址行
                          </td>
                        </tr>
                      ) : (
                        epRows.map((er, ri) => {
                          const shell: React.CSSProperties =
                            !er.ready
                              ? { backgroundColor: "rgba(249,115,22,0.08)" }
                              : er.podHealth && er.podHealth !== "健康"
                                ? { backgroundColor: "rgba(202,138,4,0.06)" }
                                : {};
                          const canPod = er.podName && er.podName !== "—";
                          return (
                            <tr key={ri} className="wl-table-row" style={shell}>
                              <td style={svcSubTd}>{er.ip}</td>
                              <td style={{ ...svcSubTd, fontSize: 11 }}>{er.ports}</td>
                              <td style={svcSubTd}>{er.ready ? "是" : "否"}</td>
                              <td style={svcSubTd}>
                                {canPod ? (
                                  <ResourceNameWithCopy
                                    name={er.podName}
                                    onCopy={copyName}
                                    fontSize={12}
                                    copyButtonTitle="复制 Pod 名称"
                                  />
                                ) : (
                                  er.podName
                                )}
                              </td>
                              <td style={svcSubTd}>{er.podHealth}</td>
                              <td style={{ ...svcSubTd, fontSize: 11 }}>{er.node}</td>
                              <td style={{ ...svcSubTd, fontSize: 11, color: "#94a3b8" }}>{er.note || "—"}</td>
                              <td style={secondaryExpandActionsCellStyle({ ...secondaryExpandTdBase, fontSize: 11 })}>
                                {canPod ? (
                                  <ResourceJumpChip
                                    label="Pods"
                                    compact
                                    onClick={() => jumpToPods(er.podName)}
                                    title="打开 Pods 列表并过滤"
                                  />
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </SecondaryExpandTable>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
