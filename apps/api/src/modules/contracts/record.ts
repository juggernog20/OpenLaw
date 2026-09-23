// SPDX-License-Identifier: AGPL-3.0-only

import {
  activityLog,
  alias,
  and,
  asc,
  CONTRACT_STAGES,
  CONTRACT_VALUE_CADENCES,
  contractCounterparties,
  contracts,
  contractStatuses,
  contractTeam,
  contractTypeFields,
  contractTypes,
  counterparties,
  departments,
  desc,
  entities,
  eq,
  inArray,
  ne,
  SEVERITY_LEVELS,
  sql,
  TERM_TYPES,
  USER_ROLES,
  users,
  type AnyPgColumn,
  type Contract,
  type CustomFieldValue,
  type Executor,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import {
  CONTRACT_SORT_KEYS,
  MAX_CONTRACT_CLASSIFICATION_LENGTH,
  MAX_CONTRACT_TITLE_LENGTH,
  SORT_DIRECTIONS,
  type ActivityPayloadMap,
  type ContractSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { z } from "zod";
import { type AuthenticatedUser } from "../../auth/guards.js";
import {
  confidentialityWrite,
  contractTeamScope,
  NO_CONTRACT,
  reachesLockedContract,
} from "../../lib/contract-access.js";
import {
  daysRemaining,
  noticeDeadline,
  proposedRollExpiry,
  renewalPending,
} from "../../lib/contract-term.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
  projectCustomFields,
  selectAttachedFields,
  type AttachedCustomField,
} from "../../lib/custom-fields.js";
import { entityReachScope } from "../../lib/entity-access.js";
import { nextDeadline, NextDeadlineSchema } from "../../lib/next-deadline.js";
import { httpError } from "../../lib/problem.js";
import { FilterChoices, validDateRanges } from "../../lib/record-filters.js";
import { FormNodeSchema } from "../../lib/type-form-routes.js";
import { AnalysisRunSchema } from "../contract-analysis/routes.js";
import { OriginalIntakeSchema } from "../requests/original-intake.js";
import { CONTRACT_RENEWAL_VEHICLES } from "./create.js";

/**
 * How many contracts one read answers (CTR-024).
 *
 * Server-fixed, like the audit log's — the client cannot ask for more,
 * so no client can turn one request into a whole-table scan. 50 rather
 * than the activity feed's 25 because this is a table somebody scans,
 * not a feed somebody reads.
 */
export const PAGE_SIZE = 50;

/**
 * How many confirmed rolls the record envelope carries (CTR-006).
 *
 * The history is read out of the activity log on every record read, and
 * a contract that rolls monthly grows it without end. 50 matches the
 * table page above, because the renewals are drawn as a table too, and
 * a record that has rolled more than fifty times is asking a question
 * the feed answers better than the card does.
 */
const RENEWAL_HISTORY_LIMIT = 50;

/** A cursor is a contract id, and nothing longer is worth reading. */
const CursorSchema = z.string().min(1).max(64);

/** The sort the list was asked for, or null for its natural order. */
export interface SortRequest {
  key: ContractSortKey;
  dir: SortDirection;
}

/**
 * DES-018's severity ramp as a number the database can order.
 *
 * `priority` and `risk` hold slugs, and ordering slugs sorts them
 * critical, high, low, medium — an alphabet, not a ramp. The `case`
 * restates the sequence DES-018 already fixed, so "sort by risk" answers
 * what the word means. Built from `SEVERITY_LEVELS` rather than written
 * out, so a level added to the ramp cannot be left out of the ordering.
 *
 * NULL stays NULL: risk unassessed is not low risk (CTR-005), and the
 * ordering puts it with the other unknowns at the end.
 */
function severityRank(column: AnyPgColumn): SQL {
  const arms = SEVERITY_LEVELS.map(
    (level, index) => sql`when ${level} then ${sql.raw(String(index + 1))}`,
  );
  return sql`case ${column} ${sql.join(arms, sql` `)} end`;
}

export const SeveritySchema = z.enum(SEVERITY_LEVELS);

/**
 * The ISO 4217 codes this instance accepts, taken from the runtime's own
 * CU/ICU tables rather than a list checked into the repository: a
 * hand-kept list is a list that goes stale, and picking a shorter one
 * would be an unrecorded product decision about which currencies a
 * self-hoster may trade in.
 */
const ISO_4217 = new Set(Intl.supportedValuesOf("currency"));

/**
 * CTR-010's value, as every surface reads it: the amount as an integer
 * count of the currency's smallest unit (cents for USD, yen for JPY),
 * the ISO 4217 code that says which unit that is, and what the amount
 * is per. Null as a whole — no value recorded is normal, which is what
 * an NDA looks like — never null in part.
 */
const ContractValueSchema = z.object({
  amount: z.int().nonnegative(),
  currency: z.string(),
  cadence: z.enum(CONTRACT_VALUE_CADENCES),
  cadenceDescription: z.string().trim().max(100).optional(),
});

/**
 * The same trio on the way in. All three are required together, so the
 * seam cannot be handed an amount with no currency; `null` in place of
 * the object is how the whole value is cleared. Case is normalized, so
 * "usd" and "USD" are one currency and never two rows that disagree.
 */
export const ContractValueInput = z
  .strictObject({
    amount: z.int().nonnegative(),
    currency: z
      .string()
      .trim()
      .transform((code) => code.toUpperCase())
      .refine((code) => ISO_4217.has(code), {
        message: "Use a three-letter ISO 4217 currency code.",
      }),
    cadence: z.enum(CONTRACT_VALUE_CADENCES),
    cadenceDescription: z.string().trim().max(100).optional(),
  })
  .refine(
    (value) =>
      value.cadence === "other"
        ? !!value.cadenceDescription
        : value.cadenceDescription === undefined,
    {
      message: "Enter a custom cadence only when Other is selected.",
      path: ["cadenceDescription"],
    },
  );

/** CTR-006's three kinds of commitment. Code branches on it, so it is a
 * fixed enum rather than an admin-configurable list. */
export const TermTypeSchema = z.enum(TERM_TYPES);

/**
 * The two term periods, bounded exactly as the database bounds them.
 *
 * A roll of zero months would advance an expiry to itself and a
 * negative notice period would put the deadline after the date it warns
 * about; neither is a term. The ceilings are generous rather than
 * meaningful — a century of months, a century of days — and they are
 * here so a slip reads as a refusal at the seam rather than as a
 * constraint violation out of Postgres.
 */
export const RenewalPeriodSchema = z.int().min(1).max(1200);

export const NoticePeriodSchema = z.int().min(0).max(36_500);

/**
 * CTR-007's two routed vehicles, and which record the renewal is being
 * routed from (M16/5).
 *
 * The other two vehicles are not here, because neither makes a record.
 * Confirming the roll moves the predecessor's own expiry and has its own
 * route; papering the renewal as an amendment files a version on the
 * primary document's chain, which is the M11 write path and needs
 * nothing from this one.
 *
 * The vehicle vocabulary itself belongs to the write, so the wire takes
 * exactly what the write accepts and neither can be widened without the
 * other.
 */
export const RenewalOfSchema = z.strictObject({
  /** The predecessor's CTR-003 number — the reference a person speaks,
   * exactly as every other contract route takes it. */
  number: z.int().positive(),
  vehicle: z.enum(CONTRACT_RENEWAL_VEHICLES),
});

/** A person as every contract surface renders them: name and face, plus
 * the SET-005 archived flag the shared identity component greys on. */
const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

/** One `contract_team` row, read back as the person. DD-023 keeps one
 * membership per person, so a name appears once. */
const TeamMemberSchema = PersonSchema;

/** One of our own Entities as the contract record names it (CTR-011):
 * the id the picker commits and the legal name that goes on the paper.
 * Archiving an entity later never touches the record — the contract
 * keeps naming who signed it, and the registry is where its standing is
 * read. Nothing more of the identity card is joined in: the record
 * renders a name, not a card. */
const SigningEntitySchema = z.discriminatedUnion("restricted", [
  z.object({ restricted: z.literal(false), id: z.string(), legalName: z.string() }),
  z.object({ restricted: z.literal(true) }),
]);

/** Their side, as a list needs it (CTR-011): one name per contract. The
 * primary is the party the contracts list column and the record name
 * first. NULL means nobody is recorded on the other side yet. */
const PrimaryCounterpartySchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** One party on the record, with the jurisdiction that tells two
 * same-named organizations apart and the flag that says which one the
 * list shows. */
const CounterpartySchema = PrimaryCounterpartySchema.extend({
  jurisdiction: z.string().nullable(),
  isPrimary: z.boolean(),
});

export const ContractRowSchema = z.object({
  id: z.string(),
  /** CTR-003's immutable global reference, rendered C-###. */
  number: z.number().int(),
  title: z.string(),
  contractTypeId: z.string(),
  /** The type's display name, joined in — the list renders it directly. */
  contractTypeName: z.string(),
  statusId: z.string(),
  /** The status's configurable label (CTR-001) — presentation only. */
  statusName: z.string(),
  /** Derived from the status, never stored; code branches on this. */
  stage: z.enum(CONTRACT_STAGES),
  /** CTR-004's single accountable person, labelled "Owner" in the UI.
   * NULL = unassigned, which reads as triage, not as missing data. */
  manager: PersonSchema.nullable(),
  /** DD-021 business contact, independent of the Legal Owner; null means unassigned. */
  businessOwner: PersonSchema.nullable(),
  createdBy: z.string().nullable().optional(),
  /** CTR-011's our side: which of our Entities signs. NULL until known.
   * The list does not draw it (the C1 mock has no such column), but it
   * is a field of the record, and a field rides the row the per-field
   * PATCH answers with — the same place `description` sits. */
  entity: SigningEntitySchema.nullable(),
  /** CTR-011's their side, reduced to the one name a row can show: the
   * primary counterparty. The C1 mock draws it as a list column, so it
   * rides the row every route answers with. The full party list is the
   * record's, and rides the record envelope. */
  primaryCounterparty: PrimaryCounterpartySchema.nullable(),
  priority: SeveritySchema,
  /** NULL = not yet assessed, which is not the same as low (CTR-005). */
  risk: SeveritySchema.nullable(),
  /** CTR-010's amount, currency, and cadence as one field. NULL = no
   * value is recorded, which is normal — an NDA is worth nothing and
   * says nothing about money. The C1 mock draws it as a list column, so
   * it rides every row, not just the record's. */
  value: ContractValueSchema.nullable(),
  /** CTR-006's term type. Not null: every contract is one of the three
   * kinds whether or not anybody has said so, and `fixed` is what a
   * record starts on. */
  termType: TermTypeSchema,
  /** When the term starts; NULL until known. */
  effectiveDate: z.iso.date().nullable(),
  /** When the term ends; NULL for an evergreen contract, which has no
   * end, and NULL on the other two until somebody records one. */
  expiryDate: z.iso.date().nullable(),
  /** How far one confirmed roll advances the expiry. Auto-renewing
   * contracts only, so NULL on the other two. */
  renewalPeriodMonths: z.int().nullable(),
  /** The action window before expiry, in days. Legal on any term
   * type. */
  noticePeriodDays: z.int().nullable(),
  /**
   * CTR-006's notice deadline: the expiry minus the notice period,
   * **derived at read and never stored**. NULL while either half is
   * missing — there is nothing to subtract from, or nothing to
   * subtract — which is why an evergreen contract never has one.
   */
  noticeDeadline: z.iso.date().nullable(),
  /**
   * How many days are left of the term: the expiry minus today,
   * **derived at read and never stored**. Negative once the expiry has
   * passed, which is a fact the record has to be able to say. NULL when
   * no expiry is recorded, and so always NULL for an evergreen
   * contract.
   */
  daysRemaining: z.int().nullable(),
  /**
   * CTR-006's "renewal pending confirmation": this contract auto-renews,
   * is not archived, and its expiry has gone by with nobody confirming
   * the roll.
   *
   * **A predicate, not a status.** No column holds it and no job sets
   * it — it is true because the record's own dates say so, and false
   * again the moment the expiry advances or the term is re-typed. That
   * is CTR-006's notify-only engine in one boolean: nothing here
   * advances a date, so the record says the date passed and waits for a
   * person. The status and the stage are untouched by it.
   */
  renewalPendingConfirmation: z.boolean(),
  /**
   * Where a confirmed roll would take the expiry: the current expiry
   * plus the renewal period, **derived at read and never stored**. NULL
   * whenever the record cannot roll — a term that does not auto-renew,
   * an expiry nobody recorded, or a renewal period nobody recorded.
   *
   * It is a proposal and never a commitment: the person confirming may
   * enter a different date, because a roll whose dates shifted in
   * negotiation is recorded as it really landed (CTR-007). It is
   * answered here rather than computed by the surface for DES-040 clause
   * 4's reason — one date two places could disagree about is one place's
   * to own, and the month arithmetic a roll needs is not something a
   * dialog should keep a second copy of.
   */
  proposedRenewalExpiry: z.iso.date().nullable(),
  owningDepartment: z.string().nullable(),
  owningDepartmentId: z.string().nullable(),
  region: z.string().nullable(),
  description: z.string().nullable(),
  nextDeadline: NextDeadlineSchema,
  /** CTR-016's custom fields, keyed by the catalog field's slug. Which
   * of these the record draws is the type's attachment join to say, not
   * this map's: a value under a slug the type no longer attaches is
   * held, not shown, and comes back the moment the field is re-attached.
   * `{}` = nothing recorded. It rides every row for the same reason
   * `description` does — it is a column of the record, and the
   * per-field PATCH answers with the row. */
  customFields: CustomFieldsSchema,
  /** Values written by AI and not yet confirmed or edited, keyed by
   * slug. The evidence quote is Document text, so it stays on the run's
   * results, which the Document audience gates; the row reaches readers
   * the Document may not, and never carries the quote. */
  aiUnverified: z
    .record(
      z.string(),
      z.union([
        z.object({
          runId: z.string(),
          sourceContext: z.boolean().optional(),
          keyDateId: z.string().optional(),
          draftId: z.string().optional(),
          writtenAt: z.iso.datetime(),
        }),
        z.object({
          draftId: z.string(),
          runId: z.string().optional(),
          keyDateId: z.string().optional(),
          writtenAt: z.iso.datetime(),
        }),
      ]),
    )
    .nullable(),
  /** DD-014's opt-in gate. `true` means only the named team and Owner
   * reach this record at all — so every viewer who
   * receives this row already reaches it, and the flag is here to be
   * drawn (DES-009's marker and banner), never to be inferred from. */
  isConfidential: z.boolean(),
  /** CTR-019's queryable summary: when this contract entered the ended
   * stage. NULL on every non-ended contract; cleared on reopen. */
  endedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const ContractEnvelope = z.object({ contract: ContractRowSchema });

/**
 * One confirmed roll, as the record reads its own renewal history back
 * out of the activity log (CTR-006, CTR-007, grill row G.R5).
 *
 * **Nothing stores a renewal.** The roll moves one column and appends
 * one `contract.renewal_confirmed` entry, and that entry is the whole
 * record of it — so the confirmed-renewal rows on the record's card and
 * the "Last renewal" fact among its facts are both this, read back. A
 * renewal table would be a second copy of a history the log already
 * keeps append-only.
 *
 * `from` and `to` are the expiry either side of the roll. Both, because
 * a roll the person adjusted committed what they entered rather than
 * the proposal, and the row has to say what the term actually moved
 * from rather than leave a reader to recompute it.
 */
const ConfirmedRenewalSchema = z.object({
  /** The activity entry's own id — the row's key, and nothing else
   * addresses it: a confirmed roll is a fact, not a thing to edit. */
  id: z.string(),
  /** The expiry the term ran to before the roll. */
  from: z.iso.date(),
  /** The expiry it advanced to. */
  to: z.iso.date(),
  confirmedAt: z.iso.datetime(),
  /** Who confirmed it. NULL only where the log holds no actor, which is
   * a system entry — no path in this build writes one, and the row
   * still reads rather than disappearing. */
  confirmedBy: PersonSchema.nullable(),
});

/**
 * The people and Entities the stored custom-field values name (CTR-016's
 * `user` and `entity` types). The pickers offer live rows only, so a
 * person or an Entity archived after being picked would drop out of the
 * option lists and leave the control showing a bare id — the record
 * would stop naming what it holds. These are the rows it holds,
 * whatever their standing, which is the same move the Owner and the
 * signing entity already make by riding the row resolved.
 */
const CustomFieldRefsSchema = z.object({
  users: z.array(PersonSchema),
  entities: z.array(
    z.discriminatedUnion("restricted", [
      z.object({ restricted: z.literal(false), id: z.string(), legalName: z.string() }),
      z.object({ restricted: z.literal(true), id: z.string() }),
    ]),
  ),
});

/** The contract plus the fields its type attaches (CTR-016). Every
 * answer that can change the type carries them, because changing the
 * type changes which fields the record renders. */
export const ContractFieldsEnvelope = ContractEnvelope.extend({
  /** The type's live attachments in `display_order` — the order the
   * record draws them, and the only fields it draws. */
  fields: z.array(AttachedCustomFieldSchema),
  customFieldRefs: CustomFieldRefsSchema,
});

/** The record page's read: the contract, the fields its type attaches,
 * its working group, and every party on the other side. The lists ride
 * here rather than on the row, because only the record renders them —
 * the list would carry joins it never draws. */
export const ContractRecordEnvelope = ContractFieldsEnvelope.extend({
  form: z.array(FormNodeSchema).optional(),
  originalIntake: OriginalIntakeSchema.nullable().optional(),
  creator: PersonSchema.nullable().optional(),
  team: z.array(TeamMemberSchema),
  counterparties: z.array(CounterpartySchema),
  /** Every confirmed roll on this record, most recent first (G.R5). It
   * rides the record read for the team's reason — only the record draws
   * a renewal history — and most-recent-first so the "Last renewal"
   * fact is the first row rather than a scan for a maximum. */
  renewals: z.array(ConfirmedRenewalSchema),
  analysis: z.object({
    available: z.boolean(),
    latestRun: AnalysisRunSchema.nullable(),
  }),
});

/** What the confirmed roll answers with: the record, because the roll
 * moved its expiry and cleared its pending state, and the whole history,
 * because the roll just added to it. */
export const ContractRenewalsEnvelope = ContractEnvelope.extend({
  renewals: z.array(ConfirmedRenewalSchema),
});

export const TeamEnvelope = z.object({ team: z.array(TeamMemberSchema) });

/** What every counterparty write answers with. The contract rides along
 * because the party list decides the row's `primaryCounterparty`, and a
 * caller that only got the list back would have to guess it. */
export const CounterpartiesEnvelope = ContractEnvelope.extend({
  counterparties: z.array(CounterpartySchema),
});

/** The Member+ readable slice of a contract type. */
const TypeOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

/** A type as the create dialog and the re-type control read it: the
 * name to offer, and the fields picking it will demand (CTR-016). The
 * dialog grows the required ones so a contract cannot be born missing
 * data its type demands — the client half of the MTR-014 rule the seam
 * enforces either way. */
export const TypeChoiceSchema = TypeOptionSchema.extend({
  isDefault: z.boolean().optional(),
  form: z.array(FormNodeSchema).optional(),
  creationForm: z.array(FormNodeSchema).optional(),
  fields: z.array(AttachedCustomFieldSchema),
});

/** The Member+ readable slice of a contract status: the label to show
 * and the fixed stage behind it. */
export const StatusOptionSchema = TypeOptionSchema.extend({ stage: z.enum(CONTRACT_STAGES) });

/** The Member+ readable slice of a person: enough to draw a picker
 * entry, plus the role the Owner filter reads. Archived people are left
 * out entirely — this list exists to be assigned from. */
export const UserOptionSchema = PersonSchema.extend({ role: z.enum(USER_ROLES) });

/**
 * The Member+ readable slice of an approver group (CTR-012): the name
 * to offer in the record's apply picker, and the people applying it
 * would ask.
 *
 * **Ids, not person rows.** The same answer already carries every live
 * person in `users`, so a second copy of the same people could go stale
 * against the first. The client joins them, and a member the `users`
 * list does not hold is an archived person — exactly the member the
 * apply itself leaves out, so the two agree without either saying so.
 *
 * Managing groups stays Administrator-only (SET-002): this is the list
 * an apply reads, not the list an Administrator edits, and it carries
 * the live groups alone.
 */
export const ApproverGroupOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberIds: z.array(z.string()),
});

export const TitleSchema = z.string().trim().min(1).max(MAX_CONTRACT_TITLE_LENGTH);

export const DescriptionSchema = z.string().trim().max(10_000);

/** The number is the path, so it is an integer or it is not a contract. */
export const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** A user row as the person shape, or null when nobody is joined. */
interface JoinedPerson {
  id: string;
  displayName: string;
  image: string | null;
  archivedAt: Date | null;
}

export function toPerson(person: JoinedPerson) {
  return {
    id: person.id,
    displayName: person.displayName,
    image: person.image,
    // SET-005: an archived person stays on the record and renders greyed
    // — removing them would rewrite history to hide a departure.
    archived: person.archivedAt !== null,
  };
}

/** `toPerson` for the outer join, where nobody is a real answer. */
function toPersonOrNull(person: JoinedPerson | null) {
  return person ? toPerson(person) : null;
}

/** An entity row as the outer join answers it, where no entity yet is a
 * real answer (CTR-011). */
interface JoinedEntity {
  id: string;
  legalName: string | null;
}

/** The primary counterparty as the outer join answers it, where nobody
 * recorded yet is a real answer (CTR-011). */
export interface JoinedCounterparty {
  id: string;
  name: string;
}

/** One party on the record, ordered and flagged as the record draws it. */
interface RecordCounterparty extends JoinedCounterparty {
  jurisdiction: string | null;
  isPrimary: boolean;
}

/** The joined shape every route answers with — the stored row plus the
 * two display names, the derived stage, the Owner, the entity that
 * signs, and the party the other side is named by. */
interface ContractContext {
  nextDeadline?: z.infer<typeof NextDeadlineSchema>;
  owningDepartment: string | null;
  row: Contract;
  contractTypeName: string;
  statusName: string;
  stage: (typeof CONTRACT_STAGES)[number];
  manager: JoinedPerson | null;
  businessOwner: JoinedPerson | null;
  entity: JoinedEntity | null;
  entityRestricted: boolean;
  primaryCounterparty: JoinedCounterparty | null;
}

/** The three stored columns read back as the one field they are. The
 * database's group check is what lets this test a single column and
 * trust the rest; the other two are tested anyway, because a type that
 * admits the partial state should be narrowed by the code that reads
 * it, not by a comment. */
export function toValue(row: Contract) {
  return row.valueAmount === null || row.valueCurrency === null || row.valueCadence === null
    ? null
    : {
        amount: row.valueAmount,
        currency: row.valueCurrency,
        cadence: row.valueCadence,
        ...(row.valueCadenceDescription ? { cadenceDescription: row.valueCadenceDescription } : {}),
      };
}

/** One value equals another when all three parts match, and no value
 * equals no value. A field that commits as a group compares as a group
 * — otherwise a re-sent identical value would write an audit row saying
 * something changed when nothing did. */
export function sameValue(
  left: z.infer<typeof ContractValueSchema> | null,
  right: z.infer<typeof ContractValueSchema> | null,
) {
  if (left === null || right === null) return left === right;
  return (
    left.amount === right.amount &&
    left.currency === right.currency &&
    left.cadence === right.cadence &&
    left.cadenceDescription === right.cadenceDescription
  );
}

/** The row's marker map without the evidence quote. The quote is Document
 * text, and only the run's results (audience-gated in `latestAnalysisRun`)
 * may carry it; the row reaches readers the Document may not. */
function publicUnverified(map: Contract["aiUnverified"]) {
  if (!map) return null;
  return Object.fromEntries(
    Object.entries(map).map(([slug, entry]) => [
      slug,
      entry.draftId !== undefined
        ? { draftId: entry.draftId, writtenAt: entry.writtenAt, keyDateId: entry.keyDateId }
        : {
            runId: entry.runId,
            writtenAt: entry.writtenAt,
            sourceContext: entry.sourceContext,
            keyDateId: entry.keyDateId,
          },
    ]),
  );
}

export function toRow(
  context: ContractContext,
  customFields: Readonly<Record<string, CustomFieldValue>>,
  visibleFields: readonly AttachedCustomField[],
) {
  const { row } = context;
  const visibleSlugs = new Set(visibleFields.map((field) => field.slug));
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    contractTypeId: row.contractTypeId,
    contractTypeName: context.contractTypeName,
    statusId: row.statusId,
    statusName: context.statusName,
    stage: context.stage,
    manager: toPersonOrNull(context.manager),
    businessOwner: toPersonOrNull(context.businessOwner ?? null),
    createdBy: context.row.createdBy,
    // The projection blanks `legalName` on a signing Entity outside the
    // viewer's reach, so a null name is the restricted case however the
    // context was built.
    entity:
      context.entity === null
        ? null
        : context.entityRestricted || context.entity.legalName === null
          ? { restricted: true as const }
          : {
              restricted: false as const,
              id: context.entity.id,
              legalName: context.entity.legalName,
            },
    primaryCounterparty: context.primaryCounterparty,
    priority: row.priority,
    risk: row.risk,
    value: toValue(row),
    termType: row.termType,
    effectiveDate: row.effectiveDate,
    expiryDate: row.expiryDate,
    renewalPeriodMonths: row.renewalPeriodMonths,
    noticePeriodDays: row.noticePeriodDays,
    // The two CTR-006 derivations, taken from the one module that
    // derives them — so the record read, the list, every write's answer,
    // and the CTR-009 deadline union can never disagree about a date
    // none of them stores.
    noticeDeadline: noticeDeadline(row.expiryDate, row.noticePeriodDays),
    daysRemaining: daysRemaining(row.expiryDate),
    // The pending state and the roll's proposal, from the same module
    // and for the same reason: neither is a column, neither needs a job,
    // and a surface that computed either of them itself would be the
    // copy that drifts.
    renewalPendingConfirmation: renewalPending(row),
    proposedRenewalExpiry: proposedRollExpiry(row),
    owningDepartment: context.owningDepartment,
    owningDepartmentId: row.owningDepartmentId,
    region: row.region,
    description: row.description,
    nextDeadline: context.nextDeadline ?? null,
    customFields,
    aiUnverified: publicUnverified(
      row.aiUnverified
        ? Object.fromEntries(
            Object.entries(row.aiUnverified).filter(
              ([slug]) =>
                slug.startsWith("key_date:") ||
                (slug.startsWith("field:")
                  ? visibleSlugs.has(slug.slice(6))
                  : [
                      "title",
                      "description",
                      "priority",
                      "contract_type",
                      "counterparties",
                      "needed_by",
                      "term_type",
                      "effective_date",
                      "expiry_date",
                      "renewal_period_months",
                      "notice_period_days",
                      "value",
                    ].includes(slug) || visibleSlugs.has(slug)),
            ),
          )
        : null,
    ),
    isConfidential: row.isConfidential,
    endedAt: row.endedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The one read shape: the contract with its type name, status label,
 * derived stage, Owner, signing entity, and primary counterparty. All
 * three people-and-parties joins go outward — unassigned (CTR-004),
 * not-yet-known, and nobody-recorded-yet (CTR-011) are real states, so
 * a contract missing any of them still reads. The primary join is
 * keyed on the flag as well as the contract, so at most one party row
 * can meet each contract row: that is the one-primary invariant read
 * back out. */
export const selectContracts = (db: Executor, user: AuthenticatedUser) => {
  const entityScope = entityReachScope(db, user);
  const businessOwner = alias(users, "business_owner");
  return db
    .select({
      row: contracts,
      owningDepartment: departments.displayName,
      nextDeadline: nextDeadline("contract"),
      contractTypeName: contractTypes.displayName,
      statusName: contractStatuses.displayName,
      stage: contractStatuses.stage,
      manager: {
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
      },
      businessOwner: {
        id: businessOwner.id,
        displayName: businessOwner.displayName,
        image: businessOwner.image,
        archivedAt: businessOwner.archivedAt,
      },
      entity: {
        id: entities.id,
        legalName:
          entityScope === undefined
            ? entities.legalName
            : sql<string | null>`case when ${entityScope} then ${entities.legalName} else null end`,
      },
      entityRestricted:
        entityScope === undefined
          ? sql<boolean>`false`
          : sql<boolean>`${entities.id} is not null and not (${entityScope})`,
      primaryCounterparty: {
        id: counterparties.id,
        name: counterparties.name,
      },
    })
    .from(contracts)
    .innerJoin(contractTypes, eq(contracts.contractTypeId, contractTypes.id))
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .leftJoin(departments, eq(contracts.owningDepartmentId, departments.id))
    .leftJoin(users, eq(contracts.managerId, users.id))
    .leftJoin(businessOwner, eq(contracts.businessOwnerId, businessOwner.id))
    .leftJoin(entities, eq(contracts.entityId, entities.id))
    .leftJoin(
      contractCounterparties,
      and(
        eq(contractCounterparties.contractId, contracts.id),
        eq(contractCounterparties.isPrimary, true),
      ),
    )
    .leftJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id));
};

