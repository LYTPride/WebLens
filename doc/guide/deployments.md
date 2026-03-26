# Deployments 使用手册

Deployments 页面位于左侧边栏 **Deployments**，在已应用「集群 + 命名空间」组合后可用，用于查看与管理命名空间内的 Deployment。

## 列表与筛选

- 顶部 **按 Name 关键字过滤** 与 Pods 等页面共用；**列排序**、**Watch 实时重排** 与 **「刷新列表」清空排序** 等行为与 Pods 共用一套规则，详见 [资源列表说明](./resource-lists.md)。
- 列说明（可调列宽）：
  - **Name / Namespace**：**点击 Name** 从右侧打开 **Describe** 面板（结构化展示，非 `kubectl describe` 纯文本）；Name 旁按钮可复制名称。
  - **Pods**：就绪/期望副本，如 `1/1`、`3/5`。
  - **Replicas**：当前副本数 / 期望副本数。
  - **存活时间**：与 Pods 列表相同的时长格式。
  - **Conditions**：Available、Progressing、ReplicaFailure 等状态标签（颜色区分正常/异常）。
  - **操作**：行末三点菜单。

表头列边界可 **左右拖拽** 调整宽度；最小宽度防止列过窄不可读。

## 与 Pods 切换时的加载行为

在同一 **已应用** 集群 + 命名空间下：

- 首次进入 Pods 或 Deployments 会加载对应列表。
- 在 **Pods ⇄ Deployments** 之间切换时，会 **复用已加载的列表数据**，不会每次切换都重新请求整表。
- 点击 **「刷新列表」** 仅刷新 **当前页面** 的资源类型，不影响另一页面的缓存。
- 在顶部重新选择组合并点击 **「应用」** 后，会按新作用域重新加载。

## 三点菜单

每行 **⋮** 打开菜单（样式与 Pods 列表一致）：

| 项 | 说明 |
|----|------|
| **Scale** | 弹出对话框修改副本数（非负整数），提交后调用后端并更新当前行。 |
| **Restart** | 确认后触发滚动更新（annotation `kubectl.kubernetes.io/restartedAt`）。 |
| **Edit** | 在底部面板打开 **YAML 编辑器**（与 Pod 共用 `PodYamlEditTab` + **Monaco Editor**：内置 **Sticky Scroll**（真实源码行 + 行号 + 着色）、minimap、折叠、搜索、Save / Save & Close / Cancel）。 |
| **Delete** | 确认后删除该 Deployment，并从当前列表移除该行。 |

操作进行中该行菜单会暂不可用；失败时通过顶部简短提示反馈错误。

## Describe（右侧详情）

与 Pods 相同：**半透明遮罩 + 右侧可拖拽宽度面板**，可刷新、复制 `namespace/name`、关闭。

展示为后端返回的 **结构化数据**，主要区块包括：

- **基本信息**：Name、Namespace、创建时间、存活时间、Labels、可展开 **Annotations**、Selector
- **副本与状态**：Desired / Updated / Ready / Available / Unavailable；**Conditions** 分条展示
- **滚动更新策略**：Strategy Type、MaxUnavailable / MaxSurge、Progress Deadline
- **Pod 模板**：Service Account、Node Selector、Tolerations、Volumes；Init Containers / Containers（镜像、端口、资源、挂载、Env 可折叠）
- **Events**：与 Pod Describe **同一套样式**（Warning/失败类事件红底高亮）；无事件时显示 **「暂无 Events」**

数据接口：`GET /api/clusters/:id/deployments/:namespace/:name/describe`（返回 `view` + `events`）。

## 相关文档

- 开发侧 API 与缓存说明见 `doc/dev/changelog.md` 与后端 `resources.go` 中 Deployment 相关路由。
