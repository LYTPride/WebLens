import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type WlPortalProps = {
  children: ReactNode;
};

/**
 * 统一挂到 document.body，脱离主内容 overflow / 层叠上下文裁切。
 * 仅承载节点，不含定位；与 Floating 类组件组合使用。
 */
export function WlPortal({ children }: WlPortalProps) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(children, document.body);
}