/** How far this viewer sees across the contract table (CTR-021) —
 * the shared predicate, so the list, the record read, and the comment
 * routes all answer the same question the same way. */
export const teamScope = (db: Executor, user: AuthenticatedUser) => contractTeamScope(db, user);

export async function readNextDeadline(db: Executor, user: AuthenticatedUser, id: string) {
  const [fresh] = await selectContracts(db, user).where(eq(contracts.id, id)).limit(1);
  return fresh?.nextDeadline ?? null;
}

/**
 * What each sortable column orders on (DD-019 clause 2).
 *
 * A closed registry rather than a column name off the wire: the same
 * expression has to appear in the ORDER BY and inside the keyset
 * boundary, and a sort the client could name freely would be a sort
 * nothing indexes and an ordering the cursor cannot reproduce.
 *
 * Three of the expressions are not the column they are named after,
 * and each departure earns a reader something:
 *
 * - **Text sorts fold case.** `lower(...)` on every name, so "acme"
 *   and "Acme" land together instead of in two alphabets.
 * - **Status orders by the pipeline, not the alphabet.** CTR-001 gives
 *   every status a `display_order` an Administrator arranged, and that
 *   arrangement is what "sort by status" means to somebody working a
 *   pipeline. Alphabetical would file Draft after Awaiting approval.
 * - **Risk and priority order by severity.** They are stored as slugs,
 *   so ordering the text would read critical, high, low, medium —
 *   DES-018's ramp put them in a sequence, and this reproduces it.
 */
