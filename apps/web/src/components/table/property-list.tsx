// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useIntl } from "react-intl";
import { Input } from "../ui/input";

/** Shared searchable list inside the filter and condition popovers. */
export function PropertyList({
  items,
  searchLabel,
  onSelect,
  busy = false,
}: Readonly<{
  items: { key: string; label: string; group?: string; subgroup?: string; trailing?: ReactNode }[];
  searchLabel: string;
  onSelect: (key: string) => void;
  busy?: boolean;
}>) {
  const intl = useIntl();
  const [search, setSearch] = useState("");
  const visible = items.filter((item) =>
    item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const groups = [...new Set(visible.map((item) => item.group))];
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-default p-3">
        <Search size={16} className="text-muted" aria-hidden="true" />
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={searchLabel}
          placeholder={searchLabel}
        />
      </div>
      <div className="max-h-80 overflow-y-auto p-1.5">
        {groups.map((group) => (
          <div key={group ?? "all"} role={group ? "group" : undefined} aria-label={group}>
            {group && <p className="px-3 py-2 text-sm font-semibold">{group}</p>}
            {visible
              .filter((item) => item.group === group)
              .map((item, index, grouped) => (
                <div key={item.key}>
                  {item.subgroup && grouped[index - 1]?.subgroup !== item.subgroup && (
                    <p className="px-3 py-2 text-xs font-semibold text-muted">{item.subgroup}</p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSelect(item.key)}
                    className="flex w-full items-center justify-between gap-3 rounded-button px-3 py-2 text-start text-sm hover:bg-control focus-visible:outline-2 focus-visible:outline-link"
                  >
                    <span>{item.label}</span>
                    {item.trailing}
                  </button>
                </div>
              ))}
          </div>
        ))}
        {!visible.length && (
          <p className="p-3 text-sm text-muted">
            {intl.formatMessage({
              id: "recordFilters.noFilters",
              defaultMessage: "No filters found",
            })}
          </p>
        )}
      </div>
    </>
  );
}
