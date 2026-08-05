import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminScopeGroup,
  createAdminUser,
  deleteAdminScopeGroup,
  deleteAdminUser,
  fetchAdminAuditLogs,
  fetchAdminScopeGroups,
  fetchAdminUserGrants,
  fetchAdminUsers,
  resetAdminUserPassword,
  saveAdminScopeGroupScopes,
  saveAdminUserGrants,
  setAdminUserEnabled,
  updateAdminScopeGroup,
  type AccessRole,
  type AdminUserRow,
  type AuditEntry,
  type ClusterCombo,
  type ClusterSummary,
  type ScopeGroup,
  type UserGrants,
} from "../api";
import { ClearableSearchInput } from "../components/ClearableSearchInput";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CopyIcon } from "../components/icons/CopyIcon";
import { kubeconfigDisplayFileName } from "../components/SearchableDropdownPrimitives";

type PublicTab = "users" | "scopes" | "grants" | "groups" | "audit";
type Tab = "users" | "grants" | "groups" | "audit";
type GrantRole = AccessRole | "none";

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  textAlign: "left",
  fontSize: 12,
  color: "var(--wl-text-muted)",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 13,
  color: "var(--wl-text-primary)",
  verticalAlign: "middle",
};

const buttonStyle: React.CSSProperties = {
  padding: "5px 9px",
  borderRadius: 6,
  border: "1px solid var(--wl-border-subtle)",
  background: "var(--wl-bg-elevated)",
  color: "var(--wl-text-primary)",
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--wl-border-strong)",
  background: "var(--wl-bg-input)",
  color: "var(--wl-text-heading)",
  fontSize: 13,
  outline: "none",
};

const emptyGrants = (): UserGrants => ({ groupGrants: [], scopeGrants: [] });

function normalizeTab(tab: PublicTab): Tab {
  return tab === "scopes" ? "grants" : tab;
}

function roleLabel(role: GrantRole): string {
  if (role === "viewer") return "只读观察者";
  if (role === "operator") return "读写运维";
  return "未授权";
}

function formatTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

const RoleSelect: React.FC<{
  value: GrantRole;
  disabled?: boolean;
  onChange: (role: GrantRole) => void;
}> = ({ value, disabled, onChange }) => (
  <select
    value={value}
    disabled={disabled}
    onChange={(event) => onChange(event.target.value as GrantRole)}
    style={{
      ...inputStyle,
      width: 132,
      padding: "5px 7px",
      cursor: disabled ? "not-allowed" : "pointer",
    }}
  >
    <option value="none">未授权</option>
    <option value="viewer">只读观察者</option>
    <option value="operator">读写运维</option>
  </select>
);

const Switch: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ checked, disabled, onChange }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    aria-pressed={checked}
    title={checked ? "已启用" : "已禁用"}
    style={{
      width: 42,
      height: 22,
      padding: 2,
      borderRadius: 999,
      border: `1px solid ${checked ? "var(--wl-pill-success-border)" : "var(--wl-border-strong)"}`,
      background: checked ? "var(--wl-pill-success-bg)" : "var(--wl-bg-input)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      display: "inline-flex",
      justifyContent: checked ? "flex-end" : "flex-start",
      alignItems: "center",
    }}
  >
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: checked ? "var(--wl-pill-success-text)" : "var(--wl-text-muted)",
      }}
    />
  </button>
);

