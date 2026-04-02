# Changelog（开发变更记录）

> 本文件用于记录开发过程中的关键变更，按功能域持续补充。

## 2026-03（近期）

### Nodes 与资源级「无权限」优雅降级（可复用）

- **背景**：部分 kubeconfig / ServiceAccount 无集群级 `nodes` 的 list/watch 权限时，原先整页 `setError` 或原始报错体验较差。
- **产品行为**：侧栏 **保留 Nodes**；有权限时列表与 Watch 不变；无权限时主区域展示 **`ResourceAccessDeniedState`**（深色卡片、人话说明、可选折叠「技术摘要」），**不**把大段原始错误作为主内容。
- **前端实现要点**：
  - 通用组件：`web/src/components/ResourceAccessDeniedState.tsx`
  - 错误归类：`web/src/utils/k8sAccessErrors.ts`（`isK8sAccessDeniedError`、`k8sAccessDeniedSummary` 等）
  - 按集群 + 资源键的轻量缓存：`web/src/utils/resourceAccessCache.ts`（Nodes 使用 `resourceKey: "nodes"`），避免同集群反复打接口与刷错
  - **Watch**：`web/src/api.ts` 中 `watchResourceList` 增加可选 **`shouldReconnect`**；401/403 等访问拒绝时 **不重连**，避免刷屏
  - 编排与 Nodes 分支：`web/src/pages/App.tsx`（list 成功写 `granted`、拒绝写 `denied`；「刷新列表」对 Nodes 调用 `clearResourceAccessDecision` 后重试）
- **后续资源复用**：为新资源选定 `resourceKey`，在 list/watch 失败分支调用同一套 `isK8sAccessDeniedError` + 缓存 + `ResourceAccessDeniedState`，并为 watch 传入 `shouldReconnect` 策略即可。
- **用户文档**：`doc/guide/resource-lists.md`「Nodes 与访问权限」。

### Ingress / Services 与跨资源联动 UI

- **后端**：`server/internal/httpapi/ingress_ops.go`、`service_ops.go` 等，提供 Ingress / Service 结构化 describe 与列表相关能力（与 `resources.go` 协同）；详见各文件注释与 `web/src/api.ts` 类型。
- **前端列表**：`web/src/components/ServicesListTable.tsx`；Ingress 表格与展开逻辑在 `App.tsx`，辅助 `web/src/utils/ingressTable.ts`、`ingressTroubleshoot.ts`、`serviceTable.ts`、`serviceTroubleshoot.ts`。
- **Describe**：`web/src/components/describe/IngressDescribeContent.tsx`、`ServiceDescribeContent.tsx`。
- **统一联动入口**：`ResourceJumpChip` + `.wl-resource-jump`（轻量胶囊，短标签，宽度随内容）。
- **统一名称展示**：`ResourceNameWithCopy` + `.wl-resource-name-with-copy*`（可换行正文 + 复制，名称不可点跳转；与联动按钮职责分离）。
- **用户文档**：`doc/guide/ingress-services.md`。

### 统一确认 / 输入弹窗（替代浏览器原生 dialog）

- 新增 **`web/src/components/ConfirmDialog.tsx`**：深色主题、标题/说明/可滚动资源列表、取消与确定；支持 `danger` / `primary`、外部 `busy`、**Esc** 与遮罩关闭（忙碌时禁用）；确定在 `onConfirm` **成功返回后**再关闭，失败抛错则保留弹窗。
- 新增 **`web/src/components/InputDialog.tsx`**：替代 `window.prompt`，用于单行输入（如重命名、新建文件夹）；**Esc** / **Enter** 提交。
- **`App.tsx`**：批量 Pod/Deployment 操作确认改为 `ConfirmDialog`；单行删除 Pod、Deployment/StatefulSet 删除与重启等不再使用 `window.confirm`，统一为 `actionConfirm` + `ConfirmDialog`；批量操作失败时在 `confirmBatchAction` 中 **rethrow**，以便保持弹窗。
- **`FileManagerPanel.tsx`**：删除确认、重命名与新建文件夹改为上述组件（`zIndex` 略高于底部面板）。
- 后续新增需用户确认的危险操作，应优先 **`import { ConfirmDialog }`** 或沿用 App 内 `setActionConfirm` 模式，避免 `window.confirm` / `alert` / `prompt`。

### 资源列表标题简化

- 列表主标题统一为 **`资源类型 · namespace / 条数`**，去掉标题中的 **集群 ID / 组合括号**（与上方「集群与命名空间 · 当前：…」去重），减轻长集群名下顶部栏横向挤压；实现：`web/src/pages/App.tsx`。
- 用户说明：`doc/guide/resource-lists.md`「列表标题格式」。

### 资源列表：服务端时间（serverTimeMs）与 Age

- **后端**：各类资源 **HTTP list** 响应在 `items` 外统一附带 **`serverTimeMs`**；**watch** 每行事件 JSON 附带 **`serverTimeMs`**（`watchAndStream` / `watchPodsStream`）。
- **前端**：`fetchPods` / `fetchResourceList` 返回 `ListWithServerTime`；`App.tsx` 中 `syncServerClock` 在 list、watch、`mergeListSnapshot` 缺口补齐等路径校准；**逻辑 server now** 用 `performance.now()` 在锚点间单调推进（`web/src/utils/serverClock.ts`）。
- **Age**：`formatAgeFromMetadata` / `creationTimestampToAgeSeconds` 使用上述逻辑 now；负时长钳为 **0**，避免误导性 `"-"`；本机与集群时间差超阈值时列表区轻量提示。
- **架构说明**：已写入 `web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md`（服务端时间基准、Watch 缺口 list 合并、`useNowTick` 与按 Age 排序的依赖约定）。

