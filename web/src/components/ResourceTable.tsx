import React from "react";

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-header)",
  fontSize: 12,
  color: "var(--wl-text-table-header)",
  position: "sticky",
  top: 0,
  zIndex: 1,
  backgroundColor: "var(--wl-bg-table-header)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 13,
};

export interface Column<T> {
  key: string;
  title: string;
  render: (item: T) => React.ReactNode;
}

interface ResourceTableProps<T extends { metadata: { name: string; namespace?: string; uid?: string } }> {
  title: string;
  columns: Column<T>[];
  items: T[];
  getKey: (item: T) => string;
  loading?: boolean;
}

export function ResourceTable<T extends { metadata: { name: string; namespace?: string; uid?: string } }>({
  title,
  columns,
  items,
  getKey,
  loading,
}: ResourceTableProps<T>) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>{title}</h3>
      {loading ? (
        <div style={{ color: "var(--wl-text-label)" }}>加载中…</div>
      ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              backgroundColor: "var(--wl-bg-table)",
            }}
          >
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} style={thStyle}>
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={getKey(item)}>
                  {columns.map((col) => (
                    <td key={col.key} style={tdStyle}>
                      {col.render(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
      )}
      {!loading && items.length === 0 && (
        <div style={{ color: "var(--wl-text-muted)", padding: 12 }}>暂无数据</div>
      )}
    </div>
  );
}