const SORTS: Record<ContractSortKey, { expr: SQL; joined: boolean }> = {
  number: { expr: sql`${contracts.number}`, joined: false },
  title: { expr: sql`lower(${contracts.title})`, joined: false },
  type: { expr: sql`lower(${contractTypes.displayName})`, joined: true },
  status: { expr: sql`${contractStatuses.displayOrder}`, joined: true },
  owner: { expr: sql`lower(${users.displayName})`, joined: true },
  counterparty: { expr: sql`lower(${counterparties.name})`, joined: true },
  entity: { expr: sql`lower(${entities.legalName})`, joined: true },
  risk: { expr: severityRank(contracts.risk), joined: false },
  priority: { expr: severityRank(contracts.priority), joined: false },
  effectiveDate: { expr: sql`${contracts.effectiveDate}`, joined: false },
  expiryDate: { expr: sql`${contracts.expiryDate}`, joined: false },
  createdAt: { expr: sql`${contracts.createdAt}`, joined: false },
  updatedAt: { expr: sql`${contracts.updatedAt}`, joined: false },
};

/** The sort expression as this viewer may see it. The signing Entity
 * renders as "Restricted Entity" when ENT-004 walls it, so its sort
 * key is NULL for that viewer and the row files with the unrecorded
 * ones. Ordering by the hidden name would tell the viewer where it
 * sits in the alphabet. */
