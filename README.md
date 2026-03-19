# WebLens（Kubernetes Web 监控控制台）

WebLens 是一个部署在 Linux 服务器上的 **Web 版 Kubernetes 控制台**，界面和使用体验参考 Freelens/Lens，但以 **浏览器访问 Web 页面** 的方式提供运维监控能力，适合集中管理多业务集群。

当前版本使用：

- **后端**：Go + Gin + client-go（多集群、资源查询、日志接口）
- **前端**：React + TypeScript + Vite（暗色工作台风格）
- **部署形态**：Linux 服务器解压目录 + shell 启停脚本（支持后续打包为 `.tar.gz`）

---

## 功能概览

### 已实现功能

- **多集群接入**
  - 通过环境变量 `WEBLENS_KUBECONFIG_DIR` 指定一个目录，目录中存放多个 kubeconfig 文件（`.yaml` / `.yml` / `config*`）。
  - 后端启动时扫描目录，解析其中的所有 context，每个 context 视为一个逻辑集群。
  - `GET /api/clusters` 返回所有可用集群（ID、context 名称、kubeconfig 路径等），前端以列表方式展示，可点击选择当前集群。
  - **默认命名空间**：当 kubeconfig 中 context 未设置 namespace 或当前账号无集群级 list namespaces 权限时，可采用两种方式之一：（1）在 `config/weblens.env` 或环境中设置 `WEBLENS_DEFAULT_NAMESPACE=你的命名空间`，对该服务器上所有未在 kubeconfig 中指定 namespace 的 context 生效；（2）在前端命名空间下拉为空时，使用「输入命名空间」输入框填写后点击「应用」。
  - **平台配置**：顶栏右上角提供「平台配置」菜单：
    - **kubeconfig 目录**：在界面中指定 kubeconfig 存放目录（仅支持绝对路径，无需在服务器上 export 环境变量）。若目录不存在或非绝对路径会提示；配置会持久化到 `config/kubeconfig-dir.override`，重启后仍生效。
    - **集群组合设置**：预设「集群 + 命名空间」组合（可配置别名、测试可用性、删除），主界面只需通过「组合选择 + 应用」实现一键切换，避免反复手动选集群/命名空间。
  - **集群选择**：主区使用「组合选择」下拉框选择当前集群+命名空间组合，下拉框顶部带搜索框，输入关键字可过滤 ID/名称/kubeconfig 文件名/组合别名；选中后仅显示该组合下的资源列表。
  - 支持前端“刷新”按钮重新从后端获取最新集群列表。

- **资源浏览（对标 Freelens 左侧菜单）**
  - 后端提供以下接口（均支持 `namespace` 查询参数，Nodes/Namespaces 为集群级）：
  - **工作负载**：`/pods`、`/deployments`、`/statefulsets`、`/daemonsets`、`/jobs`、`/cronjobs`
  - **配置**：`/configmaps`、`/secrets`
  - **网络**：`/services`、`/ingresses`
  - **集群**：`/namespaces`、`/nodes`、`/events`
  - 前端：左侧 **侧栏菜单**（工作负载 / 配置 / 网络 / 集群），主区域为「集群与命名空间组合选择」上方固定区域 + 下方可滚动的资源列表。Pods 视图中：
    - Name 列支持 **一键复制 Pod 名称**（小图标按钮）。
    - 列表包含 **Age**（运行时长）、Status、Restarts、容器数等字段。
    - 新增 **状态标签**（健康 / 关注 / 警告 / 严重）：后端基于 STATUS/READY/RESTARTS/卡住时长计算健康分并映射为标签，前端仅展示标签并在悬浮时展示原因列表。
    - 当当前组合范围内存在任意非“健康”标签 Pod 时，Pods 列表标题后会显示红色全局提示语，帮助快速发现风险（不受 Name 搜索过滤影响）。
    - 每一行提供三点操作菜单：Logs / Edit（YAML 编辑）/ Delete，Shell 将在后续版本中整合到底部面板。

