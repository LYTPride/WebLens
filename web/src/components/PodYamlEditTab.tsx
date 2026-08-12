import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyDeploymentYaml,
  applyIngressYaml,
  applyPodYaml,
  applyServiceYaml,
  applyStatefulSetYaml,
  fetchDeploymentYaml,
  fetchIngressYaml,
  fetchPodYaml,
  fetchServiceYaml,
  fetchStatefulSetYaml,
  fetchPvcYaml,
  applyPvcYaml,
  fetchNodeYaml,
  applyNodeYaml,
  fetchConfigMapYaml,
  applyConfigMapYaml,
} from "../api";
import { AuditReasonDialog } from "./AuditReasonDialog";
import { ClearableSearchInput } from "./ClearableSearchInput";
import { ConfirmDialog } from "./ConfirmDialog";
import { YamlMonacoEditor, type YamlMonacoEditorHandle } from "./YamlMonacoEditor";

interface PodYamlEditTabProps {
  clusterId: string;
  namespace: string;
  podName: string;
  /** 默认 Pod；Deployment 时与 podName 传部署名称 */
  yamlKind?: "pod" | "deployment" | "statefulset" | "ingress" | "service" | "pvc" | "node" | "configmap";
  onClose: () => void;
  /** Deployment 保存时传入 API 返回的 JSON 对象，便于列表局部更新 */
  onSaved?: (result?: unknown) => void;
  /** 仅当标签激活时才请求 YAML，避免与 Watch 等长连接争抢导致长时间等待 */
  isActive?: boolean;
  /** Viewer 角色使用只读 YAML 查看模式，不渲染保存入口。 */
  readOnly?: boolean;
}

type ApiErrorLike = {
  message?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
};

function extractApiError(e: unknown, fallback: string): { status?: number; message: string } {
  const err = e as ApiErrorLike | null;
  const data = err?.response?.data;
  let message = "";
  if (typeof data === "string") {
    const text = data.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        const parsedMessage = parsed.error ?? parsed.message;
        message = typeof parsedMessage === "string" && parsedMessage.trim() ? parsedMessage : text;
      } catch {
        message = text;
      }
    }
  } else if (data && typeof data === "object") {
    const parsed = data as { error?: unknown; message?: unknown };
    const parsedMessage = parsed.error ?? parsed.message;
    if (typeof parsedMessage === "string" && parsedMessage.trim()) {
      message = parsedMessage;
    }
  }
  if (!message) {
    message = err?.message ?? fallback;
  }
  return { status: err?.response?.status, message };
}

function yamlKindLabel(kind: NonNullable<PodYamlEditTabProps["yamlKind"]>): string {
  switch (kind) {
    case "deployment":
      return "Deployment";
    case "statefulset":
      return "StatefulSet";
    case "ingress":
      return "Ingress";
    case "service":
      return "Service";
    case "pvc":
      return "PersistentVolumeClaim";
    case "node":
      return "Node";
    case "configmap":
      return "ConfigMap";
    default:
      return "Pod";
  }
}

function buildYamlErrorHint(status: number | undefined, yamlKind: NonNullable<PodYamlEditTabProps["yamlKind"]>): string | null {
  if (status === 403) {
    return yamlKind === "configmap"
      ? "当前账号缺少 get 或 update ConfigMap 权限；列表只需要 list/watch，但 YAML 编辑需要读取并更新单个 ConfigMap。"
      : "当前账号缺少读取或更新该资源 YAML 的权限。";
  }
  if (status === 404) {
    return "资源不存在、Namespace 不匹配，或当前选择的集群与目标 kubeconfig/context 不一致。";
  }
  if (status && status >= 500) {
    return "后端返回内部错误；页面已保留后端错误正文，服务端日志会同时记录 cluster、namespace 和 name。";
  }
  return null;
}