### 资源列表架构与 Watch

- 统一 **list（快照）+ watch（增量）+ 作用域内跳过重复 list**：共享 `web/src/resourceList/watchEventReducer.ts`（Pods 按 `uid`，Deployments / StatefulSets / 其他 namespaced 资源按 `namespace/name`）
- 开发约定与后续资源接入清单：`web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md`；文档索引：`doc/dev/resource-list-dataflow.md`
- 修复在 **Deployments** 等视图下后台 `loadPods` 成功后未更新 `lastPodsListFetchRef`，导致切回 Pods 误触发重复全量 list、体感滞后的问题
- Watch 客户端：流结束后自动重连；服务端 Watch 响应头 `X-Accel-Buffering: no`、Pods watch 输出 `PodWithHealth` 与列表一致，避免健康标签被裸 Pod 覆盖漂移
- 表头 sticky 与 hover 高亮：`th.wl-table-sticky-head`（`ResizableTh` 与全选列等统一 class）

### Pod 状态标签

- 新增 `healthLabel` / `healthReasons` / `healthScore`
- 新增 Pods 全局风险提示语（基于当前范围，不受名称搜索影响）

### Shell 与底部工作区

- Shell 支持重连按钮
- 保留历史输出，不清空终端内容

### 文件管理面板

- 新增 Shell 右侧文件管理窗口（默认收起、可展开、可拖拽）
- 新增列目录/上传/下载/删除/重命名/新建目录接口
- 修复目录“空目录误判”问题（统一使用 `printf` 结构化输出）
- 优化 UI：路径不存在提示、工具栏按钮置灰
- 路径区合并为单条地址栏：默认面包屑（`›` 分隔、可横向滚动），空白区点击或双击进入输入模式；Enter 跳转，Esc/失焦恢复面包屑；保留手动路径不存在时的固定提示
- 默认展开宽度调至 520px，拖拽范围约 300–780px；工具栏优先单行展示（极窄时可横向滚动）
- **传输任务**：`FileTransferTasksPanel` + 工具栏下方面板；上传走 `onUploadProgress`；下载 `fetch` 流式读 body，区分 Content-Length **真实**进度、列表原始大小 **估算**进度与无法估算三种展示（见 `doc/guide/file-manager.md`）

### Deployments 页面与运维 API

- 列表列：Name、Namespace、Pods、Replicas、Age、Conditions、操作；表头拖拽调宽（与 Pods 共用 `useColumnResize` + `ResizableTh`）
- 列表行 hover、三点按钮与下拉菜单样式与 Pods 统一（`global.css` + `wl-table-menu-trigger` / `wl-table-dropdown-menu`）
- 同一已应用 cluster + namespace 下，Pods ⇄ Deployments 切换复用内存列表；「刷新列表」仅刷新当前资源类型
- 后端：`GET/PUT .../deployments/:ns/:name/yaml`、`PATCH .../scale`、`POST .../restart`、`DELETE .../name`；变更后失效 deployments 列表短缓存
- Edit：复用 `PodYamlEditTab`（`yamlKind: deployment`），保存后 `onEditSaved` 合并列表项
- **Describe**：`GET .../deployments/:ns/:name/describe` 返回结构化 `view` + `events`；前端与 Pod 共用右侧抽屉壳与 `DescribeEventsSection` 事件样式
- 列表 **Name** 可点击打开 Describe（交互对齐 Pods）

### YAML 编辑器增强（Pod / Deployment 共用）

- YAML 编辑改为 **Monaco Editor**（`YamlMonacoEditor` + `monaco/yamlMonacoEnv` Worker）：内置 **stickyScroll**（`indentationModel`）、行号、minimap、折叠；移除自研 textarea 叠层与顶部路径条
- `PodYamlEditTab` 接入上述能力；后续其他 YAML 编辑可复用同一组件
- **启动与离线**：入口 `web/src/main.tsx` 加载 `monaco/monacoInit.ts`，在 Worker 注册后执行 `loader.config({ monaco })`，强制使用 **npm 包内 Monaco**，避免 `@monaco-editor/react` 默认走 CDN 导致编辑页长期停在 **Loading...**（内网/防火墙环境常见）
- **Sticky Scroll 与换行**：`npm install` 后 `postinstall` 运行 `web/scripts/apply-monaco-sticky-patch.cjs`，修正原生 sticky 在 `wordWrap` 下的占位问题（无需额外 npm 依赖）

### 搜索/过滤输入

- 新增可复用组件 `web/src/components/ClearableSearchInput.tsx`：有关键字时显示右侧清空按钮，点击清空并 focus 回输入框
- 已接入：平台配置「已添加组合」搜索、集群下拉内搜索、资源列表 Name 过滤、Logs 关键字、Pod/Deployment YAML 编辑区关键字（样式见 `global.css` `.wl-clearable-search-clear`）

