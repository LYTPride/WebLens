# Ingress 与 Services 使用说明

本文说明 WebLens 中 **Ingress**、**Services** 资源页的列表、行展开、Describe 面板，以及 **跨资源联动**（跳转到 Services / Pods / Ingress）与 **名称展示** 的交互约定。

## 列表与展开

- **Ingress**：列表支持按当前命名空间加载；行可展开查看规则级诊断行（Host、Path、Backend Service、状态、异常说明等），与 Describe 中 Rules 表使用同一套排障模型（见 `ingressTroubleshoot`）。展开后的 **规则子表** 支持 **表头拖拽调列宽**，窄屏下子表可横向滚动，单元格内长文本换行展示。
- **Services**：列表支持排序、列宽、行展开；展开区展示端口子表与 **Endpoints / 关联后端** 子表（IP、Ready、Pod、Node、说明、联动等）。两张子表均支持 **表头拖拽调列宽**，布局规则见 [资源列表](./resource-lists.md)「表头列宽（主表与行内展开子表）」。

## Describe 面板

- **Ingress Describe**：基本信息、规则摘要、**Rules**（诊断表或静态规则表）、TLS、Default Backend、后端状态摘要、Events。
- **Service Describe**：基本信息、Ports、Selector、**Endpoints**、**关联资源**（匹配 Pods、引用本 Service 的 Ingress）、Events。

## 资源名称 vs 联动入口（职责分离）

为在长名称下仍可区分后缀、避免「整块可点」与右侧联动重复：

- **资源全名**（Backend Service、Pod、Ingress 名等）以 **普通文本** 展示，支持在单元格内 **换行**（`word-break` / `overflow-wrap`），**点击名称不会跳转**。
- 名称旁提供 **复制** 按钮（与 Pods / Deployments 列表 Name 列同款图标行为），用于复制完整名称。
- **联动** 由独立的轻量胶囊按钮完成（文案如 **Services**、**Pods**、**Ingress**），样式类 `.wl-resource-jump`，宽度随文案收缩，**不撑满整列**。

前端复用组件：

- **`ResourceNameWithCopy`**（`web/src/components/ResourceNameWithCopy.tsx`）：名称 + 复制。
- **`ResourceJumpChip`**（`web/src/components/ResourceJumpChip.tsx`）：短标签跳转；`compact` 用于表格联动列。

样式见 `web/src/global.css`：`.wl-resource-name-with-copy*`、`.wl-resource-jump*`。

## 联动行为（与实现位置）

- Ingress 展开 / Describe：**Services** 打开 Services 列表并过滤对应 Service 名；**Pods** 打开 Pods 列表并按 Service 名提示过滤（逻辑在 `App.tsx` 中 `jumpIngressToServices` / `jumpIngressToPods`）。
- Services 展开 / Describe Endpoints：**Pods** 打开 Pods 列表并过滤 Pod 名（`jumpToPods` / `jumpServiceToPods`）。
- Service Describe 中引用 Ingress：**Ingress** 打开 Ingress 列表并过滤（`jumpServiceToIngress`）。

具体 API 与数据结构见后端 `ingress_ops.go`、`service_ops.go` 与前端 `api.ts`。

## 相关文档

- [资源列表：筛选、排序与实时更新](./resource-lists.md)
- [开发变更记录](../dev/changelog.md)（Ingress / Services 与 UI 组件条目）
