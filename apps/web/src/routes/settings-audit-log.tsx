// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Security · Audit log (#133, DD-017) — the second read
 * surface over the activity log, and the one an Administrator opens to
 * answer "who changed this user's role last quarter?"
 *
 * It shows every entry in the system: every entity type, every tier,
 * and the `admin_only` settings, user administration, and security
 * entries that no record feed carries. The record feed is a working
 * group's account of one record; this is the compliance surface, and
 * the only gate on it is the Administrator role.
 *
 * **The pane is absent for everyone else, not refused** (SET-002). The
 * rail entry sits in the Security group, inside the Organization group
 * that non-Administrators never see, so the settings rail never
 * advertises what it will not open. This loader is the client half of
 * that gate; the API's 403 is the real refusal.
 *
 * **Filters compose, because the API composes them.** Actor, action,
 * entity type, and date range are one `AND`, and search is one more
 * term across the fields a reader would search. The pane holds them in
 * state and hands the whole set over on every read, so what is on
 * screen is always the answer to one question rather than to several
 * layered by hand.
 *
 * **Entries read as sentences**, through `lib/activity.ts` — the same
 * narration the record's history applet uses (DES-026). One answer to
 * "what does this entry say", for both surfaces. A slug this build does
 * not know renders plainly rather than throwing, which is what keeps a
 * log older than the code from taking the pane down.
 *
 * **The export is a link, not a fetch.** It streams (the filtered set
 * can be any size), so the browser's own download is the right client
 * for it, and the link carries the filters that are on screen. Taking
 * one is itself a security event — the API appends its own entry.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Download, Lock } from "lucide-react";
import { api } from "../lib/api";
import { narrateActivity } from "../lib/activity";
import { dayBounds, formatLongDateTime, formatRelativeOrShort } from "../lib/format";
import { CONTROL_CLASS } from "../lib/form-controls";
import { registerSearchTarget } from "../lib/keyboard";
import { requireUser } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { paths } from "@openlaw/api-client";

type LogResponse =
  paths["/api/v1/audit-log"]["get"]["responses"]["200"]["content"]["application/json"];

/** One entry as the audit log answers it — wider than a record feed's,
 * because this surface has no entity scope and no tier filter. */
type AuditEntry = LogResponse["entries"][number];

type EntityType = AuditEntry["entityType"];
type Tier = AuditEntry["visibility"];

/** The seven the table's CHECK admits, as the filter offers them. Typed
 * against the generated client, so widening the column without widening
 * this list fails the build rather than dropping an option quietly. */
const ENTITY_TYPES = [
  "contract",
  "matter",
  "document",
  "request",
  "user",
  "entity",
  "system",
] as const satisfies readonly EntityType[];

/** How long the pane waits after the last keystroke before it searches.
 * Long enough that typing a word is one request, short enough that the
 * table keeps up with the reader. */
const SEARCH_DEBOUNCE_MS = 300;

/** The lock ahead of a restricted audience, at DES-009's own size —
 * the one glyph the 16/20/24 ramp carves out (DES-023). */
const LOCK_SIZE = 12;

export async function settingsAuditLogLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  // The two vocabularies the filters offer. Actions come from the table
  // rather than from the code: the log outlives the code that wrote it,
  // so a slug no longer emitted is still in there and still filterable.
  const [actions, people] = await Promise.all([
    api.GET("/api/v1/audit-log/actions"),
    api.GET("/api/v1/users"),
  ]);
  if (!actions.data) throw new Error("The audit log could not be read.");
  return { actions: actions.data.actions, actors: people.data?.users ?? [] };
}

/** What the reader has narrowed by. Empty string means "not narrowed" —
 * the state a `select` and an `input` are both natively in. */
interface Filters {
  actorId: string;
  action: string;
  entityType: string;
  /** Civil dates, as the date inputs answer them. */
  from: string;
  to: string;
  q: string;
}

const UNFILTERED: Filters = {
  actorId: "",
  action: "",
  entityType: "",
  from: "",
  to: "",
  q: "",
};

/**
 * The filters as the API takes them. The two civil dates become the
 * first and last instants of their day in the reader's own timezone, so
 * "August" is their August (DES-014).
 */
