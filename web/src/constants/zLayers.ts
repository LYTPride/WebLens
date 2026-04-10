/**
 * WebLens 全局 z-index 约定（避免魔法数分散）。
 * 关系：底栏 < 下拉 < 部分业务模态 < 确认框 < Toast < Shell 全屏层
 */
export const Z_INDEX = {
  /** 主内容、侧栏等 */
  base: 1,
  /** 顶栏 */
  appHeader: 2,
  /** 列表 sticky 表头（见 global.css th.wl-table-sticky-head） */
  stickyTableHead: 3,
  /** 底部 Shell/Logs 面板 */
  bottomPanel: 100,
  /** 下拉 / 可搜索面板：透明点击遮罩 */
  dropdownBackdrop: 150,
  /** 下拉 / 可搜索面板：实际面板 */
  dropdownSurface: 160,
  /** 例如 Deployment Scale 等中等模态 */
  modalMid: 180,
  /** ConfirmDialog / InputDialog 默认 */
  modal: 185,
  /** 顶部 Toast */
  toast: 200,
  /** Pod Shell 全屏等 */
  podShell: 1000,
} as const;
