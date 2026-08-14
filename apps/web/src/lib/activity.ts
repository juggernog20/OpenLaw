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
 * The vocabulary narrated here is the whole of it. A record feed can
 * only contain `contract.*` and `comment.*`, and those came first
 * (M9/6); the Administrator's audit log reads the table with no entity
 * scope and no tier filter, so it reaches everything — user
 * administration, settings, the taxonomies, the field catalog, the
 * registry, the identity provider, and an export of the log itself.
 * Those arms landed with that surface (M9/7). Adding an action family
 * is adding entries to `ARMS`, and nothing else.
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
  Clock,
  Download,
  FilePlus2,
  GitCommitHorizontal,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Link2,
  ListOrdered,
  Lock,
  LogOut,
  MessageSquare,
  Palette,
  PencilLine,
  Settings,
  ShieldCheck,
  ShieldOff,
  SquareCheck,
  Tag,
  Tags,
  Trash2,
  Unlink,
  Upload,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { defineMessage, type IntlShape, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { formatShortDate } from "./format";
import { roleLabel } from "./roles";
import {
  formatContractValue,
  riskLabel,
  severityLabel,
  type ContractValue,
  type SeverityLevel,
} from "./contracts";

type FeedResponse =
  paths["/api/v1/activity"]["get"]["responses"]["200"]["content"]["application/json"];

/** One activity entry as the record feed answers it. */
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
 */
type Payload = NarratableEntry["payload"];

/** Who acted, as the sentence names them. A system-emitted entry has no
 * human actor, and saying so beats inventing one. */
function actorName(intl: IntlShape, entry: NarratableEntry): string {
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
        "entity {Signing entity} priority {Priority} risk {Risk} " +
        "contractType {Contract type} value {Value} status {Status} " +
        "primaryCounterparty {Primary counterparty} " +
        "displayName {Name} display_name {Display name} name {Name} " +
        "role {Role} email {Email} " +
        "stage {Stage} moduleScope {Scope} isRequired {Required} " +
        "theme {Theme} timezone {Timezone} avatar {Avatar} logo {Logo} " +
        "defaultLocale {Default language} defaultTimezone {Default timezone} " +
        "authMode {Sign-in method} allowedEmailDomains {Allowed email domains} " +
        "smtpUrl {SMTP server} smtpFrom {From address} " +
        "issuer {Issuer} domain {Email domain} clientId {Client ID} " +
        "clientSecret {Client secret} " +
        "legalName {Legal name} entityType {Entity type} " +
        "jurisdiction {Jurisdiction} formedOn {Formed on} " +
        "registrationNumber {Registration number} taxId {Tax ID} " +
        "registeredAgent {Registered agent} registeredAddress {Registered address} " +
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

/** What a payload calls somebody or something it names, when it does.
 * A name that is not there is not a reason to render nothing. */
function named(intl: IntlShape, payload: Payload, key: string): string {
  return (
    text(payload, key) ?? intl.formatMessage({ id: "activity.someone", defaultMessage: "someone" })
  );
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
 * The settings taxonomies say the same seven things about five
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
      "contract_status {contract status} field {field} other {type}} {name}",
  }),
  renamed: defineMessage({
    id: "activity.taxonomy.renamed",
    defaultMessage:
      "{actor} renamed the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "contract_status {contract status} field {field} other {type}} {name}",
  }),
  updated: defineMessage({
    id: "activity.taxonomy.updated",
    defaultMessage:
      "{actor} changed the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "contract_status {contract status} field {field} other {type}} {name}",
  }),
  reordered: defineMessage({
    id: "activity.taxonomy.reordered",
    defaultMessage:
      "{actor} reordered the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "contract_status {contract status} field {field} other {type}} list",
  }),
  archived: defineMessage({
    id: "activity.taxonomy.archived",
    defaultMessage:
      "{actor} archived the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "contract_status {contract status} field {field} other {type}} {name}",
  }),
  restored: defineMessage({
    id: "activity.taxonomy.restored",
    defaultMessage:
      "{actor} restored the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "contract_status {contract status} field {field} other {type}} {name}",
  }),
  deleted: defineMessage({
    id: "activity.taxonomy.deleted",
    defaultMessage:
      "{actor} deleted the {kind, select, contract_type {contract type} " +
      "matter_type {matter type} entity_type {entity type} " +
      "contract_status {contract status} field {field} other {type}} {name}",
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
function taxonomyArms(
  kind: string,
  icon: LucideIcon,
  verbs: readonly (keyof typeof TAXONOMY)[],
): Record<string, Arm> {
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
  return Object.fromEntries(verbs.map((verb) => [`${kind}.${verb}`, arms[verb]]));
}

/** The seven a settings taxonomy writes (contract, matter, and entity
 * types), in one place because three lists share them. */
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
 * The two type-field prefixes attach the same catalog to two different
 * types, so they share four sentences and name which type inside them,
 * for the reason the taxonomies do.
 */
const TYPE_FIELD = {
  attached: defineMessage({
    id: "activity.typeField.attached",
    defaultMessage:
      "{actor} attached the field {field} to the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "other {type}} {type}",
  }),
  detached: defineMessage({
    id: "activity.typeField.detached",
    defaultMessage:
      "{actor} detached the field {field} from the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "other {type}} {type}",
  }),
  reordered: defineMessage({
    id: "activity.typeField.reordered",
    defaultMessage:
      "{actor} reordered the fields on the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "other {type}} {type}",
  }),
  requiredChanged: defineMessage({
    id: "activity.typeField.requiredChanged",
    defaultMessage:
      "{actor} made the field {field} {required, select, true {required} " +
      "other {optional}} on the {owner, select, " +
      "contract_type_field {contract type} matter_type_field {matter type} " +
      "other {type}} {type}",
  }),
} as const;

