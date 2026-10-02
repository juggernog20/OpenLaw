// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Matter field on the Obligation dialog. It is a combobox over the
 * Matters the dialog already holds, because a native select of every
 * reached Matter grows with the Legal Team's work and cannot search.
 *
 * It follows the Link contract picker's keyboard rules: typing filters
 * by reference or title, Arrow keys walk the list, Enter picks, and
 * Escape closes only the list. None clears the link. Leaving the box
 * without a pick keeps the value it had.
 */
import { useEffect, useId, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { cn } from "../../lib/utils";

export interface MatterChoice {
  id: string;
  label: string;
}

export function ObligationMatterInput({
  id,
  value,
  choices,
  noneLabel,
  onChange,
  onListOpenChange,
}: Readonly<{
  id: string;
  /** The picked Matter id, or "" for no Matter. */
  value: string;
  /** Every Matter the field can show, the kept link included. */
  choices: readonly MatterChoice[];
  noneLabel: string;
  onChange: (matterId: string) => void;
  /** Fires when the list opens or closes. The dialog needs it to leave
   * Escape to the list. Must be stable across renders. */
  onListOpenChange: (open: boolean) => void;
}>) {
  const intl = useIntl();
  const listboxId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  /** What the person typed, or null while they have not typed. */
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const term = (query ?? "").trim().toLocaleLowerCase();
  const options: MatterChoice[] = term
    ? choices.filter((choice) => choice.label.toLocaleLowerCase().includes(term))
    : [{ id: "", label: noneLabel }, ...choices];
  const picked = choices.find((choice) => choice.id === value);
  const active = Math.min(activeIndex, Math.max(options.length - 1, 0));
  const rowId = (index: number) => `${listboxId}-row-${index}`;

  useEffect(() => {
    onListOpenChange(open);
  }, [open, onListOpenChange]);

  useEffect(() => {
    if (!open || options.length === 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, options.length, active]);

  function show() {
    setOpen(true);
    setActiveIndex(
      Math.max(
        options.findIndex((option) => option.id === value),
        0,
      ),
    );
  }

  function close() {
    setOpen(false);
    setQuery(null);
  }

  function commit(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    close();
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && options.length > 0 ? rowId(active) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className={cn(CONTROL_CLASS, "px-2.5")}
        placeholder={noneLabel}
        value={query ?? picked?.label ?? ""}
        onFocus={(event) => {
          event.currentTarget.select();
          show();
        }}
        onClick={() => {
          if (!open) show();
        }}
        // Options commit on pointerdown, ahead of this blur.
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              show();
              return;
            }
            if (options.length === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((active + delta + options.length) % options.length);
            return;
          }
          if (event.key === "Enter") {
            // Picking a Matter and saving the Obligation are two acts.
            if (open && options.length > 0) {
              event.preventDefault();
              commit(active);
            }
            return;
          }
          if (event.key === "Escape" && open) {
            // DES-010: Escape closes the innermost thing, which is the list.
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={intl.formatMessage({
          id: "entities.record.obligations.matterMatches",
          defaultMessage: "Matter matches",
        })}
        hidden={!open}
        className="absolute top-full z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-card border border-border-default bg-raised py-1 shadow-md"
      >
        {options.map((option, index) => (
          <li
            key={option.id || "none"}
            id={rowId(index)}
            role="option"
            aria-selected={index === active}
            className={cn(
              "cursor-default truncate px-3 py-1.5 text-sm text-primary",
              index === active && "bg-control",
              option.id === "" && "text-muted",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              commit(index);
            }}
            onMouseMove={() => setActiveIndex(index)}
          >
            {option.label}
          </li>
        ))}
        {/* A disabled option, so assistive technology reads the empty answer. */}
        {options.length === 0 && (
          <li
            role="option"
            aria-disabled="true"
            aria-selected={false}
            className="px-3 py-1.5 text-sm text-muted"
          >
            <FormattedMessage
              id="entities.record.obligations.matterNoMatch"
              defaultMessage="No matching Matters"
            />
          </li>
        )}
      </ul>
    </div>
  );
}
