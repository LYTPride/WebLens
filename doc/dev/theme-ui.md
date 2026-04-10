# 主题与顶栏 / 侧栏 UI（前端）

本文说明 WebLens 前端 **浅色 / 深色** 主题切换、顶栏操作区与左侧导航轨道的实现要点，便于后续迭代时保持一致。

## 主题状态与 token

- **入口**：`web/src/main.tsx` 使用 `ThemeProvider` 包裹应用根节点。
- **上下文**：`web/src/theme/ThemeContext.tsx` 提供 `theme`、`setTheme`、`toggleTheme`；`document.documentElement[data-theme]` 与 React 状态同步。
- **持久化**：`web/src/theme/themeStorage.ts`（localStorage 偏好；未保存时可跟随系统 `prefers-color-scheme`）。
- **样式变量**：`web/src/theme/tokens.css` 在 `[data-theme="dark"]` / `[data-theme="light"]` 下定义 `--wl-*` 语义色；业务组件优先使用变量，避免硬编码十六进制。

## 顶栏右上角

- **形态**：右上角为 **轻量 icon 操作区**（无大块文字按钮区）。
- **主题切换**：`web/src/components/ThemeToggleButton.tsx`，太阳 / 月亮线条 icon，交叉淡入淡出。
- **平台配置**：齿轮 icon，点击弹出与原「平台配置」相同的下拉菜单（逻辑仍在 `App.tsx`）；hover 仅 icon 提亮。

## 左侧导航与把手

- **轨道**：`App.tsx` 中 `.wl-sidebar-rail` 控制展开宽度；导航内容为 `Sidebar`（`edge="rail"` 时由轨道承担右侧分隔线）。
- **把手**：`.wl-sidebar-grip` 为边栏右缘中部局部凸耳，与侧栏同色；收起时仅保留小凸耳，不保留整条竖向控制条。
- **v1 隐藏入口**：`web/src/utils/v1HiddenViews.ts` 中的 `V1_HIDDEN_VIEWS` 用于侧栏过滤与视图回退；当前 **Nodes** 等入口可按需隐藏，**业务逻辑与 API 仍保留**，恢复时从集合中移除即可。

## 受限态卡片

- **组件**：`ResourceAccessDeniedState.tsx` 使用 `--wl-access-denied-card-*` 等 token，深浅主题下均为卡片式说明，而非固定深色面板。

## 相关记录

- 变更流水：`doc/dev/changelog.md` 中「主题系统收敛、导航入口调整与 Shell 主题切换修复」小节。
