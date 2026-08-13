// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The narration layer (M9/6, DD-017): one activity-log entry in, one
 * sentence out.
 *
 * The log stores a slug and a payload. A reader wants an account of what
 * happened to a record — "Nadia Counsel changed the status", not
 * `contract.status_changed {from,to}`. This module is the whole of that
 * translation: it maps a slug plus its payload to an ICU message and its
 * values, picks the glyph the action's family wears, and renders the old
 * and new values of an edit through the same formatters the record page
 * renders them with, so a value reads the same in the feed as on the
 * page.
 *
 * **It lives here, and not inside the panel, because two surfaces read
 * it.** The record feed is the first (M9/6); the Administrator's audit
 * log is the second (M9/7), over the same table with no entity scope.
 * A second copy of the narration would be a second answer to "what does
 * this entry say".
 *
 * **An unknown slug renders plainly rather than throwing.** The log is
 * append-only and nothing prunes it, so a slug written by a version of
 * this application that no longer exists is still in the table and still
 * has to come out. Every lookup here falls through to a plain rendering
 * that names the actor and the slug; the same holds one level down, for
 * a payload that does not carry the keys its slug usually does.
 *
 * The vocabulary narrated today is the vocabulary a **record** feed can
 * contain: `contract.*` and `comment.*`. The audit log's wider set —
 * `user.*`, `org_settings.*`, the taxonomy prefixes, `entity.*` — joins
 * in M9/7, and reads through the fallback until it does.
 *
 * Nothing here reads comment text: `comment.*` payloads carry ids only,
 * because the log is append-only and an Administrator's hard redact has
 * to be able to remove what was said (CMT-006). A redacted comment's
 * entry therefore reads as a comment, never as what the comment said.
 */

