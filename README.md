# WebLens

WebLens 是一个面向 Kubernetes 运维场景的 Web 控制台。它通过浏览器提供多集群资源查看、Pod 排障与基础运维能力，后端作为 Kubernetes API Proxy 统一处理请求。

> 说明：本 README **只概括重大核心特色**；字段级交互、样式与迭代细节默认写在 `doc/`，不在此逐条展开。

## 核心功能

- **登录与权限**：首次部署通过 `scripts/init.sh` 初始化唯一受保护的根管理员 `admin`；根管理员可创建平台管理员或普通用户，创建/重置使用一次性随机临时密码；本机可通过 `scripts/reset-admin-password.sh` 恢复遗失的 root 密码。用户、平台配置和授权保存到 SQLite（默认 `data/weblens.db`）；支持 `viewer/operator` 作用域角色、后端能力拦截及操作审计，最终权限仍与 Kubernetes RBAC 取交集，说明见 `doc/guide/authentication.md`
- **界面主题**：支持 **浅色 / 深色** 切换（顶栏右上角太阳/月亮 icon），样式由 CSS 变量统一驱动；平台配置入口为同组 **齿轮 icon**，下拉菜单与设置项行为不变
- **多集群**：作用域选择（cluster + namespace preset）、应用与刷新
- **Pods / Deployments / StatefulSets**：列表采用 **HTTP List（快照）+ Watch（增量）** 同一套模式；Deployments / StatefulSets 支持 Describe、扩缩容、重启、删除等（以当前版本为准）；Pods Describe 侧栏
- **列表能力**（Pods、Deployments 等）：主标题为 **类型 · 命名空间 / 条数**（集群与作用域详情见上方「集群与命名空间」小字，避免重复占宽）；Name 筛选、表头拖拽调宽、**按列排序**（Watch 更新后仍按当前排序重排；开启排序时若某行排序位置因数据变化而改变，可有轻量行内提示）；**Age 列** 以服务端下发的 **`serverTimeMs`** 为时间基准（配合前端单调推进），减轻本机时间与集群不一致带来的误判；偏差超阈值时有轻量提示；**Ingress / StatefulSet / Service 行内展开子表** 同样支持表头调宽与格内换行，下拉菜单统一 **body Portal** 定位（见 `doc/dev/portal-dropdown-and-secondary-tables.md`）
- **YAML 编辑**（Pods、Deployments、StatefulSets、Ingresses、Services、PVCs、ConfigMaps 等）：Monaco（高亮、minimap、折叠、sticky 上下文、搜索与保存），按资源类型走对应 API
- **ConfigMaps**：配置资源一等页面，支持 List + Watch、Name 打开结构化 Describe、引用 Pod 影响范围、风险标签、YAML 编辑、配置 key 编辑、导出与删除；说明见 `doc/guide/configmaps.md`
- **其他资源**：Workloads / Config / Network / Cluster 等浏览
- **Nodes（集群级）**：列表与 Watch 与命名空间无关；若当前 kubeconfig / ServiceAccount **无 list/watch nodes** 权限，页面以统一 **「暂无访问权限 / 受限态」** 展示（非整页报错），并支持按集群缓存拒绝结果；管理员放权后可通过 **「刷新列表」** 重新探测。**当前 v1 侧栏默认不展示 Nodes 入口**（便于无集群级权限的团队使用），相关逻辑与路由仍保留，恢复入口见 `doc/dev/theme-ui.md` 与 `doc/dev/changelog.md`，用户说明见 `doc/guide/resource-lists.md`
- **PersistentVolumeClaims（PVC）**：命名空间内列表 **List + Watch**、结构化 **Describe**、**YAML 编辑** 与删除（以当前 RBAC 为准）；列表能力（筛选、排序、Age、`serverTimeMs`）与其他资源列表一致，说明见 `doc/guide/resource-lists.md`
- **Events（事件）**：命名空间内 **List + Watch**；未选列排序时 **异常优先默认顺序**，可选表头多列排序；**Describe** 与 Involved Object **跳转**至侧栏已开放资源（v1 隐藏类型不跳转；会话恢复回落见 `doc/guide/events.md`）；存在 Warning 时可有列表区提示
- **Ingress / Services**：列表与行展开、结构化 **Describe**（规则诊断、Endpoints、关联 Pods / 引用 Ingress）；**跨资源联动**（跳转并过滤 Services / Pods / Ingress）与 **资源名称展示** 统一为「可换行正文 + 复制 + 独立轻量联动按钮」，见 `doc/guide/ingress-services.md`
- **Pod 健康标签**（健康 / 关注 / 警告 / 严重）与范围级风险提示
- **Pod Logs**：流式、历史上翻、下载
- **Pod Shell**：WebSocket exec，支持重连；终端 **背景与前景色随主题切换同步更新**，避免切换浅色/深色后仍残留旧主题底色
- **Shell 旁文件管理**：目录浏览与上传/下载/删除等；传输任务汇总；删除/重命名/新建目录使用与资源列表一致的 **应用内确认与输入弹窗**（非浏览器原生 `confirm`/`prompt`）
- **底部工作区标签条**：横向滚动 **仅作用于标签区域**；`html`/`body`/`#root` **禁止视口级横向溢出**，避免与标签条 scrollbar 叠成双条、误拖整页；标签滚动区 **底部预留空间 + 略矮横条样式**，减轻悬停/拖动滚动条时遮挡标签标题