function sortSpec(db: Executor, key: ContractSortKey, user: AuthenticatedUser) {
  const spec = SORTS[key];
  if (key !== "entity") return spec;
  const entityScope = entityReachScope(db, user);
  if (entityScope === undefined) return spec;
  return { expr: sql`case when ${entityScope} then ${spec.expr} else null end`, joined: true };
}

/**
 * The order the page reads in.
 *
 * The reference number is the last term of every ordering, sorted or
 * not. It is monotonic and unique, so it breaks every tie the sorted
 * column leaves — and a keyset cursor over an ordering with unbroken
 * ties skips and repeats rows, which is the failure this one line
 * prevents.
 *
 * NULLs go last in **both** directions rather than following the
 * direction. A contract with no expiry is not the earliest expiry
 * ascending and the latest descending; it is the one the reader did
 * not ask about, and it belongs under the ones they did.
 */
export function listOrder(db: Executor, sort: SortRequest | null, user: AuthenticatedUser): SQL[] {
  if (!sort) return [sql`${contracts.number} desc`];
  const { expr } = sortSpec(db, sort.key, user);
  return [
    sql`${expr} ${sql.raw(sort.dir === "asc" ? "asc" : "desc")} nulls last`,
    sql`${contracts.number} desc`,
  ];
}

