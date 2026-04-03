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
- **作用域内跳过重复 list**：用 ref 记录「该作用域下最近一次成功 list 的 scopeKey + refresh nonce」，**切页复用内存**；仅在首次进入、应用新作用域、手动刷新、nonce 变化时 HTTP list。
- **派生**：如 Pod 表格 Status 用 `getPodStatusInfo(pod)`；健康提示用 `pod.healthLabel`（由后端 list/watch 计算）；**勿**把仅展示用的字符串当作唯一缓存字段。
- **列表主标题（UI）**：`App.tsx` 中为 **`viewTitle[currentView] · namespace / 过滤后条数`**，**不**在标题中重复集群 ID / 作用域括号（与页面上方「集群与命名空间 · 当前：…」分工，避免长 ID 挤占横向空间）。

## 代码地图

| 职责 | 位置 |
|------|------|
| HTTP list（Pods） | `web/src/api.ts` → `fetchPods` |
| HTTP list（通用） | `web/src/api.ts` → `fetchResourceList` |
| List 响应中的 `serverTimeMs` | 同上 + 后端 `server/internal/httpapi/resources.go` 各资源 `GET` |
| Watch 客户端与重连 | `web/src/api.ts` → `watchPods`, `watchResourceList`（事件含 `serverTimeMs`） |
| Watch 事件归约（共享） | `web/src/resourceList/watchEventReducer.ts`（Events 等同名资源用 `applyK8sNamespacedWatchEvent`） |
| Watch 缺口：list 快照合并 | `web/src/resourceList/mergeListSnapshot.ts` |
| 服务端逻辑 now（锚点 + 单调推进） | `web/src/utils/serverClock.ts` |
| Age 展示 / 排序用时间差 | `web/src/utils/k8sCreationTimestamp.ts` |
| 统一 1s tick（驱动重算，配合 server now） | `web/src/hooks/useNowTick.ts` |
| 作用域、list 跳过、watch 挂载、时钟校准、缺口补齐编排 | `web/src/pages/App.tsx`（各资源 `useEffect`） |
| Pod Status 派生 | `web/src/utils/podTableStatus.ts` |
| 排序比较 | `web/src/utils/resourceListSort.ts`（含 **Events**：`compareEventsDefaultTriage` / `compareEventsForSort`） |
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

---

## 服务端时间基准（serverTimeMs）与 Age 列

运维列表中的 **Age（存活时间）** 应对齐 **集群/apiserver 语义**，不能依赖用户本机 `Date.now()` 单独计算，否则本地改时间会出现负 Age、与 `kubectl` 明显不一致等问题。

### 后端约定

- **HTTP List**：`GET /api/clusters/:id/<resource>` 的 JSON 体在 `items` 之外携带 **`serverTimeMs`**（Unix 毫秒，Go：`time.Now().UnixMilli()`），包括缓存命中与 forbidden 空列表分支，保证任意 list 响应均可作为一次时间锚点。
- **Watch**：`watchAndStream` / `watchPodsStream` 输出的 **每一行 JSON 事件** 在 `type`、`object` 之外携带 **`serverTimeMs`**，用于在仅有 watch、无 list 时仍可校准前端逻辑时钟。
- Watch 仍为主增量通道；`serverTimeMs` 不改变对象形状，**raw object 仍为唯一业务真相**。

### 前端约定

| 职责 | 位置 |
|------|------|
| List 解析（含 `serverTimeMs`） | `web/src/api.ts` → `fetchPods`、`fetchResourceList` → `ListWithServerTime<T>` |
| Watch 事件中的 `serverTimeMs` | `PodWatchEvent` / `ResourceWatchEvent` |
| 逻辑「当前服务端时间」：锚点 + `performance.now()` 单调推进 | `web/src/utils/serverClock.ts`（`newServerClockSnapshot`、`getCurrentServerNow`） |
| 校准入口（list / watch / 缺口 list 合并成功后） | `web/src/pages/App.tsx` → `syncServerClock` |
| UI 每秒 tick（仅驱动重算，**不**直接当 Age 基准） | `web/src/hooks/useNowTick.ts` |
| Age 展示与排序用秒数 | `web/src/utils/k8sCreationTimestamp.ts`（`formatAgeFromMetadata(meta, nowMs)`、`creationTimestampToAgeSeconds`）；**负时长钳为 0**，避免显示 `"-"` 误导 |
| 排序按 Age 时 | `web/src/utils/resourceListSort.ts`：传入与列表同一 `nowMs`（`App.tsx` 中 `listAgeNow`）；仅在 `sort.key === "age"` 时把 tick 纳入 `useMemo` 依赖，避免无意义每秒全表重排 |

**推进模型**：每次收到合法的 `serverTimeMs`，记录 `serverTimeMs` 与当时的 `performance.now()`；任意时刻 **服务端逻辑 now** = `lastServerTimeMs + (performance.now() - lastSyncedPerfNow)`。两次锚点之间 Age 仍稳定递增，且 **不随用户手动篡改系统时钟** 漂移（单调时钟为主）。

**时钟偏差提示**：当 `Date.now()` 与上述逻辑 server now 相差超过阈值（`serverClock.ts` 中 `CLOCK_SKEW_WARN_THRESHOLD_MS`，默认 5s）时，Pods / Deployments / StatefulSets 列表区展示轻量文案：**本地时间与集群时间存在偏差，Age 已按服务端时间校准**（详情见 `App.tsx`）。

---

## Watch 缺口与 list 合并补齐（非轮询主路径）

Watch 在断线、切页、页面隐藏恢复等场景可能出现 **短时漏事件**；应用 **不改写 watch 主链路** 的前提下，用 **节流后的 HTTP list 合并进现有 raw state** 做补丁。

| 职责 | 位置 |
|------|------|
| 连接建立回调（含重连） | `web/src/api.ts` → `watchPods` / `watchResourceList` 可选 `onConnectionEstablished` |
| 合并策略（单 ns / 全 ns、以 list 为准补齐漏 ADDED） | `web/src/resourceList/mergeListSnapshot.ts` |
| 编排：重连后 / 可见性恢复后触发 | `web/src/pages/App.tsx`（如 `runPodsWatchGapFill`、`runEventsWatchGapFill` 等，带最小间隔节流） |

原则：**watch 仍为实时主源**；list 仅用于 **补洞与手动刷新**，合并时保持 apiserver 对象字段为准，与 `watchEventReducer` 的语义一致。