export const PodYamlEditTab: React.FC<PodYamlEditTabProps> = ({
  clusterId,
  namespace,
  podName,
  yamlKind = "pod",
  onClose,
  onSaved,
  readOnly = false,
  isActive = true,
}) => {
  const [yaml, setYaml] = useState("");
  const [initialYaml, setInitialYaml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveIntent, setSaveIntent] = useState<{ andClose: boolean; auditReason?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const editorRef = useRef<YamlMonacoEditorHandle>(null);

  const loadYaml = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorHint(null);
    try {
      const text =
        yamlKind === "deployment"
          ? await fetchDeploymentYaml(clusterId, namespace, podName)
          : yamlKind === "statefulset"
            ? await fetchStatefulSetYaml(clusterId, namespace, podName)
            : yamlKind === "ingress"
              ? await fetchIngressYaml(clusterId, namespace, podName)
              : yamlKind === "service"
                ? await fetchServiceYaml(clusterId, namespace, podName)
                : yamlKind === "pvc"
                  ? await fetchPvcYaml(clusterId, namespace, podName)
                  : yamlKind === "node"
                    ? await fetchNodeYaml(clusterId, podName)
                    : yamlKind === "configmap"
                      ? await fetchConfigMapYaml(clusterId, namespace, podName)
                      : await fetchPodYaml(clusterId, namespace, podName);
      setYaml(text);
      setInitialYaml(text);
    } catch (e: unknown) {
      const parsed = extractApiError(e, "加载 YAML 失败");
      setError(`${yamlKindLabel(yamlKind)} ${yamlKind === "node" ? podName : `${namespace}/${podName}`} YAML 加载失败：${parsed.message}`);
      setErrorHint(buildYamlErrorHint(parsed.status, yamlKind));
    } finally {
      setLoading(false);
    }
  }, [clusterId, namespace, podName, yamlKind]);

  useEffect(() => {
    if (isActive) loadYaml();
  }, [isActive, loadYaml]);

  const isDirty = yaml !== initialYaml;

  const keyword = search.trim();
  const { matches, total } = useMemo(() => {
    if (!keyword) return { matches: [] as { start: number; end: number }[], total: 0 };
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const list: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(yaml)) !== null) {
      list.push({ start: m.index, end: m.index + m[0].length });
    }
    return { matches: list, total: list.length };
  }, [yaml, keyword]);

  const safeIndex = total > 0 ? ((currentMatchIndex % total) + total) % total : 0;

  const scrollToMatch = useCallback(
    (idx: number, opts?: { focusEditor?: boolean }) => {
      const focusEditor = opts?.focusEditor ?? true;
      const api = editorRef.current;
      if (!api || total === 0) return;
      const target = matches[idx];
      if (!target) return;
      if (focusEditor) {
        api.focus();
      }
      api.selectRangeByOffset(target.start, target.end);
    },
    [matches, total],
  );

  const goPrev = () => {
    if (total === 0) return;
    setCurrentMatchIndex((i) => {
      const next = (i - 1 + total) % total;
      scrollToMatch(next, { focusEditor: true });
      return next;
    });
  };
  const goNext = () => {
    if (total === 0) return;
    setCurrentMatchIndex((i) => {
      const next = (i + 1 + total) % total;
      scrollToMatch(next, { focusEditor: true });
      return next;
    });
  };

  const save = async (andClose: boolean, auditReason: string) => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    setErrorHint(null);
    try {
      if (yamlKind === "deployment") {
        const data = await applyDeploymentYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else if (yamlKind === "statefulset") {
        const data = await applyStatefulSetYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else if (yamlKind === "ingress") {
        const data = await applyIngressYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else if (yamlKind === "service") {
        const data = await applyServiceYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else if (yamlKind === "pvc") {
        const data = await applyPvcYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else if (yamlKind === "node") {
        const data = await applyNodeYaml(clusterId, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else if (yamlKind === "configmap") {
        const data = await applyConfigMapYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.(data);
      } else {
        await applyPodYaml(clusterId, namespace, podName, yaml, auditReason);
        setInitialYaml(yaml);
        onSaved?.();
      }
      if (andClose) onClose();
    } catch (e: unknown) {
      const parsed = extractApiError(e, "保存失败");
      setError(`${yamlKindLabel(yamlKind)} ${yamlKind === "node" ? podName : `${namespace}/${podName}`} YAML 保存失败：${parsed.message}`);
      setErrorHint(buildYamlErrorHint(parsed.status, yamlKind));
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const requestSave = (andClose: boolean) => {
    if (readOnly) return;
    if (!isDirty) {
      if (andClose) onClose();
      return;
    }
    setSaveIntent({ andClose });
  };

  const cancel = () => {
    setYaml(initialYaml);
    setError(null);
    setErrorHint(null);
    onClose();
  };

  if (loading) {
    return (
      <div style={{ padding: 24, color: "var(--wl-text-secondary)" }}>加载 YAML…</div>
    );
  }

  return (
    <>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        flex: 1,
        minWidth: 0,
        width: "100%",
        backgroundColor: "var(--wl-bg-elevated)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid var(--wl-border-sidebar)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, color: "var(--wl-text-secondary)", fontSize: 12 }}>
          <span>
            Kind:{" "}
            {yamlKind === "deployment"
              ? "Deployment"
              : yamlKind === "statefulset"
                ? "StatefulSet"
                : yamlKind === "ingress"
                  ? "Ingress"
                  : yamlKind === "service"
                    ? "Service"
                    : yamlKind === "pvc"
                      ? "PersistentVolumeClaim"
                      : yamlKind === "node"
                        ? "Node"
                        : yamlKind === "configmap"
                          ? "ConfigMap"
                        : "Pod"}
          </span>
          <span>Name: {podName}</span>
          <span>Namespace: {yamlKind === "node" ? "—（集群级）" : namespace}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ClearableSearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setCurrentMatchIndex(0);
            }}
            placeholder="搜索关键字"
            style={{ width: 160 }}
            inputStyle={{
              padding: "4px 8px",
              borderRadius: 4,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "var(--wl-bg-table)",
              color: "var(--wl-text-heading)",
              fontSize: 12,
            }}
          />
          {keyword && (
            <>
              <span style={{ fontSize: 12, color: "var(--wl-text-secondary)", whiteSpace: "nowrap" }}>
                × {total > 0 ? `${safeIndex + 1}/${total}` : "0/0"}
              </span>
              <button
                type="button"
                onClick={goPrev}
                title="上一处匹配"
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--wl-border-strong)",
                  backgroundColor: "var(--wl-bg-control)",
                  color: "var(--wl-text-heading)",
                  cursor: total > 0 ? "pointer" : "not-allowed",
                  fontSize: 12,
                  lineHeight: 1.2,
                }}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={goNext}
                title="下一处匹配"
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--wl-border-strong)",
                  backgroundColor: "var(--wl-bg-control)",
                  color: "var(--wl-text-heading)",
                  cursor: total > 0 ? "pointer" : "not-allowed",
                  fontSize: 12,
                  lineHeight: 1.2,
                }}
              >
                ▼
              </button>
            </>
          )}
          {error && (
            <span style={{ fontSize: 12, color: "var(--wl-status-error-text)" }}>{error}</span>
          )}
          <button
            type="button"
            onClick={cancel}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid var(--wl-border-strong)",
              backgroundColor: "transparent",
              color: "var(--wl-text-secondary)",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => requestSave(false)}
                disabled={saving || !isDirty}
                style={{
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: "1px solid var(--wl-border-strong)",
                  backgroundColor: "var(--wl-bg-control)",
                  color: isDirty && !saving ? "var(--wl-text-heading)" : "var(--wl-text-muted)",
                  cursor: isDirty && !saving ? "pointer" : "not-allowed",
                  fontSize: 12,
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => requestSave(true)}
                disabled={saving}
                style={{
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: "var(--wl-action-primary)",
                  color: "var(--wl-text-on-primary)",
                  cursor: saving ? "not-allowed" : "pointer",
                  fontSize: 12,
                }}
              >
                Save & Close
              </button>
            </>
          )}
        </div>
      </div>

      {error && !yaml ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            padding: 24,
            color: "var(--wl-text-secondary)",
            backgroundColor: "var(--wl-bg-table)",
            borderTop: "1px solid var(--wl-border-sidebar)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: "var(--wl-status-error-text)", fontWeight: 600, marginBottom: 8 }}>YAML 加载失败</div>
          <div>{error}</div>
          {errorHint ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--wl-text-muted)" }}>{errorHint}</div>
          ) : null}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          <YamlMonacoEditor ref={editorRef} value={yaml} onChange={setYaml} readOnly={readOnly} />
        </div>
      )}
    </div>
    <AuditReasonDialog
      open={!!saveIntent && !saveIntent.auditReason}
      actionLabel="编辑 YAML"
      items={[`${yamlKindLabel(yamlKind)} ${yamlKind === "node" ? podName : `${namespace}/${podName}`}`]}
      onClose={() => setSaveIntent(null)}
      onConfirm={(auditReason) => {
        setSaveIntent((current) => current ? { ...current, auditReason } : null);
      }}
    />
    <ConfirmDialog
      open={!!saveIntent?.auditReason}
      title={`确认保存 1 个 ${yamlKindLabel(yamlKind)} 的 YAML？`}
      description="保存后配置会立即提交到当前集群，请确认目标资源与改动内容。"
      items={[yamlKind === "node" ? podName : `${namespace}/${podName}`]}
      variant="primary"
      busy={saving}
      busyText="保存中…"
      onClose={() => setSaveIntent(null)}
      onConfirm={async () => {
        const intent = saveIntent;
        if (!intent?.auditReason) return;
        await save(intent.andClose, intent.auditReason);
      }}
    />
    </>
  );
};