function queryFrom(filters: Filters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.actorId) query.actorId = filters.actorId;
  if (filters.action) query.action = filters.action;
  if (filters.entityType) query.entityType = filters.entityType;
  const from = dayBounds(filters.from);
  if (from) query.from = from.start;
  const to = dayBounds(filters.to);
  if (to) query.to = to.end;
  const term = filters.q.trim();
  if (term) query.q = term;
  return query;
}

/** What a record type reads as. `other` covers a type this build does
 * not know, which an append-only table can still be holding. */
function entityTypeLabel(intl: IntlShape, entityType: string): string {
  return intl.formatMessage(
    {
      id: "audit.entityType",
      defaultMessage:
        "{type, select, contract {Contract} matter {Matter} document {Document} " +
        "request {Request} user {User} entity {Entity} system {System} other {{type}}}",
    },
    { type: entityType },
  );
}

/**
 * Which room an entry belongs to. The three DD-016 tiers plus
 * `admin_only`, which only this surface can show — a record feed never
 * reads one.
 */
function tierLabel(intl: IntlShape, tier: string): string {
  return intl.formatMessage(
    {
      id: "audit.tier",
      defaultMessage:
        "{tier, select, legal_only {Legal only} working_team {Working team} " +
        "full_thread {Full thread} admin_only {Administrators} other {{tier}}}",
    },
    { tier },
  );
}

/**
 * The audience badge. The two restricted rooms — Legal Only and
 * Administrators — take DES-009's confidential pair and its lock; the
 * two wider ones take the neutral counter pair, exactly as the comment
 * row's badge does (DES-023). The label is what tells the restricted
 * two apart; the treatment is what makes either one read as restricted
 * without being looked at.
 */
function AudienceBadge({ tier }: Readonly<{ tier: Tier }>) {
  const intl = useIntl();
  const restricted = tier === "legal_only" || tier === "admin_only";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-px text-xs font-semibold",
        restricted
          ? "bg-confidential-bg text-confidential"
          : "bg-badge-count-bg text-badge-count-fg",
      )}
    >
      {restricted && <Lock size={LOCK_SIZE} aria-hidden="true" />}
      {tierLabel(intl, tier)}
    </span>
  );
}

/** One labelled filter control. The label is visible, not a
 * placeholder: six controls in a row need naming to be usable, and a
 * placeholder disappears the moment somebody uses it. */
