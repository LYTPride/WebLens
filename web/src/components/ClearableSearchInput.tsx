import React, { forwardRef, useCallback, useRef } from "react";
import { mergeRefs } from "../utils/mergeRefs";

/**
 * 带右侧「清空」按钮的关键字搜索/过滤输入框。
 * 有内容时显示叉按钮；清空后立即更新受控值并 focus 回输入框。
 * 支持 ref 转发到原生 input，便于下拉打开时统一自动聚焦（见 useFocusInputWhenOpen）。
 */
export type ClearableSearchInputProps = {
  value: string;
  /** 受控更新：传入新的完整字符串（含清空为 ""） */
  onChange: (nextValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 外层容器：宽度、minWidth、margin 等 */
  style?: React.CSSProperties;
  /** 仅作用于原生 input */
  inputStyle?: React.CSSProperties;
  /** 默认 true；可关闭清空能力 */
  clearable?: boolean;
  titleClear?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
  className?: string;
};

export const ClearableSearchInput = forwardRef<HTMLInputElement, ClearableSearchInputProps>(
  function ClearableSearchInput(
    {
      value,
      onChange,
      placeholder,
      disabled,
      style,
      inputStyle,
      clearable = true,
      titleClear = "清空",
      id,
      name,
      autoComplete = "off",
      className,
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLInputElement>(null);
    const setInputRef = useCallback(
      (el: HTMLInputElement | null) => {
        innerRef.current = el;
        mergeRefs(forwardedRef)(el);
      },
      [forwardedRef],
    );

    const hasValue = value.length > 0;
    const showClear = clearable && hasValue && !disabled;

    const handleClear = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange("");
      queueMicrotask(() => {
        innerRef.current?.focus();
      });
    };

    return (
      <div
        className={className}
        style={{
          position: "relative",
          display: "inline-block",
          verticalAlign: "middle",
          maxWidth: "100%",
          ...style,
        }}
      >
        <input
          ref={setInputRef}
          id={id}
          name={name}
          type="text"
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            boxSizing: "border-box",
            ...inputStyle,
            ...(showClear ? { paddingRight: 28 } : {}),
          }}
        />
        {showClear && (
          <button
            type="button"
            className="wl-clearable-search-clear"
            title={titleClear}
            aria-label={titleClear}
            onClick={handleClear}
            tabIndex={-1}
          >
            ×
          </button>
        )}
      </div>
    );
  },
);
