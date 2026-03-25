import React, { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

const FONT =
  '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export type YamlMonacoEditorHandle = {
  focus: () => void;
  /** 按 UTF-16 偏移选中并滚到视区中部（与原先 textarea 搜索行为一致） */
  selectRangeByOffset: (start: number, end: number) => void;
};

export type YamlMonacoEditorProps = {
  value: string;
  onChange: (next: string) => void;
};

const THEME_ID = "weblens-yaml-dark";

const beforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME_ID, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "tag.yaml", foreground: "5eead4" },
      { token: "string.yaml", foreground: "93c5fd" },
      { token: "number.yaml", foreground: "fde047" },
      { token: "keyword.yaml", foreground: "c4b5fd" },
      { token: "comment.yaml", foreground: "64748b" },
      { token: "delimiter.yaml", foreground: "94a3b8" },
    ],
    colors: {
      "editor.background": "#020617",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#64748b",
      "editorLineNumber.activeForeground": "#cbd5e1",
      "editorIndentGuide.background": "#1e293b",
      "editorIndentGuide.activeBackground": "#475569",
      "editorGutter.background": "#0f172a",
      "minimap.background": "#020617",
      "scrollbarSlider.background": "#33415588",
      "scrollbarSlider.hoverBackground": "#475569aa",
      "editorStickyScroll.background": "#0c1220",
      "editorStickyScroll.border": "#1e293b",
      "editorStickyScroll.shadow": "#00000066",
    },
  });
};

/**
 * 统一 YAML 编辑：Monaco + 原生 sticky scroll（indentation 模型）+ 内置行号与 minimap。
 * Pod / Deployment 等均通过此组件复用。
 */
export const YamlMonacoEditor = forwardRef<YamlMonacoEditorHandle, YamlMonacoEditorProps>(
  function YamlMonacoEditor({ value, onChange }, ref) {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

    const selectRangeByOffset = useCallback((start: number, end: number) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const len = model.getValueLength();
      const s = Math.min(Math.max(0, start), len);
      const e = Math.min(Math.max(0, end), len);
      const startPos = model.getPositionAt(s);
      const endPos = model.getPositionAt(Math.max(s, e));
      const range = {
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column,
      };
      editor.setSelection(range);
      editor.revealRangeInCenter({
        startLineNumber: range.startLineNumber,
        startColumn: range.startColumn,
        endLineNumber: range.endLineNumber,
        endColumn: range.endColumn,
      });
      editor.focus();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          editorRef.current?.focus();
        },
        selectRangeByOffset,
      }),
      [selectRangeByOffset],
    );

    const onMount: OnMount = useCallback((editor, monaco) => {
      editorRef.current = editor;
      monaco.editor.setTheme(THEME_ID);
    }, []);

    return (
      <Editor
        height="100%"
        width="100%"
        defaultLanguage="yaml"
        theme={THEME_ID}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        beforeMount={beforeMount}
        onMount={onMount}
        options={{
          fontSize: 12,
          lineHeight: 18,
          fontFamily: FONT,
          fontLigatures: true,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: "on",
          minimap: {
            enabled: true,
            side: "right",
            scale: 1,
            showSlider: "mouseover",
            maxColumn: 100,
          },
          lineNumbers: "on",
          lineNumbersMinChars: 4,
          glyphMargin: false,
          folding: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          padding: { top: 8, bottom: 8 },
          guides: { indentation: true },
          stickyScroll: {
            enabled: true,
            defaultModel: "indentationModel",
            maxLineCount: 12,
          },
          smoothScrolling: true,
          cursorBlinking: "smooth",
          automaticLayout: true,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
    );
  },
);
