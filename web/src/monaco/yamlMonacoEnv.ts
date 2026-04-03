/**
 * Vite + Monaco：在首屏加载 monaco 之前注册 Worker 工厂（必须最先执行）。
 */
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

const g = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: (_workerId: string, _label: string) => Worker };
};

g.MonacoEnvironment = {
  getWorker(_workerId: string, _label: string) {
    return new EditorWorker();
  },
};
