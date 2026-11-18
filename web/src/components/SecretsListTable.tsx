import React, { useEffect, useState } from "react";
import type { SecretSummary } from "../api";
import { useResourceListColumnResize } from "../resourceList/useResourceListColumnResize";
import { creationTimestampToAgeSeconds, formatAgeFromMetadata } from "../utils/k8sCreationTimestamp";
import { sortByState, type ResourceListSortState } from "../utils/resourceListSort";
import { ResizableTh } from "./ResizableTh";
import { ResourceRowMenu, ResourceRowMenuItem } from "./ResourceRowMenu";
import { ResourceSortArrows } from "./ResourceSortArrows";
import { CopyIcon } from "./icons/CopyIcon";

const columns = ["name", "namespace", "type", "keys", "immutable", "age", "actions"] as const;
type SortKey = Exclude<(typeof columns)[number], "actions">;
const defaults = { name: 220, namespace: 130, type: 210, keys: 76, immutable: 90, age: 100, actions: 76 };
const labels = {
  name: "Name", namespace: "Namespace", type: "Type", keys: "键数量", immutable: "不可变",
  age: "存活时间", actions: "操作",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-header)",
  color: "var(--wl-text-table-header)",
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
};

function compareSecrets(a: SecretSummary, b: SecretSummary, key: SortKey, now: number): number {
  switch (key) {
    case "name":
    case "namespace":
      return a.metadata[key].localeCompare(b.metadata[key]);
    case "type":
      return a.type.localeCompare(b.type);
    case "keys":
      return a.keyCount - b.keyCount;
    case "immutable":
      return Number(a.immutable) - Number(b.immutable);
    case "age":
      return (creationTimestampToAgeSeconds(a.metadata, now) ?? -1) -
        (creationTimestampToAgeSeconds(b.metadata, now) ?? -1);
  }
}

type Props = {
  items: SecretSummary[];
  loading: boolean;
  error: string | null;
  hasFilter: boolean;
  now: number;
  canWrite: boolean;
  sort: ResourceListSortState<SortKey>;
  setSort: (sort: ResourceListSortState<SortKey>) => void;
  onDescribe: (secret: SecretSummary) => void;
  onCopy: (name: string) => void;
  onPreview: (secret: SecretSummary) => void;
  onRotate: (secret: SecretSummary) => void;
  onDelete: (secret: SecretSummary) => void;
};

export type SecretListSort = ResourceListSortState<SortKey>;

export function SecretsListTable({
  items, loading, error, hasFilter, now, canWrite, sort, setSort, onDescribe, onCopy, onPreview, onRotate, onDelete,
}: Props) {
  const [menuUid, setMenuUid] = useState<string | null>(null);
  const { columnWidths, beginResize, totalDataWidth } = useResourceListColumnResize({
    columnKeys: columns, defaults, minWidthForKey: () => 62,
  });
  const rows = sortByState(items, sort, (a, b, key) => compareSecrets(a, b, key, now));

  useEffect(() => {
    if (menuUid && !items.some((item) => item.metadata.uid === menuUid)) setMenuUid(null);
  }, [items, menuUid]);

  return (
    <table style={{ width: totalDataWidth, minWidth: "100%", borderCollapse: "collapse", backgroundColor: "var(--wl-bg-table)", tableLayout: "fixed" }}>
      <colgroup>
        {columns.map((key) => <col key={key} style={{ width: columnWidths[key] }} />)}
      </colgroup>
      <thead>
        <tr>
          {columns.map((key) => (
            <ResizableTh
              key={key}
              label={labels[key]}
              width={columnWidths[key]}
              thBase={thStyle}
              onResizeStart={beginResize(key)}
              sortTrailing={key !== "actions" && (
                <ResourceSortArrows
                  activeDirection={sort?.key === key ? sort.direction : null}
                  onPickAsc={() => setSort({ key, direction: "asc" })}
                  onPickDesc={() => setSort({ key, direction: "desc" })}
                />
              )}
            />
          ))}
        </tr>
      </thead>
      <tbody className="wl-table-body">
        {(error || rows.length === 0) && (
          <tr className="wl-table-row">
            <td colSpan={columns.length} style={{ ...tdStyle, textAlign: "center" }}>
              {error ? <span role="alert" style={{ color: "var(--wl-status-error-text)" }}>{error}</span>
                : loading ? "加载中…" : hasFilter ? "没有匹配的 Secret" : "当前作用域下没有 Secret"}
            </td>
          </tr>
        )}
        {rows.map((secret) => {
          const { uid, name, namespace } = secret.metadata;
          const menuOpen = menuUid === uid;
          return (
            <tr key={uid} className={`wl-table-row${menuOpen ? " wl-table-row--menu-open" : ""}`}>
              <td style={tdStyle} title={name}>
                <span className="wl-table-hover-copy">
                  <span className="wl-table-hover-copy__main">
                    <button
                      type="button"
                      className="wl-table-hover-copy__truncate"
                      style={{ padding: 0, border: 0, background: "none", color: "inherit", cursor: "pointer" }}
                      onClick={() => onDescribe(secret)}
                    >{name}</button>
                  </span>
                  <button type="button" className="wl-table-hover-copy__btn" aria-label={`复制 Secret 名称：${name}`} onClick={() => onCopy(name)}>
                    <CopyIcon size={15} />
                  </button>
                </span>
              </td>
              <td style={tdStyle} title={namespace}>{namespace}</td>
              <td style={tdStyle} title={secret.type}>{secret.type || "Opaque"}</td>
              <td style={tdStyle}>{secret.keyCount}</td>
              <td style={tdStyle}>{secret.immutable ? "是" : "否"}</td>
              <td style={tdStyle}>{formatAgeFromMetadata(secret.metadata, now)}</td>
              <td style={{ ...tdStyle, overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
                <ResourceRowMenu
                  label={`操作 Secret ${name}`}
                  open={menuOpen}
                  onOpenChange={(open) => setMenuUid(open ? uid : null)}
                >
                  <ResourceRowMenuItem icon="✎" onClick={() => { setMenuUid(null); onPreview(secret); }}>
                    查看脱敏 YAML
                  </ResourceRowMenuItem>
                  {canWrite && (
                    <>
                      <ResourceRowMenuItem
                        icon="⚙"
                        disabled={secret.immutable || secret.keyCount === 0}
                        title={secret.immutable ? "此 Secret 不可变" : undefined}
                        onClick={() => { setMenuUid(null); onRotate(secret); }}
                      >
                        更新键值
                      </ResourceRowMenuItem>
                      <ResourceRowMenuItem icon="🗑" danger onClick={() => { setMenuUid(null); onDelete(secret); }}>
                        删除
                      </ResourceRowMenuItem>
                    </>
                  )}
                </ResourceRowMenu>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
