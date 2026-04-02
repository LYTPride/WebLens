import React from "react";
import type { ResourceKind } from "../api";

export const SIDEBAR_WIDTH = 220;

const MENU: { title: string; items: { id: ResourceKind; label: string }[] }[] = [
  {
    title: "工作负载",
    items: [
      { id: "pods", label: "Pods" },
      { id: "deployments", label: "Deployments" },
      { id: "statefulsets", label: "Stateful Sets" },
      { id: "daemonsets", label: "Daemon Sets" },
      { id: "jobs", label: "Jobs" },
      { id: "cronjobs", label: "Cron Jobs" },
    ],
  },
  {
    title: "配置",
    items: [
      { id: "configmaps", label: "Config Maps" },
      { id: "secrets", label: "Secrets" },
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
  {
    title: "集群",
    items: [
      { id: "nodes", label: "Nodes" },
      { id: "namespaces", label: "Namespaces" },
      { id: "events", label: "Events" },
    ],
  },
];

const sidebarStyle: React.CSSProperties = {
  width: SIDEBAR_WIDTH,
  minWidth: SIDEBAR_WIDTH,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  backgroundColor: "#0f172a",
  borderRight: "1px solid #1e293b",
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
  color: "#64748b",
  padding: "8px 16px",
  textTransform: "uppercase" as const,
};

const itemStyle = (active: boolean): React.CSSProperties => ({
  display: "block",
  width: "100%",
  padding: "8px 16px",
  fontSize: 13,
  color: active ? "#38bdf8" : "#e2e8f0",
  backgroundColor: active ? "#1e293b" : "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
});

interface SidebarProps {
  currentView: ResourceKind;
  onSelect: (view: ResourceKind) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onSelect }) => {
  return (
    <nav style={sidebarStyle}>
      <div style={sidebarInnerStyle}>
      {MENU.map((group) => (
        <div key={group.title}>
          <div style={groupTitleStyle}>{group.title}</div>
          {group.items.map((item) => (
            <button
              key={item.id}
              type="button"
              style={itemStyle(currentView === item.id)}
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
