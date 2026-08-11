// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DES-014 timezone picker: a search-narrowed combobox over the
 * runtime's IANA zone list. Typing filters; Arrow keys walk the list;
 * Enter commits; Escape reverts. Hand-rolled on the WAI-ARIA combobox
 * pattern — shadcn's combobox would bring cmdk, a dependency DES-004
 * doesn't admit, and Radix has no combobox primitive.
 *
 * With `allowBrowserDefault` the list leads with "Use browser timezone"
 * (DES-014's null override — the default most users never change); the
 * org-defaults variant omits it, since org_settings always holds a zone.
 */

import { useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { cn } from "../lib/utils";

/** IANA zones with their current GMT offsets, mock-style labels. */
export function timezoneOptions(): { zone: string; label: string }[] {
  const zones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]);
  const now = new Date();
  return [...zones]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => {
      const offset = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(now)
        .find((part) => part.type === "timeZoneName")?.value;
      return { zone, label: offset && offset !== "GMT" ? `${zone} (${offset})` : zone };
    });
}

/** The null sentinel rides the option list as a zone of "". */
const BROWSER_DEFAULT = "";

export function TimezonePicker({
  id,
  value,
  onCommit,
  allowBrowserDefault = false,
  className,
}: Readonly<{
  id: string;
  /** The committed zone; null = use the browser's (with `allowBrowserDefault`). */
  value: string | null;
  onCommit: (zone: string | null) => void;
  allowBrowserDefault?: boolean;
  className?: string;
}>) {
  const intl = useIntl();
  const zones = useMemo(timezoneOptions, []);
  const browserDefaultLabel = intl.formatMessage({
    id: "timezone.browserDefault",
    defaultMessage: "Use browser timezone",
  });
  const options = useMemo(
    () =>
      allowBrowserDefault
        ? [{ zone: BROWSER_DEFAULT, label: browserDefaultLabel }, ...zones]
        : zones,
    [allowBrowserDefault, browserDefaultLabel, zones],
  );

  const displayValue = value ?? (allowBrowserDefault ? browserDefaultLabel : "");
  const [editing, setEditing] = useState<{ query: string; activeIndex: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    if (!editing) return options;
    const query = editing.query.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [editing, options]);

  const activeIndex = editing ? Math.min(editing.activeIndex, filtered.length - 1) : -1;
  const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const optionId = (zone: string) => `${listboxId}-${zone.replace(/\W/g, "-") || "browser"}`;

  function commit(zone: string) {
    setEditing(null);
    const next = zone === BROWSER_DEFAULT ? null : zone;
    if (next !== value) onCommit(next);
    inputRef.current?.blur();
  }

  return (
    <div className={cn("relative w-80 max-w-full", className)}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={editing !== null}
        aria-controls={listboxId}
        aria-activedescendant={activeOption ? optionId(activeOption.zone) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder={intl.formatMessage({
          id: "timezone.searchPlaceholder",
          defaultMessage: "Search timezones",
        })}
        className="h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
        value={editing ? editing.query : displayValue}
        onFocus={() => setEditing({ query: "", activeIndex: 0 })}
        onChange={(event) => setEditing({ query: event.target.value, activeIndex: 0 })}
        // Focus loss reverts to the committed value (DES-017); options
        // select on pointerdown, ahead of the blur.
        onBlur={() => setEditing(null)}
        onKeyDown={(event) => {
          if (!editing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const delta = event.key === "ArrowDown" ? 1 : -1;
            const count = filtered.length;
            if (count === 0) return;
            setEditing({
              query: editing.query,
              activeIndex: (activeIndex + delta + count) % count,
            });
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (activeOption) commit(activeOption.zone);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(null);
            inputRef.current?.blur();
          }
        }}
      />
      <ul // NOSONAR — a select/datalist cannot search-narrow (DES-014)
        id={listboxId}
        role="listbox"
        aria-label={intl.formatMessage({ id: "timezone.listLabel", defaultMessage: "Timezones" })}
        className={cn(
          "absolute top-full z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-border-default bg-raised py-1",
          editing === null && "hidden",
        )}
      >
        {filtered.map((option, index) => (
          <li
            key={option.zone || "browser-default"}
            id={optionId(option.zone)}
            role="option"
            aria-selected={(value ?? BROWSER_DEFAULT) === option.zone}
            className={cn(
              "cursor-default px-2 py-1 text-sm text-primary",
              index === activeIndex && "bg-control",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              commit(option.zone);
            }}
            onMouseMove={() => {
              if (editing && activeIndex !== index) {
                setEditing({ query: editing.query, activeIndex: index });
              }
            }}
          >
            {option.label}
          </li>
        ))}
        {/* A disabled option, not role="presentation": non-option children
            of a listbox are not reliably exposed, so a query with zero
            results would read as silence to assistive technology. */}
        {filtered.length === 0 && (
          <li
            className="px-2 py-1 text-sm text-muted"
            role="option"
            aria-disabled="true"
            aria-selected={false}
          >
            {intl.formatMessage({
              id: "timezone.noMatches",
              defaultMessage: "No matching timezones.",
            })}
          </li>
        )}
      </ul>
    </div>
  );
}
