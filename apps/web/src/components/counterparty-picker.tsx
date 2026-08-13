// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The counterparty typeahead (CTR-011) — the shared control for naming
 * the other side of a piece of work. The contract record mounts it now;
 * contract intake mounts the same component in M20/M21, which is why it
 * lives here and not inside the record page.
 *
 * It does two things at once, and that is the whole point. It searches
 * the counterparties we already hold, so picking one never leaves a
 * second record behind for the same organization. And it offers to
 * create the name that matched nothing, so a Legal Team Member recording
 * a deal with an organization we have never met does not have to go and
 * register it first — CTR-011's near-zero intake friction. The create
 * row is withheld the moment the search answers with that exact name,
 * and the API refuses a duplicate as well, so the two agree.
 *
 * The control commits a pick; it does not hold a value. The caller
 * decides what a pick means — the record puts the party on the contract
 * — and the input clears itself afterwards, ready for the next one.
 * Tripartite deals are named one party at a time.
 *
 * Hand-rolled on the WAI-ARIA combobox pattern, as the DES-014 timezone
 * picker already is: shadcn's combobox brings cmdk, a dependency DES-004
 * does not admit, and Radix has no combobox primitive. Typing filters,
 * Arrow keys walk the list, Enter commits the active row, Escape closes.
 */

import { useEffect, useId, useState, type Ref } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

/** What one pick means to the caller: an organization we already hold,
 * or a name we do not — exactly the two shapes the API's add route
 * takes, so nothing has to translate between them. */
export type CounterpartyPick = { counterpartyId: string } | { name: string };

/** One search answer, as the shared read gives it. */
interface CounterpartyOption {
  id: string;
  name: string;
  jurisdiction: string | null;
}

/**
 * How long a pause in typing means "search now". Short enough that the
 * list feels like it is keeping up, long enough that typing a name
 * straight through is one request and not fifteen.
 */
const SEARCH_DEBOUNCE_MS = 150;

export function CounterpartyPicker({
  id,
  ref,
  disabled = false,
  exclude = [],
  onPick,
  className,
}: Readonly<{
  id: string;
  /** React 19 passes a function component's ref through props. Callers
   * that move focus by hand — a removed row taking the focus with it —
   * need the input itself. */
  ref?: Ref<HTMLInputElement>;
  disabled?: boolean;
  /** Counterparties already named on this record. They are dropped from
   * the list rather than offered and refused. */
  exclude?: readonly string[];
  /** Fires once per commit. The caller owns the write and the busy
   * state; this control has committed as soon as it calls. */
  onPick: (pick: CounterpartyPick) => void;
  className?: string;
}>) {
  const intl = useIntl();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [matches, setMatches] = useState<CounterpartyOption[]>([]);
  const [searching, setSearching] = useState(false);
  const listboxId = useId();

  const trimmed = query.trim();

  // The search runs only while the list is open, and only after typing
  // pauses. A closed picker is not a reason to ask the server anything.
  useEffect(() => {
    if (!open) {
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void api
        .GET("/api/v1/counterparties", {
          params: { query: { query: trimmed || undefined } },
        })
        .catch(() => ({ data: undefined }))
        .then(({ data }) => {
          // A slower earlier answer must never overwrite a later one.
          if (!live) return;
          setMatches(data?.counterparties ?? []);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, trimmed]);

  /** What the list offers: everything found, less what the record
   * already names. */
  const available = matches.filter((option) => !exclude.includes(option.id));
  /**
   * Whether to offer creating what was typed. The whole search answer
   * is consulted, not just what is offered — an organization we hold
   * and this record already names is still not a new one, so typing its
   * name must not invite a second record for it.
   */
  const canCreate =
    trimmed.length > 0 &&
    !searching &&
    !matches.some((option) => option.name.toLowerCase() === trimmed.toLowerCase());

  const rowCount = available.length + (canCreate ? 1 : 0);
  const active = Math.min(activeIndex, Math.max(rowCount - 1, 0));
  const rowId = (index: number) => `${listboxId}-row-${index}`;

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function commit(index: number) {
    const option = available[index];
    if (option) {
      onPick({ counterpartyId: option.id });
    } else if (canCreate && index === available.length) {
      onPick({ name: trimmed });
    } else {
      return;
    }
    // Cleared and still focused: the next party is typed straight in,
    // which is what a tripartite deal needs (CTR-011).
    setQuery("");
    setActiveIndex(0);
    setMatches([]);
  }

  const createLabel = intl.formatMessage(
    { id: "counterparty.picker.create", defaultMessage: 'Create "{name}"' },
    { name: trimmed },
  );

  return (
    <div className={cn("relative", className)}>
      <input
        ref={ref}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && rowCount > 0 ? rowId(active) : undefined}
        aria-autocomplete="list"
        aria-busy={searching}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={intl.formatMessage({
          id: "counterparty.picker.placeholder",
          defaultMessage: "Find or create a counterparty",
        })}
        className="h-8 w-full rounded-button border border-border-default bg-raised px-2.5 text-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        // Options commit on pointerdown, ahead of this blur.
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (rowCount === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((active + delta + rowCount) % rowCount);
            return;
          }
          if (event.key === "Enter") {
            if (open && rowCount > 0) {
              // A picked row must not also submit the form around it.
              // With nothing to pick, Enter is left alone — an intake
              // form built around this control keeps its submit key.
              event.preventDefault();
              commit(active);
            }
            return;
          }
          if (event.key === "Escape") {
            // Local dismiss, as DES-010 reserves the key for.
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      <ul // NOSONAR — a select cannot search-narrow or create (CTR-011)
        id={listboxId}
        role="listbox"
        // Not "Counterparties": the field around this control is
        // already labelled that, and two things named the same is a
        // reader having to work out which one they landed on.
        aria-label={intl.formatMessage({
          id: "counterparty.picker.listLabel",
          defaultMessage: "Counterparty matches",
        })}
        className={cn(
          "absolute top-full z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-border-default bg-raised py-1",
          !open && "hidden",
        )}
      >
        {available.map((option, index) => (
          <li
            key={option.id}
            id={rowId(index)}
            role="option"
            aria-selected={index === active}
            className={cn(
              "flex cursor-default items-center justify-between gap-2 px-2 py-1 text-sm text-primary",
              index === active && "bg-control",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              commit(index);
            }}
            onMouseMove={() => setActiveIndex(index)}
          >
            <span className="truncate">{option.name}</span>
            {/* The disambiguator: two organizations do share a name, and
                this is what tells them apart. */}
            {option.jurisdiction && (
              <span className="shrink-0 text-xs text-muted">{option.jurisdiction}</span>
            )}
          </li>
        ))}
        {canCreate && (
          <li
            id={rowId(available.length)}
            role="option"
            aria-selected={active === available.length}
            className={cn(
              "cursor-default px-2 py-1 text-sm text-link",
              active === available.length && "bg-control",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              commit(available.length);
            }}
            onMouseMove={() => setActiveIndex(available.length)}
          >
            {createLabel}
          </li>
        )}
        {/* A disabled option, not a bare list item: non-option children
            of a listbox are not reliably exposed, so an empty answer
            would read as silence to assistive technology. */}
        {rowCount === 0 && (
          <li
            className="px-2 py-1 text-sm text-muted"
            role="option"
            aria-disabled="true"
            aria-selected={false}
          >
            {searching ? (
              <FormattedMessage id="counterparty.picker.searching" defaultMessage="Searching…" />
            ) : (
              <FormattedMessage
                id="counterparty.picker.noMatches"
                defaultMessage="No counterparties to add."
              />
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
