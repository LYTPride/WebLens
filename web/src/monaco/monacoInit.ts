/**
 * 必须在任何 Monaco / @monaco-editor/react 渲染之前执行：
 * 1. 注册 Worker（Vite ?worker）
 * 2. 让 @monaco-editor/react 使用本地 npm 包，避免默认走 CDN 导致长期卡在 Loading
 */
import "./yamlMonacoEnv";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

loader.config({ monaco });
