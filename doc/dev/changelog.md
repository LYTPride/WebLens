# Changelog（开发变更记录）

> 本文件用于记录开发过程中的关键变更，按功能域持续补充。

## 2026-04

### 资源列表：行尾菜单关联行高亮与批量操作条可读性

- **行尾三点菜单展开时行高亮**（`global.css` / `App.tsx` / `NodesListTable.tsx` / `PVCListTable.tsx` / `ServicesListTable.tsx`）：主表行增加 **`wl-table-row--menu-open`**，在菜单打开期间保持与 hover 同级的底色并辅以左侧 **sky 内阴影**，鼠标移出行仍可识别「当前菜单对应行」；菜单关闭或执行菜单项后随 `*MenuOpenKey` 清空而恢复。StatefulSet 展开区 Pod 子行若带异常提示 **内联 `box-shadow`**，与菜单关联线 **合并** 避免被覆盖。
- **Pods / Deployments 多选批量操作条**（`App.tsx` / `tokens.css` / `global.css`）：内联硬编码深色专用色（如删除 `#fecaca`、重启 `#99f6e4`）在浅色主题下对比不足；改为 **`--wl-bulk-*` token** + **`.wl-bulk-action-bar` / `.wl-bulk-btn--danger|secondary|ghost`**，浅色下危险/次级/取消分层更清晰；**`.wl-bulk-btn`** 从全局 `button:hover` 叠层中排除，使用 **`--wl-bulk-btn-hover-overlay`**。已选数量使用 **`.wl-bulk-action-bar__count`** 字重强调。
- **文档**：`doc/guide/resource-lists.md`、`doc/dev/theme-ui.md`、本变更记录。

### 交互一致性：文件管理、侧栏、按钮、作用域列表与底栏标签

- **文件管理**（`FileManagerPanel.tsx` / `server/internal/httpapi/files.go`）：列目录增加可选 **`mtime`**（Unix 秒）；表格增加 **修改时间**列；列表行 **`wl-table-body` / `wl-table-row`** 与主列表一致的 hover；表头全选 **三态**（`indeterminate`），行为对齐 Pod 列表表头。
- **左侧资源导航**（`Sidebar.tsx` / `global.css`）：仅可点击资源项 **`wl-sidebar-resource-item`** hover 使用 **`--wl-menu-item-hover`**（深色下避免与侧栏底色撞色）；分组标题无该类名。
- **全局按钮 hover**（`global.css` / `tokens.css`）：新增 **`--wl-btn-overlay-hover`**，默认 **`inset` 叠层**覆盖大量内联样式按钮；排除已有专用规则的控件；`ConfirmDialog` / `InputDialog` 主操作按钮使用 **`wl-confirm-btn-*`** class。
- **平台配置 · 已添加作用域**（`App.tsx`）：表格行加 **`wl-table-body` / `wl-table-row`**，整行 hover。
- **底部标签栏**（`BottomPanel.tsx` / `global.css`）：标签格 **`wl-bottom-panel-tab`** / **`--active`**，hover 共用 **`--wl-btn-overlay-hover`**，激活态 **`--wl-bg-control`**。
- **文档**：`doc/guide/file-manager.md`、`doc/dev/file-manager-design.md`、`doc/dev/theme-ui.md`、本变更记录。

## 2026-03（近期）

### 主题系统收敛、导航入口调整与 Shell 主题切换修复

- **文档同步**：根 `README.md`、`doc/README.md`、`doc/guide/resource-lists.md`（Nodes 与 v1 入口策略）、`doc/guide/shell.md`、`doc/dev/shell-implementation.md`、`doc/dev/architecture.md`；新增 **`doc/dev/theme-ui.md`** 集中说明主题、顶栏 icon 区与侧栏轨道。
- **主题系统统一接入**：补齐深浅主题 token 并在多处表格/详情组件去硬编码，统一使用 `--wl-*` 变量；`Deployment` 列表与详情中的 `Conditions` 标签改为语义色 token（浅色主题下可读性恢复，深色效果保持）。
- **受限态公共修复**：`ResourceAccessDeniedState` 卡片背景、阴影、文字和按钮全面接入主题变量；浅色主题不再出现深色面板残留。
- **Node 入口收敛（逻辑保留）**：`nodes` 加入 `V1_HIDDEN_VIEWS`，侧栏不再展示 Nodes；`App.tsx` 增加隐藏视图回退，避免通过常规 UI 进入 Nodes 页面；Nodes 相关列表/状态/API 逻辑未删除，后续可恢复入口。
- **顶栏右上角操作区重构**：主题切换与平台配置统一为轻量 icon action；平台配置从文字区块改为齿轮入口，保持原菜单内容与交互；点击齿轮增加轻量自转反馈，hover 仅 icon 提亮。
- **左侧边栏与把手重构**：把手改为边栏右缘中部局部凸耳（连续曲线，同体色），收起态仅保留小把手入口；去除“整条竖向控制条 / 外挂按钮”观感，展开收起保持一体化抽拉动画。
- **Shell 主题切换修复**：修复“深色进入 Shell 后切浅色仍黑底 / 浅色进入后切深色仍白底”问题；`PodShell` 在主题切换后双帧重应用 xterm 主题并强制 refresh，同步 viewport 背景避免残留底色。

### 全局下拉 Portal 与次级展开表格

