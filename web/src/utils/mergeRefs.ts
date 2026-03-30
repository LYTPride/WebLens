import type { MutableRefObject, Ref } from "react";

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined | null>) {
  return (value: T | null) => {
    refs.forEach((ref) => {
      if (ref == null) return;
      if (typeof ref === "function") {
        ref(value);
      } else {
        (ref as MutableRefObject<T | null>).current = value;
      }
    });
  };
}
