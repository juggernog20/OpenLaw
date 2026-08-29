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
 * The vocabulary narrated here is the whole of it, and the compiler
 * says so: `ARMS` is keyed by `ActivityAction` from `@openlaw/shared`,
 * the same union the API writes rows against, so a slug that gains a
 * write site and no sentence does not build. A record feed can only
 * contain `contract.*` and `comment.*`, and those came first (M9/6);
 * the Administrator's audit log reads the table with no entity scope
 * and no tier filter, so it reaches everything — user administration,
 * settings, the taxonomies, the field catalog, the registry, the
 * identity provider, and an export of the log itself. Those arms landed
 * with that surface (M9/7). Adding an action family is adding entries
 * to `ARMS`, and nothing else.
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
  ArrowRightLeft,
  Bell,
  Building2,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Download,
  Eraser as EraserIcon,
  FilePen,
  FilePlus2,
  FolderInput,
  FolderPlus,
  FolderX,
  GitCommitHorizontal,
  Globe,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  Link2,
  ListOrdered,
  ListPlus,
  Lock,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Network,
  Palette,
  PenLine,
  PencilLine,
  Pin,
  Plug,
  RotateCw,
  Send,
  Settings,
  ShieldCheck,
  ShieldOff,
  SquareCheck,
  Star,
  Stamp,
  Tag,
  Tags,
  Trash2,
  TriangleAlert,
  Undo2,
  Unlink,
  Unplug,
  Upload,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { defineMessage, type IntlShape, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";
import type { ActivityAction } from "@openlaw/shared";
import { formatShortDate } from "./format";
import { roleLabel } from "./roles";
import {
  formatContractValue,
  riskLabel,
  severityLabel,
  termTypeLabel,
  type ContractValue,
  type SeverityLevel,
  type TermType,
} from "./contracts";

type FeedResponse =
  paths["/api/v1/activity"]["get"]["responses"]["200"]["content"]["application/json"];

export type ActivityEntry = FeedResponse["entries"][number];

/**
 * What narration actually reads out of an entry: who acted, what they
 * did, and the action's own data. Structural rather than one surface's
 * response type, because two surfaces answer entries and their shapes
 * are not the same one — the audit log carries a fourth tier, an entity
 * type, and an entity id that a record feed has no use for. Both
 * satisfy this, and neither has to be converted to be narrated.
 */
export interface NarratableEntry {
  action: string;
  actor: { displayName: string } | null;
  payload: Record<string, unknown>;
}

/** The record reference that keys the panel. */
export type ActivityEntityType =
  paths["/api/v1/activity"]["get"]["parameters"]["query"]["entityType"];

/** A rendered before-and-after pair. */
export interface NarratedChange {
  /** What changed, named as the record names it. */
  label: string;
  from: string;
  to: string;
}

/** An entry ready to render. */
export interface Narration {
  /** The glyph for the action's family. */
  icon: LucideIcon;
  /** The sentence naming the actor and what they did. */
  sentence: string;
  /** The old→new pairs this action carries, if any. */
  changes: readonly NarratedChange[];
}

/** One custom field, as much of it as the narration needs. */
export interface NarratedField {
  slug: string;
  displayName: string;
  /** CTR-016's kind. `user` and `entity` store an id, so a change to
   * one needs a name looked up before it can be read. */
  fieldType: string;
}

/**
 * What the narration needs that the entry does not carry.
 *
 * A custom field's changed key is `field.<slug>` (the record's own
 * `title` and a custom field named "Title" are two different things, so
 * the payload namespaces one of them). A slug is not a label, and the
 * catalog that turns it into one belongs to whoever mounted the feed —
 * the contract record already holds its type's attached fields.
 *
 * Two of CTR-016's nine kinds store an id rather than a value, so their
 * changed values are ids too. The record's own people and Entities are
 * not: M8 wrote the Owner and the signing entity into the payload as
 * names, precisely so this layer would not have to look them up. Custom
 * fields did not get that treatment, so `referenceNames` is where the
 * mount hands over the names it already loaded for its own pickers.
 *
 * Everything here is optional and everything falls back. An unknown
 * slug reads as the slug, and an id nothing names reads as the id —
 * which is the honest rendering for a field since detached, or a person
 * since deleted.
 */
export interface NarrationContext {
  fields?: readonly NarratedField[];
  referenceNames?: Readonly<Record<string, string>>;
}

/**
 * An entry's own data, as the log stores it: whatever the slug's writer
 * put there. Every read of it below is defensive, because the shapes
 * are as old as the rows and nothing prunes either.
 *
 * The shape a slug's writer puts there *today* is `ActivityPayloadMap`
 * in `@openlaw/shared`, which is what the narration tests build their
 * fixtures from. It is not this type: a row read off the wire is as old
 * as the build that wrote it, and a reader that assumed today's keys
 * would throw on yesterday's row.
 */
type Payload = NarratableEntry["payload"];

/** Who acted, as the sentence names them. A system-emitted entry has no
 * human actor, and saying so beats inventing one. */
function actorName(intl: IntlShape, entry: NarratableEntry): string {
  const name =
    entry.actor?.displayName ??
    intl.formatMessage({ id: "activity.actor.system", defaultMessage: "OpenLaw" });
  const actorRole = text(entry.payload, "actorRole");
  return actorRole ? `${name} (${roleLabel(intl, actorRole)})` : name;
}

/**
 * The words a decline or a void ended with, as its sentence selects on
 * them (CTR-013).
 *
 * Two values rather than one, because ICU `select` takes discrete arms
 * and a reason is free text: the flag chooses the arm, the text fills
 * it. A provider that reported no reason is the `no` arm, and the
 * sentence still reads without inventing one.
 */
function reasonValues(payload: Payload): Record<string, string> {
  const reason = text(payload, "reason");
  return { hasReason: reason ? "yes" : "no", reason: reason ?? "" };
}

/** A payload value as a plain string, or null when the payload does not
 * carry it. Everything read out of a payload goes through here: the
 * shapes are as old as the rows, so nothing may assume one. */
function text(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Which version of the chain an entry is about (DOC-001), as the
 * sentence selects on it.
 *
 * A string, because ICU `select` takes one, and version numbers are
 * references rather than quantities — `v3` is a name, so it is not
 * locale-formatted the way a count would be. `unknown` is the arm a row
 * that carries no number falls into: the log is append-only, so a
 * payload written by an older build has to still read as a sentence.
 */
function versionNumber(payload: Payload): string {
  const value = payload.versionNumber;
  return typeof value === "number" && Number.isInteger(value) ? String(value) : "unknown";
}

/**
 * How many rounds an erasure took with it (DOC-010), as a quantity.
 *
 * A number here, where `versionNumber` above is a string, because these
 * are two different things wearing the same word: one names a round in
 * the chain, and this one counts them, so it pluralizes and it is
 * locale-formatted. Zero is the arm an entry with no count falls into —
 * the log is append-only, so a payload an older build wrote has to still
 * read as a sentence — and the message says "and its files" there rather
 * than naming a number nobody recorded.
 */
function versionCount(payload: Payload): number {
  const value = payload.versionCount;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * A count a payload carries, or zero.
 *
 * Zero for anything that is not a whole number at or above it, because
 * the log is append-only: a payload written by an older build may not
 * hold the key at all, and a sentence that pluralized on `undefined`
 * would render an ICU argument error where a fact should be.
 */
function wholeCount(payload: Payload, key: string): number {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** What an unrecorded value reads as, on either side of a change. */
function notSet(intl: IntlShape): string {
  return intl.formatMessage({ id: "activity.notSet", defaultMessage: "Not set" });
}

/**
 * One changed key, named as the record names it. The record's own fields
 * have labels of their own; a `field.<slug>` key takes its name from the
 * catalog the mount supplied, and the bare slug when that catalog does
 * not have it.
 */
function changeLabel(intl: IntlShape, key: string, context: NarrationContext): string {
  const slug = customFieldSlug(key);
  if (slug !== null) return customField(context, slug)?.displayName ?? slug;
  return intl.formatMessage(
    {
      id: "activity.field",
      // One catalog of changed-key names, for both surfaces. The record
      // page's own fields lead; the rest are the keys the audit log's
      // wider vocabulary changes — settings, user administration, the
      // taxonomies, the field catalog, the registry, and the identity
      // provider. A key with no arm reads as itself, which is the
      // honest rendering for one this build no longer writes.
      defaultMessage:
        "{key, select, title {Title} description {Description} owner {Owner} " +
        "entity {Signing entity} priority {Priority} risk {Risk} matterManager {Matter Manager} matterType {Matter type} " +
        "contractType {Contract type} value {Value} status {Status} " +
        "termType {Term type} effectiveDate {Effective date} " +
        "expiryDate {Expiry date} renewalPeriodMonths {Renewal period (months)} " +
        "noticePeriodDays {Notice period (days)} " +
        "date {Date} label {Event} note {Note} kind {Kind} " +
        "primaryCounterparty {Primary counterparty} " +
        "primaryDocument {Primary document} " +
        "displayName {Name} display_name {Display name} name {Name} " +
        "role {Role} email {Email} " +
        "stage {Stage} moduleScope {Scope} isRequired {Required} " +
        "targetModule {Target} targetType {Target type} " +
        "theme {Theme} timezone {Timezone} avatar {Avatar} logo {Logo} " +
        "defaultLocale {Default language} defaultTimezone {Default timezone} " +
        "authMode {Sign-in method} allowedEmailDomains {Allowed email domains} " +
        "reminderOffsetDays {Reminder lead times} " +
        "smtpUrl {SMTP server} smtpFrom {From address} " +
        "issuer {Issuer} domain {Email domain} clientId {Client ID} " +
        "clientSecret {Client secret} " +
        "environment {Environment} integrationKey {Integration key} " +
        "apiUserId {User ID} privateKey {RSA private key} " +
        "webhookSecret {Connect HMAC secret} " +
        "legalName {Legal name} entityType {Entity type} " +
        "jurisdiction {Jurisdiction} formedOn {Formed on} " +
        "registrationNumber {Registration number} taxId {Tax ID} " +
        "registeredAgent {Registered agent} registeredAddress {Registered address} " +
        "sharesAuthorized {Authorized shares} sharesIssued {Issued shares} " +
        "parValue {Par value} appointedOn {Appointed on} resignedOn {Resigned on} " +
        "linkedUser {Linked user} " +
        "registrationId {Registration} recurrenceMonths {Repeat every (months)} " +
        "nextDueOn {Due date} assigneeId {Assignee} matterId {Matter} " +
        "other {{key}}}",
    },
    { key },
  );
}

/** The slug behind a custom field's changed key, or null when the key
 * is one of the record's own fields. */
function customFieldSlug(key: string): string | null {
  return key.startsWith("field.") ? key.slice("field.".length) : null;
}

/** What the mount knows about that field, if it knows about it. A field
 * detached since the change was made is not here, and its slug is what
 * the row reads as. */
function customField(context: NarrationContext, slug: string): NarratedField | undefined {
  return context.fields?.find((field) => field.slug === slug);
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
  // CTR-006's term type is a stored slug, so the feed says "Evergreen"
  // where the column says `evergreen`. Its ICU message carries an
  // `other` arm, so a kind this build no longer has still renders.
  if (key === "termType") return termTypeLabel(intl, value as TermType);
  if (key === "kind") {
    return intl.formatMessage(
      {
        id: "activity.document.versionKind",
        defaultMessage:
          "{kind, select, draft_ours {Draft · ours} draft_theirs {Draft · theirs} " +
          "redline_theirs {Redline · theirs} redline_ours {Redline · ours} " +
          "executed {Executed} amendment {Amendment} " +
          "generated_redline {Generated redline} other {{kind}}}",
      },
      { kind: value as string },
    );
  }
  // INT-002's target module is a stored slug, so the feed says "Contract"
  // where the column says `contract`. Its `other` arm covers a module
  // this build no longer has.
  if (key === "targetModule") {
    return intl.formatMessage(
      {
        id: "activity.targetModule",
        defaultMessage: "{module, select, matter {Matter} contract {Contract} other {{module}}}",
      },
      { module: value as string },
    );
  }
  if (typeof value === "boolean") {
    return intl.formatMessage(
      {
        id: "activity.boolean",
        defaultMessage: "{value, select, true {Yes} other {No}}",
      },
      { value },
    );
  }
  // NOT-004's lead times are days, and the list is narrated whole. A
  // bare "7, 1, and 0" says nothing about what the numbers count —
  // least of all the day-of offset, which reads as nothing at all.
  if (key === "reminderOffsetDays" && typeof value === "number") {
    return intl.formatMessage(
      {
        id: "activity.reminderOffset",
        defaultMessage: "{days, plural, =0 {day of} one {# day} other {# days}}",
      },
      { days: value },
    );
  }
  if (typeof value === "number") return intl.formatNumber(value);
  if (typeof value === "string") {
    // A `user` or `entity` field stores an id, so the id is what the
    // payload carries. The mount already loaded these names for its own
    // pickers; an id nothing names reads as itself, which is what a
    // person since deleted honestly looks like.
    const slug = customFieldSlug(key);
    const kind = slug === null ? undefined : customField(context, slug)?.fieldType;
    if (kind === "user" || kind === "entity") return context.referenceNames?.[value] ?? value;
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

/**
 * What a deflection-link entry calls the link it names.
 *
 * Its own fallback rather than {@link named}'s, because that one is a
 * person's — "removed the deflection link someone" is not a sentence.
 */
function linkNamed(intl: IntlShape, payload: Payload): string {
  return (
    text(payload, "label") ??
    intl.formatMessage({ id: "activity.unnamed", defaultMessage: "(unnamed)" })
  );
}

/**
 * The old→new pairs a deflection-link edit carries (INT-004).
 *
 * Its own reader rather than {@link changesFrom}, because two of its
 * three keys mean something else in the shared catalog: `label` there is
 * a key date's event name, and a link's placement has no key there at
 * all. Three keys, three nouns, one ICU `select` — the `other` arm
 * covers a key this build no longer writes, which the append-only log
 * can still be holding.
 *
 * A placement of `null` reads as "Portal home" rather than "not set":
 * the portal home panel is a real place a link sits, not the absence of
 * one.
 */
function intakeLinkChanges(intl: IntlShape, payload: Payload): NarratedChange[] {
  const changed = payload.changed;
  if (typeof changed !== "object" || changed === null || Array.isArray(changed)) return [];
  const placement = (value: unknown): string =>
    typeof value === "string" && value !== ""
      ? value
      : intl.formatMessage({
          id: "activity.intakeLink.portalHome",
          defaultMessage: "Portal home",
        });
  const side = (key: string, value: unknown): string =>
    key === "placement"
      ? placement(value)
      : typeof value === "string" && value !== ""
        ? value
        : notSet(intl);
  return Object.entries(changed as Record<string, unknown>).flatMap(([key, pair]) => {
    if (typeof pair !== "object" || pair === null) return [];
    const { from, to } = pair as { from?: unknown; to?: unknown };
    return [
      {
        label: intl.formatMessage(
          {
            id: "activity.intakeLink.field",
            defaultMessage:
              "{key, select, label {Label} url {Address} placement {Placement} other {{key}}}",
          },
          { key },
        ),
        from: side(key, from),
        to: side(key, to),
      },
    ];
  });
}

/**
 * What a folder entry calls the folder it names, when it says.
 *
 * Its own fallback rather than {@link named}'s, because that one is a
 * person's — "someone made the someone folder" is not a sentence. Every
 * payload written here carries a name; this is what keeps a row that
 * somehow does not from reading as a bug.
 */
function folderNamed(intl: IntlShape, payload: Payload, key: string): string {
  return (
    text(payload, key) ??
    intl.formatMessage({ id: "activity.folder.unnamed", defaultMessage: "unnamed" })
  );
}

/**
 * The two values a folder create and a folder move narrate from: what
 * the folder is called, and where it went.
 *
 * Whether it went to the record root is its **own** value rather than a
 * sentinel inside the parent's name. A folder really can be called
 * "none", and a message that read the destination out of the name would
 * narrate that one as if it had landed on the contract.
 */
function folderNarration(intl: IntlShape, payload: Payload): Record<string, string> {
  const parent = text(payload, "parentName");
  return {
    name: folderNamed(intl, payload, "name"),
    atRoot: parent === null ? "true" : "false",
    // Never read when `atRoot` is true, and never left undefined: an
    // ICU argument a locale still names has to resolve to something.
    parent: parent ?? "",
  };
}

/** What a payload calls somebody or something it names, when it does.
 * A name that is not there is not a reason to render nothing. */
/**
 * One civil date an entry carries, drawn through the standing
 * short-date formatter (DES-014) rather than printed as the stored
 * `YYYY-MM-DD`.
 *
 * The log is append-only, so an entry written by a build that carried no
 * such date still has to read as a sentence: an unreadable one falls
 * back to the em dash the record already prints where it holds nothing.
 */
function civilDateIn(intl: IntlShape, payload: Payload, key: string): string {
  const value = text(payload, key);
  return value === null
    ? intl.formatMessage({ id: "contracts.record.notRecorded", defaultMessage: "—" })
    : formatShortDate(value, { locale: intl.locale });
}

/** The day a key-date entry is about. */
const keyDateOn = (intl: IntlShape, payload: Payload): string => civilDateIn(intl, payload, "date");

/**
 * The contract at the far end of a relation entry (CTR-015), named as
 * "C-51 (Acme master services agreement)".
 *
 * Both halves, because they answer two questions: the reference is what
 * a person types into the address bar, and the title is what tells them
 * whether they care. `prefix` picks which pair of payload keys to read —
 * `parentNumber`/`parentTitle` or `relatedNumber`/`relatedTitle` — so
 * one function serves both verbs.
 *
 * The log is append-only, so a payload written without either half still
 * has to read as a sentence: a missing title collapses to the reference
 * alone, and a payload with neither falls back to a wording about a
 * **record**. Not `activity.someone`, which is a person's fallback — "put
 * this contract under someone" is not a sentence about a hierarchy.
 */
function relatedRecord(intl: IntlShape, payload: Payload, prefix: "parent" | "related"): string {
  const number = payload[`${prefix}Number`];
  const title = text(payload, `${prefix}Title`);
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return (
      title ??
      intl.formatMessage({
        id: "activity.contract.unnamedRecord",
        defaultMessage: "another contract",
      })
    );
  }
  const reference = intl.formatMessage(
    { id: "contracts.reference", defaultMessage: "C-{number}" },
    { number },
  );
  return title === null
    ? reference
    : intl.formatMessage(
        {
          id: "activity.contract.relatedRecord",
          defaultMessage: "{reference} ({title})",
        },
        { reference, title },
      );
}

/** The Matter sibling of {@link relatedRecord}, using M-number vocabulary. */
function relatedMatter(
  intl: IntlShape,
  payload: Payload,
  prefix: "parent" | "related" | "matter",
): string {
  const number = payload[`${prefix}Number`];
  const title = text(payload, `${prefix}Title`);
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return (
      title ??
      intl.formatMessage({
        id: "activity.matter.unnamedRecord",
        defaultMessage: "another matter",
      })
    );
  }
  const reference = intl.formatMessage(
    { id: "matters.reference", defaultMessage: "M-{number}" },
    { number },
  );
  return title === null
    ? reference
    : intl.formatMessage(
        {
          id: "activity.matter.relatedRecord",
          defaultMessage: "{reference} ({title})",
        },
        { reference, title },
      );
}

/**
 * A record named by its own reference alone, for the two entries that
 * link an ask to the work it became (INT-006, M21/9).
 *
 * The reference is the whole of the name here, because both payloads
 * carry a number and no title on purpose: R-42 and C-51 never change,
 * and an append-only log that quoted a title would go on quoting it
 * after a rename. A payload written without the number still has to
 * read as a sentence, so it collapses to a wording about the record
 * rather than to `activity.someone`, which is a person's fallback.
 */
function crossReference(
  intl: IntlShape,
  payload: Payload,
  key: string,
  reference: { id: string; defaultMessage: string },
  missing: { id: string; defaultMessage: string },
): string {
  const number = payload[key];
  if (typeof number !== "number" || !Number.isInteger(number)) {
    return intl.formatMessage(missing);
  }
  return intl.formatMessage(reference, { number });
}

/**
 * The record a conversion's two entries name, in the one wording both
 * use.
 *
 * `request.converted` and `request.thread_moved` say different sentences
 * about the same move, and the C-### inside each of them is the same
 * phrase. Hoisted so one edit cannot leave the two arms reading
 * differently. The `defineMessage` wrappers stay inside, because a
 * descriptor handed to a helper is invisible to `formatjs extract`.
 */
function convertedContract(intl: IntlShape, payload: Payload): string {
  return crossReference(
    intl,
    payload,
    "contractNumber",
    defineMessage({ id: "contracts.reference", defaultMessage: "C-{number}" }),
    defineMessage({
      id: "activity.contract.unnamedRecord",
      defaultMessage: "another contract",
    }),
  );
}

function convertedRecord(intl: IntlShape, payload: Payload): string {
  if (typeof payload.matterNumber === "number" && Number.isInteger(payload.matterNumber)) {
    return crossReference(
      intl,
      payload,
      "matterNumber",
      defineMessage({ id: "matters.reference", defaultMessage: "M-{number}" }),
      defineMessage({ id: "activity.matter.unnamedRecord", defaultMessage: "another matter" }),
    );
  }
  return convertedContract(intl, payload);
}

function named(intl: IntlShape, payload: Payload, key: string): string {
  return (
    text(payload, key) ?? intl.formatMessage({ id: "activity.someone", defaultMessage: "someone" })
  );
}

/** What a task entry calls the task it names. Its own fallback rather
 * than {@link named}'s, because that one is a person's — "added the
 * task someone" is not a sentence. */
function taskNamed(intl: IntlShape, payload: Payload): string {
  return (
    text(payload, "title") ??
    intl.formatMessage({ id: "activity.task.untitled", defaultMessage: "(untitled)" })
  );
}

/**
 * The people a soft-gate override went past (CTR-012), in the order the
 * payload holds them — the roster's own order, oldest ask first.
 *
 * A row with no readable name is dropped rather than rendered as
 * "someone": the sentence is a list, and "Sarah Chen and someone" reads
 * as a second person nobody can look up. The count comes from what is
 * left, so the plural and the list always agree.
 */
function approverNames(payload: Payload): string[] {
  const rows = payload.approvers;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (row && typeof row === "object" ? text(row as Payload, "approverName") : null))
    .filter((name): name is string => name !== null);
}

/**
 * A `contract_team` role (CTR-004) in the words the record's Team card
 * uses, so one fact does not read as "Contributor" on the card and
 * `contributor` in the feed.
 *
 * The `other` arm echoes the slug rather than answering "Unknown", the
 * way `changeLabel` does: the log is append-only, so a role this build
 * no longer has is still in a payload and still has to come out as
 * itself.
 */
function teamRole(intl: IntlShape, payload: Payload): string {
  const role = text(payload, "role");
  if (role === null) return named(intl, payload, "role");
  return intl.formatMessage(
    {
      id: "activity.teamRole",
      defaultMessage:
        "{role, select, member {Member} watcher {Watcher} creator {Creator} " +
        "contributor {Contributor} other {{role}}}",
    },
    { role },
  );
}

/**
 * What a payload calls the thing it is about — a taxonomy row, a field,
 * a registry record. Display name first, because that is what the reader
 * saw; the slug behind it when the payload carries no name, which is
 * what a rename's payload looks like; and a placeholder when it carries
 * neither, which only an ancient row shape can.
 */
function thingName(intl: IntlShape, payload: Payload): string {
  return (
    text(payload, "displayName") ??
    text(payload, "legalName") ??
    text(payload, "slug") ??
    intl.formatMessage({ id: "activity.unnamed", defaultMessage: "(unnamed)" })
  );
}

/**
 * The `{field, old, new}` shape the settings, profile, and identity
 * provider writers use. The payload names the key it changed instead of
 * the slug doing it, because one slug covers every field on the surface.
 */
function fieldChange(
  intl: IntlShape,
  payload: Payload,
  context: NarrationContext,
): NarratedChange[] {
  const key = text(payload, "field");
  if (key === null) return [];
  return [
    {
      label: changeLabel(intl, key, context),
      from: changeValue(intl, key, payload.old, context),
      to: changeValue(intl, key, payload.new, context),
    },
  ];
}

/** A role change, with both sides in the words the Users pane uses. A
 * slug that is no longer a role reads as itself (`roleLabel`). */
function roleChange(
  intl: IntlShape,
  payload: Payload,
  context: NarrationContext,
): NarratedChange[] {
  if (!("from" in payload) && !("to" in payload)) return [];
  // A side the payload does not carry reads as unrecorded, the way every
  // other one-sided change in this module reads. `roleLabel` would
  // answer the empty string and leave the row reading "Role:  → …".
  const side = (value: unknown): string =>
    value === null || value === undefined || value === ""
      ? notSet(intl)
      : roleLabel(intl, String(value));
  return [
    {
      label: changeLabel(intl, "role", context),
      from: side(payload.from),
      to: side(payload.to),
    },
  ];
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
 * The settings taxonomies say the same seven things about seven
 * different lists, so they share seven sentences and name which list
 * inside them.
 *
 * The name of the list is an ICU `select` rather than an interpolated
 * noun: a translator needs the whole sentence for each case, because a
 * language that inflects around the noun cannot be served by dropping
 * one into a slot. `other` covers a taxonomy this build no longer has,
 * which the append-only log can still be holding entries for.
 */
/**
 * Every `defaultMessage` below spells the `kind` select out in full,
 * rather than sharing one constant for it. The ICU extractor reads the
 * source rather than running it, so a message assembled from a variable
 * is a message it cannot see. Literal, repeated, and extractable beats
 * short and invisible.
 */
const TAXONOMY = {
  created: defineMessage({
    id: "activity.taxonomy.created",
    defaultMessage:
      "{actor} added the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} {name}",
  }),
  renamed: defineMessage({
    id: "activity.taxonomy.renamed",
    defaultMessage:
      "{actor} renamed the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} {name}",
  }),
  updated: defineMessage({
    id: "activity.taxonomy.updated",
    defaultMessage:
      "{actor} changed the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} {name}",
  }),
  reordered: defineMessage({
    id: "activity.taxonomy.reordered",
    defaultMessage:
      "{actor} reordered the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} list",
  }),
  archived: defineMessage({
    id: "activity.taxonomy.archived",
    defaultMessage:
      "{actor} archived the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} {name}",
  }),
  restored: defineMessage({
    id: "activity.taxonomy.restored",
    defaultMessage:
      "{actor} restored the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} {name}",
  }),
  deleted: defineMessage({
    id: "activity.taxonomy.deleted",
    defaultMessage:
      "{actor} deleted the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "request_type {request type} " +
      "contract_status {contract status} field {field} " +
      "approver_group {approver group} matter_template {matter template} other {type}} {name}",
  }),
} as const;

/** Which list a taxonomy arm is about, plus the row it names. */
function taxonomyValues(kind: string) {
  return (intl: IntlShape, payload: Payload) => ({ kind, name: thingName(intl, payload) });
}

/**
 * The taxonomy arms for one prefix, keyed by slug. Each list gets the
 * verbs its own writer emits and no others: the field catalog neither
 * renames, reorders, nor hard-deletes, and a statuses list has no
 * description to change. An arm for a slug that cannot be written is a
 * sentence nobody will ever read.
 */
function taxonomyArms<Kind extends string, Verb extends keyof typeof TAXONOMY>(
  kind: Kind,
  icon: LucideIcon,
  verbs: readonly Verb[],
): Record<`${Kind}.${Verb}`, Arm> {
  const values = taxonomyValues(kind);
  const arms: Record<keyof typeof TAXONOMY, Arm> = {
    created: { icon, message: TAXONOMY.created, values },
    renamed: {
      icon,
      message: TAXONOMY.renamed,
      values,
      changes: (intl, payload, context) => directChange(intl, payload, "displayName", context),
    },
    updated: { icon, message: TAXONOMY.updated, values, changes: changesFrom },
    reordered: { icon: ListOrdered, message: TAXONOMY.reordered, values },
    archived: { icon: Archive, message: TAXONOMY.archived, values },
    restored: { icon: ArchiveRestore, message: TAXONOMY.restored, values },
    deleted: { icon: Trash2, message: TAXONOMY.deleted, values },
  };
  // The keys are the slugs this prefix writes, and the return type says
  // so: `ARMS` below is checked against the whole vocabulary, and a
  // spread that answered a bare `Record<string, Arm>` would satisfy that
  // check without covering anything.
  return Object.fromEntries(verbs.map((verb) => [`${kind}.${verb}`, arms[verb]])) as Record<
    `${Kind}.${Verb}`,
    Arm
  >;
}

/** The seven a settings taxonomy writes (contract, matter, entity, and
 * request types), in one place because four lists share them. */
const TAXONOMY_VERBS = [
  "created",
  "renamed",
  "updated",
  "reordered",
  "archived",
  "restored",
  "deleted",
] as const satisfies readonly (keyof typeof TAXONOMY)[];

/**
 * The three type-field prefixes attach the same catalog to three
 * different types, so they share four sentences and name which type
 * inside them, for the reason the taxonomies do.
 */
const TYPE_FIELD = {
  attached: defineMessage({
    id: "activity.typeField.attached",
    defaultMessage:
      "{actor} attached the field {field} to the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "request_type_field {request type} other {type}} {type}",
  }),
  detached: defineMessage({
    id: "activity.typeField.detached",
    defaultMessage:
      "{actor} detached the field {field} from the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "request_type_field {request type} other {type}} {type}",
  }),
  reordered: defineMessage({
    id: "activity.typeField.reordered",
    defaultMessage:
      "{actor} reordered the fields on the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "request_type_field {request type} other {type}} {type}",
  }),
  requiredChanged: defineMessage({
    id: "activity.typeField.requiredChanged",
    defaultMessage:
      "{actor} made the field {field} {required, select, true {required} " +
      "other {optional}} on the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "request_type_field {request type} other {type}} {type}",
  }),
} as const;