/**
 * The keyset boundary: every contract strictly further down the list
 * than one of them, in the order the list reads (CTR-024).
 *
 * Unsorted, `number` is monotonic and unique and the boundary needs no
 * tie-break — the whole reason the cursor works on this table and
 * would not on a table ordered by a timestamp alone.
 *
 * Sorted, the position is a **pair**: the sorted column's value, then
 * the reference. So "further down" becomes three ways of being after
 * the boundary row — a value that sorts later, a value that is NULL
 * when the boundary's is not (NULLs last), or the same value with a
 * lower reference. The `case` splits on whether the boundary row's own
 * value is NULL, because a boundary already in the trailing NULL group
 * is only followed by more of that group.
 *
 * The boundary's own position is read from the table rather than taken
 * from the client, so nobody can page from a reference that was never
 * written, and no sort value ever rides a URL. It is read **under this
 * viewer's own scope**: a cursor naming a contract they cannot reach
 * resolves to NULL, every comparison answers nothing, and they get an
 * empty page — the same nothing the record itself answers them
 * (DD-014). A boundary that resolved outside the scope would turn the
 * cursor into an oracle for the numbers of contracts the viewer is not
 * allowed to know exist.
 */
export function furtherDownThan(
  db: Executor,
  cursor: string,
  user: AuthenticatedUser,
  sort: SortRequest | null,
): SQL {
  const scope = teamScope(db, user);
  /** The boundary row's reference. Needs no join: the reference and
   * the scope predicate both live on `contracts`. */
  const at = sql`(
      select ${contracts.number} from ${contracts}
      where ${and(eq(contracts.id, cursor), scope)}
    )`;
  if (!sort) return sql`${contracts.number} < ${at}`;

  const { expr, joined } = sortSpec(db, sort.key, user);
  /**
   * The boundary row's sorted value, through the same joins the page
   * reads so the value is the one the ordering will compare against.
   * `limit 1` is belt to the braces of the primary-counterparty
   * uniqueness rule: a second primary row would make this a set, and a
   * set here is an error rather than a boundary.
   */
  const value = joined
    ? sql`(
          select ${expr} from ${contracts}
            inner join ${contractTypes} on ${eq(contracts.contractTypeId, contractTypes.id)}
            inner join ${contractStatuses} on ${eq(contracts.statusId, contractStatuses.id)}
            left join ${users} on ${eq(contracts.managerId, users.id)}
            left join ${entities} on ${eq(contracts.entityId, entities.id)}
            left join ${contractCounterparties} on ${and(
              eq(contractCounterparties.contractId, contracts.id),
              eq(contractCounterparties.isPrimary, true),
            )}
            left join ${counterparties} on ${eq(
              contractCounterparties.counterpartyId,
              counterparties.id,
            )}
          where ${and(eq(contracts.id, cursor), scope)}
          limit 1
        )`
    : sql`(
          select ${expr} from ${contracts}
          where ${and(eq(contracts.id, cursor), scope)}
        )`;
  const later = sql.raw(sort.dir === "asc" ? ">" : "<");
  return sql`case
      when ${value} is null
        then (${expr} is null and ${contracts.number} < ${at})
      else (
        ${expr} is null
        or ${expr} ${later} ${value}
        or (${expr} = ${value} and ${contracts.number} < ${at})
      )
    end`;
}

