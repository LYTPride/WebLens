# 资源列表数据流（list + watch + 作用域缓存）

本文面向开发者，说明 WebLens 资源表格背后的数据流约定；**规范正文与接入清单**以仓库内源码为准：

→ [`web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md`](../../web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md)

## 一句话模型

```
[HTTP list] → scoped raw state（按 cluster + namespace + 资源类型）
[watch 流] → reducer → 同一 raw state（立即合并，无前端节流阻塞）
raw state → 派生（Status / 健康 / 排序键等）→ 筛选 / 排序 / 多选 → UI
```

## 与用户体验的对应关系

- **切页**（如 Pods ⇄ Deployments）：在已应用同一作用域下优先复用内存列表，避免重复全量 list；各资源类型的 watch 按视图挂载策略保持或并行运行（见 `App.tsx` 中 `needsPodsData` 等注释）。
- **刷新列表**：递增对应 `*ListNonce`，强制重新 list **当前资源类型**；不替代 watch，watch 在 effect 中继续订阅。
- **Pod 健康标签**：列表与 **Pods Watch** 均由后端输出 `PodWithHealth`，避免仅用 apiserver 裸 Pod 覆盖后丢失 `healthLabel`。
- **Age 与时间基准**：列表与 watch 响应携带 **`serverTimeMs`**；前端用 `serverClock.ts` 做锚点 + `performance.now()` 推进逻辑「当前集群时间」，Age 与按 Age 排序与之对齐；本机与集群时间差过大时列表区有轻量提示。详见 [`RESOURCE_LIST_ARCHITECTURE.md`](../../web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md) 中「服务端时间基准」一节。
- **Watch 缺口**：连接建立/重连、页面从隐藏恢复等场景可触发 **节流后的 list 合并**（`mergeListSnapshot.ts`），补漏事件而非替代 watch。详见同文档「Watch 缺口与 list 合并补齐」。
- **访问拒绝（401/403 / forbidden 等）**：对 **Nodes** 等资源，list/watch 若判定为 RBAC 类拒绝，进入 **受限态 UI**，并按 `clusterId + resourceKey` 缓存 **`denied`**，同集群重复进入可减少无效请求；`watchResourceList` 可通过 **`shouldReconnect: false`** 避免 403 循环重连。用户说明见 [资源列表手册 · Nodes 与访问权限](../guide/resource-lists.md)。

## 相关文件速查

| 职责 | 路径 |
|------|------|
| Watch 归约（共享） | `web/src/resourceList/watchEventReducer.ts` |
| 列表与 watch 编排 | `web/src/pages/App.tsx` |
| Watch 客户端与重连 | `web/src/api.ts`（`watchPods` / `watchResourceList`；可选 `shouldReconnect` 抑制 401/403 重连） |
| 资源无权限受限态（通用 UI） | `web/src/components/ResourceAccessDeniedState.tsx` |
| RBAC 拒绝判定与摘要 | `web/src/utils/k8sAccessErrors.ts` |
| 按集群 + 资源键的 granted/denied 缓存 | `web/src/utils/resourceAccessCache.ts` |
| List/Watch 中的 `serverTimeMs` | 后端 `server/internal/httpapi/resources.go`；前端 `fetchPods` / `fetchResourceList` |
| 逻辑服务端 now、时钟偏差阈值 | `web/src/utils/serverClock.ts` |
| Age 格式化与排序用秒数 | `web/src/utils/k8sCreationTimestamp.ts`、`resourceListSort.ts` |
| Watch 缺口 list 合并 | `web/src/resourceList/mergeListSnapshot.ts` |
| Pod 表格 Status 派生 | `web/src/utils/podTableStatus.ts` |
| 服务端 Pods watch 带健康字段 | `server/internal/httpapi/resources.go`（`watchPodsStream`） |
| HTTP list 极短软缓存 | 同文件 `listCache`（仅 List，非 Watch） |
| PVC 列表表格与列派生 | `web/src/components/PVCListTable.tsx`、`web/src/utils/pvcTable.ts` |
| PVC describe / 运维 API | `server/internal/httpapi/pvc_ops.go` |

## 用户向说明

运维可见交互（排序、关键字筛选、与 Watch 的关系）见 [资源列表：筛选、排序与实时更新](../guide/resource-lists.md)。
