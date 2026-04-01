# WebLens 架构设计

## 总体结构

WebLens 采用前后端分离 + 同源部署模式：

- 前端：React + TypeScript + Vite
- 后端：Go + Gin + client-go
- 部署：后端同时托管 API 与静态资源，避免跨域问题

## 核心链路

1. 浏览器请求 `window.location.origin/api/...`
2. Gin 路由分发到各业务 handler
3. handler 使用 client-go 访问 Kubernetes API
4. 返回 JSON / stream / websocket 到前端

## 数据刷新模式

- 资源列表：**HTTP List** 负责首次进入、应用 cluster+namespace、手动「刷新列表」与异常兜底；**Watch** 负责后续准实时增量（ADDED/MODIFIED/DELETED），客户端断线自动重连。详情见 [资源列表数据流](./resource-list-dataflow.md)。
- 服务端对 **HTTP List** 仅有极短软缓存（约 1s，合并并发请求）；**Watch 流不经此缓存**。
- **List / Watch JSON** 中可携带 **`serverTimeMs`**（服务端 Unix 毫秒），供前端 Age 等相对时间以集群侧时间为锚，见 [`RESOURCE_LIST_ARCHITECTURE.md`](../../web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md)。
- Logs 使用 follow 流式输出
- Shell 使用 WebSocket + SPDY exec

## 主要模块

- `server/internal/cluster`：kubeconfig 扫描与多集群注册
- `server/internal/httpapi`：API 路由与资源操作（含 Deployment 的 List/Watch/YAML 更新、Scale、Restart、Delete 等；Ingress / Service 结构化 describe 等见 `ingress_ops.go`、`service_ops.go`）
- `web/src/pages/App.tsx`：主页面状态编排（多资源列表、列宽、菜单、作用域内跳过重复 list 与 watch 生命周期）
- `web/src/resourceList/watchEventReducer.ts`：Watch 事件归约（Pods 按 uid，其余 namespaced 资源按 namespace/name），与 `RESOURCE_LIST_ARCHITECTURE.md` 中的接入约定一致
- `web/src/components/*`：底部工作区、YAML 编辑、可拖拽表头 `ResizableTh`、日志、Shell 等；**`ConfirmDialog` / `InputDialog`** 统一危险确认与单行输入（替代 `window.confirm` / `prompt`，见 `doc/dev/changelog.md`）；**`ResourceJumpChip` / `ResourceNameWithCopy`** 统一跨资源联动与名称+复制展示（见 `doc/guide/ingress-services.md`）
- `web/src/hooks/useColumnResize.ts`：表格列宽拖拽逻辑（Pods / Deployments 复用）

## 前端 YAML 编辑（Monaco）

- 组件：`web/src/components/YamlMonacoEditor.tsx`，由 `PodYamlEditTab`（Pod / Deployment Edit）复用。
- 初始化顺序：`main.tsx` → `monaco/monacoInit.ts` → 先 `yamlMonacoEnv.ts`（Vite `?worker` 注册 `MonacoEnvironment`）→ 再 `import * as monaco from "monaco-editor"` 与 `@monaco-editor/react` 的 **`loader.config({ monaco })`**，使运行时不再依赖外网 CDN 拉取 Monaco。
- 依赖：`monaco-editor`、`@monaco-editor/react`（见 `web/package.json`）；生产构建会将编辑器打入静态资源，首屏 JS 体积会增大，属预期。


