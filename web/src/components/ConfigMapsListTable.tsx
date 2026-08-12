import React, { useEffect, useRef } from "react";
import type { AuditedActionConfirmRequest } from "./AuditReasonDialog";
import { ResizableTh } from "./ResizableTh";
import { ResourceSortArrows } from "./ResourceSortArrows";
import { SelectionHeaderCell } from "./SelectionHeaderCell";
import { CopyIcon } from "./icons/CopyIcon";
import { DropdownMenuPortal } from "./DropdownMenuPortal";
import { formatAgeFromMetadata } from "../utils/k8sCreationTimestamp";
import type { ResourceListSortState } from "../utils/resourceListSort";
import {
  configMapKey,
  configMapReferenceTitle,
  configMapRiskRank,
  deriveConfigMapRisks,
  formatConfigMapReferenceSummary,
  summarizeConfigMapSize,
  type ConfigMapListRow,
  type ConfigMapReferenceSummary,
  type ConfigMapRisk,
  type ConfigMapSortKey,
} from "../utils/configMapTable";

export const CONFIGMAP_COLUMN_KEYS = [
  "select",
  "name",
  "namespace",
  "references",
  "size",
  "risk",
  "age",
  "actions",
] as const;

export const CONFIGMAP_COLUMN_DEFAULTS: Record<(typeof CONFIGMAP_COLUMN_KEYS)[number], number> = {
  select: 40,
  name: 220,
  namespace: 120,
  references: 160,
  size: 130,
  risk: 220,
  age: 90,
  actions: 96,
};

const CONFIGMAP_COLUMN_LABELS: Record<(typeof CONFIGMAP_COLUMN_KEYS)[number], string> = {
  select: "",
  name: "Name",
  namespace: "Namespace",
  references: "引用资源",
  size: "配置规模",
  risk: "风险",
  age: "存活时间",
  actions: "操作",
};

