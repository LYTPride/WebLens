import type { Pod } from "../api";

type ContainerStatus = NonNullable<Pod["status"]>["containerStatuses"] extends (infer U)[] | undefined
  ? U
  : never;

function podWorkContainerRestarts(pod: Pod): number {
  const containerStatuses = pod.status?.containerStatuses || [];
  return (
    containerStatuses.reduce((s, cs) => s + (typeof cs.restartCount === "number" ? cs.restartCount : 0), 0) || 0
  );
}

function firstWaitingReason(cs: ContainerStatus | undefined): string {
  if (!cs) return "";
  const w = cs.state?.waiting?.reason;
  return typeof w === "string" && w ? w : "";
}

function firstTerminatedReason(cs: ContainerStatus | undefined): string {
  if (!cs) return "";
  const t = cs.state?.terminated?.reason;
  return typeof t === "string" && t ? t : "";
}

/**
 * 与 Pods 列表 Status / Restarts 列一致：基于当前 Pod 对象即时重算（watch 每次推送都会走这里）。
 * 覆盖 Terminating、Init 进度、waiting reason、phase=Running 下的 CrashLoopBackOff 等。
 */
export function getPodStatusInfo(pod: Pod): { text: string; restarts: number } {
  const restarts = podWorkContainerRestarts(pod);

  if (pod.metadata.deletionTimestamp) {
    return { text: "Terminating", restarts };
  }

  const phase = pod.status?.phase || "";
  const overallReason = pod.status?.reason || "";
  const initStatuses = pod.status?.initContainerStatuses || [];
  const containerStatuses = pod.status?.containerStatuses || [];

  // Init 容器：未完成时优先展示 Init:x/y 或具体 waiting/terminated reason
  if (initStatuses.length > 0) {
    const total = initStatuses.length;
    let readyCount = 0;
    let firstBlocked: (typeof initStatuses)[0] | undefined;
    for (const ics of initStatuses) {
      if (ics.ready) readyCount += 1;
      else {
        firstBlocked = ics;
        break;
      }
    }
    if (firstBlocked) {
      const wr = firstWaitingReason(firstBlocked);
      const tr = firstTerminatedReason(firstBlocked);
      if (wr === "PodInitializing") {
        return { text: `Init:${readyCount}/${total}`, restarts };
      }
      if (wr) {
        return { text: `Init:${wr}`, restarts };
      }
      if (tr && firstBlocked.state?.terminated && firstBlocked.state.terminated.exitCode !== 0) {
        return { text: `Init:${tr}`, restarts };
      }
      return { text: `Init:${readyCount}/${total}`, restarts };
    }
  }

  // 工作容器：waiting.reason 优先于 phase（Running 仍可能 CrashLoopBackOff）
  for (const cs of containerStatuses) {
    const wr = firstWaitingReason(cs);
    if (wr) {
      return { text: wr, restarts };
    }
  }

  for (const cs of containerStatuses) {
    const tr = firstTerminatedReason(cs);
    const term = cs.state?.terminated;
    if (tr && term && !cs.ready) {
      if (tr === "Completed" && term.exitCode === 0) {
        continue;
      }
      return { text: tr, restarts };
    }
  }

  if (overallReason) {
    return { text: overallReason, restarts };
  }
  if (phase) {
    return { text: phase, restarts };
  }
  return { text: "-", restarts };
}
