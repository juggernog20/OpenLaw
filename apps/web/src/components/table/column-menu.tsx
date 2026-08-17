// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Show, hide, and reorder a managed table's columns (DES-046 clause 4).
 *
 * One menu off a `Columns3` glyph, listing every column the catalogue can
 * draw. Shown ones lead, in the order the table draws them; the rest
 * follow, so "add a column" and "move a column" are the same list rather
 * than two places to look.
 *
 * **Reorder is by button, not by dragging a header.** A header drag is the
 * familiar affordance and a reasonable later addition. This is the version
 * that works from the keyboard without inventing a drag-and-drop keyboard
 * protocol the design record has not drawn.
 *
 * **The menu does not close on a toggle.** A reader hiding four columns
 * visits once (clause 4), which is what `event.preventDefault()` on each
 * item's select is for.
 */

import { useIntl, FormattedMessage } from "react-intl";
import { ChevronDown, ChevronUp, Columns3 } from "lucide-react";
import type { ColumnCatalogue, Layout } from "../../lib/list-views";
import { builtInLayout } from "../../lib/list-views";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function ColumnMenu<Row>({
  catalogue,
  layout,
  onLayoutChange,
}: Readonly<{
  catalogue: ColumnCatalogue<Row>;
  layout: Layout;
  onLayoutChange: (next: Layout) => void;
}>) {
  const intl = useIntl();
  const shownKeys = layout.columns.map((column) => column.key);

  /** Every column, shown ones first in table order, then the hidden ones
   * in catalogue order — so the list reads as the table plus what could
   * join it. */
  const rows = [
    ...layout.columns.flatMap((column) => {
      const def = catalogue.columns.find((candidate) => candidate.key === column.key);
      return def ? [{ def, shown: true }] : [];
    }),
    ...catalogue.columns
      .filter((def) => !shownKeys.includes(def.key))
      .map((def) => ({ def, shown: false })),
  ];

  function toggle(key: string, shown: boolean) {
    if (shown) {
      onLayoutChange({
        ...layout,
        columns: layout.columns.filter((column) => column.key !== key),
      });
      return;
    }
    const def = catalogue.columns.find((candidate) => candidate.key === key);
    if (!def) return;
    // A column joins at the end, which is the only position the reader
    // did not have to be asked about. Moving it is one press away.
    onLayoutChange({
      ...layout,
      columns: [...layout.columns, { key, width: def.defaultWidth }],
    });
  }

  function move(key: string, by: -1 | 1) {
    const from = layout.columns.findIndex((column) => column.key === key);
    const to = from + by;
    if (from === -1 || to < 0 || to >= layout.columns.length) return;
    const columns = [...layout.columns];
    const [moved] = columns.splice(from, 1);
    columns.splice(to, 0, moved!);
    onLayoutChange({ ...layout, columns });
  }

  /**
   * Back to the built-in layout, keeping the sort and the filters.
   *
   * "Reset columns" says columns: a reader who arranged a sort and then
   * wants their columns back has not asked to lose the sort as well.
   */
  function reset() {
    onLayoutChange({ ...builtInLayout(catalogue), sort: layout.sort, filters: layout.filters });
  }

  /**
   * Hand the card's spare width back to the catalogue's stretching column
   * (DES-046 clause 1).
   *
   * Dragging that column pins it, because a column cannot both absorb the
   * spare width and be dragged narrower than that width makes it. This is
   * the way back, and it is in the menu rather than on the column, because
   * a reader looking for it is looking for where columns are arranged.
   */
  function fill() {
    onLayoutChange({ ...layout, flexKey: catalogue.flexColumnKey });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={intl.formatMessage({ id: "table.columns", defaultMessage: "Columns" })}
        >
          <Columns3 size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* Seventeen columns is taller than a short window, so the list
          scrolls inside the menu rather than running "Reset columns" off
          the bottom of the screen. Radix measures the room it has and
          publishes it as the custom property. */}
      <DropdownMenuContent
        align="end"
        className="max-h-(--radix-dropdown-menu-content-available-height) min-w-64 overflow-y-auto"
      >
        <DropdownMenuLabel className="text-sm font-medium text-muted">
          <FormattedMessage id="table.columns" defaultMessage="Columns" />
        </DropdownMenuLabel>
        {rows.map(({ def, shown }, index) => (
          <DropdownMenuCheckboxItem
            key={def.key}
            checked={shown}
            // Required columns show checked and disabled: a list with no
            // Title is not a shorter list, it is a broken one.
            disabled={def.required === true}
            onCheckedChange={() => toggle(def.key, shown)}
            onSelect={(event) => event.preventDefault()}
            className="gap-3"
          >
            {/* The name takes the row and the arrows sit at its end. A
                `justify-between` here instead pushed the hidden columns'
                names — which have no arrows after them — to the trailing
                edge, so one list read as two. */}
            <span className="flex-1 truncate text-start">{def.label(intl)}</span>
            {shown && (
              <span className="flex shrink-0 items-center">
                <MoveButton
                  direction="up"
                  label={intl.formatMessage(
                    { id: "table.moveColumnUp", defaultMessage: "Move {column} earlier" },
                    { column: def.label(intl) },
                  )}
                  disabled={index === 0}
                  onPress={() => move(def.key, -1)}
                />
                <MoveButton
                  direction="down"
                  label={intl.formatMessage(
                    { id: "table.moveColumnDown", defaultMessage: "Move {column} later" },
                    { column: def.label(intl) },
                  )}
                  disabled={index === layout.columns.length - 1}
                  onPress={() => move(def.key, 1)}
                />
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        {/* Only while there is spare width to hand back. Offering it when
            a column is already stretching is a control that does nothing. */}
        {layout.flexKey !== catalogue.flexColumnKey &&
          shownKeys.includes(catalogue.flexColumnKey) && (
            <DropdownMenuItem onSelect={() => fill()}>
              <FormattedMessage id="table.fillWidth" defaultMessage="Fill the width" />
            </DropdownMenuItem>
          )}
        <DropdownMenuItem onSelect={() => reset()}>
          <FormattedMessage id="table.resetColumns" defaultMessage="Reset columns" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One reorder press. A `span` with a button role rather than a `button`,
 * because a nested button inside a `menuitemcheckbox` is invalid content
 * — the role and the key handling are what make it a control. */
function MoveButton({
  direction,
  label,
  disabled,
  onPress,
}: Readonly<{
  direction: "up" | "down";
  label: string;
  disabled: boolean;
  onPress: () => void;
}>) {
  const Glyph = direction === "up" ? ChevronUp : ChevronDown;
  return (
    <span
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? undefined : -1}
      className={`flex size-6 items-center justify-center rounded-chip ${
        disabled ? "opacity-30" : "hover:bg-raised"
      }`}
      onClick={(event) => {
        // The row's own checkbox must not toggle because the reader
        // pressed the arrow inside it.
        event.stopPropagation();
        event.preventDefault();
        if (!disabled) onPress();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.stopPropagation();
        event.preventDefault();
        if (!disabled) onPress();
      }}
    >
      <Glyph size={16} aria-hidden="true" />
    </span>
  );
}
