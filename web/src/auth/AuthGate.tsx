import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";

const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_WARNING_MS = 30 * 1000;
const AUTH_VIDEO_SRC = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4";

const eyeIcon = (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const eyeOffIcon = (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6" />
    <path d="M7.1 7.1C3.8 8.8 2 12 2 12s3.5 6 10 6c1.7 0 3.2-.4 4.4-1" />
    <path d="M14.1 6.3C13.4 6.1 12.7 6 12 6 5.5 6 2 12 2 12s.8 1.4 2.3 2.8" />
    <path d="M17.7 8.4C20.3 10.1 22 12 22 12s-.8 1.5-2.4 3" />
  </svg>
);

const PasswordInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
}> = ({ value, onChange, placeholder, autoComplete }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="wl-auth-password-wrap">
      <input
        className="wl-auth-input"
        type={visible ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="wl-auth-eye wl-btn--no-hover-overlay"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        title={visible ? "隐藏密码" : "显示密码"}
      >
        {visible ? eyeOffIcon : eyeIcon}
      </button>
    </div>
  );
};

const AuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main className="wl-auth-page">
    <section className="wl-auth-hero" aria-label="WebLens 控制台入口">
      <video className="wl-auth-hero-video" autoPlay muted loop playsInline aria-hidden="true">
        <source src={AUTH_VIDEO_SRC} type="video/mp4" />
      </video>
      <div className="wl-auth-hero-content">
        <div className="wl-auth-hero-brand">
          <span className="wl-auth-hero-mark" aria-hidden="true" />
          <span>WebLens</span>
        </div>
        <div className="wl-auth-hero-title">Kubernetes operations console</div>
        <div className="wl-auth-hero-subtitle">聚焦集群资源、日志、终端与 YAML 操作</div>
      </div>
    </section>
    <section className="wl-auth-panel">{children}</section>
  </main>
);

const LoginPage: React.FC = () => {
  const { login, notice, clearNotice } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    clearNotice();
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "登录失败");
    } finally {
      setSubmitting(false);
    }
  }, [clearNotice, login, password, submitting, username]);

  return (
    <AuthShell>
      <form className="wl-auth-card" onSubmit={submit}>
        <div className="wl-auth-heading">
          <div className="wl-auth-title">登录 WebLens</div>
          <div className="wl-auth-subtitle">输入账号密码进入 Kubernetes operations console</div>
        </div>
        <label className="wl-auth-label">
          用户名
          <input
            className="wl-auth-input"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
            autoFocus
          />
        </label>
        <label className="wl-auth-label">
          密码
          <PasswordInput value={password} onChange={setPassword} placeholder="请输入密码" autoComplete="current-password" />
        </label>
        {(error || notice) && (
          <div className={notice?.type === "info" && !error ? "wl-auth-message wl-auth-message--info" : "wl-auth-message"}>
            {error || notice?.message}
          </div>
        )}
        <button type="submit" className="wl-auth-submit wl-btn--no-hover-overlay" disabled={submitting || !username.trim() || !password}>
          {submitting ? "登录中..." : "登录"}
        </button>
      </form>
    </AuthShell>
  );
};

