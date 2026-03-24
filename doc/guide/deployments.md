# Deployments 使用手册

Deployments 页面位于左侧边栏 **Deployments**，在已应用「集群 + 命名空间」组合后可用，用于查看与管理命名空间内的 Deployment。

## 列表与筛选

- 顶部 **按 Name 关键字过滤** 与 Pods 等页面共用。
- 列说明（可调列宽）：
  - **Name / Namespace**：名称与命名空间；Name 旁可复制。
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
| **Edit** | 在底部面板打开 **YAML 编辑器**（与 Pod 编辑同一套界面：搜索、minimap、Save / Save & Close / Cancel）。 |
| **Delete** | 确认后删除该 Deployment，并从当前列表移除该行。 |

操作进行中该行菜单会暂不可用；失败时通过顶部简短提示反馈错误。

## 相关文档

- 开发侧 API 与缓存说明见 `doc/dev/changelog.md` 与后端 `resources.go` 中 Deployment 相关路由。
