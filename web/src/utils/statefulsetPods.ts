import type { Pod } from "../api";

const HEALTH_RANK: Record<string, number> = {
  健康: 0,
  关注: 1,
  警告: 2,
  严重: 3,
};

/** 是否属于指定 StatefulSet（ownerReferences 优先，否则 name 形如 stsName-<ordinal>） */
export function podBelongsToStatefulSet(pod: Pod, stsName: string, namespace: string): boolean {
  if (pod.metadata.namespace !== namespace) return false;
  const refs = pod.metadata.ownerReferences;
  if (refs?.length) {
    for (const r of refs) {
      if (r.kind === "StatefulSet" && r.name === stsName) return true;
    }
    return false;
  }
  const prefix = `${stsName}-`;
  if (!pod.metadata.name.startsWith(prefix)) return false;
  const tail = pod.metadata.name.slice(prefix.length);
  return /^\d+$/.test(tail);
}

export function podsOwnedByStatefulSet(pods: Pod[], stsName: string, namespace: string): Pod[] {
  return pods.filter((p) => podBelongsToStatefulSet(p, stsName, namespace));
}

export function ordinalFromStsPodName(stsName: string, podName: string): number | null {
  const prefix = `${stsName}-`;
  if (!podName.startsWith(prefix)) return null;
  const tail = podName.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return null;
  return parseInt(tail, 10);
}

/** 连续区间用 a-b，否则逗号分隔，如 0-2 或 0,2 */
export function formatOrdinalSummary(ordinals: number[]): string {
  if (ordinals.length === 0) return "-";
  const sorted = [...new Set(ordinals)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    if (j === i) parts.push(String(sorted[i]));
    else parts.push(`${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

/** 聚合子 Pod 健康标签（取最严重一档） */
export function aggregatePodHealthLabel(pods: Pod[]): "健康" | "关注" | "警告" | "严重" {
  let max = 0;
  let label: "健康" | "关注" | "警告" | "严重" = "健康";
  for (const p of pods) {
    const l = p.healthLabel || "健康";
    const r = HEALTH_RANK[l] ?? 0;
    if (r > max) {
      max = r;
      label = l as "健康" | "关注" | "警告" | "严重";
    }
  }
  return label;
}

/** 与排序/聚合一致的健康等级数值（0=健康 … 3=严重） */
export function podHealthRankValue(pod: Pod): number {
  const l = pod.healthLabel || "健康";
  return HEALTH_RANK[l] ?? 0;
}

/** 非「健康」即异常（复用后端下发的 healthLabel） */
export function isPodHealthAbnormal(pod: Pod): boolean {
  return podHealthRankValue(pod) > 0;
}

/**
 * StatefulSet 子实例「异常优先」排序：严重度降序，再按 ordinal 升序（便于排障扫表）
 */
export function sortStsPodsTroubleshootFirst(pods: Pod[], stsName: string): Pod[] {
  return [...pods].sort((a, b) => {
    const ra = podHealthRankValue(a);
    const rb = podHealthRankValue(b);
    if (ra !== rb) return rb - ra;
    const oa = ordinalFromStsPodName(stsName, a.metadata.name) ?? 9999;
    const ob = ordinalFromStsPodName(stsName, b.metadata.name) ?? 9999;
    return oa - ob;
  });
}

/** 异常实例中 ordinal 最小者（无异常返回 null） */
export function findSmallestOrdinalAbnormalPod(pods: Pod[], stsName: string): Pod | null {
  let best: Pod | null = null;
  let bestOrd = Infinity;
  for (const p of pods) {
    if (!isPodHealthAbnormal(p)) continue;
    const o = ordinalFromStsPodName(stsName, p.metadata.name);
    if (o === null) continue;
    if (o < bestOrd) {
      bestOrd = o;
      best = p;
    }
  }
  return best;
}

/** Pod 声明的 PVC 卷名（来自 spec.volumes，无额外请求） */
export function podPersistentVolumeClaimNames(pod: Pod): string[] {
  const vols = pod.spec?.volumes;
  if (!vols?.length) return [];
  const names: string[] = [];
  for (const v of vols) {
    const cn = v.persistentVolumeClaim?.claimName;
    if (cn) names.push(cn);
  }
  return names;
}

/** Describe / 展开区共用：ordinal 顺序操作建议（仅当有异常实例时） */
export function stsOrdinalOperationHintLine(pods: Pod[], stsName: string): string | null {
  const primary = findSmallestOrdinalAbnormalPod(pods, stsName);
  if (!primary) return null;
  const ord = ordinalFromStsPodName(stsName, primary.metadata.name);
  const suffix = ord != null ? `（#${ord}）` : "";
  return `建议优先检查 ordinal 最小的异常实例：${primary.metadata.name}${suffix}`;
}

/** 展开区顶部摘要一行 */
export function stsTroubleshootSummaryLine(pods: Pod[], stsName: string): string | null {
  const abnormal = pods.filter(isPodHealthAbnormal);
  if (abnormal.length === 0) return null;
  const byOrd = [...abnormal].sort((a, b) => {
    const oa = ordinalFromStsPodName(stsName, a.metadata.name) ?? 9999;
    const ob = ordinalFromStsPodName(stsName, b.metadata.name) ?? 9999;
    return oa - ob;
  });
  const names = byOrd.map((p) => p.metadata.name).join("、");
  const primary = byOrd[0]!;
  const po = ordinalFromStsPodName(stsName, primary.metadata.name);
  const ordBit = po != null ? `（#${po}）` : "";
  if (abnormal.length === 1) {
    return `异常实例：${primary.metadata.name}${ordBit}。建议优先排查该实例。`;
  }
  return `当前共 ${abnormal.length} 个异常实例：${names}。建议优先检查 ordinal 最小：${primary.metadata.name}${ordBit}`;
}

/** 同一 STS 下是否属于「高重启」扫描目标（相对本组最大值或绝对阈值） */
export function isHighRestartInStsGroup(pod: Pod, pods: Pod[], getRestarts: (p: Pod) => number): boolean {
  const r = getRestarts(pod);
  const maxR = pods.reduce((m, p) => Math.max(m, getRestarts(p)), 0);
  return r >= 10 || (r === maxR && maxR >= 5);
}

/** Pod 行 Ready 列：就绪容器数 / 工作容器数 */
export function podReadyColumn(p: Pod): string {
  const specCount = p.spec?.containers?.length ?? 0;
  const statuses = p.status?.containerStatuses ?? [];
  if (specCount === 0 && statuses.length === 0) return "-";
  const n = specCount > 0 ? specCount : statuses.length;
  const ready = statuses.filter((cs) => cs.ready).length;
  return `${ready}/${n}`;
}