/** The four verbs an attached-field catalog writes. */
type TypeFieldVerb = "attached" | "detached" | "reordered" | "required_changed";

/** The same four arms for one type-field prefix, keyed by slug. The
 * return type names those slugs for `taxonomyArms`' reason. */
function typeFieldArms<Owner extends string>(
  owner: Owner,
): Record<`${Owner}.${TypeFieldVerb}`, Arm> {
  const values = (intl: IntlShape, payload: Payload) => ({
    owner,
    type: named(intl, payload, "typeSlug"),
    field: named(intl, payload, "fieldSlug"),
    required: String(payload.isRequired === true),
  });
  const arms: Record<TypeFieldVerb, Arm> = {
    attached: { icon: Link2, message: TYPE_FIELD.attached, values },
    detached: { icon: Unlink, message: TYPE_FIELD.detached, values },
    reordered: { icon: ListOrdered, message: TYPE_FIELD.reordered, values },
    required_changed: { icon: SquareCheck, message: TYPE_FIELD.requiredChanged, values },
  };
  return Object.fromEntries(
    (Object.keys(arms) as TypeFieldVerb[]).map((verb) => [`${owner}.${verb}`, arms[verb]]),
  ) as Record<`${Owner}.${TypeFieldVerb}`, Arm>;
}