/** The working group on one contract, alphabetical by name so the
 * roster reads the same on every visit; a person holding two roles
 * appears once per role. */
export const selectTeam = async (db: Executor, contractId: string) => {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    })
    .from(contractTeam)
    .innerJoin(users, eq(contractTeam.userId, users.id))
    .where(eq(contractTeam.contractId, contractId))
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
  return rows.map(toPerson);
};

/**
 * The other side of one contract (CTR-011), primary first and then
 * alphabetical. The primary leads because it is the party the record
 * and the list name, and a reader should not have to hunt for it.
 * Archived counterparties stay in the answer: a party that signed is
 * a fact of the contract, and leaving the typeahead does not undo it.
 */
export const selectCounterparties = async (
  db: Executor,
  contractId: string,
): Promise<RecordCounterparty[]> =>
  db
    .select({
      id: counterparties.id,
      name: counterparties.name,
      jurisdiction: counterparties.jurisdiction,
      isPrimary: contractCounterparties.isPrimary,
    })
    .from(contractCounterparties)
    .innerJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id))
    .where(eq(contractCounterparties.contractId, contractId))
    .orderBy(desc(contractCounterparties.isPrimary), asc(sql`lower(${counterparties.name})`));

/**
 * One contract's renewal history, read straight out of the activity
 * log (CTR-006, CTR-007, grill row G.R5).
 *
 * **This is the only state a confirmed roll leaves behind.** The roll
 * advances one column and appends one entry, so the entries *are* the
 * history — the confirmed-renewal rows on the record's card and the
 * "Last renewal" fact among its facts both read this. A renewal table
 * would be a second copy of a history the log already keeps
 * append-only, and it would need its own erasure and audit rules to
 * say the same thing twice.
 *
 * Most recent first, so the last renewal is the first row: the fact
 * the record draws is then a read of `[0]` rather than a scan for a
 * maximum, and the card draws a history newest-first, which is the
 * order somebody asking "when did we last renew this" reads in.
 *
 * The actor is joined out for the same reason the roster joins its
 * approvers: a row that named an id would make the surface look one
 * up. An entry with no actor still reads — nothing in this build
 * writes one, and a row that vanished because a column was null would
 * lose a roll the record made.
 */
export const selectRenewals = async (db: Executor, contractId: string) => {
  const rows = await db
    .select({
      id: activityLog.id,
      payload: activityLog.payload,
      createdAt: activityLog.createdAt,
      actor: {
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
      },
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.actorId, users.id))
    .where(
      and(
        eq(activityLog.entityType, "contract"),
        eq(activityLog.entityId, contractId),
        eq(activityLog.action, "contract.renewal_confirmed"),
      ),
    )
    // Newest first, tie-broken on the id: uuidv7 is time-ordered, so
    // two rolls committed in one millisecond still read in the order
    // they were written.
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    // Bounded, because this rides every record read and a monthly
    // roll grows it forever. The newest are what the card draws and
    // what "Last renewal" reads, so the cut is at the old end. A
    // record that outruns the bound has its whole history in the
    // feed, which is where a long history belongs.
    .limit(RENEWAL_HISTORY_LIMIT);
  return rows.map((row) => {
    // Read through the shared vocabulary rather than an inline shape,
    // so a change to what the roll writes fails to compile here
    // instead of quietly answering undefined. The column is jsonb and
    // the log is append-only, so the cast is unavoidable; naming the
    // vocabulary entry is what makes it check anything at all.
    const payload = row.payload as ActivityPayloadMap["contract.renewal_confirmed"];
    return {
      id: row.id,
      from: payload.from,
      to: payload.to,
      confirmedAt: row.createdAt.toISOString(),
      confirmedBy: toPersonOrNull(row.actor),
    };
  });
};

/** The row's `primaryCounterparty` derived from the party list a write
 * path just produced — the same answer the list query's flag-keyed
 * join gives the read paths, without a second round trip. */
function primaryOf(parties: readonly RecordCounterparty[]): JoinedCounterparty | null {
  const primary = parties.find((party) => party.isPrimary);
  return primary ? { id: primary.id, name: primary.name } : null;
}

/**
 * Reads the parties back and answers the whole envelope, so a write
 * path never has to assemble the row and the list itself. Called at
 * the end of every counterparty mutation, inside its transaction.
 */
export async function counterpartiesEnvelope(tx: Transaction, context: ContractContext) {
  const parties = await selectCounterparties(tx, context.row.id);
  return {
    contract: await memberRow(tx, { ...context, primaryCounterparty: primaryOf(parties) }),
    counterparties: parties,
  };
}

/**
 * Moves the primary flag onto one party of one contract: demote the
 * holder, then promote the named row. The order is not a style — the
 * partial unique index behind the invariant refuses a second primary,
 * so promoting first would be refused by the database.
 *
 * The caller holds the contract row's lock, which is what makes the
 * two statements one decision (CTR-011: the application enforces this).
 */
export async function promotePrimary(tx: Transaction, contractId: string, counterpartyId: string) {
  await tx
    .update(contractCounterparties)
    .set({ isPrimary: false })
    .where(
      and(
        eq(contractCounterparties.contractId, contractId),
        eq(contractCounterparties.isPrimary, true),
        ne(contractCounterparties.counterpartyId, counterpartyId),
      ),
    );
  await tx
    .update(contractCounterparties)
    .set({ isPrimary: true })
    .where(
      and(
        eq(contractCounterparties.contractId, contractId),
        eq(contractCounterparties.counterpartyId, counterpartyId),
      ),
    );
}

