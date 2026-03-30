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

## 相关文件速查

| 职责 | 路径 |
|------|------|
| Watch 归约（共享） | `web/src/resourceList/watchEventReducer.ts` |
| 列表与 watch 编排 | `web/src/pages/App.tsx` |
| Watch 客户端与重连 | `web/src/api.ts`（`watchPods` / `watchResourceList`） |
| Pod 表格 Status 派生 | `web/src/utils/podTableStatus.ts` |
| 服务端 Pods watch 带健康字段 | `server/internal/httpapi/resources.go`（`watchPodsStream`） |
| HTTP list 极短软缓存 | 同文件 `listCache`（仅 List，非 Watch） |

## 用户向说明

运维可见交互（排序、关键字筛选、与 Watch 的关系）见 [资源列表：筛选、排序与实时更新](../guide/resource-lists.md)。