import {
  Activity,
  Archive,
  ArchiveRestore,
  Building2,
  FilePlus2,
  GitCommitHorizontal,
  MessageSquare,
  PencilLine,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { defineMessage, type IntlShape, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { formatShortDate } from "./format";
import {
  formatContractValue,
  riskLabel,
  severityLabel,
  type ContractValue,
  type SeverityLevel,
} from "./contracts";

type FeedResponse =
  paths["/api/v1/activity"]["get"]["responses"]["200"]["content"]["application/json"];

/** One activity entry as the API answers it. */
export type ActivityEntry = FeedResponse["entries"][number];

/** The record a feed hangs off — the reference the panel is keyed by. */
export type ActivityEntityType =
  paths["/api/v1/activity"]["get"]["parameters"]["query"]["entityType"];

/** One old→new pair an entry carries, both sides already rendered. */
export interface NarratedChange {
  /** What changed, named as the record names it. */
  label: string;
  from: string;
  to: string;
}

/** One entry, ready to draw. */
export interface Narration {
  /** The glyph for the action's family. */
  icon: LucideIcon;
  /** The sentence naming the actor and what they did. */
  sentence: string;
  /** The old→new pairs this action carries, if any. */
  changes: readonly NarratedChange[];
}

/**
 * What the narration needs that the entry does not carry.
 *
 * A custom field's changed key is `field.<slug>` (the record's own
 * `title` and a custom field named "Title" are two different things, so
 * the payload namespaces one of them). The slug is not a label, and the
 * catalog that turns it into one belongs to whoever mounted the feed —
 * the contract record already holds its type's attached fields. An
 * unknown slug falls back to the slug itself, which is the honest
 * rendering for a field that has since been detached.
 */
export interface NarrationContext {
  fieldLabels?: Readonly<Record<string, string>>;
}

/**
 * An entry's own data, as the log stores it: whatever the slug's writer
 * put there. Every read of it below is defensive, because the shapes
 * are as old as the rows and nothing prunes either.
 */
type Payload = ActivityEntry["payload"];

/** Who acted, as the sentence names them. A system-emitted entry has no
 * human actor, and saying so beats inventing one. */
function actorName(intl: IntlShape, entry: ActivityEntry): string {
  return (
    entry.actor?.displayName ??
    intl.formatMessage({ id: "activity.actor.system", defaultMessage: "OpenLaw" })
  );
}

/** A payload value as a plain string, or null when the payload does not
 * carry it. Everything read out of a payload goes through here: the
 * shapes are as old as the rows, so nothing may assume one. */
function text(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** What an unrecorded value reads as, on either side of a change. */
function notSet(intl: IntlShape): string {
  return intl.formatMessage({ id: "activity.notSet", defaultMessage: "Not set" });
}

/**
 * One changed key, named as the record names it. The record's own fields
 * have labels of their own; a `field.<slug>` key takes the label the
 * mount supplied, and the bare slug when it supplied none.
 */
function changeLabel(intl: IntlShape, key: string, context: NarrationContext): string {
  if (key.startsWith("field.")) {
    const slug = key.slice("field.".length);
    return context.fieldLabels?.[slug] ?? slug;
  }
  return intl.formatMessage(
    {
      id: "activity.field",
      defaultMessage:
        "{key, select, title {Title} description {Description} owner {Owner} " +
        "entity {Signing entity} priority {Priority} risk {Risk} " +
        "contractType {Contract type} value {Value} status {Status} " +
        "primaryCounterparty {Primary counterparty} other {{key}}}",
    },
    { key },
  );
}

/** Whether a string is a bare civil date, as a `date` custom field
 * stores one. Anything else renders as itself. */
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One side of a change, rendered as the record renders it (DES-014).
 *
 * The record's own fields each read through their own helper — the value
 * through the currency formatter and its cadence suffix, priority and
 * risk through the severity ramp's labels. A custom field's stored value
 * is a primitive, and reads as one. Anything this does not recognise
 * reads as its own JSON rather than as `[object Object]`: an entry the
 * narration cannot place still has to say something true.
 */
function changeValue(
  intl: IntlShape,
  key: string,
  value: unknown,
  context: NarrationContext,
): string {
  if (value === null || value === undefined || value === "") return notSet(intl);
  if (key === "value" && typeof value === "object") {
    return formatContractValue(intl, value as ContractValue);
  }
  // The ramp's labels come from an ICU `select` with an `other` arm, so
  // a level the ramp no longer has still renders rather than throwing.
  if (key === "priority") return severityLabel(intl, value as SeverityLevel);
  if (key === "risk") return riskLabel(intl, value as SeverityLevel);
  if (typeof value === "boolean") {
    return intl.formatMessage(
      {
        id: "activity.boolean",
        defaultMessage: "{value, select, true {Yes} other {No}}",
      },
      { value },
    );
  }
  if (typeof value === "number") return intl.formatNumber(value);
  if (typeof value === "string") {
    return CIVIL_DATE.test(value) ? formatShortDate(value, { locale: intl.locale }) : value;
  }
  if (Array.isArray(value)) {
    return intl.formatList(
      value.map((item) => changeValue(intl, key, item, context)),
      { type: "conjunction" },
    );
  }
  return JSON.stringify(value);
}

/** The `changed` map a `contract.updated` payload carries, if it carries
 * one that reads as a map at all. */
function changesFrom(
  intl: IntlShape,
  payload: Payload,
  context: NarrationContext,
): NarratedChange[] {
  const changed = payload.changed;
  if (typeof changed !== "object" || changed === null || Array.isArray(changed)) return [];
  return Object.entries(changed as Record<string, unknown>).flatMap(([key, pair]) => {
    if (typeof pair !== "object" || pair === null) return [];
    const { from, to } = pair as { from?: unknown; to?: unknown };
    return [
      {
        label: changeLabel(intl, key, context),
        from: changeValue(intl, key, from, context),
        to: changeValue(intl, key, to, context),
      },
    ];
  });
}

/** A one-key change the payload states directly — a status move, a
 * re-type, a primary counterparty. Empty when the payload carries
 * neither side, which is what an old row may look like. */
function directChange(
  intl: IntlShape,
  payload: Payload,
  key: string,
  context: NarrationContext,
): NarratedChange[] {
  if (!("from" in payload) && !("to" in payload)) return [];
  return [
    {
      label: changeLabel(intl, key, context),
      from: changeValue(intl, key, payload.from, context),
      to: changeValue(intl, key, payload.to, context),
    },
  ];
}


/** What a payload calls somebody or something it names, when it does.
 * A name that is not there is not a reason to render nothing. */
function named(intl: IntlShape, payload: Payload, key: string): string {
  return (
    text(payload, key) ?? intl.formatMessage({ id: "activity.someone", defaultMessage: "someone" })
  );
}

/**
 * One action's narration: the glyph it wears, the sentence it reads as,
 * the placeholders that sentence needs, and the old→new pairs it
 * carries.
 *
 * A table rather than a switch, because that is what it is — and
 * because every message has to sit at a literal call site for the ICU
 * extractor to find it. `defineMessage` is that call site.
 */
interface Arm {
  icon: LucideIcon;
  message: MessageDescriptor;
  /** The old→new pairs, read out of the payload. */
  changes?: (intl: IntlShape, payload: Payload, context: NarrationContext) => NarratedChange[];
  /** What the sentence needs beyond `actor`. */
  values?: (
    intl: IntlShape,
    payload: Payload,
    changes: readonly NarratedChange[],
  ) => Record<string, string | number>;
}

/**
 * The vocabulary a record feed can contain, narrated. `contract.*` is
 * the record's own story and `comment.*` is the conversation on it; the
 * audit log's wider set joins in M9/7. A slug that is not here reads
 * through the fallback at the bottom of `narrateActivity`, which is what
 * makes this table safe to be incomplete.
 */
const ARMS: Readonly<Record<string, Arm>> = {
  "contract.created": {
    icon: FilePlus2,
    message: defineMessage({
      id: "activity.contract.created",
      defaultMessage: "{actor} created this contract",
    }),
  },
  "contract.updated": {
    icon: PencilLine,
    // One field is named in the sentence, because naming it reads
    // better than counting to one. Several are counted, and the lines
    // below say which. A payload carrying none is an older row shape,
    // and the sentence still holds.
    message: defineMessage({
      id: "activity.contract.updated",
      defaultMessage:
        "{actor} changed {count, plural, =0 {this contract} one {{field}} other {# fields}}",
    }),
    changes: changesFrom,
    values: (_intl, _payload, changes) => ({
      count: changes.length,
      field: changes[0]?.label ?? "",
    }),
  },
  "contract.status_changed": {
    icon: GitCommitHorizontal,
    message: defineMessage({
      id: "activity.contract.statusChanged",
      defaultMessage: "{actor} changed the status",
    }),
    changes: (intl, payload, context) => directChange(intl, payload, "status", context),
  },
  "contract.type_reassigned": {
    icon: Tag,
    message: defineMessage({
      id: "activity.contract.typeReassigned",
      defaultMessage: "{actor} re-typed this contract",
    }),
    changes: (intl, payload, context) => directChange(intl, payload, "contractType", context),
  },
  "contract.team_added": {
    icon: Users,
    message: defineMessage({
      id: "activity.contract.teamAdded",
      defaultMessage: "{actor} added {member} to the team as {role}",
    }),
    values: (intl, payload) => ({
      member: named(intl, payload, "member"),
      role: named(intl, payload, "role"),
    }),
  },
  "contract.team_removed": {
    icon: Users,
    message: defineMessage({
      id: "activity.contract.teamRemoved",
      defaultMessage: "{actor} took {member} off the team as {role}",
    }),
    values: (intl, payload) => ({
      member: named(intl, payload, "member"),
      role: named(intl, payload, "role"),
    }),
  },
  "contract.counterparty_added": {
    icon: Building2,
    message: defineMessage({
      id: "activity.contract.counterpartyAdded",
      defaultMessage: "{actor} added {counterparty} on the other side",
    }),
    values: (intl, payload) => ({ counterparty: named(intl, payload, "counterparty") }),
  },
  "contract.counterparty_removed": {
    icon: Building2,
    message: defineMessage({
      id: "activity.contract.counterpartyRemoved",
      defaultMessage: "{actor} took {counterparty} off the other side",
    }),
    values: (intl, payload) => ({ counterparty: named(intl, payload, "counterparty") }),
  },
  "contract.counterparty_primary_changed": {
    icon: Building2,
    message: defineMessage({
      id: "activity.contract.primaryChanged",
      defaultMessage: "{actor} changed which counterparty the contract is listed under",
    }),
    changes: (intl, payload, context) =>
      directChange(intl, payload, "primaryCounterparty", context),
  },
  "contract.archived": {
    icon: Archive,
    message: defineMessage({
      id: "activity.contract.archived",
      defaultMessage: "{actor} archived this contract",
    }),
  },
  "contract.restored": {
    icon: ArchiveRestore,
    message: defineMessage({
      id: "activity.contract.restored",
      defaultMessage: "{actor} restored this contract",
    }),
  },
  // Ids only, never text (CMT-006). A redacted comment's entry reads as
  // a comment that was removed, never as what the comment said.
  "comment.posted": {
    icon: MessageSquare,
    message: defineMessage({ id: "activity.comment.posted", defaultMessage: "{actor} commented" }),
  },
  "comment.edited": {
    icon: MessageSquare,
    message: defineMessage({
      id: "activity.comment.edited",
      defaultMessage: "{actor} changed a comment",
    }),
  },
  "comment.deleted": {
    icon: MessageSquare,
    message: defineMessage({
      id: "activity.comment.deleted",
      defaultMessage: "{actor} deleted a comment",
    }),
  },
  "comment.redacted": {
    icon: MessageSquare,
    message: defineMessage({
      id: "activity.comment.redacted",
      defaultMessage: "{actor} removed a comment for good",
    }),
  },
};

/**
 * The slug this build does not know, rendered plainly.
 *
 * The log is append-only and nothing prunes it, so a slug written by a
 * version of this application that no longer exists is still in the
 * table and still has to come out. It names an actor and a fact, so
 * both are shown rather than neither. Throwing here would take the
 * whole panel down over one old row.
 */
const UNKNOWN = defineMessage({ id: "activity.unknown", defaultMessage: "{actor} — {action}" });

/** One entry, narrated. Every arm reads its payload defensively; none of
 * them throws, and a slug with no arm falls through to `UNKNOWN`. */
export function narrateActivity(
  intl: IntlShape,
  entry: ActivityEntry,
  context: NarrationContext = {},
): Narration {
  const actor = actorName(intl, entry);
  const arm = ARMS[entry.action];
  if (!arm) {
    return {
      icon: Activity,
      sentence: intl.formatMessage(UNKNOWN, { actor, action: entry.action }),
      changes: [],
    };
  }
  const changes = arm.changes?.(intl, entry.payload, context) ?? [];
  return {
    icon: arm.icon,
    sentence: intl.formatMessage(arm.message, {
      actor,
      ...arm.values?.(intl, entry.payload, changes),
    }),
    changes,
  };
}
