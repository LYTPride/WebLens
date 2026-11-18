import React from "react";
import type { Pod, SecretSummary } from "../../api";
import { formatAgeFromMetadata } from "../../utils/k8sCreationTimestamp";
import { DescribePodReferencesTable } from "./DescribePodReferencesTable";

function podReferencesSecret(pod: Pod, namespace: string, name: string): boolean {
  const { spec } = pod;
  if (!spec || pod.metadata.namespace !== namespace) return false;
  if (spec.imagePullSecrets?.some((secret) => secret.name === name)) return true;
  if (spec.volumes?.some((volume) =>
    volume.secret?.secretName === name ||
    volume.projected?.sources?.some((source) => source.secret?.name === name) ||
    volume.csi?.nodePublishSecretRef?.name === name
  )) return true;
  const containers = [...(spec.containers ?? []), ...(spec.initContainers ?? []), ...(spec.ephemeralContainers ?? [])];
  return containers.some((container) =>
    container.envFrom?.some((env) => env.secretRef?.name === name) ||
    container.env?.some((env) => env.valueFrom?.secretKeyRef?.name === name)
  );
}

type Props = {
  secret: SecretSummary;
  now: number;
  pods: Pod[] | null | undefined;
  onCopy: (name: string) => void;
  onJumpPod: (name: string) => void;
};

export function SecretDescribeContent({ secret, now, pods, onCopy, onJumpPod }: Props) {
  const { metadata } = secret;
  const refs = pods?.filter((pod) => podReferencesSecret(pod, metadata.namespace, metadata.name)) ?? [];
  const details = [
    ["Name", metadata.name],
    ["Namespace", metadata.namespace],
    ["Type", secret.type || "Opaque"],
    ["键数量", secret.keyCount],
    ["不可变", secret.immutable ? "是" : "否"],
    ["存活时间", formatAgeFromMetadata(metadata, now)],
  ] as const;

  return (
    <div style={{ display: "grid", gap: 16, fontSize: 13 }}>
      <section>
        <h4 style={{ margin: "0 0 8px" }}>基本信息</h4>
        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 14px", margin: 0 }}>
          {details.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt style={{ color: "var(--wl-text-muted)" }}>{label}</dt>
              <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </section>
      <section style={{ minWidth: 0 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--wl-text-primary)" }}>关联资源</h4>
        <div style={{ fontSize: 11, color: "var(--wl-text-secondary)", marginBottom: 8 }}>
          当前可见的 Pod 引用{pods && `（${refs.length}）`}
        </div>
        {!refs.length ? (
          <div style={{ fontSize: 12, color: "var(--wl-text-muted)" }}>
            {pods === undefined ? "正在加载 Pod 引用…" : pods === null ? "无法获取 Pod 引用" : "暂无已知引用"}
          </div>
        ) : (
          <DescribePodReferencesTable pods={refs} onCopyName={onCopy} onJumpPods={onJumpPod} />
        )}
      </section>
    </div>
  );
}
