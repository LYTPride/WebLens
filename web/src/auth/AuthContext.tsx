import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  changeOwnPassword,
  fetchAuthMe,
  login as loginApi,
  logoutApi,
  renewAuthSession,
  type AuthEnvelope,
  WEBLENS_AUTH_EVENT,
} from "../api";

type AuthNotice = {
  type: "info" | "error";
  message: string;
} | null;

type AuthContextValue = {
  auth: AuthEnvelope | null;
  loading: boolean;
  notice: AuthNotice;
  clearNotice: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: (message?: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  renew: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [auth, setAuth] = useState<AuthEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<AuthNotice>(null);

  const clearNotice = useCallback(() => setNotice(null), []);

  const refresh = useCallback(async () => {
    const next = await fetchAuthMe();
    setAuth(next);
  }, []);

  useEffect(() => {
    const onAuthEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: string; message?: string }>).detail || {};
      const code = detail.code || "SESSION_EXPIRED";
      if (code === "SCOPE_FORBIDDEN") return;
      if (code === "PASSWORD_CHANGE_REQUIRED") {
        setAuth((prev) =>
          prev
            ? {
                ...prev,
                mustChangePassword: true,
                user: { ...prev.user, mustChangePassword: true },
              }
            : prev,
        );
        setNotice({ type: "error", message: detail.message || "请先修改临时密码" });
        return;
      }
      setAuth(null);
      setNotice({
        type: "error",
        message:
          code === "USER_DISABLED"
            ? "当前账号已被禁用，请联系管理员"
            : detail.message || "会话已失效，请重新登录",
      });
    };

    window.addEventListener(WEBLENS_AUTH_EVENT, onAuthEvent);
    fetchAuthMe()
      .then((next) => {
        setAuth(next);
        setNotice(null);
      })
      .catch((err: any) => {
        setAuth(null);
        if (err?.response?.data?.code === "UNAUTHENTICATED") {
          setNotice(null);
        }
      })
      .finally(() => setLoading(false));

    return () => window.removeEventListener(WEBLENS_AUTH_EVENT, onAuthEvent);
  }, []);

  useEffect(() => {
    if (!auth) return;
    const id = window.setInterval(() => {
      fetchAuthMe()
        .then((next) => setAuth(next))
        .catch(() => {
          /* axios interceptor emits the user-facing state change */
        });
    }, 5000);
    return () => window.clearInterval(id);
  }, [auth?.user.id]);

  const login = useCallback(async (username: string, password: string) => {
    const next = await loginApi(username, password);
    setAuth(next);
    setNotice(null);
  }, []);

  const logout = useCallback(async (message?: string) => {
    try {
      await logoutApi();
    } catch {
      /* session may already be gone */
    }
    setAuth(null);
    setNotice(message ? { type: "info", message } : null);
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const next = await changeOwnPassword(oldPassword, newPassword);
    setAuth(next);
    setNotice({ type: "info", message: "密码已更新" });
  }, []);

  const renew = useCallback(async () => {
    const next = await renewAuthSession();
    setAuth(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      loading,
      notice,
      clearNotice,
      login,
      logout,
      changePassword,
      renew,
      refresh,
    }),
    [auth, loading, notice, clearNotice, login, logout, changePassword, renew, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
