# WebLens 架构设计

## 总体结构

WebLens 采用前后端分离 + 同源部署模式：

- 前端：React + TypeScript + Vite
- 后端：Go + Gin + client-go
- 部署：后端同时托管 API 与静态资源，避免跨域问题

## 核心链路

1. 浏览器请求 `window.location.origin/api/...`
2. Gin 路由分发到各业务 handler
3. handler 使用 client-go 访问 Kubernetes API
4. 返回 JSON / stream / websocket 到前端

## 数据刷新模式

- 资源列表以 Watch 为主，List 为初始化/回退
- Logs 使用 follow 流式输出
- Shell 使用 WebSocket + SPDY exec

## 主要模块

- `server/internal/cluster`：kubeconfig 扫描与多集群注册
- `server/internal/httpapi`：API 路由与资源操作
- `web/src/pages/App.tsx`：主页面状态编排
- `web/src/components/*`：底部工作区、表格、日志、Shell 等组件