/**
 * Locks one live user by id and returns them, or refuses. `roles`
 * narrows the answer — the Owner must be Member+, a team member may be
 * anyone, including the Contributor who is external counsel (MTR-006).
 * The lock stops a concurrent archive slipping between check and write.
 */
export async function lockedUser(
  tx: Transaction,
  userId: string,
  roles: readonly string[],
  refusal: string,
) {
  const [person] = await tx
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!person || person.archivedAt || !roles.includes(person.role)) throw httpError(400, refusal);
  return person;
}

/**
 * Locks one contract by number and returns it with its display
 * names, or 404s — every mutation starts here.
 *
 * Two statements, and the split is the fix for #154. The lock is taken
 * on `contracts` alone, with no join in the statement. A statement
 * that waits on a locked row re-checks its qualification against the
 * row it waited for, but it re-checks the *join* against the tuples it
 * had already fetched — so when the writer ahead committed a status
 * change, the status row it holds no longer matches, the contract
 * drops out of the result, and the caller is told the contract does
 * not exist. Locking one table cannot say that: `number` is immutable,
 * so the re-check always holds.
 *
 * The display names come second, on the row this now holds. That read
 * takes its own snapshot, so it answers the state the writer ahead
 * committed rather than the state this transaction first saw.
 *
 * Reach is asked last, on the row just locked and inside the same
 * transaction (CTR-021, DD-014). Member+ was a sufficient grant until
 * M10, so this read carried no row scope at all; the Confidential flag
 * is the one thing that takes a contract away from a Legal Team
 * Member, so every write now asks the question every read already
 * asks — the shared predicate, not a second copy of it.
 *
 * The order is the point. The lock comes first, so the flag and the
 * team rows cannot move under the answer; the question comes before
 * anything is written, so a refusal changes nothing. A contract this
 * viewer does not reach then answers exactly as a contract that was
 * never made — the same status and the same words, {@link NO_CONTRACT}
 * shared with every other surface that refuses a record — so a write
 * leaks no more than a read.
 *
 * It is **not** `reachedContract` (#254), and that is the one place in
 * the API where the two shapes differ on purpose. `reachedContract`
 * puts the row scope inside the locked `SELECT`; this takes the lock
 * with no qualification but the immutable number, and asks reach after
 * it, for the reason the paragraph above gives and the one
 * `reachesLockedContract` gives. What every mutation here needs is the
 * joined read anyway — the type name, the status label, the derived
 * stage — which is a projection the shared reach read does not carry.
 * The refusal is shared; the statement is not.
 */
export async function lockedContract(
  tx: Transaction,
  number: number,
  user: AuthenticatedUser,
): Promise<ContractContext> {
  const [locked] = await tx
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.number, number))
    .limit(1)
    .for("update");
  if (!locked) throw httpError(404, NO_CONTRACT);

  // The row is held, and a type and a status are both non-null FKs, so
  // the inner joins cannot fail to match. The guard stays because the
  // answer for "the contract is not there" has one home, and a caller
  // that trusted the row to exist would be one schema change away from
  // a crash instead of a refusal.
  const [target] = await selectContracts(tx, user).where(eq(contracts.id, locked.id)).limit(1);
  if (!target) throw httpError(404, NO_CONTRACT);
  if (!(await reachesLockedContract(tx, user, target.row))) {
    throw httpError(404, NO_CONTRACT);
  }
  return target;
}

/** The refusal every write path shares: an archived contract reads as
 * facts until it is restored. Separate from the read that produced it,
 * because one caller has a guard to answer first (see below). */
export function assertEditable(current: ContractContext): void {
  if (current.row.archivedAt) {
    throw httpError(409, "This contract is archived. Restore it before editing.");
  }
}

/** `lockedContract` for the write paths that refuse a frozen record.
 * The reach refusal comes first, inside `lockedContract`: a 409 on a
 * record the viewer cannot reach would say the record is there. */
export async function editableContract(
  tx: Transaction,
  number: number,
  user: AuthenticatedUser,
): Promise<ContractContext> {
  const current = await lockedContract(tx, number, user);
  assertEditable(current);
  return current;
}

/**
 * The two refusals behind the Confidential flag (DD-014, CTR-022),
 * decided by the shared access module and turned into HTTP here.
 *
 * A viewer who does reach the record but is none of the three actors
 * is refused plainly: they can already see the record, so 404 would
 * hide nothing and would only make a real permission boundary read as
 * a bug.
 *
 * A viewer who does not reach the record never arrives here — every
 * mutation is refused at `lockedContract` now, in the same words a
 * contract that does not exist is refused in. The module still answers
 * that case, and this still turns it into the same 404: the whole
 * question has one home, and a caller that reads only half of the
 * answer would be one refactor away from a leak.
 *
 * It runs before the archived refusal, because a 409 on a record the
 * viewer may not decide the audience of would tell them the flag write
 * was theirs to make.
 *
 * The refusal sentence is the caller's, because two acts decide the
 * audience and each has to name itself. The rule behind them is one
 * rule, asked in one place.
 */
async function assertAudienceActor(
  tx: Transaction,
  current: ContractContext,
  user: AuthenticatedUser,
  refusal: string,
) {
  const verdict = await confidentialityWrite(tx, user, current.row);
  if (verdict === "unreachable") throw httpError(404, NO_CONTRACT);
  if (verdict === "refused") throw httpError(403, refusal);
}

/** Setting and clearing the flag itself (CTR-022). */
export const assertMayFlagConfidential = (
  tx: Transaction,
  current: ContractContext,
  user: AuthenticatedUser,
) =>
  assertAudienceActor(
    tx,
    current,
    user,
    "Only an Administrator, the contract's creator, or its Owner can change this.",
  );

/**
 * Changing the team on a **Confidential** contract (CTR-023).
 *
 * Putting somebody on a walled record's team is deciding the audience:
 * it clears the flag for one person. CTR-022 says nobody outside the
 * three actors may do that, and being on the team is not enough — so
 * the roster is theirs to change too, or the switch is a gate with a
 * door beside it.
 *
 * An open contract is untouched. CTR-004's generous rule is right for
 * the rest: any Member+ edits the roster, and nothing about it is
 * withheld from anybody.
 *
 * It runs before the archived refusal, for the flag guard's reason.
 */
export async function assertMayChangeTeam(
  tx: Transaction,
  current: ContractContext,
  user: AuthenticatedUser,
): Promise<void> {
  if (!current.row.isConfidential) return;
  await assertAudienceActor(
    tx,
    current,
    user,
    "Only an Administrator, the contract's creator, or its Owner can change the team on a confidential contract.",
  );
}

/** One contract type's attached fields, in the order the record draws
 * them (CTR-016). The join is the only thing that decides this: the
 * jsonb column holds whatever it holds. */
export const attachedFieldsOf = (db: Executor, contractTypeId: string) =>
  selectAttachedFields(db, contractTypeFields, contractTypeId);

/**
 * The people and Entities the stored values name, resolved so the
 * record can render a name where it holds an id. Archived rows are
 * included on purpose — the pickers stop offering them, but a record
 * that already names one must go on naming it.
 */
