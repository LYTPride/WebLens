# 全局下拉 Portal 与次级展开表格

本文记录前端 **轻量菜单 / 可搜索下拉** 的统一挂载与定位方案，以及 **资源列表行内次级子表** 的列宽与布局约定，便于后续扩展同类 UI 时复用同一套能力。

## 一、下拉与 Portal（Dropdown / Searchable panel）

### 目标

- 菜单挂载到 **`document.body`**，避免被父级 `overflow` 裁切。
- 统一定位（向下优先、空间不足向上翻折、左右贴边避让、`maxHeight` + 内部滚动）。
- 统一 **z-index**（高于底栏与 sticky 表头，低于确认框与 Toast）。
- 统一关闭：**点击遮罩**、**Esc**、再次点击 trigger、菜单项内自行 `onClose`。
- **仅打开时挂载**：由父组件 **`{open && <DropdownMenuPortal … />}`** 条件渲染，避免列表每行常驻隐藏 Portal。

### 代码地图

| 职责 | 位置 |
|------|------|
| z-index 常量 | `web/src/constants/zLayers.ts`（`Z_INDEX.dropdownBackdrop` / `dropdownSurface` 等） |
| Body Portal | `web/src/components/portal/WlPortal.tsx` |
| 菜单/面板视觉容器 | `web/src/components/portal/WlDropdownSurface.tsx` |
| 定位计算 | `web/src/utils/dropdownPosition.ts` → `computeDropdownPosition` |
| 测量与 resize/scroll 订阅 | `web/src/hooks/useFloatingDropdownPosition.ts` |
| Esc 关闭 | `web/src/hooks/useEscapeToClose.ts` |
| 轻量菜单 | `web/src/components/DropdownMenuPortal.tsx`（props：`surfaceStyle` / `surfaceClassName` / `repositionKey`） |
| 可搜索大面板 | `web/src/components/SearchableDropdownPanelPortal.tsx` |
| 全局样式（与历史 class 并存） | `web/src/global.css`（`.wl-dropdown-surface--menu`、`.wl-searchable-dropdown-panel` 等） |

### 接入约定

- **不要**再给 `DropdownMenuPortal` 传 `open`；打开状态完全由「是否渲染组件」表达。
- 子菜单或内容高度变化时传 **`repositionKey`**（如子菜单展开状态、搜索关键字、过滤结果长度），以触发重新测量。
- 可搜索面板默认以 **320px** 为高度上限；视口可用空间更小时使用定位结果给出的更小高度。面板外层保持 `overflow: hidden`，搜索区固定在顶部，选项列表承担垂直滚动，禁止让全部选项把 Portal 撑满页面。
- 定位完成后的自动聚焦只依赖 `layout != null` 的布尔跃迁，不要依赖完整 `layout` 对象。定位 hook 的第二帧测量会产生新对象；若聚焦 effect 依赖该对象，后续更新可能在 focus 执行前清理定时任务，导致搜索框无法自动获得焦点。
- 可搜索面板的列表区必须由内部滚动容器承载：滚动区使用 `overflow-y: auto`、`overflow-x: hidden`、`overscroll-behavior: contain` 与稳定 scrollbar gutter；面板内部滚动不会触发 `useFloatingDropdownPosition` 重新测量，避免 kubeconfig 列表较多时滚轮滚动导致菜单重绘、滚动条消失或无法继续滚动。
- 下拉表面会阻止 `wheel` 事件继续冒泡到外层遮罩/弹窗；不要在业务页额外全局拦截滚轮，避免破坏下拉内部滚动。
- 列表 **sticky 表头** 的 z-index 与 `Z_INDEX.stickyTableHead` 对齐：`web/src/components/ResizableTh.tsx`。

## 二、次级展开表格（Secondary expand rows）

### 背景

Ingress 规则子表、StatefulSet 展开 Pod 子表、Services 展开区的 Ports / Endpoints 子表，在 **窄视口** 下若缺少与表头一致的列宽模型，容易出现 **内容视觉上串列**。主列表已使用 `useResourceListColumnResize` + `ResizableTh`；次级表单独使用 **另一组 column keys 与 hook 实例**，避免与主表列宽互相覆盖。

### 代码地图

| 职责 | 位置 |
|------|------|
| 子表壳（colgroup + 可拖拽表头 + 横向滚动容器） | `web/src/components/SecondaryExpandTable.tsx` |
| 列 key / 默认宽度 / 表头文案 | `web/src/resourceList/secondaryExpandTableConfig.ts` |
| 列宽状态（与主表相同的 hook） | `useResourceListColumnResize`（Ingress / STS 在 `App.tsx`；Services 在 `ServicesListTable.tsx`） |
| 单元格换行与防溢出 | `secondaryExpandDataCellStyle`、`secondaryExpandBreakAllCellStyle`、`secondaryExpandActionsCellStyle`（同文件导出） |

### 布局要点

- 子表 **`table-layout: fixed`**，且 **`colgroup` 列宽与 `ResizableTh` 宽度一致**。
- 数据单元格使用 **`maxWidth: 0` + `overflow: hidden` + `word-break` / `overflow-wrap`**，保证长文本在 **本列内换行**，行高随内容增高。
- 外层 **`overflow-x: auto`**：总宽超过展开格时仅在子表区域横向滚动，避免撑乱整页布局。
- 含 **Portal 菜单或联动 Chip** 的列使用 `secondaryExpandActionsCellStyle`，避免裁切弹出层。

### 已接入的子表类型

- **Ingress**：规则排障行（`App.tsx`）。
- **StatefulSets**：实例 Pod 子表（`App.tsx`）。
- **Services**：Ports 子表、Endpoints 子表（`ServicesListTable.tsx`）。

## 三、相关用户说明

- 列表主表与次级展开子表均可 **拖拽表头右缘** 调整列宽；子表列宽在 **当前会话** 内各自记忆（未持久化到 localStorage）。
- 用户向导读：`doc/guide/resource-lists.md`（次级展开与列宽）、`doc/guide/ingress-services.md`（Ingress / Service 展开区）。
