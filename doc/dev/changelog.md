# Changelog（开发变更记录）

> 本文件用于记录开发过程中的关键变更，按功能域持续补充。

## 2026-07

### 认证入口视觉升级与权限配置交互

- **登录 / 首次改密页视觉**：认证入口改为固定深色双栏布局，移除登录页与首次改密页的 logo 和主题切换；左侧视频 Hero 保留 WebLens 品牌和三行居中文案，去掉注册式步骤；视频背景通过低对比滤镜与 4.2s 呼吸动画降低闪烁刺激。
- **表单细节**：用户名、密码、首次改密的新密码和确认新密码输入框显式使用白色 caret，保证深色认证页中光标可见；密码输入继续保留小眼睛显隐控制。
- **首次强制改密**：普通用户首次使用默认密码登录后，只需输入新密码和确认新密码；后端仅在 `must_change_password` 且当前密码仍为默认密码时接受空旧密码，改密后仍要求后续改密提供当前密码。
- **权限配置弹窗**：创建普通用户成功后默认密码提示支持复制；普通用户作用域授权列表支持按 kubeconfig、namespace 或别名搜索，授权面板改为固定头部 + 内部滚动列表，长列表下保存操作保持可见。
- **顶栏图标反馈**：权限配置与用户配置入口使用轻量弹起反馈，权限配置盾牌图标尺寸统一到 20px。

### 登录系统、用户权限与 SQLite 配置库

- **初始化与数据保留**：新增 `scripts/init.sh`，首次部署注册 `admin` 并创建默认 `data/weblens.db`；启动脚本在未初始化时提示先执行初始化。发布升级约定不覆盖 `data/`，旧版 `config/kubeconfig-dir.override` 与 `config/cluster-combos.json` 会迁移到 SQLite，旧文件保留。
- **认证与会话**：移除旧 BasicAuth 入口，改为登录页 + 服务端 session + HttpOnly Cookie；密码使用 bcrypt 哈希落库，用户无法使用用户名加哈希串登录。`/api/auth/me` 用作约 5 秒心跳，禁用或重置密码会使在线会话失效。
- **权限模型**：admin 管理平台配置、普通用户、启用/禁用、删除、重置密码和作用域授权；普通用户只看到被授权的 `集群 + 单一 namespace` 作用域。本版普通用户在授权作用域内允许执行现有全部资源操作，后续角色模型再细分只读/读写。
- **前端入口**：新增登录页、强制修改密码页、权限配置弹窗、用户菜单和修改密码弹窗；登录后不自动选择或应用作用域。普通用户无授权作用域时资源区显示“暂无授权作用域，请联系管理员”。
- **超时策略**：admin 与普通用户默认 20 分钟无真实操作超时，超时前 30 秒倒计时提醒；Logs、Shell、Watch 不续期，未保存 YAML 超时后不自动保存。

## 2026-06

### ConfigMaps 一等资源页

- **入口与列表**：ConfigMaps 从 v1 隐藏视图移出，侧栏新增「配置 / ConfigMaps」；列表改为专用列（Name、Namespace、引用资源、配置规模、风险、Age、操作），Name 打开右侧 Describe，复制名称仍是 hover/focus 小图标，三点菜单只放编辑 YAML、编辑配置、下载 YAML、删除。
- **数据流**：后端保留 ConfigMap list/watch，并新增 describe/yaml/update/delete ops；前端新增独立 `configMapItems` raw state、refresh nonce、watch gap fill 与 `applyK8sNamespacedWatchEvent` 合并，不再用 generic table 暴露可见页面。
- **排障模型**：前端基于 raw Pods memo 派生 Pod 引用统计，覆盖 volume、envFrom、env/configMapKeyRef 与 initContainers；配置规模合并 data/binaryData key 数与大小；风险标签覆盖未引用、空配置、超大配置、疑似敏感配置、高影响范围。
- **Describe 与底部工作区**：新增结构化 ConfigMap Describe（影响范围、风险分析、配置摘要、Key 列表、基本信息、Events）；YAML Edit 复用底部 `PodYamlEditTab`；新增 Config Editor 底部 tab，可浏览 key、复制/下载内容，并支持保存 data 文本 key。
- **YAML 加载修复**：`PodYamlEditTab` 补齐 `yamlKind === "configmap"` 的加载分支，避免把 ConfigMap 名称误走 Pod YAML API；错误展示会解析 JSON / 纯文本响应体，仅在真实 403 时提示权限方向。后端 ConfigMap ops 改为按 Kubernetes `StatusError` 返回 403/404/409/400 等真实状态码，并在日志中记录 cluster、namespace、name。
- **文档**：新增 `doc/guide/configmaps.md`，同步根 `README.md`、`doc/guide/resource-lists.md` 与 Events 关联跳转说明。

### 浅色主题 Events / 告警可读性修复

