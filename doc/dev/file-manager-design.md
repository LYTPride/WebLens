# 文件管理面板设计说明

## 设计目标

在不引入 SFTP 依赖的前提下，提供基于 Pod exec 的轻量文件管理能力，并与当前 Shell 上下文绑定。

## 前端设计

- 组件：`FileManagerPanel.tsx`
- 容器：集成在 `BottomPanel` 的 Shell 标签页右侧
- 状态按 tab 维度隔离：
  - 面板展开状态
  - 面板宽度
  - 当前路径

## 后端接口

- `GET /files` 列目录
- `POST /files/mkdir` 新建目录
- `POST /files/rename` 重命名
- `POST /files/delete` 删除
- `POST /files/upload` 上传
- `GET /files/download` 下载（tar）

## 兼容性原则

所有“需要 Go 解析”的 shell 输出必须遵循：

- 使用 `printf`
- 明确字段分隔符（TAB）
- 明确换行（`\n`）
- 明确 stderr 与退出码

禁止依赖 `echo` 的转义行为，避免在不同镜像 `/bin/sh` 下出现解析为空的问题。

## 错误处理

- 解析失败记录后端日志（含原始行截断信息）
- 前端显示用户可读错误，不静默吞掉
- 手动输入不存在路径时显示固定提示：`路径不存在，请检查`

