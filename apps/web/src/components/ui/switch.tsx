// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A toggle switch (the Tog control of settings.pen): a 36×20 pill whose
 * knob slides right when on. Native button semantics carry the state
 * through role="switch" + aria-checked, so it reads and keyboards like
 * a checkbox without pretending to be one visually. The transparent pseudo-element
 * expands the pointer target to 24px without changing the pill (DES-090).
 */

import { cn } from "../../lib/utils";

export function Switch(
  props: Readonly<{
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
    /** Accessible name; the visible label usually sits beside the control. */
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    "aria-disabled"?: boolean;
  }>,
) {
  const { checked, onCheckedChange, disabled, id, ...aria } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      id={id}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full before:absolute before:inset-x-0 before:-inset-y-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
        checked ? "bg-cta-primary" : "bg-control",
      )}
      {...aria}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-raised shadow-sm transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
