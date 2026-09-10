// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage } from "react-intl";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface ProgressionStep {
  id: string;
  label: string;
  className: string;
}

export interface ProgressionMove {
  statusId: string;
  label: string;
  busy: boolean;
  grouped?: boolean;
  labelForGroup?: (group: string) => string;
  statuses: readonly { id: string; label: string; detail: string; groupId?: string }[];
  onPick: (statusId: string) => void;
}

/** Radix opens the menu with focus on the menu itself, never on a row, so nothing
 * brings the saved status into view once the list scrolls. Reveal it after placement. */
function revealCheckedStatus(content: HTMLDivElement | null) {
  if (!content) return;
  const frame = requestAnimationFrame(() => {
    if (!content.isConnected) return;
    content
      .querySelector<HTMLElement>('[role="menuitemradio"][data-state="checked"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  return () => cancelAnimationFrame(frame);
}

/** Shared status strip. Earlier checks show position, not completed work. */
export function StatusProgression({
  steps,
  currentId,
  label,
  move,
  className,
}: Readonly<{
  steps: readonly ProgressionStep[];
  currentId: string;
  label: string;
  move?: ProgressionMove;
  className?: string;
}>) {
  const position = steps.findIndex((step) => step.id === currentId);
  return (
    <ol
      aria-label={label}
      tabIndex={0}
      className={cn(
        "flex min-w-0 max-w-full grow basis-0 items-center gap-1.5 overflow-x-auto rounded-card",
        "border border-border-default bg-control px-3 py-1.5",
        "@5xl/shell:grow-0 @5xl/shell:basis-auto @5xl/shell:shrink-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
        className,
      )}
    >
      {steps.map((step, index) => {
        const current = index === position;
        const options =
          move?.statuses.filter((option) => !move.grouped || option.groupId === step.id) ?? [];
        const behind = position >= 0 && index < position;
        return (
          <li
            key={step.id}
            aria-current={current ? "step" : undefined}
            className="flex shrink-0 items-center gap-1.5"
          >
            {index > 0 && (
              <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-border-default" />
            )}
            {move && (current || move.grouped) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={move.busy || options.length === 0}
                    aria-label={move.labelForGroup?.(step.id) ?? move.label}
                    className={cn(
                      "flex min-h-6 items-center gap-1 rounded-pill border border-border-default px-2",
                      "text-xs font-medium transition-[filter] duration-150",
                      "hover:brightness-95 active:brightness-90",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
                      "disabled:pointer-events-none disabled:opacity-50",
                      current ? step.className : "border-transparent bg-transparent text-muted",
                    )}
                  >
                    {behind && (
                      <Check size={12} aria-hidden="true" className="text-status-success-fg" />
                    )}
                    {step.label}
                    <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  collisionPadding={8}
                  className="max-h-(--radix-dropdown-menu-content-available-height) max-w-80 overflow-y-auto overscroll-contain"
                  ref={revealCheckedStatus}
                >
                  <DropdownMenuLabel className="text-xs text-muted">
                    <FormattedMessage id="contracts.stage.moveTo" defaultMessage="Move to" />
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={move.statusId}
                    onValueChange={(id) => {
                      if (!move.busy && id !== move.statusId) move.onPick(id);
                    }}
                  >
                    {options.map((option) => (
                      <DropdownMenuRadioItem key={option.id} value={option.id} className="gap-3">
                        <span className="truncate">{option.label}</span>
                        {!move.grouped && (
                          <span className="ms-auto shrink-0 text-xs text-muted">
                            {option.detail}
                          </span>
                        )}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : current ? (
              <span className={cn("rounded-pill px-2 py-0.5 text-xs font-medium", step.className)}>
                {step.label}
              </span>
            ) : (
              <span
                className={cn(
                  "flex items-center gap-1 text-xs",
                  behind ? "text-primary" : "text-muted",
                )}
              >
                {behind && (
                  <Check size={12} aria-hidden="true" className="shrink-0 text-status-success-fg" />
                )}
                {step.label}
                {behind && (
                  <>
                    {" "}
                    <span className="sr-only">
                      <FormattedMessage id="contracts.stage.done" defaultMessage="done" />
                    </span>
                  </>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
