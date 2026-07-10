import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  fetchAdminUserScopes,
  resetAdminUserPassword,
  saveAdminUserScopes,
  setAdminUserEnabled,
  type AdminUserRow,
  type ClusterCombo,
  type ClusterSummary,
} from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ClearableSearchInput } from "../components/ClearableSearchInput";
import { CopyIcon } from "../components/icons/CopyIcon";
import { kubeconfigDisplayFileName } from "../components/SearchableDropdownPrimitives";

type Tab = "users" | "scopes";

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  textAlign: "left",
  fontSize: 12,
  color: "var(--wl-text-muted)",
  fontWeight: 700,
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 13,
  color: "var(--wl-text-primary)",
  verticalAlign: "middle",
};

const smallButtonStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--wl-border-subtle)",
  background: "var(--wl-bg-elevated)",
  color: "var(--wl-text-primary)",
  cursor: "pointer",
  fontSize: 12,
};

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
  initialTab: Tab;
  onClose: () => void;
  clusterCombos: ClusterCombo[];
  clusters: ClusterSummary[];
}> = ({ open, initialTab, onClose, clusterCombos, clusters }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyableDefaultPassword, setCopyableDefaultPassword] = useState<string | null>(null);
  const [copyableDefaultPasswordMessage, setCopyableDefaultPasswordMessage] = useState<string | null>(null);
  const [defaultPasswordCopied, setDefaultPasswordCopied] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedScopeIds, setSelectedScopeIds] = useState<Set<string>>(() => new Set());
  const [scopeSearch, setScopeSearch] = useState("");
  const [scopesLoading, setScopesLoading] = useState(false);
  const [savingScopes, setSavingScopes] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    description?: string;
    items: string[];
    variant: "danger" | "primary";
    onConfirm: () => Promise<void>;
  } | null>(null);

  const normalUsers = useMemo(() => users.filter((u) => u.role === "user"), [users]);
  const clusterById = useMemo(() => new Map(clusters.map((cluster) => [cluster.id, cluster])), [clusters]);
  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) ?? null, [selectedUserId, users]);
  const scopeSearchTerm = scopeSearch.trim().toLowerCase();
  const filteredClusterCombos = useMemo(() => {
    if (!scopeSearchTerm) return clusterCombos;
    return clusterCombos.filter((combo) => {
      const cluster = clusterById.get(combo.clusterId);
      const fileName = cluster ? kubeconfigDisplayFileName(cluster.filePath) : combo.clusterId;
      return [fileName, combo.namespace, combo.alias ?? ""].some((part) =>
        part.toLowerCase().includes(scopeSearchTerm),
      );
    });
  }, [clusterById, clusterCombos, scopeSearchTerm]);

  const reloadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchAdminUsers();
      setUsers(items);
      setSelectedUserId((prev) => {
        if (prev && items.some((u) => u.id === prev && u.role === "user")) return prev;
        return items.find((u) => u.role === "user")?.id ?? null;
      });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "加载用户失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setScopeSearch("");
    setCopyableDefaultPassword(null);
    setCopyableDefaultPasswordMessage(null);
    setDefaultPasswordCopied(false);
    void reloadUsers();
  }, [initialTab, open, reloadUsers]);

  useEffect(() => {
    if (!open || tab !== "scopes" || !selectedUserId) {
      setSelectedScopeIds(new Set());
      return;
    }
    setScopesLoading(true);
    setError(null);
    fetchAdminUserScopes(selectedUserId)
      .then((ids) => setSelectedScopeIds(new Set(ids)))
      .catch((err: any) => setError(err?.response?.data?.error ?? err?.message ?? "加载授权失败"))
      .finally(() => setScopesLoading(false));
  }, [open, selectedUserId, tab]);

  const createUser = async () => {
    const username = newUsername.trim();
    if (!username) return;
    setError(null);
    setCopyableDefaultPassword(null);
    setCopyableDefaultPasswordMessage(null);
    setDefaultPasswordCopied(false);
    try {
      const res = await createAdminUser(username);
      const message = `用户 ${res.user.username} 已创建，默认密码为 ${res.defaultPassword}`;
      setNewUsername("");
      await reloadUsers();
      setError(message);
      setCopyableDefaultPassword(res.defaultPassword);
      setCopyableDefaultPasswordMessage(message);
    } catch (err: any) {
      setCopyableDefaultPassword(null);
      setCopyableDefaultPasswordMessage(null);
      setDefaultPasswordCopied(false);
      setError(err?.response?.data?.error ?? err?.message ?? "创建用户失败");
    }
  };

  const copyDefaultPassword = useCallback((password: string) => {
    const value = password.trim();
    if (!value) return;

    const markCopied = () => setDefaultPasswordCopied(true);
    const fallbackExecCommand = () => {
      const textarea = document.createElement("textarea");
      try {
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand && document.execCommand("copy");
        if (ok) markCopied();
        else setError("复制默认密码失败");
      } catch {
        setError("复制默认密码失败");
      } finally {
        textarea.remove();
      }
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(markCopied).catch(fallbackExecCommand);
    } else {
      fallbackExecCommand();
    }
  }, []);

  const comboLabel = (combo: ClusterCombo) => {
    const cluster = clusterById.get(combo.clusterId);
    const fileName = cluster ? kubeconfigDisplayFileName(cluster.filePath) : combo.clusterId;
    const clusterName = cluster?.name ?? combo.clusterId;
    const base = `${fileName} · ${clusterName} · ${combo.namespace}`;
    return combo.alias ? `${combo.alias}（${base}）` : base;
  };

  if (!open) return null;

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
          if (!loading && !savingScopes) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal
          aria-labelledby="wl-access-title"
          style={{
            width: "min(960px, 94vw)",
            maxHeight: "88vh",
            display: "flex",
            flexDirection: "column",
            padding: 20,
            borderRadius: 8,
            border: "1px solid var(--wl-border-sidebar)",
            backgroundColor: "var(--wl-bg-elevated)",
            boxShadow: "var(--wl-shadow-modal)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <h3 id="wl-access-title" style={{ margin: 0, color: "var(--wl-text-heading)", fontSize: 16 }}>
              权限配置
            </h3>
            <button type="button" onClick={onClose} style={smallButtonStyle}>关闭</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setTab("users")}
              style={{
                ...smallButtonStyle,
                background: tab === "users" ? "var(--wl-bg-control)" : "var(--wl-bg-elevated)",
                fontWeight: tab === "users" ? 700 : 500,
              }}
            >
              用户管理
            </button>
            <button
              type="button"
              onClick={() => setTab("scopes")}
              style={{
                ...smallButtonStyle,
                background: tab === "scopes" ? "var(--wl-bg-control)" : "var(--wl-bg-elevated)",
                fontWeight: tab === "scopes" ? 700 : 500,
              }}
            >
              作用域授权
            </button>
          </div>
          {error && (
            <div
              style={{
                marginBottom: 12,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--wl-pill-info-bg)",
                border: "1px solid var(--wl-pill-info-border)",
                color: "var(--wl-pill-info-text)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span>{error}</span>
              {copyableDefaultPassword && copyableDefaultPasswordMessage === error && (
                <button
                  type="button"
                  onClick={() => copyDefaultPassword(copyableDefaultPassword)}
                  title="复制默认密码"
                  aria-label="复制默认密码"
                  style={{
                    ...smallButtonStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 7px",
                    borderColor: "var(--wl-pill-info-border)",
                    background: "var(--wl-bg-elevated)",
                    color: "var(--wl-pill-info-text)",
                  }}
                >
                  <CopyIcon size={14} />
                  {defaultPasswordCopied ? "已复制" : "复制"}
                </button>
              )}
            </div>
          )}

          {tab === "users" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="普通用户名"
                  style={{
                    width: 220,
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--wl-border-strong)",
                    background: "var(--wl-bg-input)",
                    color: "var(--wl-text-heading)",
                    fontSize: 13,
                  }}
                />
                <button type="button" onClick={() => void createUser()} style={smallButtonStyle}>
                  创建普通用户
                </button>
                <span style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>默认密码：WebLens@2026</span>
              </div>
              <div style={{ overflow: "auto", border: "1px solid var(--wl-border-sidebar)", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead style={{ background: "var(--wl-bg-table)" }}>
                    <tr>
                      <th style={thStyle}>用户名</th>
                      <th style={thStyle}>类型</th>
                      <th style={thStyle}>状态</th>
                      <th style={thStyle}>授权数</th>
                      <th style={thStyle}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr><td colSpan={5} style={tdStyle}>加载中...</td></tr>
                    )}
                    {!loading && users.map((user) => (
                      <tr key={user.id}>
                        <td style={tdStyle}>{user.username}</td>
                        <td style={tdStyle}>{user.role === "admin" ? "管理员" : "普通用户"}</td>
                        <td style={tdStyle}>
                          <Switch
                            checked={!user.disabled}
                            disabled={user.role === "admin" || busyUserId === user.id}
                            onChange={async (enabled) => {
                              setBusyUserId(user.id);
                              setError(null);
                              try {
                                await setAdminUserEnabled(user.id, enabled);
                                await reloadUsers();
                              } catch (err: any) {
                                setError(err?.response?.data?.error ?? err?.message ?? "更新用户状态失败");
                              } finally {
                                setBusyUserId(null);
                              }
                            }}
                          />
                        </td>
                        <td style={tdStyle}>{user.role === "admin" ? "全部" : user.scopeCount}</td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {user.role === "user" && (
                              <>
                                <button
                                  type="button"
                                  style={smallButtonStyle}
                                  onClick={() =>
                                    setConfirm({
                                      title: `重置 ${user.username} 的密码？`,
                                      description: "重置后该用户在线会话会立即失效，下次登录必须先修改默认密码。",
                                      items: [user.username],
                                      variant: "primary",
                                      onConfirm: async () => {
                                        const res = await resetAdminUserPassword(user.id);
                                        setCopyableDefaultPassword(null);
                                        setCopyableDefaultPasswordMessage(null);
                                        setDefaultPasswordCopied(false);
                                        setError(`密码已重置为 ${res.defaultPassword}`);
                                      },
                                    })
                                  }
                                >
                                  重置密码
                                </button>
                                <button
                                  type="button"
                                  style={smallButtonStyle}
                                  onClick={() =>
                                    setConfirm({
                                      title: `删除 ${user.username}？`,
                                      description: "删除会移除该用户信息、授权和会话；删除前必须先禁用用户。",
                                      items: [user.username],
                                      variant: "danger",
                                      onConfirm: async () => {
                                        await deleteAdminUser(user.id);
                                        await reloadUsers();
                                      },
                                    })
                                  }
                                >
                                  删除
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: 14, minHeight: 360, height: "min(560px, calc(88vh - 160px))", overflow: "hidden" }}>
              <div style={{ border: "1px solid var(--wl-border-sidebar)", borderRadius: 8, overflow: "auto" }}>
                {normalUsers.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 13, color: "var(--wl-text-muted)" }}>暂无普通用户</div>
                ) : normalUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedUserId(user.id)}
                    style={{
                      display: "block",
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
                    <div style={{ fontSize: 11, color: "var(--wl-text-muted)" }}>{user.disabled ? "已禁用" : `授权 ${user.scopeCount} 个`}</div>
                  </button>
                ))}
              </div>
              <div
                style={{
                  border: "1px solid var(--wl-border-sidebar)",
                  borderRadius: 8,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {!selectedUser ? (
                  <div style={{ padding: 12, color: "var(--wl-text-muted)", fontSize: 13 }}>请选择普通用户</div>
                ) : (
                  <>
                    <div
                      style={{
                        flexShrink: 0,
                        padding: 12,
                        borderBottom: "1px solid var(--wl-border-table-row)",
                        background: "var(--wl-bg-elevated)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--wl-text-heading)" }}>{selectedUser.username}</div>
                          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>从已添加作用域中勾选授权项</div>
                        </div>
                        <button
                          type="button"
                          disabled={savingScopes || scopesLoading}
                          onClick={async () => {
                            if (!selectedUserId) return;
                            setSavingScopes(true);
                            setError(null);
                            try {
                              await saveAdminUserScopes(selectedUserId, Array.from(selectedScopeIds));
                              await reloadUsers();
                              setError("授权已保存");
                            } catch (err: any) {
                              setError(err?.response?.data?.error ?? err?.message ?? "保存授权失败");
                            } finally {
                              setSavingScopes(false);
                            }
                          }}
                          style={smallButtonStyle}
                        >
                          {savingScopes ? "保存中..." : "保存授权"}
                        </button>
                      </div>
                      <ClearableSearchInput
                        value={scopeSearch}
                        onChange={setScopeSearch}
                        placeholder="搜索 kubeconfig / 命名空间 / 别名"
                        disabled={scopesLoading || clusterCombos.length === 0}
                        style={{ width: "100%", marginTop: 10 }}
                        inputStyle={{
                          padding: "7px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--wl-border-strong)",
                          background: "var(--wl-bg-input)",
                          color: "var(--wl-text-heading)",
                          fontSize: 13,
                          outline: "none",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
                      {scopesLoading ? (
                        <div style={{ fontSize: 13, color: "var(--wl-text-muted)" }}>加载授权中...</div>
                      ) : clusterCombos.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--wl-text-muted)" }}>暂无已添加作用域，请先到平台配置添加。</div>
                      ) : filteredClusterCombos.length === 0 ? (
                        <div style={{ fontSize: 13, color: "var(--wl-text-muted)" }}>未找到匹配的作用域</div>
                      ) : (
                        <div style={{ display: "grid", gap: 6 }}>
                          {filteredClusterCombos.map((combo) => (
                            <label
                              key={combo.id}
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "flex-start",
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: "1px solid var(--wl-border-subtle)",
                                background: selectedScopeIds.has(combo.id) ? "var(--wl-bg-control)" : "var(--wl-bg-table)",
                                color: "var(--wl-text-primary)",
                                fontSize: 13,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedScopeIds.has(combo.id)}
                                onChange={(e) => {
                                  setSelectedScopeIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(combo.id);
                                    else next.delete(combo.id);
                                    return next;
                                  });
                                }}
                              />
                              <span>{comboLabel(combo)}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
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
