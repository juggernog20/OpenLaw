// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { useIntl } from "react-intl";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** Field guidance is available on hover, keyboard focus, and tap. */
export function FieldHelp({
  children,
  labelId,
  descriptionId,
}: Readonly<{ children: ReactNode; labelId: string; descriptionId?: string }>) {
  const id = useId();
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pointerFocus = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const helpId = descriptionId ?? `${id}-description`;

  function cancelClose() {
    clearTimeout(closeTimer.current);
  }
  function leave() {
    clearTimeout(openTimer.current);
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false);
    }, 150);
  }
  useEffect(
    () => () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <>
      {/* Keep descriptions available to controls even while the tooltip is closed. */}
      <span id={helpId} hidden>
        {children}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={intl.formatMessage({
              id: "common.fieldHelp",
              defaultMessage: "More information",
            })}
            aria-describedby={`${labelId} ${helpId}`}
            aria-haspopup={undefined}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-button text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
            onPointerEnter={(event) => {
              if (event.pointerType === "touch") return;
              cancelClose();
              clearTimeout(openTimer.current);
              openTimer.current = setTimeout(() => setOpen(true), 500);
            }}
            onPointerLeave={leave}
            onPointerDown={() => {
              clearTimeout(openTimer.current);
              pointerFocus.current = true;
            }}
            onPointerUp={() => {
              pointerFocus.current = false;
            }}
            onPointerCancel={() => {
              pointerFocus.current = false;
            }}
            onFocus={() => {
              clearTimeout(openTimer.current);
              if (!pointerFocus.current) setOpen(true);
            }}
            onBlur={() => {
              pointerFocus.current = false;
              leave();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                clearTimeout(openTimer.current);
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <CircleHelp aria-hidden="true" className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="tooltip"
          side="top"
          align="start"
          className="max-w-[min(20rem,calc(100vw-2rem))] px-3 py-2 text-sm font-normal whitespace-normal"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={cancelClose}
          onPointerLeave={leave}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </PopoverContent>
      </Popover>
    </>
  );
}
