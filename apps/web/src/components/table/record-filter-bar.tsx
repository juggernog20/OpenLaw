// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { ArrowLeft, CalendarDays, ChevronDown, ListFilter, Search, X } from "lucide-react";
import { useIntl } from "react-intl";
import type { Layout } from "../../lib/list-views";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

type Choice = { id: string; displayName: string };
export type RecordFilter = { key: string; label: string } & (
  { kind: "choices"; choices: Choice[] } | { kind: "date" } | { kind: "flag" }
);

function selected(filter: RecordFilter, values: Layout["filters"]): boolean {
  return filter.kind === "date"
    ? !!(values[`${filter.key}From`] || values[`${filter.key}To`])
    : !!values[filter.key];
}

function without(filter: RecordFilter, values: Layout["filters"]): Layout["filters"] {
  const next = { ...values };
  if (filter.kind === "date") {
    delete next[`${filter.key}From`];
    delete next[`${filter.key}To`];
  } else delete next[filter.key];
  return next;
}

export function RecordFilterBar({
  definitions,
  values,
  busy,
  error,
  onChange,
}: Readonly<{
  definitions: RecordFilter[];
  values: Layout["filters"];
  busy: boolean;
  error: string | null;
  onChange: (values: Layout["filters"]) => void;
}>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const active = definitions.filter((filter) => selected(filter, values));
  const filter = definitions.find((item) => item.key === editing);
  const filterLabel = intl.formatMessage({ id: "recordFilters.filter", defaultMessage: "Filter" });
  const clearLabel = intl.formatMessage({ id: "recordFilters.clear", defaultMessage: "Clear all" });
  const apply = (next: Layout["filters"]) => {
    onChange(next);
    setOpen(false);
    setEditing(null);
  };
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label={intl.formatMessage({
        id: "recordFilters.label",
        defaultMessage: "Record filters",
      })}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setEditing(null);
          setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" disabled={busy}>
            <ListFilter size={16} aria-hidden="true" />
            {filterLabel}
            {active.length > 0 && (
              <span className="rounded-chip bg-badge-count-bg px-1.5 text-badge-count-fg">
                {active.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
          aria-label={filterLabel}
        >
          {filter ? (
            <FilterEditor
              key={filter.key}
              filter={filter}
              values={values}
              onApply={apply}
              onBack={() => setEditing(null)}
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border-default p-3">
                <Search size={16} className="text-muted" aria-hidden="true" />
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={intl.formatMessage({
                    id: "recordFilters.searchProperties",
                    defaultMessage: "Search filters",
                  })}
                  placeholder={intl.formatMessage({
                    id: "recordFilters.searchProperties",
                    defaultMessage: "Search filters",
                  })}
                />
              </div>
              <div className="max-h-80 overflow-y-auto p-1.5">
                {definitions
                  .filter((item) =>
                    item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      disabled={busy}
                      onClick={() =>
                        item.kind === "flag"
                          ? apply({ ...values, [item.key]: true })
                          : setEditing(item.key)
                      }
                      className="flex w-full items-center justify-between gap-3 rounded-button px-3 py-2 text-start text-sm hover:bg-control focus-visible:outline-2 focus-visible:outline-link"
                    >
                      <span>{item.label}</span>
                      {selected(item, values) ? (
                        <span className="text-muted">✓</span>
                      ) : item.kind === "date" ? (
                        <CalendarDays size={16} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                {!definitions.some((item) =>
                  item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                ) && (
                  <p className="p-3 text-sm text-muted">
                    {intl.formatMessage({
                      id: "recordFilters.noFilters",
                      defaultMessage: "No filters found",
                    })}
                  </p>
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
      {active.map((item) => (
        <FilterChip key={item.key} filter={item} values={values} busy={busy} onChange={onChange} />
      ))}
      {active.length > 0 && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onChange({})}>
          {clearLabel}
        </Button>
      )}
      {busy && (
        <span role="status" className="text-xs text-muted">
          {intl.formatMessage({ id: "recordFilters.updating", defaultMessage: "Updating…" })}
        </span>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-status-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

function FilterChip({
  filter,
  values,
  busy,
  onChange,
}: Readonly<{
  filter: RecordFilter;
  values: Layout["filters"];
  busy: boolean;
  onChange: (values: Layout["filters"]) => void;
}>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const ids = String(values[filter.key] ?? "").split(",");
  const formatDate = (value: boolean | string | undefined) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
      ? intl.formatDate(new Date(`${value}T12:00:00Z`), {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })
      : String(value ?? "");
  const from = values[`${filter.key}From`],
    to = values[`${filter.key}To`];
  const detail =
    filter.kind === "choices"
      ? ids
          .map((id) => filter.choices.find((choice) => choice.id === id)?.displayName ?? id)
          .join(", ")
      : filter.kind === "date"
        ? from && to
          ? `${formatDate(from)} – ${formatDate(to)}`
          : from
            ? intl.formatMessage(
                { id: "recordFilters.fromDate", defaultMessage: "From {date}" },
                { date: formatDate(from) },
              )
            : intl.formatMessage(
                { id: "recordFilters.untilDate", defaultMessage: "Until {date}" },
                { date: formatDate(to) },
              )
        : "";
  return (
    <span className="inline-flex max-w-full items-center rounded-button border border-border-default bg-raised">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={`${filter.label}${detail ? `: ${detail}` : ""}`}
            title={detail}
            className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-s-button px-2.5 text-sm hover:bg-control focus-visible:outline-2 focus-visible:outline-link"
          >
            <span className="shrink-0 text-muted">
              {filter.label}
              {detail ? ":" : ""}
            </span>
            {detail && <span className="max-w-64 truncate font-medium">{detail}</span>}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
          aria-label={filter.label}
        >
          <FilterEditor
            filter={filter}
            values={values}
            onApply={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(without(filter, values))}
        aria-label={intl.formatMessage(
          { id: "recordFilters.remove", defaultMessage: "Remove {filter} filter" },
          { filter: filter.label },
        )}
        className="flex min-h-8 w-8 shrink-0 items-center justify-center rounded-e-button border-s border-border-default text-muted hover:bg-control hover:text-primary focus-visible:outline-2 focus-visible:outline-link"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

function FilterEditor({
  filter,
  values,
  onApply,
  onBack,
}: Readonly<{
  filter: RecordFilter;
  values: Layout["filters"];
  onApply: (values: Layout["filters"]) => void;
  onBack?: () => void;
}>) {
  const intl = useIntl();
  const [search, setSearch] = useState("");
  const [ids, setIds] = useState(
    String(values[filter.key] ?? "")
      .split(",")
      .filter(Boolean),
  );
  const [from, setFrom] = useState(String(values[`${filter.key}From`] ?? ""));
  const [to, setTo] = useState(String(values[`${filter.key}To`] ?? ""));
  const valid = !from || !to || from <= to;
  const save = () => {
    const next = without(filter, values);
    if (filter.kind === "date") {
      if (from) next[`${filter.key}From`] = from;
      if (to) next[`${filter.key}To`] = to;
    } else if (filter.kind === "choices" && ids.length) next[filter.key] = ids.join(",");
    onApply(next);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save();
      }}
    >
      <div className="flex items-center gap-2 border-b border-border-default p-3">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={intl.formatMessage({
              id: "recordFilters.back",
              defaultMessage: "Back to filters",
            })}
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </Button>
        )}
        <span className="text-sm font-semibold">{filter.label}</span>
      </div>
      {filter.kind === "choices" && (
        <>
          <div className="p-3">
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={intl.formatMessage({
                id: "recordFilters.searchChoices",
                defaultMessage: "Search choices",
              })}
              placeholder={intl.formatMessage({
                id: "recordFilters.searchChoices",
                defaultMessage: "Search choices",
              })}
            />
          </div>
          <div className="max-h-64 overflow-y-auto px-2 pb-2">
            {filter.choices
              .filter((choice) =>
                choice.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
              )
              .map((choice) => (
                <label
                  key={choice.id}
                  className="flex cursor-pointer items-center gap-3 rounded-button px-2 py-2 text-sm hover:bg-control"
                >
                  <Checkbox
                    checked={ids.includes(choice.id)}
                    disabled={!ids.includes(choice.id) && ids.length >= 50}
                    onCheckedChange={(checked) =>
                      setIds((current) =>
                        checked
                          ? [...current, choice.id]
                          : current.filter((id) => id !== choice.id),
                      )
                    }
                  />
                  <span>{choice.displayName}</span>
                </label>
              ))}
            {!filter.choices.some((choice) =>
              choice.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
            ) && (
              <p className="p-2 text-sm text-muted">
                {intl.formatMessage({
                  id: "recordFilters.noChoices",
                  defaultMessage: "No matching choices",
                })}
              </p>
            )}
          </div>
        </>
      )}
      {filter.kind === "date" && (
        <div className="grid grid-cols-2 gap-3 p-3">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            {intl.formatMessage({ id: "recordFilters.from", defaultMessage: "From" })}
            <Input
              type="date"
              autoFocus
              value={from}
              max={to || "9999-12-31"}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            {intl.formatMessage({ id: "recordFilters.to", defaultMessage: "To" })}
            <Input
              type="date"
              value={to}
              min={from || undefined}
              max="9999-12-31"
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {!valid && (
            <p role="alert" className="col-span-2 text-xs text-status-danger-fg">
              {intl.formatMessage({
                id: "recordFilters.invalidDates",
                defaultMessage: "End date must be on or after start date.",
              })}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border-default p-3">
        <span className="text-xs text-muted">
          {filter.kind === "choices"
            ? intl.formatMessage({
                id: "recordFilters.matchAny",
                defaultMessage: "Matches any selected value",
              })
            : filter.kind === "date"
              ? intl.formatMessage({
                  id: "recordFilters.inclusive",
                  defaultMessage: "Includes both dates",
                })
              : ""}
        </span>
        <Button type="submit" size="sm" disabled={!valid}>
          {filter.kind === "flag"
            ? intl.formatMessage({
                id: "recordFilters.removeFlag",
                defaultMessage: "Remove filter",
              })
            : intl.formatMessage({ id: "recordFilters.apply", defaultMessage: "Apply" })}
        </Button>
      </div>
    </form>
  );
}