export async function customFieldRefs(
  db: Executor,
  attached: readonly AttachedCustomField[],
  values: Readonly<Record<string, CustomFieldValue>>,
  user: AuthenticatedUser,
) {
  const idsOfType = (fieldType: "user" | "entity") =>
    attached
      .filter((field) => field.fieldType === fieldType)
      .map((field) => values[field.slug])
      .filter((value): value is string => typeof value === "string" && value !== "");
  const userIds = [...new Set(idsOfType("user"))];
  const entityIds = [...new Set(idsOfType("entity"))];
  const [people, signatories] = await Promise.all([
    userIds.length === 0
      ? []
      : db
          .select({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
          })
          .from(users)
          .where(inArray(users.id, userIds)),
    entityIds.length === 0
      ? []
      : db
          .select({ id: entities.id, legalName: entities.legalName })
          .from(entities)
          .where(and(inArray(entities.id, entityIds), entityReachScope(db, user))),
  ]);
  const named = new Map(signatories.map((entity) => [entity.id, entity.legalName]));
  return {
    users: people.map(toPerson),
    entities: entityIds.map((id) => {
      const legalName = named.get(id);
      return legalName === undefined
        ? { restricted: true as const, id }
        : { restricted: false as const, id, legalName };
    }),
  };
}

export function hasConversionFields(context: ContractContext) {
  return Object.entries(context.row.aiUnverified ?? {}).some(
    ([slug, flag]) => flag.draftId !== undefined && slug.startsWith("field:"),
  );
}

/** Member-only mutations retain stored values but expose markers only for live Fields. */
export async function memberRow(db: Executor, context: ContractContext) {
  const attached = hasConversionFields(context)
    ? await attachedFieldsOf(db, context.row.contractTypeId)
    : [];
  return toRow(context, context.row.customFields, attached);
}

/** The whole custom-field half of an answer: the type's attachments
 * and the rows its values name. */
export async function customFieldsEnvelope(
  db: Executor,
  context: ContractContext,
  user: AuthenticatedUser,
) {
  const attached = await attachedFieldsOf(db, context.row.contractTypeId);
  const projection = projectCustomFields(user.role, attached, context.row.customFields);
  return {
    ...projection,
    customFieldRefs: await customFieldRefs(db, projection.fields, projection.customFields, user),
  };
}
export const ContractListQuery = z
  .object({
    owner: FilterChoices.optional(),
    status: FilterChoices.optional(),
    type: FilterChoices.optional(),
    effectiveFrom: z.iso.date().optional(),
    effectiveTo: z.iso.date().optional(),
    expiryFrom: z.iso.date().optional(),
    expiryTo: z.iso.date().optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
    /** CTR-019: bring ended contracts back into the list. The
     * default list shows all non-ended stages, because ended is
     * a signal that the deal is done, not a lock. */
    includeEnded: z.enum(["true", "false"]).optional(),
    /**
     * Which column to order on (DD-019 clause 2). Omit for the
     * list's natural order, newest reference first. A closed set:
     * the reference breaks every tie, so the cursor can reproduce
     * the ordering exactly on the next page.
     */
    sort: z.enum(CONTRACT_SORT_KEYS).optional(),
    /** Which way the sorted column runs; ignored without `sort`,
     * and ascending when `sort` is given without it. */
    dir: z.enum(SORT_DIRECTIONS).optional(),
    /** The previous page's `nextCursor`. Omit for the first page.
     * Carry the same `sort` and `dir` with it: a cursor is a
     * position in one ordering, and a page read under a different
     * one is a page of a different list. */
    cursor: CursorSchema.optional(),
  })
  .refine(validDateRanges, "The end date must be on or after the start date");

export const ContractPatchBody = z.strictObject({
  title: TitleSchema.optional(),
  description: DescriptionSchema.nullable().optional(),
  owningDepartmentId: z.string().min(1).nullable().optional(),
  region: z.string().trim().max(MAX_CONTRACT_CLASSIFICATION_LENGTH).nullable().optional(),
  /** CTR-004's Owner. `null` clears it back to unassigned —
   * a real state (triage), not an absent field. */
  managerId: z.string().nullable().optional(),
  /** DD-021: Member+ assigns a live person; null clears ownership and preserves team membership. */
  businessOwnerId: z.string().nullable().optional(),
  /** CTR-011's our side. `null` clears it back to not known,
   * which is where every contract starts. */
  entityId: z.string().nullable().optional(),
  priority: SeveritySchema.optional(),
  risk: SeveritySchema.nullable().optional(),
  /** CTR-010's value, committed as one field. `null` clears all
   * three parts — a contract that never had a value and one
   * whose value was taken off read the same, because both are
   * "no value is recorded". */
  value: ContractValueInput.nullable().optional(),
  /** CTR-006's term type. Changing it clears the fields the new
   * type cannot hold, and each clear is narrated as the edit it
   * is. There is no `null`: every contract is one of the three
   * kinds. */
  termType: TermTypeSchema.optional(),
  /** CTR-006's start of term. `null` clears it back to not
   * known, which is where every contract starts. */
  effectiveDate: z.iso.date().nullable().optional(),
  /** CTR-006's end of term. Refused on an evergreen contract,
   * which has no end; `null` clears it. */
  expiryDate: z.iso.date().nullable().optional(),
  /** CTR-006's roll length. Refused on anything but an
   * auto-renewing contract; `null` clears it. */
  renewalPeriodMonths: RenewalPeriodSchema.nullable().optional(),
  /** CTR-006's action window before expiry. Legal on any term
   * type; `null` clears it. */
  noticePeriodDays: NoticePeriodSchema.nullable().optional(),
  /** CTR-002's type, re-picked. Re-typing is the second place
   * MTR-014's required rule holds, so this may travel with the
   * `customFields` that satisfy the new type — the one compound
   * DES-017 carves out for a purpose-built dialog. */
  contractTypeId: z.string().optional(),
  /** CTR-016's custom fields, keyed by slug. One key is one
   * field committed; `null` clears it. Keys the type does not
   * attach are refused. */
  customFields: CustomFieldsInput.optional(),
  statusId: z.string().optional(),
  /** DD-014's flag, set or cleared. It rides the per-field PATCH
   * like every other field, but it is the one field with an
   * actor set narrower than the route's, and it keeps its own
   * audit verb rather than joining the changed map. */
  isConfidential: z.boolean().optional(),
  /** CTR-012's soft gate, pressed through. It is not a field —
   * nothing is stored for it — it is this one commit's
   * confirmation that the unresolved approvals were seen and
   * the move is deliberate. It only means anything beside a
   * `statusId` that crosses past the approval stage; anywhere
   * else it is ignored, because there is nothing to override. */
  overrideSoftGate: z.boolean().optional(),
});

export const ContractUpdateBody = ContractPatchBody.omit({
  statusId: true,
  overrideSoftGate: true,
});
export const ContractStatusBody = ContractPatchBody.pick({
  statusId: true,
  overrideSoftGate: true,
}).required({ statusId: true });
