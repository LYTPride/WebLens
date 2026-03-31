# Changelog（开发变更记录）

> 本文件用于记录开发过程中的关键变更，按功能域持续补充。

## 2026-03（近期）

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