- **Pod 日志查看**
  - 接口：`GET /api/clusters/:id/pods/:namespace/:pod/logs`
    - 支持查询参数：
      - `container`：容器名（可选）
      - `tailLines`：返回尾部若干行（可选）
      - `follow`：是否跟随日志流（`true`/`false`）
      - `previous`：是否读取上一个已退出容器的日志（`true`/`false`）
      - `timestamps`：是否在每行前输出时间戳（`true`/`false`）
      - `sinceTime`：时间下限（RFC3339，可选，用于一次性查询/下载时限制起始时间）
  - 行为：
    - `follow=false`：一次性返回文本日志。
    - `follow=true`：后端使用 chunked 传输流式输出日志行，便于前端实现实时跟随。
  - 前端：
    - 在 Pods 列表行右侧三点菜单中选择 **Logs**，在底部多标签面板中以可滚动区域展示，可与 Shell 标签并存。
    - 支持容器切换、quick filter（error/warn）、关键字高亮搜索、自动滚动开关。
    - 可勾选：
      - **previous 容器日志**：切换到前一个容器实例的日志。
      - **显示时间戳**：在每行日志前显示 Kubernetes 日志时间戳。
    - 顶部展示 `Logs from YYYY/MM/DD HH:MM:SS`，表示本次日志会话的起始时间下限（即本次查看从哪个时间点之后开始取日志），与业务日志内容的第一条时间戳无强绑定。
    - 向上滚动至日志顶部时会自动尝试从后端拉取更早的日志，并无缝拼接在现有内容之前，做到「边滚边加载」的体验。
    - **Download** 按钮提供两种下载方式：
      - **Visible logs**：下载当前页面已加载并显示的全部日志（包含通过向上滚动自动加载进来的历史部分）。
      - **All logs**：重新发起一次不带 `sinceTime` 和 `tailLines` 的请求，尽可能从日志开头拉取全部内容后下载。

- **Pod Shell（kubectl exec）**
  - 后端：`GET /api/clusters/:id/pods/:namespace/:pod/exec` 升级为 WebSocket，使用 `remotecommand.NewSPDYExecutor` 在容器内启动 `/bin/sh`，将 stdin/stdout/stderr 与 WebSocket 双向桥接。
  - 前端：
    - 在 Pods 列表三点菜单中选择 **Shell**，会在底部多标签面板中打开终端标签（支持多 Pod / 多容器并存切换）。
    - 终端使用 xterm 渲染，自动适配窗口大小，命令行在到达窗口右侧后自动换行，不会覆盖 prompt。
    - 终端标题栏提供 **重连** 按钮：无论当前是否已连接，点击都会立刻打断当前连接并重新建立会话；不会清空历史输出，新会话的 prompt 会出现在历史记录下方。
    - 支持鼠标右键菜单：
      - **复制**：复制当前选中文本到剪贴板。
      - **粘贴**：尝试通过 Clipboard API 读取剪贴板并将内容注入到终端；在浏览器限制 Clipboard API 时，会在终端内提示「请使用 Ctrl+V 粘贴」。
    - 支持键盘 **Ctrl+V**：在终端窗口中不会发送 `^V` 控制字符，而是触发浏览器原生粘贴行为，将剪贴板内容直接注入到 Shell。

- **Shell + 文件管理双栏工作区（第一版）**
  - 位置：底部面板的 Shell 标签页内，左侧为 Shell 区，右侧为文件管理窗口。
  - 默认：文件窗口 **收起** 为窄侧边栏（仅显示一个向左箭头），展开后 Shell 区自动变窄。
  - 支持：中间分隔条拖拽调整宽度（每个 Shell tab 独立记忆展开状态/宽度/当前路径）。
  - 文件管理能力（基于容器 exec 执行命令实现）：
    - 路径面包屑点击切换目录（分隔符使用 `<`，目录名蓝色下划线提示可点击）
    - 手动输入路径并进入；当路径不存在时显示红色提示语“路径不存在，请检查”
    - 上一级、刷新
    - 多选：下载（打包为 tar）、删除
    - 单选：重命名
    - 新建文件夹、上传文件到当前目录
    - 未勾选时下载/删除/重命名按钮会置灰不可点击（重命名仅在单选时可用）
  - 后端接口（均需提供 cluster/namespace/pod/container，上下文与 Shell tab 绑定）：
    - 列目录：`GET /api/clusters/:id/pods/:namespace/:pod/files?container=xxx&path=/path`
    - 新建文件夹：`POST /api/clusters/:id/pods/:namespace/:pod/files/mkdir?container=xxx`（JSON: `{path}`）
    - 重命名：`POST /api/clusters/:id/pods/:namespace/:pod/files/rename?container=xxx`（JSON: `{from,to}`）
    - 删除：`POST /api/clusters/:id/pods/:namespace/:pod/files/delete?container=xxx`（JSON: `{paths:[]}`）
    - 下载：`GET /api/clusters/:id/pods/:namespace/:pod/files/download?container=xxx&path=/a&path=/b`（返回 `application/x-tar`）
    - 上传：`POST /api/clusters/:id/pods/:namespace/:pod/files/upload?container=xxx`（multipart: `path` + `file`）
  - 注意：第一版依赖容器内 `/bin/sh`；下载依赖 `tar`，极简镜像缺失命令时会在界面显示错误提示。为提高跨镜像兼容性，凡需要 Go 解析的 shell 输出统一使用 `printf`（不依赖 `echo` 的转义行为）。

- **可选 Basic 鉴权**
  - 环境变量 `WEBLENS_AUTH_USER` 与 `WEBLENS_AUTH_PASSWORD` 同时设置时，对所有请求（除 `/healthz`）启用 HTTP Basic 鉴权。