function FilterField({
  id,
  label,
  children,
}: Readonly<{ id: string; label: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function SettingsAuditLogPage() {
  const { actions, actors } = useLoaderData<typeof settingsAuditLogLoader>();
  const intl = useIntl();

  const [filters, setFilters] = useState<Filters>(UNFILTERED);
  /** The search term as the reader has stopped typing it. */
  const [term, setTerm] = useState("");
  /** null until the first page answers. */
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Stable across renders so the `/` dispatch keeps mount order: an
  // inline callback would unregister and re-register on every render
  // (React 19 reruns a changed ref callback).
  const searchTargetRef = useCallback(
    (element: HTMLInputElement | null) => (element ? registerSearchTarget(element) : undefined),
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => setTerm(filters.q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.q]);

  // The filter set as one string, so a keystroke that has not yet
  // settled into a new search does not re-read the log: the debounced
  // term is what goes into it, and a re-render with the same filters
  // produces the same key and therefore the same object.
  const queryKey = useMemo(
    () => JSON.stringify(queryFrom({ ...filters, q: term })),
    [filters, term],
  );
  // Built from the same inputs the key is built from, and rebuilt only
  // when the key moves — so a re-render with the same filters hands
  // `loadPage` the object it already had. The key is the identity here,
  // which is why it is the only dependency.
  const query = useMemo<Record<string, string>>(
    () => queryFrom({ ...filters, q: term }),
    [queryKey],
  );

  /**
   * Which question is on screen. A read that is no longer the current
   * one has been abandoned — the reader narrowed again while it was in
   * flight — and its answer is dropped rather than written over the
   * question they are now asking. Without this, a slow first page for
   * one filter set lands on top of a fast one for the next, and the
   * table shows an answer to a question nobody is asking.
   */
  const generation = useRef(0);

  const loadPage = useCallback(
    async (from: string | null) => {
      const mine = (generation.current += 1);
      setBusy(true);
      setLoadFailed(false);
      const { data } = await api
        .GET("/api/v1/audit-log", {
          params: { query: { ...query, ...(from ? { cursor: from } : {}) } },
        })
        .catch(() => ({ data: undefined }));
      if (mine !== generation.current) return;
      setBusy(false);
      if (!data) {
        setLoadFailed(true);
        return;
      }
      setEntries((current) =>
        from === null ? data.entries : [...(current ?? []), ...data.entries],
      );
      setCursor(data.nextCursor);
    },
    [query],
  );

  // A changed filter is a new question, so it drops the answer to the
  // old one rather than paging on top of it.
  useEffect(() => {
    setEntries(null);
    setCursor(null);
    void loadPage(null);
  }, [loadPage]);

  const exportHref = `/api/v1/audit-log/export?${new URLSearchParams(query).toString()}`;

  function narrow(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({ id: "settings.section.auditLog", defaultMessage: "Audit log" })}
      />
      <SettingsCard
        title={<FormattedMessage id="settings.section.auditLog" defaultMessage="Audit log" />}
        // The log spans the pane; the shared card's max width is for
        // form panes.
        className="max-w-none"
        flush
        actions={
          <Button asChild size="sm" variant="secondary" className="px-3">
            {/* A link, because the export streams: the browser's own
                download is the right client for a response of unknown
                length, and it carries the session cookie same-origin. */}
            <a href={exportHref} download>
              <Download size={16} aria-hidden="true" />
              <FormattedMessage id="audit.export" defaultMessage="Export CSV" />
            </a>
          </Button>
        }
      >
        <div
          className="flex flex-wrap items-end gap-3 border-b border-border-default px-4 py-3"
          role="search"
          aria-label={intl.formatMessage({
            id: "audit.filters",
            defaultMessage: "Narrow the audit log",
          })}
        >
          <FilterField
            id="auditActor"
            label={<FormattedMessage id="audit.filter.actor" defaultMessage="Person" />}
          >
            <select
              id="auditActor"
              className={CONTROL_CLASS}
              value={filters.actorId}
              onChange={(event) => narrow({ actorId: event.target.value })}
            >
              <option value="">
                {intl.formatMessage({ id: "audit.filter.anyone", defaultMessage: "Anyone" })}
              </option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.displayName}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField
            id="auditAction"
            label={<FormattedMessage id="audit.filter.action" defaultMessage="Action" />}
          >
            <select
              id="auditAction"
              className={CONTROL_CLASS}
              value={filters.action}
              onChange={(event) => narrow({ action: event.target.value })}
            >
              <option value="">
                {intl.formatMessage({
                  id: "audit.filter.anyAction",
                  defaultMessage: "Any action",
                })}
              </option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField
            id="auditEntityType"
            label={<FormattedMessage id="audit.filter.record" defaultMessage="Record" />}
          >
            <select
              id="auditEntityType"
              className={CONTROL_CLASS}
              value={filters.entityType}
              onChange={(event) => narrow({ entityType: event.target.value })}
            >
              <option value="">
                {intl.formatMessage({
                  id: "audit.filter.anyRecord",
                  defaultMessage: "Any record",
                })}
              </option>
              {ENTITY_TYPES.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {entityTypeLabel(intl, entityType)}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField
            id="auditFrom"
            label={<FormattedMessage id="audit.filter.from" defaultMessage="From" />}
          >
            <Input
              id="auditFrom"
              type="date"
              value={filters.from}
              onChange={(event) => narrow({ from: event.target.value })}
            />
          </FilterField>

          <FilterField
            id="auditTo"
            label={<FormattedMessage id="audit.filter.to" defaultMessage="To" />}
          >
            <Input
              id="auditTo"
              type="date"
              value={filters.to}
              onChange={(event) => narrow({ to: event.target.value })}
            />
          </FilterField>

          <FilterField
            id="auditSearch"
            label={<FormattedMessage id="audit.filter.search" defaultMessage="Search" />}
          >
            <Input
              id="auditSearch"
              type="search"
              ref={searchTargetRef}
              value={filters.q}
              onChange={(event) => narrow({ q: event.target.value })}
            />
          </FilterField>

          <Button
            variant="ghost"
            size="sm"
            className="px-3"
            onClick={() => {
              setFilters(UNFILTERED);
              setTerm("");
            }}
          >
            <FormattedMessage id="audit.filter.clear" defaultMessage="Clear filters" />
          </Button>
        </div>

        {loadFailed && (
          <p role="alert" className="px-4 py-3 text-sm text-status-danger-fg">
            <FormattedMessage
              id="audit.loadError"
              defaultMessage="The audit log could not be read. Change a filter to try again."
            />
          </p>
        )}

        {entries !== null && entries.length === 0 && !loadFailed && (
          <p className="px-4 py-3 text-sm text-muted">
            <FormattedMessage id="audit.empty" defaultMessage="No entry matches these filters." />
          </p>
        )}

        {entries !== null && entries.length > 0 && (
          // DES-012: the table scrolls inside the card on narrow screens.
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-default text-xs font-semibold text-muted">
                  <th scope="col" className="h-9 px-4 font-semibold">
                    <FormattedMessage id="audit.col.event" defaultMessage="Event" />
                  </th>
                  {/* Column widths ride the 4px spacing scale (DES-007). */}
                  <th scope="col" className="h-9 w-44 px-3 font-semibold">
                    <FormattedMessage id="audit.col.record" defaultMessage="Record" />
                  </th>
                  <th scope="col" className="h-9 w-36 px-3 font-semibold">
                    <FormattedMessage id="audit.col.audience" defaultMessage="Audience" />
                  </th>
                  <th scope="col" className="h-9 w-32 px-3 font-semibold">
                    <FormattedMessage id="audit.col.when" defaultMessage="When" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cursor !== null && (
          <div className="px-4 py-3">
            <Button variant="secondary" disabled={busy} onClick={() => void loadPage(cursor)}>
              <FormattedMessage id="audit.older" defaultMessage="Show older" />
            </Button>
          </div>
        )}
      </SettingsCard>
    </>
  );
}

/**
 * One entry. The event cell is DES-026's narrated row — the family's
 * glyph on its medallion, the sentence, then any old→new pairs the
 * action carries. The three cells after it are what a record feed does
 * not need: which record, which room, and when.
 */
function EntryRow({ entry }: Readonly<{ entry: AuditEntry }>) {
  const intl = useIntl();
  // No catalogs: this surface reads every record in the system, so it
  // holds no one record's fields or people. Everything the narration
  // cannot name falls back to what the log stored, which is the honest
  // rendering here.
  const { icon: Icon, sentence, changes } = narrateActivity(intl, entry);
  return (
    <tr className="border-b border-border-muted last:border-b-0">
      <td className="px-4 py-2.5">
        <div className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-control text-muted"
          >
            <Icon size={16} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm text-primary">{sentence}</p>
            {/* Keyed by position: one entry's own payload, read once and
                never reordered. */}
            {changes.map((change, index) => (
              <p key={index} className="text-xs break-words text-muted">
                <FormattedMessage
                  id="activity.changeWithLabel"
                  defaultMessage="{label}: {from} → {to}"
                  values={{ label: change.label, from: change.from, to: change.to }}
                />
              </p>
            ))}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 align-top text-sm text-muted">
        <span className="block">{entityTypeLabel(intl, entry.entityType)}</span>
        {/* The id is what an auditor quotes back, so it is on screen and
            not only in the export. */}
        {entry.entityId !== null && (
          <span className="block text-xs break-all text-muted">{entry.entityId}</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        <AudienceBadge tier={entry.visibility} />
      </td>
      <td className="px-3 py-2.5 align-top">
        <time
          dateTime={entry.createdAt}
          title={formatLongDateTime(entry.createdAt, { locale: intl.locale })}
          className="text-xs whitespace-nowrap text-muted"
        >
          {formatRelativeOrShort(entry.createdAt, { locale: intl.locale })}
        </time>
      </td>
    </tr>
  );
}
