import React, { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import {
  fetchSecretKeys,
  fetchSecretYaml,
  updateSecretKey,
  type SecretKeys,
  type SecretValueEncoding,
} from "../api";
import { AuditReasonDialog } from "./AuditReasonDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { YamlMonacoEditor } from "./YamlMonacoEditor";
import { WlPortal } from "./portal/WlPortal";

type SecretTarget = { clusterId: string; namespace: string; name: string };

const controls: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  padding: "8px 12px",
  borderBottom: "1px solid var(--wl-border-sidebar)",
  fontSize: 12,
};

const control: React.CSSProperties = {
  padding: "4px 8px",
  maxWidth: "100%",
  border: "1px solid var(--wl-border-strong)",
  borderRadius: 6,
  backgroundColor: "var(--wl-bg-control)",
  color: "var(--wl-text-primary)",
  fontSize: 12,
};

const body: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  color: "var(--wl-text-primary)",
};

function requestError(err: unknown, fallback: string): string {
  if (!isAxiosError<{ error?: string }>(err)) return fallback;
  const status = err.response?.status;
  if (status === 403) return "当前账号没有执行此 Secret 操作的权限";
  if (status === 404) return "Secret 或集群已不存在";
  return err.response?.data?.error || fallback;
}

export function SecretYamlPreview({ clusterId, namespace, name }: SecretTarget) {
  const [revision, setRevision] = useState(0);
  const [yaml, setYaml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setYaml(null);
    setError(null);
    fetchSecretYaml(clusterId, namespace, name, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setYaml(value);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(requestError(err, "加载脱敏 YAML 失败"));
      });
    return () => controller.abort();
  }, [clusterId, namespace, name, revision]);

  return (
    <section style={body}>
      <div style={controls}>
        <strong>脱敏 YAML</strong>
        <button type="button" style={control} onClick={() => setRevision((n) => n + 1)}>重新加载</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {yaml !== null ? <YamlMonacoEditor value={yaml} onChange={() => {}} readOnly /> : (
          <p role={error ? "alert" : "status"} style={{ margin: 12 }}>{error ?? "加载中…"}</p>
        )}
      </div>
    </section>
  );
}

type SecretKeyEditorProps = SecretTarget & {
  uid: string;
  onSaved: () => void;
};

export function SecretKeyEditor({ clusterId, namespace, name, uid, onSaved }: SecretKeyEditorProps) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<SecretKeys | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<SecretValueEncoding>("text");
  const [error, setError] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditReason, setAuditReason] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setError(null);
    setValue(null);
    fetchSecretKeys(clusterId, namespace, name, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.secret.metadata.uid !== uid) {
          setError("Secret 已被重新创建，请从列表重新打开");
          return;
        }
        setSnapshot(data);
        setKey((previous) => data.keys.includes(previous) ? previous : data.keys[0] ?? "");
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(requestError(err, "加载 Secret 键名失败"));
      });
    return () => controller.abort();
  }, [clusterId, namespace, name, uid, revision]);

  const canEdit = !!snapshot && !snapshot.secret.immutable && !!key;
  const target = `${namespace}/${name}`;
  const save = async () => {
    if (!snapshot || !canEdit || value === null || auditReason === null) return;
    setSaving(true);
    setError(null);
    try {
      const secret = await updateSecretKey(clusterId, snapshot.secret, key, value, encoding, auditReason);
      setSnapshot({ ...snapshot, secret });
      setValue(null);
      onSaved();
    } catch (err) {
      setError(requestError(err, "保存 Secret 新值失败"));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={body}>
      <div style={controls}>
        <label>键名{" "}
          <select
            value={snapshot ? key : ""}
            disabled={!snapshot?.keys.length || saving}
            style={control}
            onChange={(event) => {
              setKey(event.currentTarget.value);
              setValue(null);
              setError(null);
            }}
          >
            {!snapshot?.keys.length && <option value="">—</option>}
            {snapshot?.keys.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>输入格式{" "}
          <select
            value={encoding}
            disabled={!canEdit || saving}
            style={control}
            onChange={(event) => setEncoding(event.currentTarget.value === "base64" ? "base64" : "text")}
          >
            <option value="text">文本</option>
            <option value="base64">Base64</option>
          </select>
        </label>
        <button type="button" style={control} disabled={saving} onClick={() => setRevision((n) => n + 1)}>重新加载</button>
        <button
          type="button"
          style={control}
          disabled={!canEdit || value === null || saving}
          onClick={() => { setError(null); setAuditOpen(true); }}
        >保存新值</button>
      </div>
      {error && <div role="alert" style={{ padding: "8px 12px", color: "var(--wl-status-error-text)" }}>{error}</div>}
      {canEdit ? (
        <label style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: 12, gap: 6, fontSize: 12 }}>
          新值
          <textarea
            value={value ?? ""}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="输入新的键值"
            autoComplete="off"
            spellCheck={false}
            disabled={saving}
            style={{ ...control, flex: 1, minHeight: 42, resize: "none", fontFamily: "monospace" }}
          />
        </label>
      ) : !error && (
        <p role="status" style={{ margin: 12 }}>
          {snapshot ? snapshot.secret.immutable ? "此 Secret 不可变" : "此 Secret 没有可更新的键" : "加载中…"}
        </p>
      )}
      {(auditOpen || auditReason !== null) && (
        <WlPortal>
          <AuditReasonDialog
            open={auditOpen}
            actionLabel="更新 Secret 键值"
            items={[target]}
            onClose={() => setAuditOpen(false)}
            onConfirm={(reason) => { setAuditOpen(false); setAuditReason(reason); }}
          />
          <ConfirmDialog
            open={auditReason !== null}
            title="确认更新 Secret 键值？"
            description={error ?? (value === "" ? "此操作将把选中的键更新为空值。" : "此操作将替换选中的键值。")}
            items={[`${target} · ${key}`]}
            variant="primary"
            busy={saving}
            onClose={() => setAuditReason(null)}
            onConfirm={save}
          />
        </WlPortal>
      )}
    </section>
  );
}
