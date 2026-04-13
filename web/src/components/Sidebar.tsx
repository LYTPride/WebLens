import React, { useMemo } from "react";
import type { ResourceKind } from "../api";
import { V1_HIDDEN_VIEWS } from "../utils/v1HiddenViews";

export const SIDEBAR_WIDTH = 220;

const MENU: { title: string; items: { id: ResourceKind; label: string }[] }[] = [
  {
    title: "集群",
    items: [
      { id: "events", label: "Events" },
      { id: "nodes", label: "Nodes" },
    ],
  },
  {
    title: "工作负载",
    items: [
      { id: "pods", label: "Pods" },
      { id: "deployments", label: "Deployments" },
      { id: "statefulsets", label: "Stateful Sets" },
    ],
  },
  {
    title: "网络",
    items: [
      { id: "services", label: "Services" },
      { id: "ingresses", label: "Ingresses" },
    ],
  },
  {
    title: "存储",
    items: [{ id: "persistentvolumeclaims", label: "Persistent Volume Claims" }],
  },
];

const sidebarStyle: React.CSSProperties = {
  width: SIDEBAR_WIDTH,
  minWidth: SIDEBAR_WIDTH,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  backgroundColor: "var(--wl-bg-sidebar)",
  borderRight: "1px solid var(--wl-border-sidebar)",
  overflow: "hidden",
};

const sidebarInnerStyle: React.CSSProperties = {
  padding: "12px 0",
  overflowY: "auto",
  overflowX: "hidden",
};

const groupTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--wl-text-muted)",
  padding: "8px 16px",
  textTransform: "uppercase" as const,
};

interface SidebarProps {
  currentView: ResourceKind;
  onSelect: (view: ResourceKind) => void;
  /** 贴在主壳左侧轨道内时去掉右侧分割线，由轨道统一承担 */
  edge?: "standalone" | "rail";
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onSelect, edge = "standalone" }) => {
  const navStyle: React.CSSProperties =
    edge === "rail" ? { ...sidebarStyle, borderRight: "none" } : sidebarStyle;
  const innerPad: React.CSSProperties =
    edge === "rail" ? { ...sidebarInnerStyle, paddingRight: 14 } : sidebarInnerStyle;
  const visibleMenu = useMemo(
    () =>
      MENU.map((group) => ({
        ...group,
        items: group.items.filter((item) => !V1_HIDDEN_VIEWS.has(item.id)),
      })).filter((g) => g.items.length > 0),
    [],
  );
  return (
    <nav style={navStyle}>
      <div style={innerPad}>
        {visibleMenu.map((group) => (
          <div key={group.title}>
            <div style={groupTitleStyle}>{group.title}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`wl-sidebar-resource-item${currentView === item.id ? " wl-sidebar-resource-item--active" : ""}`}
                onClick={() => onSelect(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
};