- **统一端口 Web 访问**
  - Go 后端在一个进程中同时提供：
    - **API**：`/api/...`、`/healthz`
    - **前端静态资源**：`/`、`/assets/*`（Vite 构建产物）
  - 默认从 `./web/dist` 读取前端构建结果，亦可通过 `WEBLENS_WEB_DIST_DIR` 覆盖。
  - 前端通过 `window.location.origin` 作为 axios `baseURL`，与后端 **同源访问**，无需写死 IP 或端口，也避免 CORS 问题。

- **服务管理脚本**
  - `scripts/weblens-start.sh`
    - 自动切换到 WebLens 根目录。
    - 自动加载 `config/weblens.env`（如存在）。
    - 后台启动 `server/bin/weblens-server`，日志输出到 `logs/weblens.log`，PID 记录在 `weblens.pid`。
  - `scripts/weblens-stop.sh`
    - 读取 PID 文件，优雅终止进程，必要时使用 SIGKILL。
  - `scripts/weblens-restart.sh`
    - 顺序调用 stop + start。
  - `scripts/smoke-test.sh`
    - 本地冒烟：构建前端、启动后端（临时端口 18080）、校验 healthz / 集群与资源 API / 静态首页，通过后自动退出。

### 规划中/待完成功能

- **权限与安全（进阶）**
  - 集群级或用户级访问控制（RBAC 与 Web 用户映射）。
  - JWT / OIDC 等登录方式。
- **监控与告警集成**
  - 对接 Metrics Server / Prometheus 展示 CPU、内存等监控图。
  - 对接 Alertmanager 或其他告警系统。

---

## 当前前端交互特性（2026-03）

- **容器兼容性原则（很重要）**
  - WebLens 的一部分能力（例如文件管理）底层依赖 `pod exec` 在容器内执行 `/bin/sh -c ...` 并将输出返回给 Go 再解析展示。
  - **原则：所有需要被 Go 解析的 shell 输出，禁止依赖 `echo` 的转义行为**（不同镜像/不同 `/bin/sh` 实现对 `echo '\t'`、`echo '\n'` 的解释并不一致，可能导致“实际有内容但解析为空”的问题）。
  - 统一约定：
    - 使用 **`printf`** 输出（避免 `echo` 差异）
    - 字段之间使用**明确分隔符**（当前约定为真实 TAB `\t`）
    - 每条记录使用**明确换行**（`\n`）
    - 失败时输出走 **stderr** + 返回**非 0**，Go 侧记录日志并将错误返回给前端（避免静默吞掉导致前端“空目录”）

- **Pods 列表增强**
  - Name 列右侧提供「复制到剪贴板」按钮，方便在终端 / IM 中粘贴 Pod 名称。
  - 新增 **Age** 列，展示 Pod 存活时长（秒 / 分钟 / 小时 / 天 / 周 / 月）。
  - 新增 **状态标签** 列（健康 / 关注 / 警告 / 严重），用于替代单纯依赖 `kubectl get pod` 的 STATUS 字段做风险识别；悬浮标签可查看触发原因（STATUS/READY/RESTARTS/卡住时长等）。
  - 新增 **全局提示语**：只要当前集群+命名空间组合范围内存在任意非“健康”标签 Pod（即使搜索过滤后表格只剩健康 Pod），标题后仍会显示红色提醒：“当前范围内存在非‘健康’状态的 Pod，请及时关注。”
  - Pods 列表支持 Name 关键字过滤与 Age/Status 等核心信息一屏查看。
- **Pod YAML 在线编辑**
  - 在 Pods 列的三点菜单中点击 **Edit**，底部面板会打开 Pod YAML 编辑标签页。
  - 编辑器支持：Cancel / Save / Save & Close，右侧带文档缩略图和视口高亮。
  - 内置关键字搜索（带上下跳转和 minimap 同步）。
- **实时刷新与性能优化**
  - 当前选中集群 + 命名空间 + 资源视图采用 **Kubernetes Watch API** 做实时监听，Pods 及大部分工作负载/配置/网络资源均通过后端 watch → 前端流式处理的方式增量更新；在 watch 权限不足时自动退回短间隔列表刷新。
  - 浏览器标签页不可见时自动暂停轮询，重新激活时立即刷新一次。
  - 后端对各类资源 List 接口增加 **1 秒软缓存**，多用户并发时减少对 kube‑apiserver 的压力。
- **侧栏折叠**
  - 左侧菜单支持一键 **收起/展开**，收起后主工作区横向空间增大，更适合宽屏查看 Pods 与 YAML。

---

## 目录结构（简要）

