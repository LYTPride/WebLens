# WebLens

WebLens 是一个面向 Kubernetes 运维场景的 Web 控制台。它通过浏览器提供多集群资源查看、Pod 排障与基础运维能力，后端作为 Kubernetes API Proxy 统一处理请求。

## 核心功能

- 多集群接入与组合切换（cluster + namespace preset）
- **Pods** 列表（状态标签、列宽拖拽；**点击 Name** 打开右侧 Describe；Shell/Logs/编辑等）
- **Deployments** 列表（可调列宽、Conditions；**点击 Name** 打开结构化 Describe 侧栏；Scale / Restart / Edit YAML / Delete；与 Pods 作用域缓存一致）
- **YAML 编辑**（Pod / Deployment 共用）：**Monaco Editor**，编辑器内 **Sticky Scroll**（缩进模型，冻结真实源码行 + 行号 + token 色）、内置 minimap / 折叠；搜索与保存流程不变
- 其他 Workloads / Config / Network / Cluster 资源浏览
- Pod 状态标签（健康/关注/警告/严重）与全局风险提示
- Pod Logs（流式跟随、历史上翻、下载）
- Pod Shell（WebSocket exec，支持重连）
- Shell 右侧文件管理面板（**单条地址栏** 面包屑/路径输入、目录浏览、上传、下载、删除、重命名、新建目录；默认可调宽度）

## 快速开始

### 1) 后端启动

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

YAML 编辑使用 **Monaco Editor**；入口已配置 **本地包加载**（`monaco/monacoInit.ts` + `loader.config`），无需外网 CDN 即可打开 Edit 标签页。若曾出现编辑页一直 **Loading...**，请确认已使用当前版本前端并重新 `npm install` / `npm run build`。

### 3) 浏览器访问

- 健康检查：`http://<host>:8080/healthz`
- 控制台首页：`http://<host>:8080/`

## 文档导航

详细文档已拆分到 `doc/` 目录：

- 文档二级首页：`doc/README.md`
- 用户手册：`doc/guide/`
  - `doc/guide/pods.md`
  - `doc/guide/deployments.md`
  - `doc/guide/shell.md`
  - `doc/guide/file-manager.md`
- 开发文档：`doc/dev/`
  - `doc/dev/architecture.md`
  - `doc/dev/health-label-model.md`
  - `doc/dev/shell-implementation.md`
  - `doc/dev/file-manager-design.md`
  - `doc/dev/changelog.md`
- 规划路线：`doc/roadmap.md`

后续新增功能建议按同样结构补充：用户视角写入 `doc/guide/`，实现原理写入 `doc/dev/`。

## 技术栈

- Backend: Go, Gin, client-go
- Frontend: React, TypeScript, Vite, Monaco Editor（YAML 编辑）
- Protocols: HTTP API, WebSocket (exec), streaming logs/watch

## License

暂未指定（建议补充 `LICENSE` 文件后在此处更新）。

