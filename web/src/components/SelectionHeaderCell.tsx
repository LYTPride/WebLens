import React from "react";
import { Z_INDEX } from "../constants/zLayers";

export interface SelectionHeaderCellProps {
  children: React.ReactNode;
  thBase: React.CSSProperties;
  width: number;
  sticky?: boolean;
}

/**
 * Resource-table header cell for the select-all checkbox.
 * It intentionally mirrors ResizableTh's sticky header tokens so selection
 * columns remain visually part of the table header in both themes.
 */
export const SelectionHeaderCell: React.FC<SelectionHeaderCellProps> = ({
  children,
  thBase,
  width,
  sticky = true,
}) => (
  <th
    className={sticky ? "wl-table-sticky-head wl-table-select-th" : "wl-table-select-th"}
    style={{
      ...thBase,
      ...(sticky
        ? {
            position: "sticky" as const,
            top: 0,
            zIndex: Z_INDEX.stickyTableHead,
            backgroundColor: "var(--wl-bg-table-header)",
            boxShadow: "0 1px 0 0 var(--wl-border-table-header)",
          }
        : { position: "relative" as const }),
      width,
      maxWidth: width,
      minWidth: width,
      boxSizing: "border-box",
      textAlign: "center",
      verticalAlign: "middle",
    }}
  >
    {children}
  </th>
);