- **Describe Events 卡片语义 token 化**（`DescribeEventsSection.tsx` / `tokens.css`）：原 Warning / Failed 类事件复用了深色主题浅红文字（如 `#fecaca`）与半透明深红背景，浅色主题下会出现粉底浅字、正文不可读。新增 **`--wl-event-normal-*` / `--wl-event-warning-*`** token，分别定义背景、边框、强调线、标题、正文与辅助信息颜色；Pod、Deployment、StatefulSet、Ingress、Service、PVC、Node 等 Describe 面板共用的 Events 区块同步受益。
- **Events 页面 Message 同步修复**（`EventDescribeContent.tsx`）：Warning 事件详情正文使用同一套 event severity token，保持浅色主题深字可读、深色主题不刺眼。
- **异常/诊断行色收口**（`App.tsx`、`IngressDescribeContent.tsx`、`ServiceDescribeContent.tsx`、`ServicesListTable.tsx`、`StatefulSetDescribeContent.tsx`）：Ingress 规则诊断、Service Endpoints、StatefulSet 实例异常摘要/行高亮改为 **`--wl-row-danger|warning|attention-*`** 与 pill token，避免浅色主题下硬编码透明色过淡或与正文层次不一致。
- **README**：本次属于主题可读性修复，不改变核心能力与启动方式，根 README 不新增条目。

## 2026-04

### 平台配置、Events Describe 与 kubeconfig 文件扫描修复

- **平台配置 · 集群选择下拉滚动稳定性**（`SearchableDropdownPanelPortal.tsx` / `SearchableDropdownPrimitives.tsx` / `WlDropdownSurface.tsx` / `useFloatingDropdownPosition.ts`）：可搜索下拉是 body Portal，原定位 hook 捕获 `window` scroll 时也会响应面板内部列表滚动；kubeconfig 文件较多时，滚轮滚动会触发重新测量与高度重算，叠加外层 `overflow: hidden` 导致滚动条消失或无法继续滚动。修复为 **忽略面板内部 scroll 的重新定位**、下拉表面阻止 `wheel` 冒泡，列表滚动区补齐 `overflow-y: auto`、`overflow-x: hidden`、`overscroll-behavior: contain` 与稳定 scrollbar gutter。
- **kubeconfig 扫描支持 `.config`**（`server/internal/cluster/registry.go`）：原扫描条件只放行 `.yaml` / `.yml` 或文件名以 `config` 开头的文件，导致 `xxxxx.config` 不会进入 `/api/clusters`，前端「集群选择」下拉框无法选到。扫描候选规则改为允许 **无后缀**、**`.config`**、**`.yaml`**、**`.yml`**；继续跳过隐藏文件、临时/备份文件与目录，候选文件仍由 `clientcmd.LoadFromFile` 做 kubeconfig 内容解析。新增 `server/internal/cluster/registry_test.go` 覆盖无后缀、`.config`、`.yaml`、隐藏/临时/目录跳过。
- **平台配置 · 已添加作用域操作列稳定布局**（`web/src/pages/App.tsx`）：表格切到固定列宽与容器横向滚动；「操作」列设定稳定宽度，**测试 / 删除** 按钮容器 `nowrap`，按钮 `white-space: nowrap` 且 `flex-shrink: 0`；kubeconfig 文件名列省略，别名 input 使用 `minWidth: 0` 在自身列内收缩，避免长内容把操作按钮压成竖排。
- **Events Describe Message 可读性**（`web/src/components/describe/EventDescribeContent.tsx`）：Message 块从固定深色背景改为 `--wl-describe-section-bg`，文字继续使用主题 token；浅色主题下恢复浅底深字，深色主题下保持原详情面板层级。
- **文档同步**：根 `README.md` 只补充 kubeconfig 扫描这一核心能力；`doc/guide/events.md`、`doc/guide/resource-lists.md`、`doc/README.md` 与本变更记录补充用户可见行为和实现说明。

### 底部工作区：Logs 标签页横向铺满（修复右侧留白）

- **根因**：`BottomPanel.tsx` 中每个标签的内容容器使用 `display: flex` 但未指定 `flex-direction`，浏览器默认为 **横向 flex**；子项在主轴（宽度）上 `flex-grow` 为 0，`LogsTab` 未像 Shell 内层那样参与伸展，工具栏与 `<pre>` 日志区仅占内容宽度，右侧出现大块空白。
- **修复**：标签内容容器改为 **`flexDirection: "column"`**（子项默认 `align-items: stretch`，横向铺满），并加 **`minWidth: 0`**；`LogsTab.tsx` 根容器与工具栏、日志滚动区补齐 **`flex: 1` / `width: 100%` / `minWidth: 0`** 等，与 flex 列布局一致。
- **涉及文件**：`web/src/components/BottomPanel.tsx`、`web/src/components/LogsTab.tsx`。
- **文档**：`doc/dev/theme-ui.md`、`doc/guide/pods.md`、本小节。

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
