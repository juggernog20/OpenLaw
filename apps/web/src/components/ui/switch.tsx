// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A toggle switch (the Tog control of settings.pen): a 36×20 pill whose
 * knob slides right when on. Native button semantics carry the state
 * through role="switch" + aria-checked, so it reads and keyboards like
 * a checkbox without pretending to be one visually.
 */

import { cn } from "../../lib/utils";

export function Switch(
  props: Readonly<{
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    /** Accessible name; the visible label usually sits beside the control. */
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
  }>,
) {
  const { checked, onCheckedChange, disabled, ...aria } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-60",
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