```txt
WebLens/
  server/           # Go 后端
    cmd/weblens/    # main 入口
    internal/
      config/       # 环境变量、路径配置
      cluster/      # kubeconfig 扫描、多集群管理
      httpapi/      # Gin 路由（API + 静态资源）

  web/              # 前端（React + Vite）
    src/
      pages/App.tsx # 主界面（侧栏 + 集群/命名空间 + 多资源视图 + Pod 日志/Shell）
      components/   # Sidebar、ResourceTable、PodShell
      api.ts        # 与后端交互的 API 封装

  scripts/          # 启停脚本
    weblens-start.sh
    weblens-stop.sh
    weblens-restart.sh

  kubeconfigs/      # （示例）kubeconfig 文件目录（实际可通过 env 配置）
  logs/             # WebLens 运行日志
  release/          # 可选：打包产物目录（构建时生成）
```

---

## 后端：开发与构建

### 依赖环境

- Go 1.22+

### 本地开发运行

```bash
cd server
go mod tidy
go run ./cmd/weblens
```

服务默认监听 `0.0.0.0:8080`：

- 健康检查：`GET /healthz`
- 集群列表：`GET /api/clusters`

### 构建 Linux 可部署二进制（推荐静态构建）

为避免目标服务器 glibc 版本过低导致运行失败，推荐使用 `CGO_ENABLED=0` 构建纯 Go 二进制：

```bash
cd server

# 若 go mod tidy / go build 因 proxy.golang.org 超时失败，可先设置国内代理再执行：
# export GOPROXY=https://goproxy.cn,direct

# 生成 Linux amd64 静态二进制
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -o bin/weblens-server ./cmd/weblens
```

> 建议在打包前使用该命令重新构建，然后将 `server/bin/weblens-server` 拷贝到目标服务器。

---

## 前端：开发与构建

### 依赖环境

- Node.js（建议 18+）
- npm / pnpm / yarn（三选一）

### 本地开发

```bash
cd web
npm install
npm run dev
```

开发模式下，Vite 会在本地开启一个开发服务器（默认端口 5173）。由于后端默认监听 8080，可以在 `vite.config.ts` 中配置代理，也可以直接使用部署形态（见下）。

### 构建生产前端

```bash
cd web
npm run build
```

构建产物默认在 `web/dist` 目录。

---

## 集成部署（统一 8080 端口）

### 目录布局示例（Linux 服务器）

```txt
/appdata/soft/weblens/
  server/bin/weblens-server     # 后端二进制
  web/dist/                     # 前端构建产物（拷贝自 web/dist）
  scripts/weblens-*.sh          # 启停脚本
  kubeconfigs/                  # kubeconfig 文件目录
  logs/                         # 日志目录
  config/weblens.env            # 可选：环境变量配置
```

### 配置环境变量

环境变量可通过 shell 导出，或写入 `config/weblens.env`：

```bash
WEBLENS_HTTP_ADDR=0.0.0.0:8080               # 后端监听地址
WEBLENS_KUBECONFIG_DIR=/appdata/soft/weblens/kubeconfigs  # 也可在界面「平台配置」中设置，会写入 config/kubeconfig-dir.override
WEBLENS_WEB_DIST_DIR=/appdata/soft/weblens/web/dist  # 可选，默认 ./web/dist
WEBLENS_DEFAULT_NAMESPACE=train-uat                   # 可选：kubeconfig 不能改时，作为未在 context 中指定 namespace 的集群的默认命名空间
WEBLENS_AUTH_USER=admin                              # 可选，与 AUTH_PASSWORD 同时设置时启用 Basic 鉴权
WEBLENS_AUTH_PASSWORD=your-secret
```

### 启动/停止

```bash
cd /appdata/soft/weblens

./scripts/weblens-start.sh    # 启动
./scripts/weblens-stop.sh     # 停止
./scripts/weblens-restart.sh  # 重启
```

启动成功后：

- `http://服务器IP:8080/healthz` → `ok`
- `http://服务器IP:8080/` → 前端 UI（集群 & Pods 视图）

---

## 使用指南（当前版本）

1. **准备 kubeconfig**
   - 将各业务系统的 kubeconfig 文件复制到 `WEBLENS_KUBECONFIG_DIR` 指定的目录。
   - 每个 kubeconfig 的每个 context 会被视为一个逻辑集群。

2. **启动 WebLens**
   - 使用前述脚本启动后端。
   - 确认 `/healthz` 返回 `ok`。

3. **通过浏览器访问**
   - 在浏览器中访问 `http://服务器IP:8080/`。
   - 在集群列表中选择一个集群和命名空间。
   - 在 Pods 列表中，通过行尾三点菜单打开 **Shell / Logs / Edit / Delete** 等操作；Logs/Shell 会在底部面板中以多标签形式展示。

---

## 后续规划

- 支持 JWT/OIDC 与集群级访问控制。
- 集成监控（Prometheus/Metrics Server）与告警视图。

