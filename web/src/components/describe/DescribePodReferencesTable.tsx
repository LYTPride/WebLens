import React from "react";
import type { Pod } from "../../api";
import { getPodStatusInfo } from "../../utils/podTableStatus";
import { PodHealthPill, PodListStatusPill } from "../PodStatusPills";
import { ResourceJumpChip } from "../ResourceJumpChip";
import { ResourceNameWithCopy } from "../ResourceNameWithCopy";

const miniTh: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid var(--wl-border-table-header)",
  fontSize: 11,
  color: "var(--wl-text-secondary)",
};

const miniTd: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--wl-border-table-row)",
  fontSize: 12,
  color: "var(--wl-text-heading)",
  verticalAlign: "top",
  wordBreak: "break-word",
};

type Props = {
  pods: Pod[];
  onCopyName: (name: string) => void;
  onJumpPods?: (podName: string) => void;
};

export function DescribePodReferencesTable({ pods, onCopyName, onJumpPods }: Props) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "var(--wl-describe-table-bg)", minWidth: 560 }}>
        <thead>
          <tr>
            <th style={miniTh}>Pod</th>
            <th style={miniTh}>状态标签</th>
            <th style={miniTh}>Status</th>
            <th style={miniTh}>Node</th>
            <th style={miniTh}>联动</th>
          </tr>
        </thead>
        <tbody>
          {pods.map((pod) => {
            const { name, uid } = pod.metadata;
            return (
              <tr key={uid}>
                <td style={miniTd}>
                  <ResourceNameWithCopy
                    name={name}
                    onCopy={onCopyName}
                    fontSize={12}
                    copyButtonTitle="复制 Pod 名称"
                  />
                </td>
                <td style={miniTd}>
                  <PodHealthPill label={pod.healthLabel || "健康"} title={pod.healthReasons?.join("；") || undefined} />
                </td>
                <td style={miniTd}>
                  <PodListStatusPill text={getPodStatusInfo(pod).text} />
                </td>
                <td style={{ ...miniTd, fontSize: 11 }}>{pod.spec?.nodeName || "—"}</td>
                <td style={miniTd}>
                  {onJumpPods ? (
                    <ResourceJumpChip
                      label="Pods"
                      compact
                      onClick={() => onJumpPods(name)}
                      title="打开 Pods 并过滤"
                    />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
