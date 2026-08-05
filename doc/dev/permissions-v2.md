# Permissions V2 实现说明

Permissions V2 在现有 `admin/user` 身份模型上扩展作用域角色，不替换已有用户、会话和作用域数据。

## 权限模型

- 平台角色继续使用 `admin` 与 `user`。admin 负责平台配置、用户、作用域分组、授权和审计。
- 作用域角色分为 `viewer`（观察者）与 `operator`（运维）。
- 作用域仍是一个明确的 `cluster + namespace`；一个作用域最多属于一个扁平分组。
- 用户可以同时获得分组授权和单独作用域授权；授权重叠时取较高角色：`operator > viewer`。
- 旧版直接作用域授权在迁移时自动保留为 `operator`，不改变已有用户的读写能力。

## 能力矩阵

| 角色 | 能力 |
| --- | --- |
| Viewer | 资源查看、Describe、Pod Logs、文件读取、只读 YAML |
| Operator | Viewer 能力，加资源写操作、Pod Shell、文件写操作 |
| Admin | 全部作用域能力，加平台配置、用户与授权管理、审计查看 |

WebLens 在请求进入 Kubernetes 客户端前检查平台能力；Kubernetes RBAC 仍是第二道权限边界，因此最终权限是 WebLens 与 Kubernetes RBAC 的交集。

## 后端拦截

- 每个集群请求先映射为语义能力，再检查用户在目标作用域上的有效角色。
- ConfigMap 批量导出逐项检查读取能力；批量删除逐项检查写入能力。
- 未配置权限策略的普通用户接口默认拒绝，避免新增写接口时意外放行。
- 非 admin 的活动 Shell 每 5 秒复核一次 `pod.exec`；授权被撤销或降级后主动关闭连接。
- 前端按钮隐藏只用于改善体验，后端判断始终是权威结果。

## 审计

审计范围包括权限管理、平台与作用域配置、资源写操作、文件写入、Shell 进入和权限拒绝。记录保存用户快照、动作、请求方法和路径、作用域与资源标识、结果、状态码、来源 IP 和能力说明。

审计不保存密码、Token、kubeconfig 内容、请求正文和资源 YAML。

## 管理接口

- `GET/POST/PATCH/DELETE /api/auth/admin/scope-groups`
- `PUT /api/auth/admin/scope-groups/:id/scopes`
- `GET/PUT /api/auth/admin/users/:id/grants`
- `GET /api/auth/admin/audit-logs`

以上接口均要求平台 admin 角色。
