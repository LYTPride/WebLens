# ConfigMaps 使用手册

ConfigMaps 页面用于快速判断配置对象的影响范围、风险与可编辑内容。入口位于左侧「配置 / ConfigMaps」。

## 列表

标题格式为 `Config Maps · <namespace-or-scope> / <count>`；集群与命名空间作用域仍显示在顶部统一 scope 区域。

列表列包括：选择框、Name、Namespace、引用资源、配置规模、风险、Age、操作。

- 点击 **Name** 打开右侧结构化 Describe Drawer。
- Name 旁的复制按钮在 hover/focus 时出现，用于复制 ConfigMap 名称。
- 三点菜单只包含操作：编辑 YAML、编辑配置、下载 YAML、删除。
- 搜索支持 name、namespace、key 名称、风险标签，以及 `pods` 等引用关键词。
- 排序支持 Name、Namespace、引用资源数量、配置规模、风险优先级与 Age。
- 表头复选框只选择当前可见行，支持搜索过滤后的三态全选。

## 引用资源

当前版本至少统计同作用域 Pod 对 ConfigMap 的引用，包含：

- `volumes[].configMap.name`
- `containers[].envFrom[].configMapRef.name`
- `initContainers[].envFrom[].configMapRef.name`
- `containers[].env[].valueFrom.configMapKeyRef.name`
- `initContainers[].env[].valueFrom.configMapKeyRef.name`

列表中会显示 `Pods N` 或 `未引用`；Describe 中会展开到引用方式、容器名、key 名或 volume 名。Deployment、StatefulSet、DaemonSet 的模板引用结构已在页面模型中预留，后续可继续扩展。

## 风险标签

风险标签用于排障提示，不代表 Kubernetes 原生状态。

- `健康`：未发现下列风险。
- `未引用`：当前作用域内未发现 Pod 或工作负载引用。
- `空配置`：`data + binaryData` key 数为 0。
- `超大配置`：总大小超过 512KB，接近 1MiB 时风险更高。
- `疑似敏感配置`：仅扫描 key 名，命中 password、token、secret、api_key 等关键词。
- `高影响范围`：引用资源数超过 20。

## Describe Drawer

ConfigMap Describe 始终从 Name 打开右侧 Drawer，不进入底部工作区。内容顺序为：

1. 影响范围
2. 风险分析
3. 配置摘要
4. Key 列表
5. 基本信息
6. Events

Events 使用统一的 Describe Events 区块，Warning/Normal 在深色与浅色主题下均保持可读。

## 底部工作区

ConfigMap 支持两个底部 tab：

- **YAML Edit**：从三点菜单「编辑 YAML」打开，复用 YAML 编辑器并走 ConfigMap 专用 YAML API，支持 Save、Save & Close、Cancel、搜索、刷新加载与保存错误提示。
- **Config Editor**：从三点菜单「编辑配置」打开。左侧显示 key 列表，右侧查看当前 key 内容；`data` 文本 key 支持编辑保存，`binaryData` 以只读方式展示 base64 内容。当前 key 支持复制与下载。

编辑器顶部会提示当前影响范围。修改 ConfigMap 后，相关工作负载可能需要重启才会读取新配置；删除或改名 key 可能导致应用启动失败。

若 YAML 加载或保存失败，面板会显示后端返回的真实错误正文。403 通常表示当前身份缺少 `get` 或 `update` ConfigMap 权限；404 通常表示资源已删除、命名空间不匹配，或当前选中的集群与目标 kubeconfig/context 不一致。

## 删除与批量操作

单个删除从三点菜单进入，使用 WebLens 统一确认弹窗；若当前发现引用资源，确认说明会展示影响范围。

批量操作条支持：

- 批量删除
- 批量导出 YAML
- 取消选择

批量选择只作用于当前可见列表项，搜索过滤后选择状态会同步修剪。
