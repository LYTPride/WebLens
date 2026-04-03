# Events（事件）使用手册

Events 页面展示当前 **已应用命名空间** 下的 Kubernetes **Core Event**（`events` 资源），采用与其他命名空间资源相同的 **HTTP list + Watch** 模式，便于快速发现 Warning、关联对象与最近发生时间。

## 入口与作用域

- 左侧边栏 **Events**；默认进入控制台时可能落在 Events 页（以当前版本为准）。
- 列表受 **集群 + 命名空间** 约束，与 Pods、PVC 等一致；切换作用域后需 **应用** 再查看。

## 列表与筛选

- **按名称关键字过滤**：对 **Involved Object** 的展示名称（kind/name）做子串匹配，便于聚焦某 Pod、Deployment 等。
- **列排序**：表头可点击列与 **▲/▼** 与其他资源列表一致；**未选择列排序** 时，列表使用 **异常优先的默认顺序**（Warning 类型、较高 count、更近的 lastSeen 等优先），便于排障扫一眼。
- **刷新列表**：强制重新 list 并 **清空当前 Events 页的列排序**；Watch 仍持续推送增量。

## Warning 提示

- 当前过滤结果中存在 **Warning** 类型事件时，列表上方可出现简短提示条，提醒关注异常事件（具体文案以界面为准）。

## Describe 与关联资源跳转

- 点击行或按列表交互打开右侧 **Describe** 时，可查看 **Reason、Message、Source、Involved Object、Count、时间** 等结构化信息。
- **关联资源**：对 Involved Object 提供跳转入口时，会切换到 **侧栏已支持的列表视图**（如 Pods、Deployments、PVC、Services、Ingress、Nodes、StatefulSets），并带上名称过滤，便于连贯排障。
- **v1 未在侧栏开放的资源类型**（如 DaemonSet、Job、CronJob、ConfigMap、Secret 等）**不展示跳转**，避免进入无列表页；会话恢复时若 localStorage 中仍为上述隐藏视图键，会 **回落到 Pods**（实现见 `web/src/utils/v1HiddenViews.ts`）。

## 与 Nodes 权限的关系

- 若事件关联 **Node** 而当前身份 **无权访问 Nodes 列表**，Describe 中跳转 Nodes 的入口会 **禁用** 并附带说明（避免点击后进入受限态仍困惑）。

## 相关文档

- [资源列表：筛选、排序与实时更新](./resource-lists.md)
- [开发变更记录 · Events 与埋点](../dev/changelog.md)