const ForcePasswordPage: React.FC = () => {
  const { auth, changePassword, logout, notice } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changePassword("", newPassword);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "修改密码失败");
    } finally {
      setSubmitting(false);
    }
  }, [changePassword, confirmPassword, newPassword, submitting]);

  return (
    <AuthShell>
      <form className="wl-auth-card wl-auth-card--wide" onSubmit={submit}>
        <div className="wl-auth-heading">
          <div className="wl-auth-title">首次修改密码</div>
          <div className="wl-auth-subtitle">{auth?.user.username} 需要先设置个人密码。</div>
        </div>
        <label className="wl-auth-label">
          新密码
          <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="请输入新密码" autoComplete="new-password" />
        </label>
        <label className="wl-auth-label">
          确认新密码
          <PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="请再次输入新密码" autoComplete="new-password" />
        </label>
        <div className="wl-auth-hint">至少 8 位，不能使用默认密码，不能与旧密码相同。</div>
        {(error || notice) && <div className="wl-auth-message">{error || notice?.message}</div>}
        <div className="wl-auth-actions">
          <button type="button" className="wl-auth-secondary wl-btn--no-hover-overlay" onClick={() => void logout()}>
            登出
          </button>
          <button type="submit" className="wl-auth-submit wl-btn--no-hover-overlay" disabled={submitting || !newPassword || !confirmPassword}>
            {submitting ? "保存中..." : "保存并进入"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
};

const IdleTimeoutGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { auth, renew, logout } = useAuth();
  const timeoutMs = auth?.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS;
  const warningMs = auth?.idleWarningMs || DEFAULT_WARNING_MS;
  const [deadline, setDeadline] = useState(() => Date.now() + timeoutMs);
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(warningMs / 1000));
  const nextRenewAtRef = useRef(0);

  useEffect(() => {
    setDeadline(Date.now() + timeoutMs);
    setWarningOpen(false);
    setRemainingSeconds(Math.ceil(warningMs / 1000));
    nextRenewAtRef.current = Date.now() + 60_000;
  }, [auth?.user.id, timeoutMs, warningMs]);

  const markActivity = useCallback(() => {
    if (warningOpen) return;
    const now = Date.now();
    setDeadline(now + timeoutMs);
    if (now >= nextRenewAtRef.current) {
      nextRenewAtRef.current = now + 60_000;
      renew().catch(() => void logout("会话已失效，请重新登录"));
    }
  }, [logout, renew, timeoutMs, warningOpen]);

  useEffect(() => {
    window.addEventListener("pointerdown", markActivity, true);
    window.addEventListener("keydown", markActivity, true);
    return () => {
      window.removeEventListener("pointerdown", markActivity, true);
      window.removeEventListener("keydown", markActivity, true);
    };
  }, [markActivity]);

  useEffect(() => {
    const warnDelay = Math.max(0, deadline - Date.now() - warningMs);
    const logoutDelay = Math.max(0, deadline - Date.now());
    const warnTimer = window.setTimeout(() => setWarningOpen(true), warnDelay);
    const logoutTimer = window.setTimeout(() => void logout("会话已超时，请重新登录"), logoutDelay);
    return () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(logoutTimer);
    };
  }, [deadline, logout, warningMs]);

  useEffect(() => {
    if (!warningOpen) return;
    const id = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [deadline, warningOpen]);

  const continueUsing = () => {
    const next = Date.now() + timeoutMs;
    setWarningOpen(false);
    setDeadline(next);
    setRemainingSeconds(Math.ceil(warningMs / 1000));
    nextRenewAtRef.current = Date.now() + 60_000;
    renew().catch(() => void logout("会话已失效，请重新登录"));
  };

  return (
    <>
      {children}
      {warningOpen && (
        <div className="wl-auth-timeout-backdrop" role="presentation">
          <div className="wl-auth-timeout-dialog" role="dialog" aria-modal aria-labelledby="wl-timeout-title">
            <div id="wl-timeout-title" className="wl-auth-timeout-title">会话即将超时</div>
            <div className="wl-auth-timeout-body">
              {remainingSeconds} 秒后将自动登出。未保存的 YAML 不会自动保存。
            </div>
            <button type="button" className="wl-auth-submit" onClick={continueUsing}>
              继续使用
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { auth, loading } = useAuth();

  if (loading) {
    return (
      <AuthShell>
        <div className="wl-auth-card">
          <div className="wl-auth-heading">
            <div className="wl-auth-title">WebLens</div>
            <div className="wl-auth-subtitle">正在检查登录状态...</div>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (!auth) return <LoginPage />;
  if (auth.mustChangePassword || auth.user.mustChangePassword) return <ForcePasswordPage />;

  return <IdleTimeoutGuard>{children}</IdleTimeoutGuard>;
};