/** The same four arms for one type-field prefix, keyed by slug. */
function typeFieldArms(owner: string): Record<string, Arm> {
  const values = (intl: IntlShape, payload: Payload) => ({
    owner,
    type: named(intl, payload, "typeSlug"),
    field: named(intl, payload, "fieldSlug"),
    required: String(payload.isRequired === true),
  });
  return {
    [`${owner}.attached`]: { icon: Link2, message: TYPE_FIELD.attached, values },
    [`${owner}.detached`]: { icon: Unlink, message: TYPE_FIELD.detached, values },
    [`${owner}.reordered`]: { icon: ListOrdered, message: TYPE_FIELD.reordered, values },
    [`${owner}.required_changed`]: {
      icon: SquareCheck,
      message: TYPE_FIELD.requiredChanged,
      values,
    },
  };
}

/**
 * The whole vocabulary, narrated. `contract.*` is a record's own story
 * and `comment.*` the conversation on it — those two are all a record
 * feed can contain (M9/6). Everything after them is what the
 * Administrator's audit log reaches and no record feed does (M9/7):
 * user administration, settings, the taxonomies, the field catalog, the
 * registry, the identity provider, and an export of the log itself.
 *
 * A slug that is not here reads through the fallback at the bottom of
 * `narrateActivity`, which is what makes this table safe to be
 * incomplete — and it will be, because the log outlives the code that
 * wrote it.
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
  // The record's paper (M11/2). The entry hangs off the owning contract
  // — a document's access is its owner's and nothing else (DOC-008) —
  // and it names the document, because hard deletion (DOC-010) will one
  // day take the row and the entry has to still say what was uploaded.
  "document.created": {
    icon: Upload,
    message: defineMessage({
      id: "activity.document.created",
      defaultMessage: "{actor} uploaded {title}",
    }),
    values: (intl, payload) => ({ title: named(intl, payload, "title") }),
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

  // ---- The settings taxonomies and the field catalog ----
  ...taxonomyArms("contract_type", Tag, TAXONOMY_VERBS),
  ...taxonomyArms("matter_type", Tag, TAXONOMY_VERBS),
  ...taxonomyArms("entity_type", Tag, TAXONOMY_VERBS),
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
  // The catalog is unordered (DES-021), names through its editor dialog
  // rather than a rename verb, and is never hard-deleted.
  ...taxonomyArms("field", Tags, ["created", "updated", "archived", "restored"]),
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
  ...typeFieldArms("matter_type_field"),

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

/** One entry, narrated. Every arm reads its payload defensively; none of
 * them throws, and a slug with no arm falls through to `UNKNOWN`. */
export function narrateActivity(
  intl: IntlShape,
  entry: NarratableEntry,
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
