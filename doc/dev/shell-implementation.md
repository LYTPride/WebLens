# Shell 实现说明

## 目标

在浏览器内提供接近 `kubectl exec -it` 的交互体验。

## 前端实现

- 组件：`PodShell.tsx`
- 终端：xterm + fit addon
- 输入输出：
  - `term.onData` -> WebSocket send
  - WebSocket message -> `term.write`
- 粘贴行为：
  - 拦截 `Ctrl+V` 防止发送 `^V`
  - 使用浏览器原生粘贴/Clipboard API

## 后端实现

- 路由：`GET /api/clusters/:id/pods/:namespace/:pod/exec`
- 机制：`remotecommand.NewSPDYExecutor`
- 流转发：
  - ws -> stdin pipe
  - stdout/stderr -> ws binary message

## 重连机制

前端提供“重连”按钮：

- 主动关闭当前 ws
- 不销毁 xterm 实例
- 重新建立 ws
- 历史输出保留，新的 prompt 继续附加显示

