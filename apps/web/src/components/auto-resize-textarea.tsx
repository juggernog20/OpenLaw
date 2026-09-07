// SPDX-License-Identifier: AGPL-3.0-only

/** Fits multiline form fields to their contents (DECISIONS-DESIGN.md UX review addenda). */

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { TEXTAREA_CLASS } from "../lib/form-controls";
import { cn } from "../lib/utils";

function fitContents(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  const border = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + border}px`;
}

export function AutoResizeTextarea({
  className,
  value,
  onInput,
  ...props
}: ComponentPropsWithoutRef<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) fitContents(ref.current);
  }, [value]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fitContents(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      onInput={(event) => {
        fitContents(event.currentTarget);
        onInput?.(event);
      }}
      className={cn(TEXTAREA_CLASS, "resize-none overflow-hidden", className)}
    />
  );
}
