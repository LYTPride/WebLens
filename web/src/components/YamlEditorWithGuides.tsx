import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { countLeadingIndentCols, detectYamlIndentUnit } from "../utils/yamlStructure";

const DEFAULT_FONT =
  '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}

export type YamlEditorWithGuidesProps = {
  value: string;
  onChange: (next: string) => void;
  /** 与 PodYamlEditTab 行高一致（fontSize * line-height） */
  lineHeight?: number;
  fontSize?: number;
  fontFamily?: string;
  paddingLeft?: number;
  paddingTop?: number;
  onScroll?: () => void;
};

/**
 * 带缩进参考线的 YAML 编辑区（底层仍为 textarea，与 minimap/搜索等现有能力兼容）。
 * 参考线由 Canvas 按滚动位置绘制；无 Monaco/CodeMirror 依赖。
 */
export const YamlEditorWithGuides = forwardRef<HTMLTextAreaElement, YamlEditorWithGuidesProps>(
  function YamlEditorWithGuides(
    {
      value,
      onChange,
      lineHeight = 18,
      fontSize = 12,
      fontFamily = DEFAULT_FONT,
      paddingLeft = 12,
      paddingTop = 10,
      onScroll,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const charWidthRef = useRef(7.2);
    const rafRef = useRef<number | null>(null);

    const lines = useMemo(() => value.split("\n"), [value]);
    const indentUnit = useMemo(() => detectYamlIndentUnit(lines), [lines]);

    const measureCharWidth = useCallback(() => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.font = `${fontSize}px ${fontFamily}`;
      const w = ctx.measureText("MMMMMMMMMM").width / 10;
      if (w > 2) charWidthRef.current = w;
    }, [fontSize, fontFamily]);

    useLayoutEffect(() => {
      measureCharWidth();
    }, [measureCharWidth]);

    const drawGuides = useCallback(() => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const ta = textareaRef.current;
      if (!canvas || !wrap || !ta) return;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (cw <= 0 || ch <= 0) return;

      canvas.width = Math.floor(cw * dpr);
      canvas.height = Math.floor(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const scrollTop = ta.scrollTop;
      const charW = charWidthRef.current;
      const lh = lineHeight;

      const firstLine = Math.max(0, Math.floor((scrollTop - paddingTop) / lh));
      const lastLine = Math.min(lines.length - 1, Math.ceil((scrollTop + ch - paddingTop) / lh));

      ctx.strokeStyle = "rgba(71, 85, 105, 0.42)";
      ctx.lineWidth = 1;

      for (let i = firstLine; i <= lastLine; i++) {
        const line = lines[i] ?? "";
        const indentCols = countLeadingIndentCols(line);
        if (indentCols === 0) continue;
        const levels = Math.floor(indentCols / indentUnit);
        const y1 = paddingTop + i * lh - scrollTop;
        const y2 = y1 + lh;
        if (y2 < 0 || y1 > ch) continue;

        for (let L = 1; L <= levels; L++) {
          const x = paddingLeft + L * indentUnit * charW - 0.5;
          if (x < paddingLeft || x > cw - 2) continue;
          ctx.beginPath();
          ctx.moveTo(x, Math.max(0, y1));
          ctx.lineTo(x, Math.min(ch, y2));
          ctx.stroke();
        }
      }
    }, [value, lines, indentUnit, lineHeight, paddingLeft, paddingTop]);

    const scheduleDraw = useCallback(() => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        drawGuides();
      });
    }, [drawGuides]);

    useEffect(() => {
      scheduleDraw();
    }, [scheduleDraw, value]);

    useEffect(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const ro = new ResizeObserver(() => scheduleDraw());
      ro.observe(wrap);
      return () => ro.disconnect();
    }, [scheduleDraw]);

    const handleScroll = useCallback(() => {
      onScroll?.();
      scheduleDraw();
    }, [onScroll, scheduleDraw]);

    const setTextareaRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    return (
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          backgroundColor: "#020617",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <textarea
          ref={setTextareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: "100%",
            minHeight: 0,
            boxSizing: "border-box",
            padding: `${paddingTop}px ${paddingLeft}px 10px 12px`,
            border: "none",
            outline: "none",
            backgroundColor: "transparent",
            color: "#e2e8f0",
            caretColor: "#e2e8f0",
            fontSize,
            lineHeight: `${lineHeight}px`,
            fontFamily,
            resize: "none",
          }}
        />
      </div>
    );
  },
);
