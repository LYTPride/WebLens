# Pods 使用手册

本文面向 WebLens 使用者，介绍 Pods 列表页的主要能力与常见操作。

## 页面概览

Pods 页面由三部分组成：

- 顶部：集群组合选择（cluster + namespace）与应用按钮
- 中部：Pods 表格（支持按 Name 过滤、列排序与 Watch 实时重排；详见 [资源列表说明](./resource-lists.md)）
- 底部：工作区（Logs / Shell / 编辑等标签）

## 状态标签

Pods 列表新增“状态标签”列，标签值为：

- 健康
- 关注
- 警告
- 严重

标签由后端根据 STATUS / READY / RESTARTS / 卡住时长综合计算。将鼠标悬停在标签上可查看触发原因。

## 全局提示语

当“当前范围（已应用的 cluster + namespace）”内存在任意非“健康” Pod 时，列表标题后会显示红色提示语（文案提示可通过「状态标签」列排序快速定位问题 Pod）。

注意：

- 提示语不受 Name 搜索过滤影响
- 只有当前范围内全部健康时提示语才消失

## Describe

- **点击表格中的 Pod Name**（名称以可点击按钮呈现）可从 **右侧** 打开 Describe 面板：遮罩、可拖拽宽度、刷新与关闭与 Deployments Describe 一致。
- 展示 Pod 基本信息、Labels/Annotations、容器摘要，以及 **Events**（Warning/失败类事件为红底高亮；无事件时显示「暂无 Events」）。

## YAML 编辑

底部面板中打开 **Edit** 时，与 Deployment 共用 **Monaco Editor**：

- **Sticky Scroll**（Monaco 内置，缩进模型）：冻结区为 **真实 YAML 源码行**，含 **行号** 与 **语法着色**，视觉与正文一体；点击冻结行可跳转到该行（折叠区域由编辑器尽量展开可见）
- 内置 **缩进参考线**、**右侧 minimap**、**折叠**
- 仍支持关键字搜索、Cancel / Save / Save & Close

## 常用操作

每个 Pod 行支持以下操作：

- 复制 Pod 名称（与点击 Name 打开 Describe 互不冲突）
- 打开 Logs
- 打开 Shell
- 打开 YAML 编辑
- 删除 Pod

## 筛选说明

- Name 搜索框只影响表格显示内容
- 不会改变后端范围数据，也不会影响全局异常提示判断

