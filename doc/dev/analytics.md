# v1 使用行为埋点（可选）

WebLens 提供 **轻量、可关闭文件写入失败即静默** 的前后端埋点通道，用于统计常见操作路径（如视图切换、Describe、文件传输等），**不**替代审计日志与 Kubernetes Audit。

## 行为约定

- 前端通过 **`trackUsage`**（`web/src/utils/usageAnalytics.ts`）向同源 **`POST /api/analytics/events`** 发送 **JSON 对象**。
- 优先使用 **`navigator.sendBeacon`**，失败时回退为 **`fetch(..., { keepalive: true })`**；任意网络或解析错误 **静默忽略**，不阻塞 UI。
- 后端 **`server/internal/httpapi/analytics.go`** 将 body 解析为 `map[string]any`，追加字段 **`ts`**（UTC RFC3339Nano），以 **一行一个 JSON（NDJSON）** 写入日志文件。
- 请求体非法或空时返回 **204 No Content**，不写文件。

## 配置

| 环境变量 | 含义 |
|----------|------|
| `WEBLENS_ANALYTICS_LOG` | 埋点日志文件路径；未设置时默认为仓库相对路径 **`logs/analytics.log`**（运行时会 `MkdirAll` 父目录）。 |

根目录 **`.gitignore`** 已忽略 **`logs/`**，避免本地运行产生的埋点文件误入版本库。

## 代码位置

| 组件 | 路径 |
|------|------|
| 追加一行 NDJSON | `server/internal/analytics/analytics.go` → `AppendLine` |
| HTTP 路由注册 | `server/internal/httpapi/analytics.go` → `registerAnalyticsRoutes`；在 `router.go` 中挂载 |
| 前端上报 | `web/src/utils/usageAnalytics.ts` → `trackUsage` |
| 主要调用点 | `web/src/pages/App.tsx`（视图与关键交互）、`web/src/components/FileManagerPanel.tsx`（上传/下载等） |

## 扩展建议

- 新增事件名时保持 **`event` 字段稳定**（便于下游按 key 聚合），可选 **`resource` / `cluster_id` / `namespace` / `target` / `extra`**。
- 若需关闭埋点：可不配置写权限目录、或将路径指向 `/dev/null`（Linux）；未来如需「完全禁用路由」再在配置层加开关即可。