/**
 * The whole vocabulary, narrated. `contract.*` is a record's own story
 * and `comment.*` the conversation on it — those two are all a record
 * feed can contain (M9/6). Everything after them is what the
 * Administrator's audit log reaches and no record feed does (M9/7):
 * user administration, settings, the taxonomies, the field catalog, the
 * registry, the identity provider, and an export of the log itself.
 *
 * **Keyed by the vocabulary itself** (`@openlaw/shared`), so a slug the
 * API learns to write without a sentence here does not compile. That is
 * the one direction the compiler can hold: the other — a slug in the
 * table that this build has never heard of — is what the fallback at the
 * bottom of `narrateActivity` is for, because the log outlives the code
 * that wrote it (DD-017).
 */
const ARMS: Readonly<Record<ActivityAction, Arm>> = {
  "contract.created": {
    icon: FilePlus2,
    message: defineMessage({
      id: "activity.contract.created",
      defaultMessage: "{actor} created this contract",
    }),
  },
  // The other half of the conversion's narration (DD-017, #420). It sits
  // beside contract.created rather than replacing it: a contract born by
  // conversion is an ordinary contract, and where it came from is a
  // second sentence about the same birth.
  "contract.created_from_request": {
    icon: ArrowRightLeft,
    message: defineMessage({
      id: "activity.contract.createdFromRequest",
      defaultMessage: "{actor} created this contract from {request}",
    }),
    values: (intl, payload) => ({
      request: crossReference(
        intl,
        payload,
        "requestNumber",
        defineMessage({
          id: "requests.reference",
          defaultMessage: "R-{number, number, ::group-off}",
        }),
        // Wrapped in defineMessage so `formatjs extract` sees the id —
        // a descriptor handed to a helper is invisible to it otherwise,
        // and this fallback appears nowhere else in the catalog.
        defineMessage({ id: "activity.request.unnamedRecord", defaultMessage: "a request" }),
      ),
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
  // CTR-012's soft gate, pushed past (M14/5). Its own entry beside the
  // status change of the same commit: the contract moved, and somebody
  // moved it past open sign-off, and only the first of those is a fact
  // about the status. The warning glyph is the point — the entry says a
  // warning was accepted, not that something failed.
  //
  // It names the people it went past, because "an override happened" is
  // not something a reader can act on and "went past Sarah Chen and
  // Marcus Webb" is. The `=0` arm is the append-only floor: an entry
  // whose payload a later build cannot read still has to come out as a
  // sentence.
  "contract.stage_gate_overridden": {
    icon: TriangleAlert,
    message: defineMessage({
      id: "activity.contract.stageGateOverridden",
      defaultMessage:
        "{count, plural, =0 {{actor} moved this contract past approval, overriding the soft gate} other {{actor} moved this contract past approval, overriding {approvers}}}",
    }),
    values: (intl, payload) => {
      const names = approverNames(payload);
      return { count: names.length, approvers: intl.formatList(names, { type: "conjunction" }) };
    },
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
      role: teamRole(intl, payload),
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
      role: teamRole(intl, payload),
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
  // One glyph for confidentiality everywhere (DES-009), so the set and
  // the clear wear the same Lock and the sentence is what tells them
  // apart. An alternate glyph for the clear would be the second
  // confidentiality icon that decision rules out.
  "contract.confidentiality_set": {
    icon: Lock,
    message: defineMessage({
      id: "activity.contract.confidentialitySet",
      defaultMessage: "{actor} marked this contract confidential",
    }),
  },
  "contract.confidentiality_cleared": {
    icon: Lock,
    message: defineMessage({
      id: "activity.contract.confidentialityCleared",
      defaultMessage: "{actor} cleared this contract's confidential mark",
    }),
  },
  "matter.created": {
    icon: FilePlus2,
    message: defineMessage({
      id: "activity.matter.created",
      defaultMessage:
        "{templatePresence, select, present {{actor} created this matter from the {template} template} " +
        "other {{actor} created this matter}}",
    }),
    values: (_intl, payload) => {
      const template = text(payload, "template");
      return {
        templatePresence: template === null ? "absent" : "present",
        template: template ?? "",
      };
    },
  },
  "matter.created_from_request": {
    icon: ArrowRightLeft,
    message: defineMessage({
      id: "activity.matter.createdFromRequest",
      defaultMessage: "{actor} created this matter from {request}",
    }),
    values: (intl, payload) => ({
      request: crossReference(
        intl,
        payload,
        "requestNumber",
        defineMessage({
          id: "requests.reference",
          defaultMessage: "R-{number, number, ::group-off}",
        }),
        defineMessage({ id: "activity.request.unnamedRecord", defaultMessage: "a request" }),
      ),
    }),
  },
  "matter.updated": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.matter.updated",
      defaultMessage:
        "{actor} changed {count, plural, =0 {this matter} one {{field}} other {# fields}}",
    }),
    changes: changesFrom,
    values: (_intl, _payload, changes) => ({
      count: changes.length,
      field: changes[0]?.label ?? "",
    }),
  },
  "matter.status_changed": {
    icon: GitCommitHorizontal,
    message: defineMessage({
      id: "activity.matter.statusChanged",
      defaultMessage: "{actor} changed the status",
    }),
    changes: (intl, payload, context) => directChange(intl, payload, "status", context),
  },
  "matter.type_reassigned": {
    icon: ArrowRightLeft,
    message: defineMessage({
      id: "activity.matter.typeReassigned",
      defaultMessage: "{actor} reassigned this matter's type",
    }),
    changes: (intl, payload, context) => directChange(intl, payload, "matterType", context),
  },
  "matter.team_added": {
    icon: Users,
    message: defineMessage({
      id: "activity.matter.teamAdded",
      defaultMessage: "{actor} added {member} to the team as {role}",
    }),
    values: (intl, payload) => ({
      member: named(intl, payload, "member"),
      role: teamRole(intl, payload),
    }),
  },
  "matter.team_removed": {
    icon: Users,
    message: defineMessage({
      id: "activity.matter.teamRemoved",
      defaultMessage: "{actor} took {member} off the team as {role}",
    }),
    values: (intl, payload) => ({
      member: named(intl, payload, "member"),
      role: teamRole(intl, payload),
    }),
  },
  "matter.status_reassigned": {
    icon: ArrowRightLeft,
    message: defineMessage({
      id: "activity.matter.statusReassigned",
      defaultMessage: "{actor} reassigned this matter's status",
    }),
    changes: (intl, payload, context) => directChange(intl, payload, "status", context),
  },
  "matter.confidentiality_set": {
    icon: Lock,
    message: defineMessage({
      id: "activity.matter.confidentialitySet",
      defaultMessage: "{actor} marked this matter confidential",
    }),
  },
  "matter.confidentiality_cleared": {
    icon: Lock,
    message: defineMessage({
      id: "activity.matter.confidentialityCleared",
      defaultMessage: "{actor} cleared this matter's confidential mark",
    }),
  },
  "matter.archived": {
    icon: Archive,
    message: defineMessage({
      id: "activity.matter.archived",
      defaultMessage: "{actor} archived this matter",
    }),
  },
  "matter.restored": {
    icon: ArchiveRestore,
    message: defineMessage({
      id: "activity.matter.restored",
      defaultMessage: "{actor} restored this matter",
    }),
  },
  "matter.parent_set": {
    icon: Network,
    message: defineMessage({
      id: "activity.matter.parentSet",
      defaultMessage: "{actor} put this Matter under {parent}",
    }),
    values: (intl, payload) => ({ parent: relatedMatter(intl, payload, "parent") }),
  },
  "matter.parent_removed": {
    icon: Network,
    message: defineMessage({
      id: "activity.matter.parentRemoved",
      defaultMessage: "{actor} took this Matter out from under {parent}",
    }),
    values: (intl, payload) => ({ parent: relatedMatter(intl, payload, "parent") }),
  },
  "matter.relation_added": {
    icon: Link2,
    message: defineMessage({
      id: "activity.matter.relationAdded",
      defaultMessage: "{actor} related this Matter to {related}",
    }),
    values: (intl, payload) => ({ related: relatedMatter(intl, payload, "related") }),
  },
  "matter.relation_removed": {
    icon: Link2,
    message: defineMessage({
      id: "activity.matter.relationRemoved",
      defaultMessage: "{actor} removed the relation to {related}",
    }),
    values: (intl, payload) => ({ related: relatedMatter(intl, payload, "related") }),
  },
  // The sign-off on the record (M14/3, CTR-012). A verb per act, so a
  // reader can tell an approval from a rejection without opening a
  // payload — and so an Administrator can filter the audit log on the
  // one they are looking for.
  //
  // Each names the approver, not only the actor. On a request and a
  // cancellation the two are different people, and on a cancellation
  // the entry is the only record left that the ask was ever made: the
  // row itself is deleted.
  // The request says where it came from, because a group apply asks
  // several people in one act and a feed that narrated each of them as
  // a separate hand-picked ask would hide the act (CTR-012, M14/4). An
  // entry with no source at all reads as the manual arm, which is what
  // every entry written before the group apply landed is.
  "approval.requested": {
    icon: Stamp,
    message: defineMessage({
      id: "activity.approval.requested",
      defaultMessage:
        "{source, select, group {{actor} asked {approver} to approve this contract, from the {group} group} other {{actor} asked {approver} to approve this contract}}",
    }),
    values: (intl, payload) => ({
      approver: named(intl, payload, "approverName"),
      source: text(payload, "source") ?? "manual",
      group: named(intl, payload, "groupName"),
    }),
  },
  "approval.approved": {
    icon: Check,
    message: defineMessage({
      id: "activity.approval.approved",
      defaultMessage: "{actor} approved this contract",
    }),
  },
  "approval.rejected": {
    icon: X,
    message: defineMessage({
      id: "activity.approval.rejected",
      defaultMessage: "{actor} rejected this contract",
    }),
  },
  "approval.cancelled": {
    icon: Undo2,
    message: defineMessage({
      id: "activity.approval.cancelled",
      defaultMessage: "{actor} cancelled the approval request to {approver}",
    }),
    values: (intl, payload) => ({ approver: named(intl, payload, "approverName") }),
  },
  // CTR-007's first renewal vehicle (M16/4). It keeps its own verb
  // rather than reading as an edit of the expiry, because the act is
  // what the record has to prove: CTR-006's engine never advances a
  // term on its own, so "somebody said this rolled" is a legal-state
  // fact and not a field commit. The sentence carries both dates,
  // because a roll the person adjusted moved the term somewhere other
  // than the record proposed, and a reader should not have to work out
  // where it came from.
  "contract.renewal_confirmed": {
    icon: RotateCw,
    message: defineMessage({
      id: "activity.contract.renewalConfirmed",
      defaultMessage: "{actor} confirmed the renewal — the term moved from {from} to {to}",
    }),
    values: (intl, payload) => ({
      from: civilDateIn(intl, payload, "from"),
      to: civilDateIn(intl, payload, "to"),
    }),
  },
  // CTR-015's two relation writes (M16/5), which renewal routing is the
  // first feature to make. Each keeps its own verb rather than reading
  // as an edit, for `team_added`'s reason: a statement about two records
  // is not a field commit, and a reader should be able to tell them
  // apart without opening a payload.
  //
  // Both name the far record by its reference **and** its title, because
  // one of the two answers "which contract" and the other answers "which
  // deal", and a reader of a feed usually wants the second.
  "contract.parent_set": {
    icon: Network,
    message: defineMessage({
      id: "activity.contract.parentSet",
      defaultMessage: "{actor} put this contract under {parent}",
    }),
    values: (intl, payload) => ({ parent: relatedRecord(intl, payload, "parent") }),
  },
  // One sentence with an arm per relation type, rather than three verbs:
  // the act is the same act — a link was written — and what differs is
  // the word in the middle of it. `other` is the arm a type this build
  // does not know falls into; the log is append-only, so a row written
  // by a later build still has to read as a sentence.
  "contract.relation_added": {
    icon: Link2,
    message: defineMessage({
      id: "activity.contract.relationAdded",
      defaultMessage:
        "{actor} linked this contract — {relationType, select, renews {it renews {related}} " +
        "amends {it amends {related}} other {related to {related}}}",
    }),
    values: (intl, payload) => ({
      relationType: text(payload, "relationType") ?? "other",
      related: relatedRecord(intl, payload, "related"),
    }),
  },
  // The removal siblings of the two relation writes above (M17/4).
  "contract.relation_removed": {
    icon: Link2,
    message: defineMessage({
      id: "activity.contract.relationRemoved",
      defaultMessage:
        "{actor} unlinked this contract — {relationType, select, renews {it no longer renews {related}} " +
        "amends {it no longer amends {related}} other {no longer related to {related}}}",
    }),
    values: (intl, payload) => ({
      relationType: text(payload, "relationType") ?? "other",
      related: relatedRecord(intl, payload, "related"),
    }),
  },
  "contract.parent_removed": {
    icon: Network,
    message: defineMessage({
      id: "activity.contract.parentRemoved",
      defaultMessage: "{actor} took this contract out from under {parent}",
    }),
    values: (intl, payload) => ({ parent: relatedRecord(intl, payload, "parent") }),
  },
  "contract.matter_linked": {
    icon: Link2,
    message: defineMessage({
      id: "activity.contract.matterLinked",
      defaultMessage: "{actor} linked this contract to {matter}",
    }),
    values: (intl, payload) => ({ matter: relatedMatter(intl, payload, "matter") }),
  },
  "contract.matter_unlinked": {
    icon: Unlink,
    message: defineMessage({
      id: "activity.contract.matterUnlinked",
      defaultMessage: "{actor} unlinked this contract from {matter}",
    }),
    values: (intl, payload) => ({ matter: relatedMatter(intl, payload, "matter") }),
  },
  // The record's free-form dates (M16/3, CTR-009). A verb per act, so a
  // reader can tell a date being put on the record from one being moved
  // or taken off without opening a payload.
  //
  // Each names the date, not only the act. A removal deletes the row, so
  // its entry is the only thing left that says the date was ever there —
  // and an added or edited one names it for the same reason the feed
  // names a document: "changed a key date" sends the reader hunting.
  "key_date.added": {
    icon: CalendarPlus,
    message: defineMessage({
      id: "activity.keyDate.added",
      defaultMessage: "{actor} added the key date {label} on {date}",
    }),
    values: (intl, payload) => ({
      label: named(intl, payload, "label"),
      date: keyDateOn(intl, payload),
    }),
  },
  "key_date.edited": {
    icon: CalendarClock,
    message: defineMessage({
      id: "activity.keyDate.edited",
      defaultMessage: "{actor} changed the key date {label}",
    }),
    changes: changesFrom,
    values: (intl, payload) => ({ label: named(intl, payload, "label") }),
  },
  "key_date.removed": {
    icon: CalendarX,
    message: defineMessage({
      id: "activity.keyDate.removed",
      defaultMessage: "{actor} removed the key date {label} on {date}",
    }),
    values: (intl, payload) => ({
      label: named(intl, payload, "label"),
      date: keyDateOn(intl, payload),
    }),
  },
  // The record's task checklist (M17/1, CTR-017). A verb per act, so a
  // reader can tell a task being added from one being completed, edited,
  // reopened, or removed without opening a payload.
  //
  // Each names the task, not only the act. A removal deletes the row, so
  // its entry is the only thing left that says the task was ever there.
  "task.added": {
    icon: ListPlus,
    message: defineMessage({
      id: "activity.task.added",
      defaultMessage: "{actor} added the task {title}",
    }),
    values: (intl, payload) => ({ title: taskNamed(intl, payload) }),
  },
  "task.edited": {
    icon: PenLine,
    message: defineMessage({
      id: "activity.task.edited",
      defaultMessage: "{actor} changed the task {title}",
    }),
    changes: changesFrom,
    values: (intl, payload) => ({ title: taskNamed(intl, payload) }),
  },
  "task.completed": {
    icon: CircleCheck,
    message: defineMessage({
      id: "activity.task.completed",
      defaultMessage: "{actor} completed the task {title}",
    }),
    values: (intl, payload) => ({ title: taskNamed(intl, payload) }),
  },
  "task.reopened": {
    icon: CircleDot,
    message: defineMessage({
      id: "activity.task.reopened",
      defaultMessage: "{actor} reopened the task {title}",
    }),
    values: (intl, payload) => ({ title: taskNamed(intl, payload) }),
  },
  "task.reordered": {
    icon: ListOrdered,
    message: defineMessage({
      id: "activity.task.reordered",
      defaultMessage: "{actor} reordered the task checklist",
    }),
  },
  "task.removed": {
    icon: Trash2,
    message: defineMessage({
      id: "activity.task.removed",
      defaultMessage: "{actor} removed the task {title}",
    }),
    values: (intl, payload) => ({ title: taskNamed(intl, payload) }),
  },
  // One round of signature on the record (M15/2, M15/3, CTR-013). A
  // verb per act, so a reader can tell a completed signature from a
  // withdrawn one without opening a payload.
  //
  // The send names its actor, because a person made it. Signed and
  // declined never do: the signers sign on the provider's own ceremony,
  // and the status arrives from the provider's feed with no human here
  // behind it. A sentence reading "{actor} signed this contract" would
  // then name whoever the entry fell back to, which is nobody. A void
  // is the one ending that can be either, and it selects on which.
  "envelope.sent": {
    icon: Send,
    message: defineMessage({
      id: "activity.envelope.sent",
      defaultMessage: "{actor} sent this contract for signature",
    }),
  },
  "envelope.signed": {
    icon: PenLine,
    message: defineMessage({
      id: "activity.envelope.signed",
      defaultMessage: "This contract's envelope was signed",
    }),
  },
  // The reason rides in the sentence rather than beside it: it is the
  // one thing a reader needs before the next round goes out, and a
  // decline that arrived without words still reads.
  "envelope.declined": {
    icon: X,
    message: defineMessage({
      id: "activity.envelope.declined",
      defaultMessage:
        "This contract's envelope was declined{hasReason, select, yes { — {reason}} other {}}",
    }),
    values: (_intl, payload) => reasonValues(payload),
  },
  // The one ending a person can take (M15/4). A void on the record is
  // somebody's act and names them; a void taken in the provider's own
  // console arrives through the same feed with nobody here behind it,
  // and the passive sentence is the honest one for it.
  "envelope.voided": {
    icon: Undo2,
    message: defineMessage({
      id: "activity.envelope.voided",
      defaultMessage:
        "{hasActor, select, yes {{actor} voided this contract's envelope} " +
        "other {This contract's envelope was voided}}" +
        "{hasReason, select, yes { — {reason}} other {}}",
    }),
    values: (_intl, payload) => reasonValues(payload),
  },
  /**
   * A lawful erasure for somebody who only ever appears as a signer
   * (#280). The sentence names nobody, because the payload names
   * nobody — an entry carrying the erased address would put it back
   * into the log the erasure just took it out of.
   */
  "signer.erased": {
    icon: EraserIcon,
    message: defineMessage({
      id: "activity.signer.erased",
      defaultMessage:
        "{actor} erased an external signer's name and address from " +
        "{entriesRedacted, plural, =0 {no entries} one {# entry} other {# entries}}",
    }),
    values: (_intl, payload) => ({
      entriesRedacted: wholeCount(payload, "entriesRedacted"),
    }),
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
  // The record's paper (M11/2, M11/3, M11/4). The entry hangs off the owning
  // contract — a document's access is its owner's and nothing else
  // (DOC-008) — and it names the document, because hard deletion
  // (DOC-010) will one day take the row and the entry has to still say
  // what was uploaded.
  // A file arriving on the record, and where it landed (M13/5, DD-017).
  // The folder is named because a bulk drop's folders narrate nothing of
  // their own — this entry is the drop's whole story, so it has to say
  // where each file went. By name rather than by id, so it still reads
  // after that folder is renamed or dissolved.
  "document.created": {
    icon: Upload,
    message: defineMessage({
      id: "activity.document.created",
      defaultMessage:
        "{atRoot, select, true {{actor} uploaded {title}} " +
        "other {{actor} uploaded {title} into {folder}}}",
    }),
    values: (intl, payload) => {
      const folder = text(payload, "folderName");
      return {
        title: named(intl, payload, "title"),
        atRoot: folder === null ? "true" : "false",
        // Never read when `atRoot` is true, and never left undefined: an
        // ICU argument a locale still names has to resolve to something.
        folder: folder ?? "",
      };
    },
  },
  // A round of the negotiation, narrated as one: which document, and
  // which version of it. The number is what makes the feed readable as
  // a history rather than as a run of identical uploads.
  "document.version_added": {
    icon: FilePlus2,
    message: defineMessage({
      id: "activity.document.versionAdded",
      defaultMessage:
        "{version, select, unknown {{actor} added a version of {title}} " +
        "other {{actor} added version {version} of {title}}}",
    }),
    values: (intl, payload) => ({
      title: named(intl, payload, "title"),
      version: versionNumber(payload),
    }),
  },
  "document.version_kind_changed": {
    icon: FilePen,
    message: defineMessage({
      id: "activity.document.versionKindChanged",
      defaultMessage:
        "{version, select, unknown {{actor} changed the kind of a version of {title}} " +
        "other {{actor} changed the kind of version {version} of {title}}}",
    }),
    values: (intl, payload) => ({
      title: named(intl, payload, "title"),
      version: versionNumber(payload),
    }),
    changes: (intl, payload, context) => directChange(intl, payload, "kind", context),
  },
  // The metadata edit (DOC-007). It says the document's details changed,
  // never that a file did: the stored versions are immutable, and a
  // rename touches none of them. The old→new pairs come off the
  // `changed` map like every other edit's.
  "document.updated": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.document.updated",
      defaultMessage: "{actor} edited the details of {title}",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
    changes: changesFrom,
  },
  // Which document *is* the contract (CTR-014). The first upload takes
  // the designation without anybody asking for it, so the log says so
  // rather than leaving it implied by the upload above — the
  // counterparty promotion is written the same way, and the old→new
  // pair rides the same `from`/`to` helper.
  "document.primary_set": {
    icon: Star,
    message: defineMessage({
      id: "activity.document.primarySet",
      defaultMessage: "{actor} made {title} the primary document",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
    changes: (intl, payload, context) => directChange(intl, payload, "primaryDocument", context),
  },
  // One glyph for the pin everywhere, the way DES-009 gives
  // confidentiality one Lock: the set and the clear are two states of
  // one fact, so the sentence is what tells them apart. The set names
  // the round, because a chain reads as a history and "version 3" is
  // what makes it one.
  "document.executed_set": {
    icon: Pin,
    message: defineMessage({
      id: "activity.document.executedSet",
      defaultMessage:
        "{version, select, unknown {{actor} pinned the executed copy of {title}} " +
        "other {{actor} pinned version {version} of {title} as the executed copy}}",
    }),
    values: (intl, payload) => ({
      title: named(intl, payload, "title"),
      version: versionNumber(payload),
    }),
  },
  "document.executed_cleared": {
    icon: Pin,
    message: defineMessage({
      id: "activity.document.executedCleared",
      defaultMessage: "{actor} cleared the executed copy of {title}",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
  },
  // DOC-010's two removals (M11/5). They take the record's own archive
  // glyphs, because they are the same act one level down: a document
  // leaves the record's lists exactly as a contract leaves the list of
  // contracts, and nothing is destroyed either time.
  "document.archived": {
    icon: Archive,
    message: defineMessage({
      id: "activity.document.archived",
      defaultMessage: "{actor} archived {title}",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
  },
  "document.restored": {
    icon: ArchiveRestore,
    message: defineMessage({
      id: "activity.document.restored",
      defaultMessage: "{actor} restored {title}",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
  },
  // The erasure (DOC-010). It reads as "deleted", not as "archived",
  // because the two are different facts and this is the row an auditor
  // is looking for. The sentence names the document and how many rounds
  // went with it: after this entry there is no row left anywhere that
  // says either, which is why the payload carries both.
  "document.hard_deleted": {
    icon: Trash2,
    message: defineMessage({
      id: "activity.document.hardDeleted",
      defaultMessage:
        "{versions, plural, =0 {{actor} deleted {title} and its files} " +
        "one {{actor} deleted {title} and its # version} " +
        "other {{actor} deleted {title} and its # versions}}",
    }),
    values: (intl, payload) => ({
      title: named(intl, payload, "title"),
      versions: versionCount(payload),
    }),
  },
  // DD-014's per-document flag (M11/6). It takes the record's own Lock,
  // for the reason the record's pair gives: one glyph for
  // confidentiality everywhere, and the sentence is what tells the set
  // from the clear.
  //
  // Both entries only ever reach a reader who is inside the document's
  // audience. Anyone the flag walls out is not shown the row at all —
  // the feed leaves it out at query time, because an entry saying a
  // file was made confidential says the file is there.
  "document.confidentiality_set": {
    icon: Lock,
    message: defineMessage({
      id: "activity.document.confidentialitySet",
      defaultMessage: "{actor} marked {title} confidential",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
  },
  "document.confidentiality_cleared": {
    icon: Lock,
    message: defineMessage({
      id: "activity.document.confidentialityCleared",
      defaultMessage: "{actor} cleared the confidential mark on {title}",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
  },
  // Where a document sits in the record's tree (M13/3, DOC-006). One
  // verb for both directions, and the sentence says which one it was:
  // into a folder, or back out onto the contract itself. Both folders
  // ride the payload **by name**, because a folder is renamed and
  // dissolved freely and the id would not draw a sentence a week later.
  //
  // Whether it went to the record root is its own value rather than a
  // sentinel inside the folder's name, for `folderNarration`'s reason: a
  // folder really can be called "none".
  "document.filed": {
    icon: FolderInput,
    message: defineMessage({
      id: "activity.document.filed",
      defaultMessage:
        "{atRoot, select, true {{actor} moved {title} onto the contract} " +
        "other {{actor} filed {title} in {folder}}}",
    }),
    values: (intl, payload) => {
      const folder = text(payload, "folderName");
      return {
        title: named(intl, payload, "title"),
        atRoot: folder === null ? "true" : "false",
        // Never read when `atRoot` is true, and never left undefined: an
        // ICU argument a locale still names has to resolve to something.
        folder: folder ?? "",
      };
    },
  },
  // How the record's paper is filed (M13/2, DOC-006). Each entry names
  // the folder by the name it had at the time, because a folder is
  // renamed and dissolved freely and the row will not be there to read
  // one off a week later.
  //
  // Only manual work is narrated. A folder that a bulk drop
  // find-or-creates on its way to a file writes nothing (DOC-011): the
  // drop's story is its uploads, and the feed narrates people rather
  // than traversal.
  "folder.created": {
    icon: FolderPlus,
    message: defineMessage({
      id: "activity.folder.created",
      defaultMessage:
        "{atRoot, select, true {{actor} made the {name} folder} " +
        "other {{actor} made the {name} folder in {parent}}}",
    }),
    values: (intl, payload) => ({ ...folderNarration(intl, payload) }),
  },
  "folder.renamed": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.folder.renamed",
      defaultMessage: "{actor} renamed the {previousName} folder to {name}",
    }),
    values: (intl, payload) => ({
      name: folderNamed(intl, payload, "name"),
      previousName: folderNamed(intl, payload, "previousName"),
    }),
  },
  "folder.moved": {
    icon: FolderInput,
    message: defineMessage({
      id: "activity.folder.moved",
      defaultMessage:
        "{atRoot, select, true {{actor} moved the {name} folder onto the contract} " +
        "other {{actor} moved the {name} folder into {parent}}}",
    }),
    values: (intl, payload) => ({ ...folderNarration(intl, payload) }),
  },
  // "Deleted", and the sentence says what that means here: a folder is
  // dissolved and its contents are re-filed, so nothing was destroyed
  // and the feed must not imply that anything was.
  "folder.deleted": {
    icon: FolderX,
    message: defineMessage({
      id: "activity.folder.deleted",
      defaultMessage: "{actor} deleted the {name} folder and kept what was in it",
    }),
    values: (intl, payload) => ({ name: folderNamed(intl, payload, "name") }),
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
      // An Administrator's hard redact, in the tombstone's own words
      // (DES-025): "removed", against the author's "deleted".
      defaultMessage: "{actor} removed a comment from the record",
    }),
  },

  // ---- The Request record (INT-001) ----
  // The second record family, and the portal's own: a Request is born
  // at the front door and carries its feed into the Inbox (M21). It
  // reads "submitted" rather than "created", because that is the act a
  // requester performed — they filled a form in and pressed a button.
  "request.created": {
    icon: Inbox,
    message: defineMessage({
      id: "activity.request.created",
      defaultMessage: "{actor} submitted this request",
    }),
  },
  // INT-007's first disposition (#418). The entry says the act and names
  // the person, because who dispositioned a Request is audit data. The
  // reason is not in the payload and is not narrated: it lives on the
  // Request, where a correction can still reach it, and the log is
  // append-only.
  "request.declined": {
    icon: CircleX,
    message: defineMessage({
      id: "activity.request.declined",
      defaultMessage: "{actor} declined this request",
    }),
  },
  // INT-007's second disposition (#419). The ask was answered in the
  // thread and closed. The closing reply, where there was one, is a
  // comment on the same feed and narrates as itself — this entry is the
  // closure, so a resolution with a reply and one without read the same
  // here.
  "request.resolved": {
    icon: CircleCheck,
    message: defineMessage({
      id: "activity.request.resolved",
      defaultMessage: "{actor} resolved this request",
    }),
  },
  // INT-007's third disposition (#420), and the one the Inbox exists to
  // reach. The entry names the record the ask became, because the trail
  // from ask to work is the point of the conversion — and it names it by
  // C-###, which never changes, rather than by a title that can.
  "request.converted": {
    icon: FilePen,
    message: defineMessage({
      id: "activity.request.converted",
      defaultMessage: "{actor} converted this request into {record}",
    }),
    values: (intl, payload) => ({ record: convertedRecord(intl, payload) }),
  },

  // CMT-001's promise, kept at the conversion (#422). The conversation
  // left with the work, so the ask's own feed says where it went — by
  // its permanent reference, which never changes. There is no count in the sentence: how
  // much was said is a fact at every tier, and this entry is one a
  // Contributor reads (DD-016).
  "request.thread_moved": {
    icon: MessagesSquare,
    message: defineMessage({
      id: "activity.request.threadMoved",
      defaultMessage: "{actor} moved this conversation onto {record}",
    }),
    values: (intl, payload) => ({ record: convertedRecord(intl, payload) }),
  },

  // ---- User administration and the profile (audit log only) ----
  // These name the person acted on by their email, because that is what
  // the payload carries — a display name would need a lookup, and an
  // email is what an Administrator searched for anyway.
  "user.invited": {
    icon: UserPlus,
    message: defineMessage({
      id: "activity.user.invited",
      defaultMessage: "{actor} invited {email} as {role}",
    }),
    values: (intl, payload) => ({
      email: named(intl, payload, "email"),
      role: roleLabel(intl, String(payload.role ?? "")),
    }),
  },
  "user.invite_resent": {
    icon: UserPlus,
    message: defineMessage({
      id: "activity.user.inviteResent",
      defaultMessage: "{actor} resent the invite to {email}",
    }),
    values: (intl, payload) => ({ email: named(intl, payload, "email") }),
  },
  "user.invite_revoked": {
    icon: UserMinus,
    message: defineMessage({
      id: "activity.user.inviteRevoked",
      defaultMessage: "{actor} revoked the invite to {email}",
    }),
    values: (intl, payload) => ({ email: named(intl, payload, "email") }),
  },
  "user.role_changed": {
    icon: UserCog,
    message: defineMessage({
      id: "activity.user.roleChanged",
      defaultMessage: "{actor} changed the role of {email}",
    }),
    values: (intl, payload) => ({ email: named(intl, payload, "email") }),
    changes: roleChange,
  },
  "user.archived": {
    icon: Archive,
    message: defineMessage({
      id: "activity.user.archived",
      defaultMessage: "{actor} archived {email}",
    }),
    values: (intl, payload) => ({ email: named(intl, payload, "email") }),
  },
  "user.unarchived": {
    icon: ArchiveRestore,
    message: defineMessage({
      id: "activity.user.unarchived",
      defaultMessage: "{actor} restored {email}",
    }),
    values: (intl, payload) => ({ email: named(intl, payload, "email") }),
  },
  "user.sessions_revoked": {
    icon: LogOut,
    message: defineMessage({
      id: "activity.user.sessionsRevoked",
      defaultMessage: "{actor} signed {email} out of every session",
    }),
    values: (intl, payload) => ({ email: named(intl, payload, "email") }),
  },
  // The profile's own four. Each payload is `{field, old, new}`, and the
  // avatar's two sides are `[image]` rather than the encoded image — the
  // writer keeps a data: URI out of the log, so nothing here has to.
  "user.theme_changed": {
    icon: Palette,
    message: defineMessage({
      id: "activity.user.themeChanged",
      defaultMessage: "{actor} changed their theme",
    }),
    changes: fieldChange,
  },
  "user.timezone_changed": {
    icon: Clock,
    message: defineMessage({
      id: "activity.user.timezoneChanged",
      defaultMessage: "{actor} changed their timezone",
    }),
    changes: fieldChange,
  },
  // One notification preference (NOT-001, #320). No old→new pair: the
  // table holds overrides, so the value before a first save is a
  // default read out of application code and not a stored fact the
  // writer could have reported.
  "user.notification_preference_changed": {
    icon: Bell,
    message: defineMessage({
      id: "activity.user.notificationPreferenceChanged",
      // Whole clauses per case rather than an interpolated noun: a
      // language that inflects around the channel or the group cannot
      // be served by dropping words into one frame. The `other` arms
      // echo the slug, because the log is append-only and a group this
      // build no longer has is still in a payload.
      defaultMessage:
        "{actor} turned {channel, select, in_app {bell items} email {emails} other {{channel}}} " +
        "{state, select, on {on} off {off} other {{state}}} for " +
        "{group, select, assigned_to_you {direct asks} " +
        "activity_on_your_records {activity on their records} " +
        "dates_approaching {approaching dates} new_requests {new requests} " +
        "requester_events {requester events} other {{group}}}",
    }),
    values: (intl, payload) => ({
      // Their own fallbacks rather than {@link named}'s, because that
      // one is a person's — "turned someone off for someone" is not a
      // sentence. Either fallback lands in the select's `other` arm.
      channel:
        text(payload, "channel") ??
        intl.formatMessage({
          id: "activity.notificationPreference.unknownChannel",
          defaultMessage: "a channel",
        }),
      group:
        text(payload, "eventGroup") ??
        intl.formatMessage({
          id: "activity.notificationPreference.unknownGroup",
          defaultMessage: "an event group",
        }),
      // Same reasoning one line up, applied to the direction: anything
      // that is not a boolean is a payload this build did not write, and
      // "turned emails off" about a person who turned them on is a
      // sentence the append-only log can never take back. Saying which
      // way is unknown costs one clause; guessing costs the record.
      state:
        typeof payload.enabled === "boolean"
          ? payload.enabled
            ? "on"
            : "off"
          : intl.formatMessage({
              id: "activity.notificationPreference.unknownState",
              defaultMessage: "on or off",
            }),
    }),
  },
  "user.display_name_changed": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.user.displayNameChanged",
      defaultMessage: "{actor} changed their display name",
    }),
    changes: fieldChange,
  },
  "user.avatar_changed": {
    icon: ImageIcon,
    message: defineMessage({
      id: "activity.user.avatarChanged",
      defaultMessage: "{actor} changed their avatar",
    }),
  },
  "user.password_changed": {
    icon: KeyRound,
    message: defineMessage({
      id: "activity.user.passwordChanged",
      defaultMessage: "{actor} changed their password",
    }),
  },
  "user.other_sessions_revoked": {
    icon: LogOut,
    message: defineMessage({
      id: "activity.user.otherSessionsRevoked",
      defaultMessage: "{actor} signed out their other sessions",
    }),
  },
  "user.two_factor_enrolled": {
    icon: ShieldCheck,
    message: defineMessage({
      id: "activity.user.twoFactorEnrolled",
      defaultMessage: "{actor} turned on two-factor authentication",
    }),
  },
  "user.two_factor_disabled": {
    icon: ShieldOff,
    message: defineMessage({
      id: "activity.user.twoFactorDisabled",
      defaultMessage: "{actor} turned off two-factor authentication",
    }),
  },

  // ---- The organization's own settings ----
  // One entry per changed field, so the sentence names the surface and
  // the change line names the field. Naming the field in the sentence
  // would need the label lowercased into prose, which is a translation
  // trap for the sake of one word.
  "org_settings.updated": {
    icon: Settings,
    message: defineMessage({
      id: "activity.orgSettings.updated",
      defaultMessage: "{actor} changed the organization settings",
    }),
    changes: fieldChange,
  },

  // ---- The identity provider ----
  "sso_provider.registered": {
    icon: Globe,
    message: defineMessage({
      id: "activity.ssoProvider.registered",
      defaultMessage: "{actor} connected the identity provider {provider}",
    }),
    values: (intl, payload) => ({ provider: named(intl, payload, "providerId") }),
  },
  "sso_provider.updated": {
    icon: Globe,
    message: defineMessage({
      id: "activity.ssoProvider.updated",
      defaultMessage: "{actor} changed the identity provider {provider}",
    }),
    values: (intl, payload) => ({ provider: named(intl, payload, "providerId") }),
    // The secret's two sides are both `[secret]`: the writer records
    // that it was rotated and never what it was.
    changes: fieldChange,
  },

  // ---- The e-signature connector (CTR-013) ----
  // Two verbs, so the audit log tells connecting an install to a
  // provider apart from rotating a key on the one it already has. Both
  // secrets read as `[secret]` on each side, for the identity
  // provider's reason.
  "signing_connector.configured": {
    icon: Plug,
    message: defineMessage({
      id: "activity.signingConnector.configured",
      defaultMessage: "{actor} connected the e-signature provider {provider}",
    }),
    values: (intl, payload) => ({ provider: named(intl, payload, "provider") }),
  },
  "signing_connector.updated": {
    icon: Plug,
    message: defineMessage({
      id: "activity.signingConnector.updated",
      defaultMessage: "{actor} changed the e-signature connector {provider}",
    }),
    values: (intl, payload) => ({ provider: named(intl, payload, "provider") }),
    changes: fieldChange,
  },
  // Turned off, and taken out. Two sentences rather than one, because
  // they are two different facts about where the credentials are —
  // which is the question a reader of this log is asking. Three icons
  // for the same reason: a scanned feed that drew "turned off" and
  // "removed, credentials and all" with one glyph would hide exactly
  // the distinction the sentences exist to draw.
  "signing_connector.disabled": {
    icon: Unplug,
    message: defineMessage({
      id: "activity.signingConnector.disabled",
      defaultMessage:
        "{actor} turned off the e-signature connector {provider}, with {liveEnvelopes, plural, =0 {nothing out for signature} one {# round still out for signature} other {# rounds still out for signature}}",
    }),
    values: (intl, payload) => ({
      provider: named(intl, payload, "provider"),
      liveEnvelopes: wholeCount(payload, "liveEnvelopes"),
    }),
  },
  "signing_connector.enabled": {
    icon: Plug,
    message: defineMessage({
      id: "activity.signingConnector.enabled",
      defaultMessage: "{actor} turned on the e-signature connector {provider}",
    }),
    values: (intl, payload) => ({ provider: named(intl, payload, "provider") }),
  },
  "signing_connector.removed": {
    icon: Trash2,
    message: defineMessage({
      id: "activity.signingConnector.removed",
      defaultMessage: "{actor} removed the e-signature connector {provider} and its credentials",
    }),
    values: (intl, payload) => ({ provider: named(intl, payload, "provider") }),
  },

  // ---- The settings taxonomies and the field catalog ----
  ...taxonomyArms("contract_type", Tag, TAXONOMY_VERBS),
  ...taxonomyArms("matter_type", Tag, TAXONOMY_VERBS),
  ...taxonomyArms("entity_type", Tag, TAXONOMY_VERBS),
  ...taxonomyArms("officer_role", Tag, TAXONOMY_VERBS),
  ...taxonomyArms("request_type", Tag, TAXONOMY_VERBS),
  // A status has a stage rather than a description, so it never writes
  // the `updated` verb.
  ...taxonomyArms("contract_status", GitCommitHorizontal, [
    "created",
    "renamed",
    "reordered",
    "archived",
    "restored",
    "deleted",
  ]),
  ...taxonomyArms("matter_status", GitCommitHorizontal, [
    "created",
    "renamed",
    "reordered",
    "archived",
    "restored",
    "deleted",
  ]),
  // The INT-004 deflection links (#356). Not a taxonomy mount: a link
  // has no slug and no archive, and the thing it is named by is its
  // label — so it gets four sentences of its own rather than seven
  // borrowed ones. Each says "deflection link" out loud, because a
  // reader of the audit log has nothing else to tell it from the
  // taxonomies above.
  "intake_link.created": {
    icon: Link2,
    message: defineMessage({
      id: "activity.intakeLink.created",
      defaultMessage:
        "{actor} added the deflection link {name} to " +
        "{onHome, select, true {the portal home} other {{placement}}}",
    }),
    // A boolean select rather than a sentinel string: the placement is
    // a request type's display name, and a type an Administrator named
    // "Portal home" must not be able to pick the wrong arm.
    values: (intl, payload) => ({
      name: linkNamed(intl, payload),
      onHome: String(text(payload, "placement") === null),
      placement: text(payload, "placement") ?? "",
    }),
  },
  "intake_link.updated": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.intakeLink.updated",
      defaultMessage: "{actor} changed the deflection link {name}",
    }),
    values: (intl, payload) => ({ name: linkNamed(intl, payload) }),
    changes: (intl, payload) => intakeLinkChanges(intl, payload),
  },
  "intake_link.reordered": {
    icon: ListOrdered,
    message: defineMessage({
      id: "activity.intakeLink.reordered",
      defaultMessage: "{actor} reordered the deflection links",
    }),
  },
  "intake_link.deleted": {
    icon: Trash2,
    message: defineMessage({
      id: "activity.intakeLink.deleted",
      defaultMessage: "{actor} removed the deflection link {name}",
    }),
    values: (intl, payload) => ({ name: linkNamed(intl, payload) }),
  },
  // The catalog is unordered (DES-021), names through its editor dialog
  // rather than a rename verb, and is never hard-deleted.
  ...taxonomyArms("field", Tags, ["created", "updated", "archived", "restored"]),
  // The CTR-012 approver-group templates (M14/1). Unordered like the
  // catalog, and never hard-deleted; unlike the catalog it renames in
  // place and carries a description, so it writes both `renamed` and
  // `updated`.
  ...taxonomyArms("approver_group", Users, [
    "created",
    "renamed",
    "updated",
    "archived",
    "restored",
  ]),
  ...taxonomyArms("matter_template", ListPlus, ["created", "updated", "archived", "restored"]),
  // Who is on a template is its own fact, not an edit of it — the rule
  // the contract team's entries follow (CTR-004).
  "approver_group.member_added": {
    icon: Users,
    message: defineMessage({
      id: "activity.approverGroup.memberAdded",
      defaultMessage: "{actor} added {member} to the approver group {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      member: named(intl, payload, "memberName"),
    }),
  },
  "approver_group.member_removed": {
    icon: Users,
    message: defineMessage({
      id: "activity.approverGroup.memberRemoved",
      defaultMessage: "{actor} took {member} off the approver group {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      member: named(intl, payload, "memberName"),
    }),
  },
  // The catalog's two scope moves keep their own verbs, because the
  // scope is what decides which modules can attach the field.
  "field.promoted": {
    icon: Tags,
    message: defineMessage({
      id: "activity.field.promoted",
      defaultMessage: "{actor} widened the field {name} to every module",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
    changes: (intl, payload, context) => directChange(intl, payload, "moduleScope", context),
  },
  "field.narrowed": {
    icon: Tags,
    message: defineMessage({
      id: "activity.field.narrowed",
      defaultMessage: "{actor} narrowed the field {name} to one module",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
    changes: (intl, payload, context) => directChange(intl, payload, "moduleScope", context),
  },

  // ---- Fields attached to a type ----
  ...typeFieldArms("contract_type_field"),
  ...typeFieldArms("entity_type_field"),
  ...typeFieldArms("matter_type_field"),
  ...typeFieldArms("request_type_field"),

  // ---- The Entities registry (M7) ----
  // Its own feed is not mounted yet (DD-017's clarification), so the
  // audit log is where these read today.
  "entity.created": {
    icon: Building2,
    message: defineMessage({
      id: "activity.entity.created",
      defaultMessage: "{actor} registered {name}",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
  },
  "entity.updated": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.entity.updated",
      defaultMessage: "{actor} changed {name}",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
    changes: changesFrom,
  },
  "entity.status_changed": {
    icon: GitCommitHorizontal,
    message: defineMessage({
      id: "activity.entity.statusChanged",
      defaultMessage: "{actor} changed the status of {name}",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
    changes: (intl, payload, context) => directChange(intl, payload, "status", context),
  },
  "entity.type_reassigned": {
    icon: Tag,
    message: defineMessage({
      id: "activity.entity.typeReassigned",
      defaultMessage: "{actor} re-typed {name}",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
    changes: (intl, payload, context) => directChange(intl, payload, "entityType", context),
  },
  "entity.archived": {
    icon: Archive,
    message: defineMessage({
      id: "activity.entity.archived",
      defaultMessage: "{actor} archived {name}",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
  },
  "entity.restored": {
    icon: ArchiveRestore,
    message: defineMessage({
      id: "activity.entity.restored",
      defaultMessage: "{actor} restored {name}",
    }),
    values: (intl, payload) => ({ name: thingName(intl, payload) }),
  },
  "entity_officer.created": {
    icon: UserPlus,
    message: defineMessage({
      id: "activity.entityOfficer.created",
      defaultMessage: "{actor} appointed {officer} as {role} on {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      officer: named(intl, payload, "officerName"),
      role: named(intl, payload, "role"),
    }),
  },
  "entity_officer.updated": {
    icon: UserCog,
    message: defineMessage({
      id: "activity.entityOfficer.updated",
      defaultMessage: "{actor} changed officer {officer} on {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      officer: named(intl, payload, "officerName"),
    }),
    changes: changesFrom,
  },
  "entity_officer.deleted": {
    icon: UserMinus,
    message: defineMessage({
      id: "activity.entityOfficer.deleted",
      defaultMessage: "{actor} removed officer {officer} from {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      officer: named(intl, payload, "officerName"),
    }),
  },
  "entity_registration.created": {
    icon: Globe,
    message: defineMessage({
      id: "activity.entityRegistration.created",
      defaultMessage: "{actor} added the {jurisdiction} registration to {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      jurisdiction: named(intl, payload, "jurisdiction"),
    }),
  },
  "entity_registration.updated": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.entityRegistration.updated",
      defaultMessage: "{actor} changed the {jurisdiction} registration on {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      jurisdiction: named(intl, payload, "jurisdiction"),
    }),
    changes: changesFrom,
  },
  "entity_registration.deleted": {
    icon: Trash2,
    message: defineMessage({
      id: "activity.entityRegistration.deleted",
      defaultMessage: "{actor} removed the {jurisdiction} registration from {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      jurisdiction: named(intl, payload, "jurisdiction"),
    }),
  },
  "entity_holding.created": {
    icon: Network,
    message: defineMessage({
      id: "activity.entityHolding.created",
      defaultMessage: "{actor} recorded {owner} owning {percent}% of {owned}",
    }),
    values: (intl, payload) => ({
      owner: named(intl, payload, "ownerName"),
      owned: named(intl, payload, "ownedName"),
      percent: named(intl, payload, "ownershipPercent"),
    }),
  },
  "entity_holding.updated": {
    icon: Network,
    message: defineMessage({
      id: "activity.entityHolding.updated",
      defaultMessage: "{actor} changed {owner}'s Holding in {owned} from {from}% to {to}%",
    }),
    values: (intl, payload) => ({
      owner: named(intl, payload, "ownerName"),
      owned: named(intl, payload, "ownedName"),
      from: named(intl, payload, "from"),
      to: named(intl, payload, "to"),
    }),
  },
  "entity_holding.deleted": {
    icon: Network,
    message: defineMessage({
      id: "activity.entityHolding.deleted",
      defaultMessage: "{actor} removed {owner}'s {percent}% Holding in {owned}",
    }),
    values: (intl, payload) => ({
      owner: named(intl, payload, "ownerName"),
      owned: named(intl, payload, "ownedName"),
      percent: named(intl, payload, "ownershipPercent"),
    }),
  },
  "entity_obligation.created": {
    icon: CalendarPlus,
    message: defineMessage({
      id: "activity.entityObligation.created",
      defaultMessage: "{actor} added the obligation {obligation} to {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      obligation: named(intl, payload, "label"),
    }),
  },
  "entity_obligation.updated": {
    icon: PencilLine,
    message: defineMessage({
      id: "activity.entityObligation.updated",
      defaultMessage: "{actor} changed the obligation {obligation} on {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      obligation: named(intl, payload, "label"),
    }),
    changes: changesFrom,
  },
  "entity_obligation.deleted": {
    icon: CalendarX,
    message: defineMessage({
      id: "activity.entityObligation.deleted",
      defaultMessage: "{actor} removed the obligation {obligation} from {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      obligation: named(intl, payload, "label"),
    }),
  },
  "entity_obligation.filed": {
    icon: Check,
    message: defineMessage({
      id: "activity.entityObligation.filed",
      defaultMessage: "{actor} marked {obligation} filed on {name}",
    }),
    values: (intl, payload) => ({
      name: thingName(intl, payload),
      obligation: named(intl, payload, "label"),
    }),
  },

  // ---- Data leaving the system ----
  // The one entry the audit log writes about itself (DD-017). The
  // filters it was taken under are in the payload; the sentence says
  // that an export happened, which is the fact an auditor is reading
  // for.
  "export.performed": {
    icon: Download,
    message: defineMessage({
      id: "activity.export.performed",
      defaultMessage: "{actor} exported the audit log",
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

/**
 * The arm for a slug read off the wire, if this build has one.
 *
 * The lookup takes a plain string, and it has to: `ARMS` is keyed by
 * this build's vocabulary, and the row is as old as the build that
 * wrote it. Answering `undefined` for the rest is the fallback's cue.
 *
 * **By own key only.** `ARMS` is an object literal, so a bare index
 * would answer for keys nobody wrote: a row whose action is
 * `constructor` would read a function, and `__proto__` would read
 * `Object.prototype`. Neither is an arm, and both would take the panel
 * down on the one thing the fallback exists to survive — a slug this
 * build has never heard of. Nothing constrains the `action` column
 * (DD-017), so the row can say anything.
 */
function armFor(action: string): Arm | undefined {
  return Object.hasOwn(ARMS, action) ? (ARMS as Readonly<Record<string, Arm>>)[action] : undefined;
}

/** One entry, narrated. Every arm reads its payload defensively; none of
 * them throws, and a slug with no arm falls through to `UNKNOWN`. */
export function narrateActivity(
  intl: IntlShape,
  entry: NarratableEntry,
  context: NarrationContext = {},
): Narration {
  const actor = actorName(intl, entry);
  // Whether a person is behind this entry at all, for the one verb that
  // both a person and the integration can take: an envelope voided on
  // the record names the voider, and one voided in the provider's own
  // console has nobody here to name. Every sentence gets it, because
  // ICU takes what it is given and ignores what it does not use, and a
  // second machinery for one arm would be a machinery to maintain.
  const hasActor = entry.actor ? "yes" : "no";
  const arm = armFor(entry.action);
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
      hasActor,
      ...arm.values?.(intl, entry.payload, changes),
    }),
    changes,
  };
}
