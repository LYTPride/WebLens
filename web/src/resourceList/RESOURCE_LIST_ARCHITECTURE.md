# WebLens 资源列表数据流（目标架构与接入约定）

本文描述 Pods / Deployments / StatefulSets 及后续资源应遵循的 **list + watch + 作用域缓存** 模式，与实现位置对应关系。

## 目标数据流（单一真相与派生分层）

```
[HTTP list]  ──►  scoped raw cache（React state / 将来可迁到 store）
[watch 流]   ──►  event reducer ──► 同上 raw cache
raw cache    ──►  derive（Status / 健康 / 排序键等）──► filter/search ──► sort ──► selection 合并 ──► UI
```

- **raw cache**：当前 `cluster + namespace + applyRevision` 下某资源类型的对象数组；存 **apiserver 形状**（Pods 列表与 watch 均由后端对齐 `PodWithHealth`，避免 health 漂移）。
- **watch**：增量源；事件到达后应 **立即** 调用 `applyPodWatchEvent` / `applyK8sNamespacedWatchEvent` 写入 raw cache，**不**经过 TTL 阻塞。
- **作用域内跳过重复 list**：用 ref 记录「该作用域下最近一次成功 list 的 scopeKey + refresh nonce」，**切页复用内存**；仅在首次进入、应用新组合、手动刷新、nonce 变化时 HTTP list。
- **派生**：如 Pod 表格 Status 用 `getPodStatusInfo(pod)`；健康提示用 `pod.healthLabel`（由后端 list/watch 计算）；**勿**把仅展示用的字符串当作唯一缓存字段。

## 代码地图

| 职责 | 位置 |
|------|------|
| HTTP list（Pods） | `web/src/api.ts` → `fetchPods` |
| HTTP list（通用） | `web/src/api.ts` → `fetchResourceList` |
| Watch 客户端与重连 | `web/src/api.ts` → `watchPods`, `watchResourceList` |
| Watch 事件归约（共享） | `web/src/resourceList/watchEventReducer.ts` |
| 作用域、list 跳过、watch 挂载 | `web/src/pages/App.tsx`（各资源 `useEffect`） |
| Pod Status 派生 | `web/src/utils/podTableStatus.ts` |
| 排序比较 | `web/src/utils/resourceListSort.ts` |
| Pod watch 带健康字段 | `server/internal/httpapi/resources.go` → `watchPodsStream` + `PodWithHealth` |
| HTTP list 极短软缓存（非 watch） | `server/internal/httpapi/resources.go` → `listCache` / `listTTL`（约 1s，仅合并并发 list） |

## 后续新资源（Services、DaemonSets、Jobs…）接入清单

1. **后端**：为该资源提供 `GET .../items` 与 `.../watch`；watch 使用与现有一致的 JSON 行协议；**勿**对 watch 响应做 list 同款 TTL 缓存。
2. **前端 API**：在 `resourcePath` / `ResourceKind` 中注册；必要时增加类型。
3. **状态**：为资源单独 `useState<YourItem[]>([])`，key 语义为 `cluster + namespace + resourceType`（与现有 `deploymentItems` / `statefulsetItems` 一致）。
4. **list**：在 `listScopeKey` 与 **refresh nonce** 变化时 `fetchResourceList`；成功后用 ref 记录 `{ scope, nonce }`，切回视图时跳过重复请求。
5. **watch**：`watchResourceList` + `applyK8sNamespacedWatchEvent`（若对象以 uid 为准则仿 `applyPodWatchEvent` 另写一小函数）。
6. **onError**：可兜底 `fetchResourceList`；**不**停止重连（客户端已实现断线重连）。
7. **UI**：表格列在 `useMemo`/渲染中从 **raw** 派生；搜索/排序/多选与 raw 解耦。
8. **多 watch ref**：若与 Pods / Deployments 并行，**勿**共用同一 `cancelRef` 互相取消；参考当前 Pods 使用 `podsWatchCancelRef`、其它资源用 `resourceWatchCancelRef` 且避免在无关视图清理对方。

## 反模式（禁止）

- 仅用定时 list 模拟实时、长期不开 watch。
- 把 `displayStatus` / 格式化后的行对象写入 state 作为唯一数据源，watch 只改其中部分字段。
- 在 Deployments 等页停止 Pods watch（若产品需要跨页 Pod 数据一致，应保持后台 watch，见 `App.tsx` 中 `needsPodsData`）。
- 在「非 Pods 视图」下成功 `loadPods` 却不更新 `lastPodsListFetchRef`（会导致切回 Pods 误触发重复 list）。
