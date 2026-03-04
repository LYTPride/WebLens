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
  - 支持前端“刷新”按钮重新从后端获取最新集群列表。

- **基础资源浏览（部分对标 Freelens 左侧菜单）**
  - 后端提供以下接口，基于当前选中集群：
    - `GET /api/clusters/:id/namespaces`：Namespaces 列表
    - `GET /api/clusters/:id/nodes`：Nodes 列表
    - `GET /api/clusters/:id/pods`：Pods 列表（可通过 `namespace` 查询参数过滤）
    - `GET /api/clusters/:id/deployments`：Deployments 列表（可通过 `namespace` 查询参数过滤）
  - 前端当前版本已实现：
    - 集群列表选择
    - 选中集群后的 **Pods 列表**（所有命名空间）：Name / Namespace / Node / Status / Restarts 等基础字段。

- **Pod 日志查看**
  - 接口：`GET /api/clusters/:id/pods/:namespace/:pod/logs`
    - 支持查询参数：
      - `container`：容器名（可选）
      - `tailLines`：返回尾部若干行（可选）
      - `follow`：是否跟随日志流（`true`/`false`）
  - 行为：
    - `follow=false`：一次性返回文本日志。
    - `follow=true`：后端使用 chunked 传输流式输出日志行，便于前端实现实时跟随。
  - 前端当前版本：
    - 在 Pods 列表中点击“日志”按钮，拉取一次性日志并在页面下方以可滚动 `pre` 区域展示。

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

### 规划中/待完成功能

- **更多资源视图（对标 Freelens 左侧菜单）**
  - Deployments / StatefulSets / DaemonSets / Jobs / CronJobs 等前端页面。
  - Nodes / Namespaces / Events 等集群视图。
  - ConfigMaps / Secrets / Services / Ingress 等配置与网络资源视图。
- **Pod Shell（`kubectl exec` WebSocket）**
  - 后端通过 `remotecommand` 建立与 K8s 的 exec 通道。
  - 前端提供浏览器内终端组件（类似 Freelens 的 Shell）。
- **权限与安全**
  - Web 端登录鉴权（如 Basic/JWT/OIDC）。
  - 集群级或用户级访问控制。
- **监控与告警集成**
  - 对接 Metrics Server / Prometheus 展示 CPU、内存等监控图。
  - 对接 Alertmanager 或其他告警系统。

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
      pages/App.tsx # 当前主界面（集群 & Pods & 日志）
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
WEBLENS_KUBECONFIG_DIR=/appdata/soft/weblens/kubeconfigs
WEBLENS_WEB_DIST_DIR=/appdata/soft/weblens/web/dist  # 可选，默认 ./web/dist
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
   - 在集群列表中选择一个集群。
   - 查看 Pods 列表、点击“日志”按钮查看指定 Pod 的应用日志。

---

## 后续规划

- 实现完整的 Freelens 风格侧边栏与多资源视图。
- 实现 Pod Shell（WebSocket + `exec`）。
- 支持用户身份认证与权限控制。
- 集成监控（Prometheus/Metrics Server）与告警视图。

