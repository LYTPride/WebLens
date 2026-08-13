# Permissions V2 实现说明

Permissions V2 在现有 `admin/user` 数据模型上增加不可变的 `is_root` 标记，以区分唯一根管理员和可委派的平台管理员；普通用户的作用域授权模型保持兼容。

## 平台身份与作用域模型

- 根管理员：`role=admin,is_root=1`，固定用户名 `admin`。只有它保留全路径 fallback，可访问未加入 `cluster_combos` 的命名空间和集群级资源。
- 平台管理员：`role=admin,is_root=0`，负责平台配置、用户、作用域分组、授权和审计；对所有已加入 `cluster_combos` 的作用域拥有 `operator` 能力，但未添加作用域默认拒绝。
- 普通用户：`role=user,is_root=0`，通过直接授权或分组授权获得 `viewer/operator`。
- 作用域仍是明确的 `cluster + namespace`；一个作用域最多属于一个扁平分组。
- 用户可以同时获得分组授权和单独作用域授权；授权重叠时取较高角色：`operator > viewer`。
- 旧版直接作用域授权在迁移时自动保留为 `operator`，不改变已有用户的读写能力。

`users.is_root` 使用增量列迁移：已有的精确 `admin` 账号会被回填为 root；唯一部分索引保证最多一个 root，启动校验保证非空用户库必须恰好有一个合法 root，数据库触发器阻止修改 root 的用户名、角色、标记、禁用状态或删除该行。

## 能力矩阵

| 身份 / 角色 | 能力 |
| --- | --- |
| Viewer | 授权作用域内的资源查看、Describe、Pod Logs、文件读取、只读 YAML |
| Operator | Viewer 能力，加授权作用域内的资源写操作、Pod Shell、文件写操作 |
| 平台管理员 | 平台管理能力，加全部已添加作用域的 Operator 能力；未添加作用域和 Nodes 默认拒绝 |
| 根管理员 | 平台管理能力，加全部作用域与集群级资源的 fallback |

WebLens 在请求进入 Kubernetes 客户端前检查平台能力；Kubernetes RBAC 仍是第二道权限边界，因此最终权限是 WebLens 与 Kubernetes RBAC 的交集。

## 后端拦截

- 每个集群请求先映射为语义能力，再检查用户在目标作用域上的有效角色。
- ConfigMap 批量导出逐项检查读取能力；批量删除逐项检查写入能力。
- 未配置权限策略的非 root 接口默认拒绝，避免新增写接口时意外放行。
- 除 root 外，namespace 请求必须命中明确的已添加/已授权作用域；Nodes 等集群级资源只允许 root fallback。
- Watch 与 Shell 的认证中间件每 5 秒复核 session；禁用、重置密码或本机恢复后会取消请求 context。Shell 另行复核 `pod.exec` 能力，作用域撤销或降级后主动关闭连接。
- 轮询只在确认 session/权限失效时断开；瞬时数据库错误会留待下一轮复核，避免偶发故障误杀连接。
- 前端按钮隐藏只用于改善体验，后端判断始终是权威结果。

## 审计

审计范围包括用户/授权管理、本人改密、root 本机恢复、平台与作用域配置、资源写操作、文件写入、Shell 进入和权限拒绝。用户管理记录会保存目标用户名、用户 ID、平台身份、root 标记和具体操作；root 恢复使用 `system:local-recovery` 作为操作者并记录会话撤销数量。审计还保存请求方法和路径、作用域与资源标识、结果、状态码和能力说明；不采集或返回来源 IP。

审计不保存密码、Token、kubeconfig 内容、请求正文和资源 YAML。

所有具备目标作用域写权限的用户（包括根管理员和平台管理员）在执行资源删除、重启、扩缩容、YAML/配置保存和已有批量高危操作前，都必须填写资源操作日志。前端交互顺序固定为：

```text
操作入口 -> 操作日志必填弹窗 -> 资源确认弹窗 -> 请求执行
```

任一步取消都不会发出请求；空日志不能进入确认步骤。前端通过 ASCII 编码的 `X-WebLens-Audit-Reason` 请求头传递日志，后端再次校验必填及 500 字符上限，避免直接调用接口绕过。实际进入资源处理的成功或失败请求会把日志写入 `audit_logs.operation_log`；旧审计记录和不属于上述资源操作的记录保持空值。

`operation_log` 使用增量列迁移，保留已有审计记录。审计查询结果不再暴露 `sourceIp`，仅根管理员或平台管理员可通过审计记录的“日志”列查看非空操作日志。

## 密码生命周期与 root 恢复

- 创建任意非 root 用户时使用 `crypto/rand` 生成独立的 24 字符 URL-safe 临时密码，响应字段为 `temporaryPassword`；数据库只保存 bcrypt 哈希并设置 `must_change_password=1`。
- 管理员重置其他非 root 用户时重新生成临时密码，在同一事务中更新哈希、设置强制改密并删除全部 session。
- 本人改密通过 `/api/auth/change-password` 完成，并写入 `account.password.change` 审计；管理员不能通过管理接口重置自己。
- root 密码遗失只能在本机调用 `weblens-server reset-admin-password`，部署包使用 `scripts/reset-admin-password.sh` 包装确认和隐藏输入；不存在远程恢复 API。
- `ResetRootPassword` 不接受用户标识，只查询唯一 `is_root=1` 行；更新哈希、强制改密、撤销 session 和写 `root.password.recovery` 审计在同一事务中完成。
- 恢复脚本通过 stdin 传递临时密码，不放入 argv、环境变量、日志或审计 detail。

## 管理接口

- `GET/POST/PATCH/DELETE /api/auth/admin/scope-groups`
- `PUT /api/auth/admin/scope-groups/:id/scopes`
- `GET/PUT /api/auth/admin/users/:id/grants`
- `GET /api/auth/admin/audit-logs`

以上接口均要求根管理员或平台管理员身份。用户管理接口还包括创建用户（请求携带 `role=user|admin`）、启用/禁用、随机临时密码重置和删除；root 与当前账号保护由 Store 层统一执行，而不只依赖 HTTP handler。