- **下拉 / 菜单**：统一挂载到 `document.body`（`WlPortal`），定位由 `computeDropdownPosition` + `useFloatingDropdownPosition` 负责（下优先、贴边避让、`maxHeight`）；**z-index** 集中在 `web/src/constants/zLayers.ts`；**Esc** 与点击遮罩关闭（`useEscapeToClose`、全屏透明层）。轻量菜单与可搜索面板分别见 `DropdownMenuPortal.tsx`、`SearchableDropdownPanelPortal.tsx`；视觉容器 `WlDropdownSurface`。列表行菜单、平台配置菜单、作用域选择、日志 Download 等均按 **打开时才挂载 Portal** 条件渲染。
- **次级展开子表**：新增 `SecondaryExpandTable` 与 `secondaryExpandTableConfig.ts`；**Ingress 规则子表**、**StatefulSet Pod 子表**、**Services 的 Ports / Endpoints 子表** 使用与主表相同的 `useResourceListColumnResize` + `ResizableTh`（子表表头 `sticky={false}`），`colgroup` 与表头列宽一致；单元格统一换行与防串列样式；子表容器 **`overflow-x: auto`**，避免窄屏撑破整页。
- **开发说明**：`doc/dev/portal-dropdown-and-secondary-tables.md`。

### Events（事件）列表、Describe 与排序

- **后端**：`events` 已纳入通用资源 list/watch（`server/internal/httpapi/resources.go` 等，与 PVC 同路径模式）。
- **前端**：`web/src/pages/App.tsx` 中独立 `eventItems` 状态、list 跳过与 refresh nonce、`watchResourceList` + `applyK8sNamespacedWatchEvent`；Watch 缺口节流合并 `runEventsWatchGapFill`（与 Pods/PVC 等同类策略）。
- **表格**：`web/src/components/EventsListTable.tsx`；列派生与 Involved 展示：`web/src/utils/eventTable.ts`。
- **排序**：`web/src/utils/resourceListSort.ts` 中 `EventSortRow` / `compareEventsDefaultTriage`（无列排序时异常优先）与 `compareEventsForSort`（表头列排序）；按 **Age** 排序时与 `listAgeNow` / `serverTimeMs` 对齐。
- **Describe**：`web/src/components/describe/EventDescribeContent.tsx`；关联资源跳转由 `onJumpToResource` 与 `resolveInvolvedKindToListView`（`web/src/utils/v1HiddenViews.ts`）统一解析；v1 侧栏未开放的 kind（DaemonSet、Job、CronJob、ConfigMap、Secret 等）不跳转；旧会话键 `namespaces` 与上述隐藏视图回落 **Pods**。
- **用户文档**：`doc/guide/events.md`；索引：`doc/guide/resource-lists.md`、`doc/README.md`。

### v1 使用行为埋点（可选）

- **后端**：`server/internal/analytics/analytics.go`（`AppendLine` 写 NDJSON）、`server/internal/httpapi/analytics.go`（`POST /api/analytics/events`）、`router.go` 注册；环境变量 **`WEBLENS_ANALYTICS_LOG`**（默认 `logs/analytics.log`）。
- **前端**：`web/src/utils/usageAnalytics.ts`（`trackUsage`，`sendBeacon` / `fetch keepalive`）；主要调用：`web/src/pages/App.tsx`、`web/src/components/FileManagerPanel.tsx`。
- **仓库**：`.gitignore` 增加 `logs/`，避免本地埋点文件入库。
- **开发说明**：`doc/dev/analytics.md`。

### 底栏标签横向滚动与视口横向溢出

- **`web/src/global.css`**：`html, body, #root` 设置 **`overflow-x: hidden`**，去掉视口级横向滚动条，避免与底部标签条横向 scrollbar 叠成双条、拖动时误滚整页；各业务表格等仍在自身 **`overflow-x: auto`** 容器内横向滚动。
- **`web/src/components/BottomPanel.tsx`**：底栏根节点 **`overflowX/Y: hidden`**、标签滚动容器 **`paddingBottom`** 为横向 scrollbar 预留带区、**`maxHeight`（最小化）** 调高以容纳预留；**`className="wl-bottom-panel-tabs-scroll"`**。
- **`global.css`**：`.wl-bottom-panel-tabs-scroll::-webkit-scrollbar { height: 6px; }`，减轻悬停/拖动 thumb 遮挡标签标题（WebKit 系）。

### PersistentVolumeClaims（PVC）列表与运维

- **后端**：`server/internal/httpapi/pvc_ops.go`（describe、yaml、delete 等）与 `resources.go` 中 list/watch 路由；详见源码与 `web/src/api.ts` 中 `fetchPvcDescribe`、`deletePvc` 等。
- **前端**：`web/src/components/PVCListTable.tsx`、`web/src/utils/pvcTable.ts`、`web/src/components/describe/PvcDescribeContent.tsx`；编排与 watch 缺口补齐在 `web/src/pages/App.tsx`（`persistentvolumeclaims` 视图）。
- **用户文档**：`doc/guide/resource-lists.md`「PersistentVolumeClaims（PVC）」。

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

- 列表主标题统一为 **`资源类型 · namespace / 条数`**，去掉标题中的 **集群 ID / 作用域括号**（与上方「集群与命名空间 · 当前：…」去重），减轻长集群名下顶部栏横向挤压；实现：`web/src/pages/App.tsx`。
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
- 已接入：平台配置「已添加作用域」搜索、集群下拉内搜索、资源列表 Name 过滤、Logs 关键字、Pod/Deployment YAML 编辑区关键字（样式见 `global.css` `.wl-clearable-search-clear`）