## 快速开始

### 1) 后端启动

首次部署或从旧版本升级后，先初始化管理员和 SQLite 配置库：

```bash
./scripts/init.sh
```

初始化成功后再启动服务。发布包升级时不要覆盖 `data/` 目录；默认数据库路径为 `data/weblens.db`，可通过 `WEBLENS_DB_PATH` 指定。

如果根管理员 `admin` 的密码遗失，请在 WebLens 主机的交互式终端执行：

```bash
./scripts/reset-admin-password.sh
```

首次使用请通过环境变量 **`WEBLENS_KUBECONFIG_DIR`**（**绝对路径**）指向 kubeconfig 目录，或在 Web 控制台「平台配置 · kubeconfig 存放目录」中填写保存。未配置时集群列表为空，直至目录配置成功。

后端会扫描该目录中的 kubeconfig 文件：支持 **无后缀**、**`.config`**、**`.yaml`**、**`.yml`** 文件名；隐藏文件、临时/备份文件与目录会被跳过，候选文件仍需通过 kubeconfig 内容解析。

可选：**`WEBLENS_ANALYTICS_LOG`** 指定 v1 **使用行为埋点** NDJSON 日志路径（默认 `logs/analytics.log`，与主日志分离）；前端 `POST /api/analytics/events`，失败不影响操作。说明见 `doc/dev/analytics.md`。

```bash
cd server
go mod tidy
go run ./cmd/weblens
```

### 2) 前端开发（可选）

```bash
cd web
npm install
npm run dev
```

前端依赖安装后会执行 `postinstall` 脚本，对 Monaco 做与换行相关的兼容性处理；编辑页需 **本地 Monaco 包**（见 `web/src/monaco/monacoInit.ts`），勿依赖外网 CDN。若编辑页长期 **Loading...**，请重新执行 `npm install` / `npm run build`。

### 3) 浏览器访问

- 健康检查：`http://<host>:8080/healthz`
- 控制台首页：`http://<host>:8080/`

## 文档导航

详细文档在 `doc/`：

- 文档二级首页：`doc/README.md`
- 用户手册：`doc/guide/`（含 Pods、Deployments、**ConfigMaps**、**Events**、Shell、文件管理、**资源列表排序与实时更新**）
- 开发文档：`doc/dev/`（含架构、**资源列表数据流 list + watch + 作用域缓存**、**v1 埋点**、健康标签、Shell/文件管理实现说明）
- 规划：`doc/roadmap.md`

## 技术栈

- Backend: Go, Gin, client-go
- Frontend: React, TypeScript, Vite, Monaco Editor（YAML 编辑）
- Protocols: HTTP API, WebSocket (exec), streaming logs/watch

## License

暂未指定（建议补充 `LICENSE` 文件后在此处更新）。
