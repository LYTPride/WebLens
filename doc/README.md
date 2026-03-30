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
- [资源列表：筛选、排序与实时更新](./guide/resource-lists.md)
- [Shell 使用手册](./guide/shell.md)
- [文件管理面板使用手册](./guide/file-manager.md)

## 开发文档（dev）

- [架构设计](./dev/architecture.md)
- [资源列表数据流（list / watch / 缓存）](./dev/resource-list-dataflow.md)
- [Pod 状态标签模型](./dev/health-label-model.md)
- [Shell 实现说明](./dev/shell-implementation.md)
- [文件管理面板设计说明](./dev/file-manager-design.md)
- [开发变更记录](./dev/changelog.md)

## 路线规划

- [Roadmap](./roadmap.md)

## 维护建议

- 新增“用户可见行为”优先写入 `guide/`
- 新增“实现细节/协议/数据结构”优先写入 `dev/`
- 版本迭代节点在 `dev/changelog.md` 追加记录