const CONFIGMAP_COLUMN_SORT: Partial<Record<(typeof CONFIGMAP_COLUMN_KEYS)[number], ConfigMapSortKey>> = {
  name: "name",
  namespace: "namespace",
  references: "references",
  size: "size",
  risk: "risk",
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

function riskPillStyle(risk: ConfigMapRisk): React.CSSProperties {
  let bg = "var(--wl-pill-success-bg)";
  let border = "var(--wl-pill-success-border)";
  let color = "var(--wl-pill-success-text)";
  if (risk.level === "info") {
    bg = "var(--wl-pill-info-bg)";
    border = "var(--wl-pill-info-border)";
    color = "var(--wl-pill-info-text)";
  } else if (risk.level === "warning") {
    bg = "var(--wl-pill-attention-bg)";
    border = "var(--wl-pill-attention-border)";
    color = "var(--wl-pill-attention-text)";
  } else if (risk.level === "danger") {
    bg = "var(--wl-pill-danger-bg)";
    border = "var(--wl-pill-danger-border)";
    color = "var(--wl-pill-danger-text)";
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "100%",
    padding: "2px 7px",
    borderRadius: 999,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    color,
    fontSize: 11,
    fontWeight: 600,
    boxSizing: "border-box",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

export type ConfigMapsListTableProps = {
  sortedRows: ConfigMapListRow[];
  loading: boolean;
  listSort: ResourceListSortState<ConfigMapSortKey>;
  setListSort: (s: ResourceListSortState<ConfigMapSortKey>) => void;
  columnWidths: Partial<Record<(typeof CONFIGMAP_COLUMN_KEYS)[number], number>>;
  beginResize: (key: (typeof CONFIGMAP_COLUMN_KEYS)[number]) => (e: React.MouseEvent) => void;
  totalWidth: number;
  refsByKey: Map<string, ConfigMapReferenceSummary>;
  risksByKey: Map<string, ConfigMapRisk[]>;
  listAgeNow: number;
  effectiveClusterId: string | null;
  canWrite: boolean;
  selectedKeys: Set<string>;
  onToggleRow: (key: string, checked: boolean) => void;
  onToggleVisible: (checked: boolean) => void;
  menuOpenKey: string | null;
  setMenuOpenKey: (k: string | null) => void;
  rowBusyKey: string | null;
  setRowBusyKey: (k: string | null) => void;
  openDescribe: (row: ConfigMapListRow) => void;
  openEditYamlTab: (row: ConfigMapListRow) => void;
  openConfigEditorTab: (row: ConfigMapListRow) => void;
  downloadYaml: (row: ConfigMapListRow) => Promise<void> | void;
  copyName: (name: string) => void;
  setActionConfirm: (request: AuditedActionConfirmRequest) => void;
  onDeletedOne: (ns: string, name: string) => void;
  setToastMessage: (m: string | null) => void;
  setError: (e: string | null) => void;
  deleteConfigMapApi: (clusterId: string, ns: string, name: string, auditReason: string) => Promise<void>;
};

export function ConfigMapsListTable({
  sortedRows,
  loading,
  listSort,
  setListSort,
  columnWidths,
  beginResize,
  totalWidth,
  refsByKey,
  risksByKey,
  listAgeNow,
  effectiveClusterId,
  canWrite,
  selectedKeys,
  onToggleRow,
  onToggleVisible,
  menuOpenKey,
  setMenuOpenKey,
  rowBusyKey,
  setRowBusyKey,
  openDescribe,
  openEditYamlTab,
  openConfigEditorTab,
  downloadYaml,
  copyName,
  setActionConfirm,
  onDeletedOne,
  setToastMessage,
  setError,
  deleteConfigMapApi,
}: ConfigMapsListTableProps) {
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const headerSelectRef = useRef<HTMLInputElement>(null);
  const visibleKeys = sortedRows.map((row) => configMapKey(row.metadata.namespace, row.metadata.name));
  const visibleSelected = visibleKeys.filter((key) => selectedKeys.has(key)).length;
  const allVisibleSelected = visibleKeys.length > 0 && visibleSelected === visibleKeys.length;

  useEffect(() => {
    const el = headerSelectRef.current;
    if (!el) return;
    el.checked = allVisibleSelected;
    el.indeterminate = visibleSelected > 0 && visibleSelected < visibleKeys.length;
  }, [allVisibleSelected, visibleKeys.length, visibleSelected]);

  const colCount = CONFIGMAP_COLUMN_KEYS.length;
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
        {CONFIGMAP_COLUMN_KEYS.map((k) => (
          <col key={k} style={{ width: columnWidths[k] ?? CONFIGMAP_COLUMN_DEFAULTS[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {CONFIGMAP_COLUMN_KEYS.map((k) => {
            if (k === "select") {
              return (
                <SelectionHeaderCell
                  key={k}
                  thBase={thStyle}
                  width={columnWidths[k] ?? CONFIGMAP_COLUMN_DEFAULTS[k]}
                >
                  <input
                    ref={headerSelectRef}
                    type="checkbox"
                    aria-label="全选当前可见 ConfigMap"
                    disabled={sortedRows.length === 0}
                    onChange={(e) => onToggleVisible(e.currentTarget.checked)}
                  />
                </SelectionHeaderCell>
              );
            }
            const sk = CONFIGMAP_COLUMN_SORT[k];
            return (
              <ResizableTh
                key={k}
                label={CONFIGMAP_COLUMN_LABELS[k]}
                sortTrailing={
                  sk != null ? (
                    <ResourceSortArrows
                      activeDirection={listSort?.key === sk ? listSort.direction : null}
                      onPickAsc={() => setListSort({ key: sk, direction: "asc" })}
                      onPickDesc={() => setListSort({ key: sk, direction: "desc" })}
                    />
                  ) : undefined
                }
                width={columnWidths[k] ?? CONFIGMAP_COLUMN_DEFAULTS[k]}
                thBase={thStyle}
                onResizeStart={beginResize(k)}
              />
            );
          })}
        </tr>
      </thead>
      <tbody className="wl-table-body">
        {loading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "var(--wl-text-secondary)" }}>
              加载中…
            </td>
          </tr>
        )}
        {!loading && sortedRows.length === 0 && (
          <tr className="wl-table-row">
            <td colSpan={colCount} style={{ ...tdStyle, textAlign: "center", color: "var(--wl-text-secondary)" }}>
              当前作用域下没有 ConfigMap
            </td>
          </tr>
        )}
        {sortedRows.map((row) => {
          const ns = row.metadata.namespace ?? "";
          const name = row.metadata.name;
          const rowKey = configMapKey(ns, name);
          const isMenuOpen = menuOpenKey === rowKey;
          const rowBusy = rowBusyKey === rowKey;
          const refs = refsByKey.get(rowKey) ?? {
            pods: 0,
            deployments: 0,
            statefulSets: 0,
            daemonSets: 0,
            others: 0,
            totalResources: 0,
            totalReferences: 0,
            references: [],
          };
          const risks = risksByKey.get(rowKey) ?? deriveConfigMapRisks(row, refs);
          const size = summarizeConfigMapSize(row);
          const age = formatAgeFromMetadata(row.metadata, listAgeNow);
          const baseCell: React.CSSProperties = {
            ...tdStyle,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 0,
          };
          return (
            <tr key={row.metadata.uid || rowKey} className={`wl-table-row${isMenuOpen ? " wl-table-row--menu-open" : ""}`}>
              <td style={{ ...baseCell, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`选择 ConfigMap ${name}`}
                  checked={selectedKeys.has(rowKey)}
                  onChange={(e) => onToggleRow(rowKey, e.currentTarget.checked)}
                />
              </td>
              <td style={baseCell} title={name}>
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
                      {name}
                    </button>
                  </span>
                  <button
                    type="button"
                    className="wl-table-hover-copy__btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyName(name);
                    }}
                    title="复制 ConfigMap 名称"
                    aria-label={`复制 ConfigMap 名称：${name}`}
                  >
                    <CopyIcon />
                  </button>
                </span>
              </td>
              <td style={baseCell} title={ns}>{ns || "—"}</td>
              <td style={baseCell} title={configMapReferenceTitle(refs)}>
                {formatConfigMapReferenceSummary(refs)}
              </td>
              <td style={baseCell} title={`${size.totalKeys} keys, ${size.totalBytes} bytes`}>
                {size.display}
              </td>
              <td style={{ ...baseCell, whiteSpace: "normal" }} title={risks.map((risk) => risk.reason).join("\n")}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                  {risks.slice(0, 3).map((risk) => (
                    <span key={risk.label} style={riskPillStyle(risk)}>
                      {risk.label}
                    </span>
                  ))}
                  {risks.length > 3 && (
                    <span style={{ color: "var(--wl-text-muted)", fontSize: 11 }}>+{risks.length - 3}</span>
                  )}
                </div>
              </td>
              <td style={baseCell} title={age}>{age}</td>
              <td style={{ ...tdStyle, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ position: "relative" }}>
                  <button
                    ref={isMenuOpen ? menuTriggerRef : undefined}
                    type="button"
                    className="wl-table-menu-trigger"
                    disabled={rowBusy || !effectiveClusterId}
                    onClick={() => setMenuOpenKey(isMenuOpen ? null : rowKey)}
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
                      surfaceStyle={{ padding: "4px 0", minWidth: 176 }}
                    >
                      <button
                        type="button"
                        className="wl-menu-item"
                        style={menuItemStyleForDropdown}
                        disabled={rowBusy}
                        onClick={() => {
                          setMenuOpenKey(null);
                          openEditYamlTab(row);
                        }}
                      >
                        <span style={{ marginRight: 8 }}>✎</span> {canWrite ? "编辑 YAML" : "查看 YAML"}
                      </button>
                      {canWrite && (
                      <button
                        type="button"
                        className="wl-menu-item"
                        style={menuItemStyleForDropdown}
                        disabled={rowBusy}
                        onClick={() => {
                          setMenuOpenKey(null);
                          openConfigEditorTab(row);
                        }}
                      >
                        <span style={{ marginRight: 8 }}>⚙</span> 编辑配置
                      </button>
                      )}
                      <button
                        type="button"
                        className="wl-menu-item"
                        style={menuItemStyleForDropdown}
                        disabled={rowBusy}
                        onClick={() => {
                          setMenuOpenKey(null);
                          void downloadYaml(row);
                        }}
                      >
                        <span style={{ marginRight: 8 }}>⇩</span> 下载 YAML
                      </button>
                      {canWrite && (
                      <button
                        type="button"
                        className="wl-menu-item wl-menu-item-danger"
                        style={menuItemStyleForDropdown}
                        disabled={rowBusy || !effectiveClusterId}
                        onClick={() => {
                          setMenuOpenKey(null);
                          if (!effectiveClusterId) return;
                          const refText = formatConfigMapReferenceSummary(refs);
                          setActionConfirm({
                            title: "确认删除 1 个 ConfigMap？",
                            description:
                              refs.totalResources > 0
                                ? `该 ConfigMap 被 ${refText} 引用。删除后相关工作负载可能启动失败或配置异常。`
                                : "当前未发现引用资源。删除后不可恢复。",
                            items: [`${ns}/${name}`],
                            variant: "danger",
                            onConfirm: async (auditReason) => {
                              setRowBusyKey(rowKey);
                              try {
                                await deleteConfigMapApi(effectiveClusterId, ns, name, auditReason);
                                onDeletedOne(ns, name);
                                setToastMessage("已删除 ConfigMap");
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
                        <span style={{ marginRight: 8 }}>🗑</span> 删除
                      </button>
                      )}
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

export function configMapRiskTitle(risks: ConfigMapRisk[]): string {
  return risks.map((risk) => risk.reason).join("\n");
}

export function configMapRiskSortRank(risks: ConfigMapRisk[]): number {
  return configMapRiskRank(risks);
}
