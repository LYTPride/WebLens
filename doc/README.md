# WebLens 文档导航

欢迎使用 WebLens 文档中心。本文档用于快速定位用户手册、开发文档与规划信息。

根目录 `README.md` 与本页 **只概括重大核心能力**；具体交互与变更默认落在 `guide/`、`dev/` 与 `changelog.md`。

## 如何阅读

- 如果你是使用者（运维/测试）：先看 `guide/`
- 如果你是开发者：先看 `dev/`
- 如果你想了解后续方向：看 `roadmap.md`

## 用户手册（guide）

- [Pods 使用手册](./guide/pods.md)
- [Deployments 使用手册](./guide/deployments.md)
- [Events（事件）使用手册](./guide/events.md)（list/watch、Describe、关联资源跳转与 v1 隐藏视图约定）
- [资源列表：筛选、排序与实时更新](./guide/resource-lists.md)（含 **PVC**、**Events**、**Nodes 与 RBAC 受限态**、刷新重探测说明）
- [Ingress 与 Services（列表、Describe、跨资源联动）](./guide/ingress-services.md)
- [Shell 使用手册](./guide/shell.md)
- [文件管理面板使用手册](./guide/file-manager.md)

## 开发文档（dev）

- [架构设计](./dev/architecture.md)
- [资源列表数据流（list / watch / 缓存）](./dev/resource-list-dataflow.md)（规范正文见仓库 [`web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md`](../web/src/resourceList/RESOURCE_LIST_ARCHITECTURE.md)，含 **serverTimeMs**、Age、Watch 缺口 list 合并）
- [Pod 状态标签模型](./dev/health-label-model.md)
- [Shell 实现说明](./dev/shell-implementation.md)
- [文件管理面板设计说明](./dev/file-manager-design.md)（含与列表共用的 **`ConfirmDialog` / `InputDialog`** 说明）
- [v1 使用行为埋点（可选）](./dev/analytics.md)（`WEBLENS_ANALYTICS_LOG`、`POST /api/analytics/events`、`trackUsage`）
- [开发变更记录](./dev/changelog.md)
- [全局下拉 Portal 与次级展开表格](./dev/portal-dropdown-and-secondary-tables.md)（`WlPortal`、统一定位与 z-index、Ingress/STS/Services 子表列宽）

## 路线规划

- [Roadmap](./roadmap.md)

## 维护建议

- 新增“用户可见行为”优先写入 `guide/`
- 新增“实现细节/协议/数据结构”优先写入 `dev/`
- 版本迭代节点在 `dev/changelog.md` 追加记录