export const AdminAccessModal: React.FC<{
  open: boolean;
  initialTab: PublicTab;
  onClose: () => void;
  clusterCombos: ClusterCombo[];
  clusters: ClusterSummary[];
}> = ({ open, initialTab, onClose, clusterCombos, clusters }) => {
  const [tab, setTab] = useState<Tab>(() => normalizeTab(initialTab));
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [groups, setGroups] = useState<ScopeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [defaultPassword, setDefaultPassword] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const [grants, setGrants] = useState<UserGrants>(emptyGrants);
  const [initialGrants, setInitialGrants] = useState<UserGrants>(emptyGrants);
  const [grantSearch, setGrantSearch] = useState("");
  const [grantsLoading, setGrantsLoading] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupScopeIDs, setGroupScopeIDs] = useState<Set<string>>(() => new Set());
  const [groupScopeSearch, setGroupScopeSearch] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");

  const [auditItems, setAuditItems] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditUserId, setAuditUserId] = useState<number | "">("");
  const [auditAction, setAuditAction] = useState("");
  const [auditResult, setAuditResult] = useState<AuditEntry["result"] | "">("");

  const [confirm, setConfirm] = useState<{
    title: string;
    description?: string;
    items: string[];
    variant: "danger" | "primary";
    onConfirm: () => Promise<void>;
  } | null>(null);

  const clusterById = useMemo(() => new Map(clusters.map((item) => [item.id, item])), [clusters]);
  const normalUsers = useMemo(() => users.filter((item) => item.role === "user"), [users]);
  const selectedUser = useMemo(
    () => normalUsers.find((item) => item.id === selectedUserId) ?? null,
    [normalUsers, selectedUserId],
  );
  const selectedGroup = useMemo(
    () => groups.find((item) => item.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const comboLabel = useCallback(
    (combo: ClusterCombo) => {
      const cluster = clusterById.get(combo.clusterId);
      const fileName = cluster ? kubeconfigDisplayFileName(cluster.filePath) : combo.clusterId;
      const clusterName = cluster?.name ?? combo.clusterId;
      const base = `${fileName} · ${clusterName} · ${combo.namespace}`;
      return combo.alias ? `${combo.alias}（${base}）` : base;
    },
    [clusterById],
  );

  const showMessage = useCallback((text: string, isError = false) => {
    setMessage(text);
    setMessageIsError(isError);
  }, []);

  const reloadUsers = useCallback(async () => {
    const items = await fetchAdminUsers();
    setUsers(items);
    setSelectedUserId((current) => {
      if (current && items.some((item) => item.id === current && item.role === "user")) return current;
      return items.find((item) => item.role === "user")?.id ?? null;
    });
  }, []);

  const reloadGroups = useCallback(async () => {
    const items = await fetchAdminScopeGroups();
    setGroups(items);
    setSelectedGroupId((current) => {
      if (current && items.some((item) => item.id === current)) return current;
      return items[0]?.id ?? null;
    });
  }, []);

  const reloadBaseData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      await Promise.all([reloadUsers(), reloadGroups()]);
    } catch (error: any) {
      showMessage(error?.response?.data?.error ?? error?.message ?? "加载权限配置失败", true);
    } finally {
      setLoading(false);
    }
  }, [reloadGroups, reloadUsers, showMessage]);

  useEffect(() => {
    if (!open) return;
    setTab(normalizeTab(initialTab));
    setDefaultPassword(null);
    setUserSearch("");
    setGrantSearch("");
    setGroupScopeSearch("");
    void reloadBaseData();
  }, [initialTab, open, reloadBaseData]);

  useEffect(() => {
    if (!selectedGroup) {
      setGroupName("");
      setGroupDescription("");
      setGroupScopeIDs(new Set());
      return;
    }
    setGroupName(selectedGroup.name);
    setGroupDescription(selectedGroup.description);
    setGroupScopeIDs(new Set(selectedGroup.scopeIds));
  }, [selectedGroup]);

  const loadUserGrants = useCallback(async () => {
    if (!selectedUserId) {
      setGrants(emptyGrants());
      setInitialGrants(emptyGrants());
      return;
    }
    setGrantsLoading(true);
    try {
      const next = await fetchAdminUserGrants(selectedUserId);
      setGrants(next);
      setInitialGrants(next);
    } catch (error: any) {
      showMessage(error?.response?.data?.error ?? error?.message ?? "加载授权失败", true);
    } finally {
      setGrantsLoading(false);
    }
  }, [selectedUserId, showMessage]);

  useEffect(() => {
    if (!open || tab !== "grants") return;
    void loadUserGrants();
  }, [loadUserGrants, open, tab]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const items = await fetchAdminAuditLogs({
        userId: auditUserId || undefined,
        action: auditAction || undefined,
        result: auditResult,
        limit: 200,
      });
      setAuditItems(items);
    } catch (error: any) {
      showMessage(error?.response?.data?.error ?? error?.message ?? "加载审计记录失败", true);
    } finally {
      setAuditLoading(false);
    }
  }, [auditAction, auditResult, auditUserId, showMessage]);

  useEffect(() => {
    if (!open || tab !== "audit") return;
    void loadAudit();
  }, [loadAudit, open, tab]);

  const groupRole = useCallback(
    (groupId: number): GrantRole => grants.groupGrants.find((item) => item.groupId === groupId)?.role ?? "none",
    [grants.groupGrants],
  );
  const scopeRole = useCallback(
    (scopeId: string): GrantRole => grants.scopeGrants.find((item) => item.scopeId === scopeId)?.role ?? "none",
    [grants.scopeGrants],
  );

  const setGroupRole = (groupId: number, role: GrantRole) => {
    setGrants((current) => ({
      ...current,
      groupGrants:
        role === "none"
          ? current.groupGrants.filter((item) => item.groupId !== groupId)
          : [...current.groupGrants.filter((item) => item.groupId !== groupId), { groupId, role }],
    }));
  };

  const setScopeRole = (scopeId: string, role: GrantRole) => {
    setGrants((current) => ({
      ...current,
      scopeGrants:
        role === "none"
          ? current.scopeGrants.filter((item) => item.scopeId !== scopeId)
          : [...current.scopeGrants.filter((item) => item.scopeId !== scopeId), { scopeId, role }],
    }));
  };

  const grantDiffItems = useMemo(() => {
    const items: string[] = [];
    const initialGroupRoles = new Map(initialGrants.groupGrants.map((item) => [item.groupId, item.role]));
    const nextGroupRoles = new Map(grants.groupGrants.map((item) => [item.groupId, item.role]));
    for (const group of groups) {
      const before = initialGroupRoles.get(group.id) ?? "none";
      const after = nextGroupRoles.get(group.id) ?? "none";
      if (before !== after) items.push(`${group.name}：${roleLabel(before)} → ${roleLabel(after)}`);
    }
    const initialScopeRoles = new Map(initialGrants.scopeGrants.map((item) => [item.scopeId, item.role]));
    const nextScopeRoles = new Map(grants.scopeGrants.map((item) => [item.scopeId, item.role]));
    for (const combo of clusterCombos) {
      const before = initialScopeRoles.get(combo.id) ?? "none";
      const after = nextScopeRoles.get(combo.id) ?? "none";
      if (before !== after) items.push(`${combo.alias || combo.namespace}：${roleLabel(before)} → ${roleLabel(after)}`);
    }
    return items;
  }, [clusterCombos, grants, groups, initialGrants]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return normalUsers;
    return normalUsers.filter((item) => item.username.toLowerCase().includes(term));
  }, [normalUsers, userSearch]);

  const filteredCombos = useMemo(() => {
    const term = grantSearch.trim().toLowerCase();
    if (!term) return clusterCombos;
    return clusterCombos.filter((combo) =>
      [combo.alias ?? "", combo.clusterId, combo.namespace, comboLabel(combo)]
        .some((text) => text.toLowerCase().includes(term)),
    );
  }, [clusterCombos, comboLabel, grantSearch]);

  const groupByScopeID = useMemo(() => {
    const map = new Map<string, ScopeGroup>();
    for (const group of groups) {
      for (const scopeID of group.scopeIds) map.set(scopeID, group);
    }
    return map;
  }, [groups]);

  const groupScopeCandidates = useMemo(() => {
    const term = groupScopeSearch.trim().toLowerCase();
    return clusterCombos.filter((combo) => {
      const owner = groupByScopeID.get(combo.id);
      if (owner && owner.id !== selectedGroupId) return false;
      if (!term) return true;
      return [combo.alias ?? "", combo.clusterId, combo.namespace, comboLabel(combo)]
        .some((text) => text.toLowerCase().includes(term));
    });
  }, [clusterCombos, comboLabel, groupByScopeID, groupScopeSearch, selectedGroupId]);

  const createUser = async () => {
    const username = newUsername.trim();
    if (!username) return;
    setBusy(true);
    setDefaultPassword(null);
    try {
      const result = await createAdminUser(username);
      setNewUsername("");
      setDefaultPassword(result.defaultPassword);
      showMessage(`用户 ${result.user.username} 已创建，首次登录必须修改默认密码。`);
      await reloadUsers();
    } catch (error: any) {
      showMessage(error?.response?.data?.error ?? error?.message ?? "创建用户失败", true);
    } finally {
      setBusy(false);
    }
  };

  const saveGrants = async () => {
    if (!selectedUserId || !selectedUser) return;
    if (grantDiffItems.length === 0) {
      showMessage("授权没有变化");
      return;
    }
    setConfirm({
      title: `确认修改 ${selectedUser.username} 的授权？`,
      description: "组授权与单独作用域授权会立即影响后续请求；同一作用域取较高角色。",
      items: grantDiffItems,
      variant: "primary",
      onConfirm: async () => {
        setBusy(true);
        try {
          await saveAdminUserGrants(selectedUserId, grants);
          setInitialGrants(grants);
          await reloadUsers();
          showMessage("授权已保存");
        } catch (error: any) {
          showMessage(error?.response?.data?.error ?? error?.message ?? "保存授权失败", true);
          throw error;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const saveGroup = async () => {
    if (!selectedGroup) return;
    setBusy(true);
    try {
      await updateAdminScopeGroup(selectedGroup.id, {
        name: groupName,
        description: groupDescription,
        sortOrder: selectedGroup.sortOrder,
      });
      await saveAdminScopeGroupScopes(selectedGroup.id, Array.from(groupScopeIDs));
      await reloadGroups();
      showMessage("作用域分组已保存");
    } catch (error: any) {
      showMessage(error?.response?.data?.error ?? error?.message ?? "保存分组失败", true);
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    setBusy(true);
    try {
      const item = await createAdminScopeGroup(newGroupName, newGroupDescription);
      setNewGroupName("");
      setNewGroupDescription("");
      await reloadGroups();
      setSelectedGroupId(item.id);
      showMessage("作用域分组已创建");
    } catch (error: any) {
      showMessage(error?.response?.data?.error ?? error?.message ?? "创建分组失败", true);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const tabItems: Array<{ id: Tab; label: string }> = [
    { id: "users", label: "用户管理" },
    { id: "grants", label: "角色授权" },
    { id: "groups", label: "作用域分组" },
    { id: "audit", label: "审计记录" },
  ];

  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--wl-overlay-scrim)",
        }}
        onClick={() => {
          if (!busy) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal
          aria-labelledby="wl-access-title"
          style={{
            width: "min(1120px, 96vw)",
            height: "min(760px, 92vh)",
            display: "flex",
            flexDirection: "column",
            padding: 20,
            borderRadius: 8,
            border: "1px solid var(--wl-border-sidebar)",
            backgroundColor: "var(--wl-bg-elevated)",
            boxShadow: "var(--wl-shadow-modal)",
            boxSizing: "border-box",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div>
              <h3 id="wl-access-title" style={{ margin: 0, color: "var(--wl-text-heading)", fontSize: 16 }}>
                权限配置
              </h3>
              <div style={{ marginTop: 3, color: "var(--wl-text-muted)", fontSize: 12 }}>
                平台身份与作用域角色分离；最终权限同时受 Kubernetes RBAC 限制。
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={busy} style={{ ...buttonStyle, marginLeft: "auto" }}>
              关闭
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {tabItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                style={{
                  ...buttonStyle,
                  background: tab === item.id ? "var(--wl-bg-control)" : "var(--wl-bg-elevated)",
                  color: tab === item.id ? "var(--wl-text-heading)" : "var(--wl-text-secondary)",
                  fontWeight: tab === item.id ? 700 : 500,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {message && (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 10px",
                borderRadius: 6,
                background: messageIsError ? "var(--wl-event-warning-bg)" : "var(--wl-pill-info-bg)",
                border: `1px solid ${messageIsError ? "var(--wl-event-warning-border)" : "var(--wl-pill-info-border)"}`,
                color: messageIsError ? "var(--wl-event-warning-title)" : "var(--wl-pill-info-text)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>{message}</span>
              {defaultPassword && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(defaultPassword)
                      .then(() => showMessage("默认密码已复制"))
                      .catch(() => showMessage("复制默认密码失败", true));
                  }}
                  style={{ ...buttonStyle, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <CopyIcon size={14} />
                  复制默认密码
                </button>
              )}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {loading ? (
              <div style={{ color: "var(--wl-text-muted)", fontSize: 13 }}>加载权限配置中…</div>
            ) : tab === "users" ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input
                    value={newUsername}
                    onChange={(event) => setNewUsername(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void createUser();
                    }}
                    placeholder="普通用户名"
                    style={{ ...inputStyle, width: 240 }}
                  />
                  <button type="button" disabled={busy || !newUsername.trim()} onClick={() => void createUser()} style={buttonStyle}>
                    创建普通用户
                  </button>
                  <span style={{ color: "var(--wl-text-muted)", fontSize: 12, alignSelf: "center" }}>
                    默认密码 WebLens@2026，首次登录强制修改
                  </span>
                </div>
                <div style={{ overflow: "auto", border: "1px solid var(--wl-border-sidebar)", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead style={{ background: "var(--wl-bg-table)" }}>
                      <tr>
                        <th style={thStyle}>用户名</th>
                        <th style={thStyle}>平台身份</th>
                        <th style={thStyle}>状态</th>
                        <th style={thStyle}>有效作用域</th>
                        <th style={thStyle}>操作</th>
                      </tr>
                    </thead>
                    <tbody className="wl-table-body">
                      {users.map((user) => (
                        <tr key={user.id} className="wl-table-row">
                          <td style={tdStyle}>{user.username}</td>
                          <td style={tdStyle}>{user.role === "admin" ? "管理员" : "普通用户"}</td>
                          <td style={tdStyle}>
                            <Switch
                              checked={!user.disabled}
                              disabled={user.role === "admin" || busy}
                              onChange={async (enabled) => {
                                setBusy(true);
                                try {
                                  await setAdminUserEnabled(user.id, enabled);
                                  await reloadUsers();
                                  showMessage(enabled ? "用户已启用" : "用户已禁用");
                                } catch (error: any) {
                                  showMessage(error?.response?.data?.error ?? error?.message ?? "更新用户状态失败", true);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            />
                          </td>
                          <td style={tdStyle}>{user.role === "admin" ? "全部" : user.scopeCount}</td>
                          <td style={tdStyle}>
                            {user.role === "user" && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  style={buttonStyle}
                                  onClick={() => {
                                    setSelectedUserId(user.id);
                                    setTab("grants");
                                  }}
                                >
                                  配置角色
                                </button>
                                <button
                                  type="button"
                                  style={buttonStyle}
                                  onClick={() =>
                                    setConfirm({
                                      title: `重置 ${user.username} 的密码？`,
                                      description: "现有会话将失效，下次登录必须修改默认密码。",
                                      items: [user.username],
                                      variant: "primary",
                                      onConfirm: async () => {
                                        const result = await resetAdminUserPassword(user.id);
                                        setDefaultPassword(result.defaultPassword);
                                        showMessage("密码已重置");
                                      },
                                    })
                                  }
                                >
                                  重置密码
                                </button>
                                <button
                                  type="button"
                                  disabled={!user.disabled}
                                  style={{ ...buttonStyle, color: "var(--wl-pill-danger-text)" }}
                                  title={user.disabled ? "删除用户" : "请先禁用用户"}
                                  onClick={() =>
                                    setConfirm({
                                      title: `删除用户 ${user.username}？`,
                                      description: "用户、会话和授权将被删除，操作不可恢复。",
                                      items: [user.username],
                                      variant: "danger",
                                      onConfirm: async () => {
                                        await deleteAdminUser(user.id);
                                        await reloadUsers();
                                        showMessage("用户已删除");
                                      },
                                    })
                                  }
                                >
                                  删除
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : tab === "grants" ? (
              <div style={{ display: "grid", gridTemplateColumns: "230px minmax(0, 1fr)", gap: 12, height: "100%", minHeight: 0 }}>
                <div style={{ border: "1px solid var(--wl-border-sidebar)", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: 10, borderBottom: "1px solid var(--wl-border-table-row)" }}>
                    <ClearableSearchInput value={userSearch} onChange={setUserSearch} placeholder="搜索用户" style={{ width: "100%" }} inputStyle={inputStyle} />
                  </div>
                  <div style={{ overflow: "auto" }}>
                    {filteredUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedUserId(user.id)}
                        style={{
                          width: "100%",
                          padding: "9px 10px",
                          border: "none",
                          borderBottom: "1px solid var(--wl-border-table-row)",
                          background: selectedUserId === user.id ? "var(--wl-bg-control)" : "transparent",
                          color: "var(--wl-text-primary)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{user.username}</div>
                        <div style={{ marginTop: 2, fontSize: 11, color: "var(--wl-text-muted)" }}>
                          {user.disabled ? "已禁用" : `有效作用域 ${user.scopeCount} 个`}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ border: "1px solid var(--wl-border-sidebar)", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {!selectedUser ? (
                    <div style={{ padding: 14, color: "var(--wl-text-muted)", fontSize: 13 }}>请选择普通用户</div>
                  ) : (
                    <>
                      <div style={{ padding: 12, borderBottom: "1px solid var(--wl-border-table-row)", flexShrink: 0 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <div>
                            <div style={{ color: "var(--wl-text-heading)", fontSize: 14, fontWeight: 700 }}>{selectedUser.username}</div>
                            <div style={{ color: "var(--wl-text-muted)", fontSize: 12 }}>
                              同一作用域同时存在组授权和直授时，读写高于只读。
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={busy || grantsLoading || grantDiffItems.length === 0}
                            onClick={() => void saveGrants()}
                            style={{ ...buttonStyle, marginLeft: "auto" }}
                          >
                            保存授权{grantDiffItems.length > 0 ? `（${grantDiffItems.length}）` : ""}
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 9, fontSize: 11 }}>
                          <span style={{ padding: "3px 7px", borderRadius: 999, background: "var(--wl-pill-info-bg)", color: "var(--wl-pill-info-text)" }}>
                            只读：查看、Logs、文件下载
                          </span>
                          <span style={{ padding: "3px 7px", borderRadius: 999, background: "var(--wl-pill-success-bg)", color: "var(--wl-pill-success-text)" }}>
                            读写：编辑、删除、重启、扩缩容、Shell、文件写入
                          </span>
                        </div>
                      </div>
                      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
                        {grantsLoading ? (
                          <div style={{ color: "var(--wl-text-muted)", fontSize: 13 }}>加载授权中…</div>
                        ) : (
                          <>
                            <div style={{ color: "var(--wl-text-label)", fontSize: 12, fontWeight: 700, marginBottom: 7 }}>作用域组授权</div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {groups.length === 0 ? (
                                <div style={{ color: "var(--wl-text-muted)", fontSize: 12 }}>暂无作用域分组</div>
                              ) : groups.map((group) => (
                                <div key={group.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", border: "1px solid var(--wl-border-subtle)", borderRadius: 6, background: "var(--wl-bg-table)" }}>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ color: "var(--wl-text-primary)", fontSize: 13, fontWeight: 700 }}>{group.name}</div>
                                    <div style={{ color: "var(--wl-text-muted)", fontSize: 11 }}>{group.scopeCount} 个作用域 · {group.description || "无说明"}</div>
                                  </div>
                                  <RoleSelect value={groupRole(group.id)} disabled={busy} onChange={(role) => setGroupRole(group.id, role)} />
                                </div>
                              ))}
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, marginBottom: 7 }}>
                              <div style={{ color: "var(--wl-text-label)", fontSize: 12, fontWeight: 700 }}>单独作用域授权</div>
                              <ClearableSearchInput value={grantSearch} onChange={setGrantSearch} placeholder="搜索作用域" style={{ width: 300, marginLeft: "auto" }} inputStyle={inputStyle} />
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {filteredCombos.map((combo) => {
                                const owner = groupByScopeID.get(combo.id);
                                return (
                                  <div key={combo.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", border: "1px solid var(--wl-border-subtle)", borderRadius: 6, background: "var(--wl-bg-table)" }}>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div style={{ color: "var(--wl-text-primary)", fontSize: 13 }}>{comboLabel(combo)}</div>
                                      <div style={{ color: "var(--wl-text-muted)", fontSize: 11 }}>
                                        {owner ? `所属分组：${owner.name}；这里可配置更高的例外权限` : "未分组作用域"}
                                      </div>
                                    </div>
                                    <RoleSelect value={scopeRole(combo.id)} disabled={busy} onChange={(role) => setScopeRole(combo.id, role)} />
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : tab === "groups" ? (
              <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: 12, height: "100%", minHeight: 0 }}>
                <div style={{ border: "1px solid var(--wl-border-sidebar)", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: 10, borderBottom: "1px solid var(--wl-border-table-row)" }}>
                    <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="新分组名称" style={inputStyle} />
                    <input value={newGroupDescription} onChange={(event) => setNewGroupDescription(event.target.value)} placeholder="说明（可选）" style={{ ...inputStyle, marginTop: 6 }} />
                    <button type="button" disabled={busy || !newGroupName.trim()} onClick={() => void createGroup()} style={{ ...buttonStyle, width: "100%", marginTop: 6 }}>
                      新建分组
                    </button>
                  </div>
                  <div style={{ overflow: "auto" }}>
                    {groups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedGroupId(group.id)}
                        style={{
                          width: "100%",
                          padding: "9px 10px",
                          border: "none",
                          borderBottom: "1px solid var(--wl-border-table-row)",
                          background: selectedGroupId === group.id ? "var(--wl-bg-control)" : "transparent",
                          color: "var(--wl-text-primary)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{group.name}</div>
                        <div style={{ marginTop: 2, fontSize: 11, color: "var(--wl-text-muted)" }}>
                          {group.scopeCount} 个作用域 · {group.grantCount} 名授权用户
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ border: "1px solid var(--wl-border-sidebar)", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
                  {!selectedGroup ? (
                    <div style={{ padding: 14, color: "var(--wl-text-muted)", fontSize: 13 }}>请选择或新建作用域分组</div>
                  ) : (
                    <>
                      <div style={{ padding: 12, borderBottom: "1px solid var(--wl-border-table-row)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) minmax(240px, 2fr) auto auto", gap: 8, alignItems: "center" }}>
                          <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="分组名称" style={inputStyle} />
                          <input value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder="分组说明" style={inputStyle} />
                          <button type="button" disabled={busy || !groupName.trim()} onClick={() => void saveGroup()} style={buttonStyle}>保存分组</button>
                          <button
                            type="button"
                            disabled={busy || selectedGroup.scopeCount > 0}
                            title={selectedGroup.scopeCount > 0 ? "请先移出分组中的全部作用域" : "删除分组"}
                            style={{ ...buttonStyle, color: "var(--wl-pill-danger-text)" }}
                            onClick={() =>
                              setConfirm({
                                title: `删除分组 ${selectedGroup.name}？`,
                                description: "该分组的用户组授权会一并删除。",
                                items: [selectedGroup.name],
                                variant: "danger",
                                onConfirm: async () => {
                                  await deleteAdminScopeGroup(selectedGroup.id);
                                  await reloadGroups();
                                  showMessage("作用域分组已删除");
                                },
                              })
                            }
                          >
                            删除
                          </button>
                        </div>
                        <div style={{ marginTop: 8, color: "var(--wl-text-muted)", fontSize: 12 }}>
                          将作用域加入此分组后，已有的 {selectedGroup.grantCount} 名组授权用户会立即获得对应权限。
                        </div>
                        <ClearableSearchInput value={groupScopeSearch} onChange={setGroupScopeSearch} placeholder="搜索未分组或当前分组作用域" style={{ width: "100%", marginTop: 9 }} inputStyle={inputStyle} />
                      </div>
                      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          {groupScopeCandidates.length === 0 ? (
                            <div style={{ color: "var(--wl-text-muted)", fontSize: 13 }}>没有可加入的作用域</div>
                          ) : groupScopeCandidates.map((combo) => (
                            <label key={combo.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--wl-border-subtle)", background: groupScopeIDs.has(combo.id) ? "var(--wl-bg-control)" : "var(--wl-bg-table)", color: "var(--wl-text-primary)", fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={groupScopeIDs.has(combo.id)}
                                onChange={(event) => {
                                  setGroupScopeIDs((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(combo.id);
                                    else next.delete(combo.id);
                                    return next;
                                  });
                                }}
                              />
                              <span>{comboLabel(combo)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <select value={auditUserId} onChange={(event) => setAuditUserId(event.target.value ? Number(event.target.value) : "")} style={{ ...inputStyle, width: 180 }}>
                    <option value="">全部用户</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}
                  </select>
                  <select value={auditAction} onChange={(event) => setAuditAction(event.target.value)} style={{ ...inputStyle, width: 180 }}>
                    <option value="">全部操作</option>
                    <option value="access.manage">权限管理</option>
                    <option value="scope.config">作用域配置</option>
                    <option value="platform.config">平台配置</option>
                    <option value="resource.write">资源写入</option>
                    <option value="resource.delete">资源删除</option>
                    <option value="resource.restart">资源重启</option>
                    <option value="resource.scale">资源扩缩容</option>
                    <option value="pod.exec">Shell</option>
                    <option value="file.write">文件写入</option>
                    <option value="access.denied">权限拒绝</option>
                  </select>
                  <select value={auditResult} onChange={(event) => setAuditResult(event.target.value as AuditEntry["result"] | "")} style={{ ...inputStyle, width: 150 }}>
                    <option value="">全部结果</option>
                    <option value="success">成功</option>
                    <option value="failure">失败</option>
                    <option value="denied">拒绝</option>
                  </select>
                  <button type="button" disabled={auditLoading} onClick={() => void loadAudit()} style={buttonStyle}>
                    {auditLoading ? "刷新中…" : "刷新"}
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--wl-border-sidebar)", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                    <thead style={{ background: "var(--wl-bg-table)", position: "sticky", top: 0 }}>
                      <tr>
                        <th style={thStyle}>时间</th>
                        <th style={thStyle}>用户</th>
                        <th style={thStyle}>操作</th>
                        <th style={thStyle}>作用域 / 资源</th>
                        <th style={thStyle}>结果</th>
                        <th style={thStyle}>来源 IP</th>
                      </tr>
                    </thead>
                    <tbody className="wl-table-body">
                      {auditItems.map((item) => (
                        <tr key={item.id} className="wl-table-row">
                          <td style={tdStyle}>{formatTime(item.createdAt)}</td>
                          <td style={tdStyle}>{item.username}</td>
                          <td style={tdStyle}>
                            <div>{item.action}</div>
                            <div style={{ color: "var(--wl-text-muted)", fontSize: 11 }}>{item.method} {item.path}</div>
                          </td>
                          <td style={tdStyle}>
                            {[item.clusterId, item.namespace].filter(Boolean).join(" / ") || "平台"}
                            {item.resourceName ? <div style={{ color: "var(--wl-text-muted)", fontSize: 11 }}>{item.resourceKind}/{item.resourceName}</div> : null}
                          </td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                padding: "2px 6px",
                                borderRadius: 999,
                                background: item.result === "success" ? "var(--wl-pill-success-bg)" : "var(--wl-event-warning-bg)",
                                color: item.result === "success" ? "var(--wl-pill-success-text)" : "var(--wl-event-warning-title)",
                              }}
                            >
                              {item.result === "success" ? "成功" : item.result === "denied" ? "拒绝" : "失败"} · {item.statusCode}
                            </span>
                          </td>
                          <td style={tdStyle}>{item.sourceIp || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!auditLoading && auditItems.length === 0 && (
                    <div style={{ padding: 14, color: "var(--wl-text-muted)", fontSize: 13 }}>暂无匹配的审计记录</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        items={confirm?.items ?? []}
        variant={confirm?.variant ?? "danger"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await confirm.onConfirm();
          setConfirm(null);
        }}
      />
    </>
  );
};
