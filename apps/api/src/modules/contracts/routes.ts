// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record routes (M8): list, create, the record read, the
 * DES-017 per-field update, archive, restore, and the contract team,
 * plus the Member+ picker read the create dialog and the record's
 * pickers need (the contract-types and contract-statuses settings
 * surfaces stay Administrator-only per SET-002).
 *
 * The create **write** is not here: it lives in `create.ts` as one
 * callable that takes the transaction rather than opening one, because
 * the INT-006 conversion of a Request has to run it as a step inside a
 * wider act. This route is its first caller, and it keeps the two
 * things a caller decides — who may create (CTR-021) and what the
 * answer looks like on the wire.
 *
 * The people are CTR-004's. The Owner is a field — one nullable FK,
 * `manager_id`, labelled "Owner" on every surface — so it commits
 * through the same per-field PATCH as the rest and rides
 * `contract.updated`. The team is a compound-key join on (contract,
 * person, role), so one person may hold two roles at once, and it has
 * its own routes and its own audit verbs.
 *
 * Our side of the contract is CTR-011's: `entity_id`, one nullable FK
 * into the M7 registry, naming which of our own Entities signs. It is a
 * field like any other, so it commits through the same per-field PATCH
 * and rides `contract.updated`. The picker reads the registry's own
 * Member+ list, which already leaves archived entities out; the write
 * refuses one, so nothing new is signed by an entity that has left.
 *
 * Their side is CTR-011's `contract_counterparties` join: N parties on
 * one contract, exactly one of them primary. That invariant is this
 * file's to keep, and it holds in one direction only — a contract with
 * counterparties always has a primary. The first party added takes the
 * flag; removing the holder passes it to the next; the last one out
 * takes it with them. Every one of those paths runs under the contract
 * row's lock, so two Legal Team Members cannot both promote. A name
 * with no record behind it becomes one in the same transaction that
 * puts it on the contract, which is what keeps intake friction near
 * zero — and the same transaction refuses to make a second record for a
 * name we already hold.
 *
 * Every route is addressed by the contract's CTR-003 number, not its
 * id: the number is the reference a Legal Team Member speaks, links,
 * and emails, so it is what the URL carries. The database assigns it
 * from a dedicated identity sequence and refuses every attempt to write
 * it, so nothing here has to defend its immutability.
 *
 * The contract stores `status_id` only. `stage` rides out on every row
 * derived from the status (CTR-001) — the client branches on the stage
 * and renders the label. Any status may follow any other: real deals
 * collapse and reopen, so there is no transition matrix.
 *
 * The value is CTR-010's, and it is the first field here that is not a
 * scalar: an amount, its ISO 4217 currency, and the cadence the amount
 * is per are three columns that behave as one field. They commit
 * together, clear together, and appear in the audit map as one entry —
 * an amount with no currency is a number nobody can read, so the seam
 * refuses it and the database check refuses it again. The amount is an
 * integer count of the currency's smallest unit; no total is stored,
 * because every total (annual × term) is derivable from what is.
 *
 * The term is CTR-006's, and it is five columns that are five fields
 * (M16/1): the type, the effective date, the expiry, the renewal period
 * in months, and the notice period in days. Each commits on its own
 * through the same per-field PATCH, and the type is what decides which
 * of the other four the record may hold — an expiry on an evergreen
 * contract and a renewal period off an auto-renewing one are refused
 * with their own problem types, and a type change clears what the new
 * type cannot hold, each clear narrated as the edit it is.
 *
 * Four answers ride out of every read that nothing stores: the notice
 * deadline (expiry minus the notice period), the days remaining (expiry
 * minus today), whether a roll is pending confirmation, and where a
 * confirmed roll would take the expiry. They are computed where the
 * answer is assembled, so no surface can disagree with another about a
 * fact none of them holds, and none needs a job, a sweep, or a clock —
 * all four are functions of the term columns and the calendar.
 *
 * The roll itself is CTR-007's first renewal vehicle (M16/4), and it is
 * the one act on this record that CTR-006's notify-only engine waits
 * for. Nothing here advances a date on its own; a person confirms, and
 * `expiry_date` moves under the row's lock. The request carries the
 * expiry it was raised against, so two confirms racing for one roll
 * advance the term exactly once and the loser is told the record moved.
 * The status and the stage are untouched — the pending state is a
 * reading of the dates, not a transition — and the roll writes its own
 * activity action, which is the **only** record a renewal leaves: the
 * record's renewal history and its "Last renewal" fact are that log read
 * back (grill row G.R5).
 *
 * The custom fields are CTR-016's, and they are the M6 catalog finally
 * doing work. The contract's type attaches fields through
 * `contract_type_fields`; that join decides which render and in what
 * order, and the values live in one jsonb column keyed by field slug.
 * Keying by slug is what retains a value when the field is detached: the
 * join row goes, the value stays, and re-attaching brings it back.
 *
 * `is_required` becomes a rule here — the M6 stub that stored the flag
 * without enforcing it closes at two points, both at this seam rather
 * than only in a form. **Creation** refuses a contract whose type
 * requires a field the body leaves empty. **Re-typing** re-checks the
 * *new* type's required fields before it commits, because a re-type that
 * skipped the check would be the way around the rule (MTR-014). Both go
 * through `assertRequiredCustomFields`; the SET-003 archive guard's bulk
 * reassignment deliberately will not, since that is a system move rather
 * than a re-type anyone chose.
 *
 * Access has two floors (CTR-021). Picker reads and every mutation
 * except the per-field PATCH are Member+ — Administrators and Legal
 * Team Members equally. The list, record read, and PATCH reach one step
 * wider: a Contributor reaches contracts they hold a `contract_team`
 * row on. DD-015 then narrows their PATCH to value, effective date, and
 * business-tagged Fields; legal-tagged Fields are omitted from their
 * projection. A contract a Contributor is not on answers exactly as a
 * contract that does not exist. Business Users are refused everywhere.
 *
 * The same predicate carries DD-014's Confidential flag (M10). A
 * confidential contract is reached by the named team, its Owner, and
 * Administrators, and by nobody else — so a Legal Team Member who is not
 * on it is answered exactly as they are for a contract that was never
 * made, in the list and at the record URL alike.
 *
 * Every mutation asks the same question, on the row it has locked and
 * inside its own transaction: the per-field patch whatever it carries,
 * the status change, the team add and remove, the counterparty add,
 * remove and primary change, and archive and restore. They all start at
 * `lockedContract`, which is where the question is asked once. So a
 * write against a contract the viewer cannot reach answers exactly as a
 * write against a contract that does not exist, and a write leaks no
 * more than a read.
 *
 * Every mutation appends to the activity log in the same transaction
 * (DD-017); the feed and audit surfaces read it in M9.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  activityLog,
  and,
  approverGroupMembers,
  approverGroups,
  asc,
  contractCounterparties,
  contractStatuses,
  contracts,
  contractTeam,
  contractTypeFields,
  contractTypes,
  counterparties,
  CONTRACT_STAGES,
  CONTRACT_TEAM_ROLES,
  desc,
  entities,
  eq,
  inArray,
  isNull,
  ne,
  SEVERITY_LEVELS,
  sql,
  TERM_TYPES,
  users,
  USER_ROLES,
  VALUE_CADENCES,
  type AnyPgColumn,
  type Contract,
  type ContractStage,
  type CustomFieldValue,
  type Executor,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  confidentialityWrite,
  contractTeamScope,
  CREATOR_TEAM_ROLE,
  NO_CONTRACT,
  reachesLockedContract,
} from "../../lib/contract-access.js";
import { NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import {
  daysRemaining,
  noticeDeadline,
  proposedRollExpiry,
  renewalPending,
} from "../../lib/contract-term.js";
import {
  AttachedCustomFieldSchema,
  applyCustomFields,
  assertContributorCustomFieldWrite,
  assertRequiredCustomFields,
  CustomFieldsInput,
  CustomFieldsSchema,
  projectCustomFields,
  selectAttachedFields,
  type AttachedCustomField,
} from "../../lib/custom-fields.js";
import {
  CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
  CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
  CONTRACT_SELF_LINK_PROBLEM_TYPE,
  CONTRACT_SORT_KEYS,
  MAX_CONTRACT_TITLE_LENGTH,
  RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE,
  SORT_DIRECTIONS,
  SOFT_GATE_PROBLEM_TYPE,
  TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE,
  TERM_RENEWAL_PERIOD_PROBLEM_TYPE,
  type ActivityPayloadMap,
  type ContractSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import { assertApprovalGate, type UnresolvedApproval } from "../../lib/soft-gate.js";
import { createContract, CONTRACT_RENEWAL_VEHICLES } from "./create.js";

/** Every mutation, and every picker read behind one, is Member+. */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * The two read surfaces — the list and the record — take a Contributor
 * as well (CTR-021). The role alone opens no contract: `teamScope`
 * narrows the answer to the contracts the Contributor holds a
 * `contract_team` row on, and takes a confidential contract away from
 * anyone outside its named team and its Owner (DD-014) — except an
 * Administrator, who reaches every contract with no team row and no
 * Owner assignment at all. Business Users stay refused on every contract
 * surface.
 */
const requireContractReader = requireRole("administrator", "legal_team_member", "contributor");

/**
 * How many contracts one read answers (CTR-024).
 *
 * Server-fixed, like the audit log's — the client cannot ask for more,
 * so no client can turn one request into a whole-table scan. 50 rather
 * than the activity feed's 25 because this is a table somebody scans,
 * not a feed somebody reads.
 */
const PAGE_SIZE = 50;

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
interface SortRequest {
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

/** Only a Member+ user can be the Owner: the Owner runs the contract,
 * and a read-only viewer cannot run one (CTR-004, DD-013). */
const OWNER_ROLES = ["administrator", "legal_team_member"] as const;

const SeveritySchema = z.enum(SEVERITY_LEVELS);

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
  cadence: z.enum(VALUE_CADENCES),
});

/**
 * The same trio on the way in. All three are required together, so the
 * seam cannot be handed an amount with no currency; `null` in place of
 * the object is how the whole value is cleared. Case is normalized, so
 * "usd" and "USD" are one currency and never two rows that disagree.
 */
const ContractValueInput = z.strictObject({
  amount: z.int().nonnegative(),
  currency: z
    .string()
    .trim()
    .transform((code) => code.toUpperCase())
    .refine((code) => ISO_4217.has(code), {
      message: "Use a three-letter ISO 4217 currency code.",
    }),
  cadence: z.enum(VALUE_CADENCES),
});

/** CTR-006's three kinds of commitment. Code branches on it, so it is a
 * fixed enum rather than an admin-configurable list. */
const TermTypeSchema = z.enum(TERM_TYPES);

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
const RenewalPeriodSchema = z.int().min(1).max(1200);
const NoticePeriodSchema = z.int().min(0).max(36_500);

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
const RenewalOfSchema = z.strictObject({
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

/** One `contract_team` row, read back as the person plus their role.
 * The compound key means the same person can appear twice, under two
 * roles — that is membership, not a duplicate. */
const TeamMemberSchema = PersonSchema.extend({ role: z.enum(CONTRACT_TEAM_ROLES) });

/** One of our own Entities as the contract record names it (CTR-011):
 * the id the picker commits and the legal name that goes on the paper.
 * Archiving an entity later never touches the record — the contract
 * keeps naming who signed it, and the registry is where its standing is
 * read. Nothing more of the identity card is joined in: the record
 * renders a name, not a card. */
const SigningEntitySchema = z.object({
  id: z.string(),
  legalName: z.string(),
});

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

const ContractRowSchema = z.object({
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
  description: z.string().nullable(),
  /** CTR-016's custom fields, keyed by the catalog field's slug. Which
   * of these the record draws is the type's attachment join to say, not
   * this map's: a value under a slug the type no longer attaches is
   * held, not shown, and comes back the moment the field is re-attached.
   * `{}` = nothing recorded. It rides every row for the same reason
   * `description` does — it is a column of the record, and the
   * per-field PATCH answers with the row. */
  customFields: CustomFieldsSchema,
  /** DD-014's opt-in gate. `true` means only the named team, the Owner,
   * and Administrators reach this record at all — so every viewer who
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

const ContractEnvelope = z.object({ contract: ContractRowSchema });

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
  entities: z.array(SigningEntitySchema),
});

/** The contract plus the fields its type attaches (CTR-016). Every
 * answer that can change the type carries them, because changing the
 * type changes which fields the record renders. */
const ContractFieldsEnvelope = ContractEnvelope.extend({
  /** The type's live attachments in `display_order` — the order the
   * record draws them, and the only fields it draws. */
  fields: z.array(AttachedCustomFieldSchema),
  customFieldRefs: CustomFieldRefsSchema,
});

/** The record page's read: the contract, the fields its type attaches,
 * its working group, and every party on the other side. The lists ride
 * here rather than on the row, because only the record renders them —
 * the list would carry joins it never draws. */
const ContractRecordEnvelope = ContractFieldsEnvelope.extend({
  team: z.array(TeamMemberSchema),
  counterparties: z.array(CounterpartySchema),
  /** Every confirmed roll on this record, most recent first (G.R5). It
   * rides the record read for the team's reason — only the record draws
   * a renewal history — and most-recent-first so the "Last renewal"
   * fact is the first row rather than a scan for a maximum. */
  renewals: z.array(ConfirmedRenewalSchema),
});

/** What the confirmed roll answers with: the record, because the roll
 * moved its expiry and cleared its pending state, and the whole history,
 * because the roll just added to it. */
const ContractRenewalsEnvelope = ContractEnvelope.extend({
  renewals: z.array(ConfirmedRenewalSchema),
});
const TeamEnvelope = z.object({ team: z.array(TeamMemberSchema) });
/** What every counterparty write answers with. The contract rides along
 * because the party list decides the row's `primaryCounterparty`, and a
 * caller that only got the list back would have to guess it. */
const CounterpartiesEnvelope = ContractEnvelope.extend({
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
const TypeChoiceSchema = TypeOptionSchema.extend({
  fields: z.array(AttachedCustomFieldSchema),
});

/** The Member+ readable slice of a contract status: the label to show
 * and the fixed stage behind it. */
const StatusOptionSchema = TypeOptionSchema.extend({ stage: z.enum(CONTRACT_STAGES) });

/** The Member+ readable slice of a person: enough to draw a picker
 * entry, plus the role the Owner filter reads. Archived people are left
 * out entirely — this list exists to be assigned from. */
const UserOptionSchema = PersonSchema.extend({ role: z.enum(USER_ROLES) });

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
const ApproverGroupOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  memberIds: z.array(z.string()),
});

const TitleSchema = z.string().trim().min(1).max(MAX_CONTRACT_TITLE_LENGTH);
/** CTR-011's inline creation writes exactly this and nothing else. */
const CounterpartyNameSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(10_000);
/** The number is the path, so it is an integer or it is not a contract. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** A user row as the person shape, or null when nobody is joined. */
interface JoinedPerson {
  id: string;
  displayName: string;
  image: string | null;
  archivedAt: Date | null;
}

function toPerson(person: JoinedPerson) {
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
  legalName: string;
}

/** The primary counterparty as the outer join answers it, where nobody
 * recorded yet is a real answer (CTR-011). */
interface JoinedCounterparty {
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
  row: Contract;
  contractTypeName: string;
  statusName: string;
  stage: (typeof CONTRACT_STAGES)[number];
  manager: JoinedPerson | null;
  entity: JoinedEntity | null;
  primaryCounterparty: JoinedCounterparty | null;
}

/** The three stored columns read back as the one field they are. The
 * database's group check is what lets this test a single column and
 * trust the rest; the other two are tested anyway, because a type that
 * admits the partial state should be narrowed by the code that reads
 * it, not by a comment. */
function toValue(row: Contract) {
  return row.valueAmount === null || row.valueCurrency === null || row.valueCadence === null
    ? null
    : { amount: row.valueAmount, currency: row.valueCurrency, cadence: row.valueCadence };
}

/** One value equals another when all three parts match, and no value
 * equals no value. A field that commits as a group compares as a group
 * — otherwise a re-sent identical value would write an audit row saying
 * something changed when nothing did. */
function sameValue(
  left: z.infer<typeof ContractValueSchema> | null,
  right: z.infer<typeof ContractValueSchema> | null,
) {
  if (left === null || right === null) return left === right;
  return (
    left.amount === right.amount &&
    left.currency === right.currency &&
    left.cadence === right.cadence
  );
}

function toRow(
  context: ContractContext,
  customFields: Readonly<Record<string, CustomFieldValue>> = context.row.customFields,
) {
  const { row } = context;
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
    entity: context.entity,
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
    description: row.description,
    customFields,
    isConfidential: row.isConfidential,
    endedAt: row.endedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const contractsRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The one read shape: the contract with its type name, status label,
   * derived stage, Owner, signing entity, and primary counterparty. All
   * three people-and-parties joins go outward — unassigned (CTR-004),
   * not-yet-known, and nobody-recorded-yet (CTR-011) are real states, so
   * a contract missing any of them still reads. The primary join is
   * keyed on the flag as well as the contract, so at most one party row
   * can meet each contract row: that is the one-primary invariant read
   * back out. */
  const selectContracts = (db: Executor) =>
    db
      .select({
        row: contracts,
        contractTypeName: contractTypes.displayName,
        statusName: contractStatuses.displayName,
        stage: contractStatuses.stage,
        manager: {
          id: users.id,
          displayName: users.displayName,
          image: users.image,
          archivedAt: users.archivedAt,
        },
        entity: {
          id: entities.id,
          legalName: entities.legalName,
        },
        primaryCounterparty: {
          id: counterparties.id,
          name: counterparties.name,
        },
      })
      .from(contracts)
      .innerJoin(contractTypes, eq(contracts.contractTypeId, contractTypes.id))
      .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
      .leftJoin(users, eq(contracts.managerId, users.id))
      .leftJoin(entities, eq(contracts.entityId, entities.id))
      .leftJoin(
        contractCounterparties,
        and(
          eq(contractCounterparties.contractId, contracts.id),
          eq(contractCounterparties.isPrimary, true),
        ),
      )
      .leftJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id));

  /** How far this viewer sees across the contract table (CTR-021) —
   * the shared predicate, so the list, the record read, and the comment
   * routes all answer the same question the same way. */
  const teamScope = (user: AuthenticatedUser) => contractTeamScope(app.db, user);

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
  function listOrder(sort: SortRequest | null): SQL[] {
    if (!sort) return [sql`${contracts.number} desc`];
    const { expr } = SORTS[sort.key];
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
  function furtherDownThan(cursor: string, user: AuthenticatedUser, sort: SortRequest | null): SQL {
    const scope = teamScope(user);
    /** The boundary row's reference. Needs no join: the reference and
     * the scope predicate both live on `contracts`. */
    const at = sql`(
      select ${contracts.number} from ${contracts}
      where ${and(eq(contracts.id, cursor), scope)}
    )`;
    if (!sort) return sql`${contracts.number} < ${at}`;

    const { expr, joined } = SORTS[sort.key];
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
  const selectTeam = async (db: Executor, contractId: string) => {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
        role: contractTeam.role,
      })
      .from(contractTeam)
      .innerJoin(users, eq(contractTeam.userId, users.id))
      .where(eq(contractTeam.contractId, contractId))
      .orderBy(asc(sql`lower(${users.displayName})`), asc(contractTeam.role));
    return rows.map((row) => ({ ...toPerson(row), role: row.role }));
  };

  /**
   * The other side of one contract (CTR-011), primary first and then
   * alphabetical. The primary leads because it is the party the record
   * and the list name, and a reader should not have to hunt for it.
   * Archived counterparties stay in the answer: a party that signed is
   * a fact of the contract, and leaving the typeahead does not undo it.
   */
  const selectCounterparties = async (
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
  const selectRenewals = async (db: Executor, contractId: string) => {
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
  async function counterpartiesEnvelope(tx: Transaction, context: ContractContext) {
    const parties = await selectCounterparties(tx, context.row.id);
    return {
      contract: toRow({ ...context, primaryCounterparty: primaryOf(parties) }),
      counterparties: parties,
    };
  }

  /**
   * CTR-011's inline creation: a typed name becomes a counterparty
   * record. It answers the record we already hold under that name
   * before it makes a new one, so the typeahead cannot leave two rows
   * behind for one organization — the client filters the same names out
   * of its create affordance, and this is the refusal that holds when
   * two clients disagree.
   *
   * The advisory lock is transaction-scoped and keyed on the name, so
   * two Legal Team Members typing the same unknown name onto two
   * different contracts at the same moment take turns: the first
   * creates, the second finds. Locking the contract row cannot do this
   * — they are on different contracts — and a unique constraint on the
   * name would be a permanent ruling that two organizations may never
   * share one, which is not ours to make here.
   */
  async function findOrCreateCounterparty(tx: Transaction, rawName: string) {
    const name = rawName.trim();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(${name})))`);
    const [existing] = await tx
      .select({ id: counterparties.id, name: counterparties.name })
      .from(counterparties)
      .where(
        and(
          isNull(counterparties.archivedAt),
          // Matched case-insensitively on the name index's own
          // expression: "helix labs gmbh" is the organization already
          // filed as "Helix Labs GmbH", not a second one.
          sql`lower(${counterparties.name}) = lower(${name})`,
        ),
      )
      .orderBy(asc(counterparties.createdAt))
      .limit(1);
    if (existing) return { party: existing, born: false };

    const [created] = await tx
      .insert(counterparties)
      .values({ name })
      .returning({ id: counterparties.id, name: counterparties.name });
    return { party: created!, born: true };
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
  async function promotePrimary(tx: Transaction, contractId: string, counterpartyId: string) {
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
  async function lockedUser(
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
  async function lockedContract(
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
    const [target] = await selectContracts(tx).where(eq(contracts.id, locked.id)).limit(1);
    if (!target) throw httpError(404, NO_CONTRACT);
    if (!(await reachesLockedContract(tx, user, target.row))) {
      throw httpError(404, NO_CONTRACT);
    }
    return target;
  }

  /** The refusal every write path shares: an archived contract reads as
   * facts until it is restored. Separate from the read that produced it,
   * because one caller has a guard to answer first (see below). */
  function assertEditable(current: ContractContext): void {
    if (current.row.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before editing.");
    }
  }

  /** `lockedContract` for the write paths that refuse a frozen record.
   * The reach refusal comes first, inside `lockedContract`: a 409 on a
   * record the viewer cannot reach would say the record is there. */
  async function editableContract(
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
  const assertMayFlagConfidential = (
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
  async function assertMayChangeTeam(
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
  const attachedFieldsOf = (db: Executor, contractTypeId: string) =>
    selectAttachedFields(db, contractTypeFields, contractTypeId);

  /**
   * The people and Entities the stored values name, resolved so the
   * record can render a name where it holds an id. Archived rows are
   * included on purpose — the pickers stop offering them, but a record
   * that already names one must go on naming it.
   */
  async function customFieldRefs(
    db: Executor,
    attached: readonly AttachedCustomField[],
    values: Readonly<Record<string, CustomFieldValue>>,
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
            .where(inArray(entities.id, entityIds)),
    ]);
    return { users: people.map(toPerson), entities: signatories };
  }

  /** The whole custom-field half of an answer: the type's attachments
   * and the rows its values name. */
  async function customFieldsEnvelope(
    db: Executor,
    context: ContractContext,
    user: AuthenticatedUser,
  ) {
    const attached = await attachedFieldsOf(db, context.row.contractTypeId);
    const projection = projectCustomFields(user.role, attached, context.row.customFields);
    return {
      ...projection,
      customFieldRefs: await customFieldRefs(db, projection.fields, projection.customFields),
    };
  }

  app.get(
    "/contracts",
    {
      preHandler: requireContractReader,
      schema: {
        operationId: "listContracts",
        summary:
          "The contract list: number, title, type, and status; " +
          "newest reference first unless sort names a column, and " +
          "unknown-valued rows always last (DD-019). Archived " +
          "contracts only with includeArchived=true; ended contracts " +
          "only with includeEnded=true (CTR-019). Member+ read every " +
          "contract that is not confidential; a Contributor reads " +
          "exactly the contracts they hold a contract_team row on, " +
          "archived and ended ones behind the same flags. A " +
          "confidential contract is listed only for its named team, " +
          "its Owner, and Administrators — silently absent for " +
          "everyone else, so no count can reveal it",
        tags: ["contracts"],
        querystring: z.object({
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
        }),
        response: {
          200: z.object({
            contracts: z.array(ContractRowSchema),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the list. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      /** Ascending is what "sort by expiry" means without a direction:
       * the soonest first is the answer somebody asking for a column
       * came for. `dir` without `sort` orders nothing, because there is
       * no column for it to run along. */
      const sort: SortRequest | null =
        request.query.sort === undefined
          ? null
          : { key: request.query.sort, dir: request.query.dir ?? "asc" };
      const rows = await selectContracts(app.db)
        .where(
          and(
            request.query.includeArchived === "true" ? undefined : isNull(contracts.archivedAt),
            // CTR-019: the default list hides ended contracts the same
            // way it hides archived ones — a dead deal drops out of the
            // working surfaces. The filter is on the column rather than
            // on the joined stage, because the column is the queryable
            // summary the stage transition stamps.
            request.query.includeEnded === "true" ? undefined : isNull(contracts.endedAt),
            // A Contributor's list is the contracts they are on. An
            // empty answer is a real state — the list's own empty
            // state, never a refusal.
            //
            // The scope is in the WHERE clause, so the limit below cuts
            // rows this viewer can already reach. A read that limited
            // first and filtered after would answer pages that shrink by
            // however many confidential contracts sat in the window, and
            // a page length that varies with what is hidden is the
            // existence leak DD-014 exists to close (CTR-024).
            teamScope(request.user),
            request.query.cursor === undefined
              ? undefined
              : furtherDownThan(request.query.cursor, request.user, sort),
          ),
        )
        // The sorted column, then the reference. Unsorted that is the
        // reference alone: it is monotonic, so newest-first can tie with
        // nothing.
        .orderBy(...listOrder(sort))
        // One past the page, which is how the answer knows whether there
        // is more without counting anything.
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      const contributorFields =
        request.user.role === "contributor"
          ? new Map(
              await Promise.all(
                [...new Set(page.map((context) => context.row.contractTypeId))].map(
                  async (contractTypeId) =>
                    [contractTypeId, await attachedFieldsOf(app.db, contractTypeId)] as const,
                ),
              ),
            )
          : null;
      return {
        contracts: page.map((context) =>
          toRow(
            context,
            contributorFields
              ? projectCustomFields(
                  request.user.role,
                  contributorFields.get(context.row.contractTypeId) ?? [],
                  context.row.customFields,
                ).customFields
              : context.row.customFields,
          ),
        ),
        // Only when a further row was actually read. A cursor on the
        // last page would send the client for an empty one.
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.row.id ?? null) : null,
      };
    },
  );

  app.get(
    "/contracts/options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listContractOptions",
        summary:
          "The live contract types in display order, each with the " +
          "fields it attaches (CTR-016) so the create dialog can grow " +
          "the ones it requires; the live statuses; and the live people " +
          "the Owner and team pickers offer — the create dialog's and " +
          "the record's Member+ picker source; and the live approver " +
          "groups the record's apply picker offers, each with the ids " +
          "of the people applying it would ask (CTR-012) — the settings " +
          "surfaces that manage all of these stay Administrator-only " +
          "per SET-002",
        tags: ["contracts"],
        response: {
          200: z.object({
            contractTypes: z.array(TypeChoiceSchema),
            contractStatuses: z.array(StatusOptionSchema),
            users: z.array(UserOptionSchema),
            approverGroups: z.array(ApproverGroupOptionSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const [types, statuses, people, groups] = await Promise.all([
        app.db
          .select({
            id: contractTypes.id,
            slug: contractTypes.slug,
            displayName: contractTypes.displayName,
          })
          .from(contractTypes)
          .where(isNull(contractTypes.archivedAt))
          .orderBy(asc(contractTypes.displayOrder), asc(contractTypes.createdAt)),
        app.db
          .select({
            id: contractStatuses.id,
            slug: contractStatuses.slug,
            displayName: contractStatuses.displayName,
            stage: contractStatuses.stage,
          })
          .from(contractStatuses)
          .where(isNull(contractStatuses.archivedAt))
          .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt)),
        // Everyone assignable to a team; the client narrows the Owner
        // pick to Member+, and the write guard is the real refusal.
        app.db
          .select({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
            role: users.role,
          })
          .from(users)
          .where(isNull(users.archivedAt))
          .orderBy(asc(sql`lower(${users.displayName})`)),
        // The live templates and their membership in one read (CTR-012).
        // An archived group is absent, which is the whole of what
        // archiving one does: it leaves the apply picker and disturbs
        // nothing it already produced. The members ride in display-name
        // order — the order the apply itself asks in — so the dialog's
        // preview names people in the order the roster will then draw
        // them, rather than in whatever order the join happened to give.
        app.db
          .select({
            id: approverGroups.id,
            name: approverGroups.name,
            memberId: approverGroupMembers.userId,
          })
          .from(approverGroups)
          .leftJoin(approverGroupMembers, eq(approverGroupMembers.groupId, approverGroups.id))
          .leftJoin(users, eq(users.id, approverGroupMembers.userId))
          .where(isNull(approverGroups.archivedAt))
          .orderBy(
            asc(approverGroups.name),
            asc(approverGroups.createdAt),
            asc(users.displayName),
            asc(users.id),
          ),
      ]);
      // A left join, so a group with no members is still offered — the
      // apply refuses it by name, which is a better answer than a
      // template that has silently vanished from the picker.
      //
      // Gathered by id rather than by adjacency: nothing makes a group
      // name unique, so two same-named templates can interleave their
      // member rows under the sort. Map insertion order keeps the
      // answer in the order the query gave.
      const byGroupId = new Map<string, { id: string; name: string; memberIds: string[] }>();
      for (const row of groups) {
        let group = byGroupId.get(row.id);
        if (!group) {
          group = { id: row.id, name: row.name, memberIds: [] };
          byGroupId.set(row.id, group);
        }
        if (row.memberId !== null) group.memberIds.push(row.memberId);
      }
      const groupOptions = [...byGroupId.values()];
      // Each type's own attachments, so the dialog knows what picking
      // that type will demand before it asks for it. One query per live
      // type: the taxonomy is a handful of rows, and the alternative —
      // one join grouped in memory — buys nothing at this size.
      const attached = await Promise.all(
        types.map((contractType) => attachedFieldsOf(app.db, contractType.id)),
      );
      return {
        contractTypes: types.map((contractType, index) => ({
          ...contractType,
          fields: attached[index]!,
        })),
        contractStatuses: statuses,
        users: people.map((person) => ({ ...toPerson(person), role: person.role })),
        approverGroups: groupOptions,
      };
    },
  );

  app.get(
    "/contracts/:number",
    {
      preHandler: requireContractReader,
      schema: {
        operationId: "getContract",
        summary:
          "One contract by its CTR-003 number, with its Owner, its " +
          "signing entity, its counterparties, its working group, and " +
          "the fields its type attaches (CTR-016) in attachment order — " +
          "the record page's read; archived contracts answer too, so " +
          "restore stays reachable. A Contributor reads a contract they " +
          "hold a contract_team row on, and is answered 404 on one they " +
          "do not. A confidential contract answers the same 404 to " +
          "anyone outside its named team, its Owner, and Administrators",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractRecordEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const [row] = await selectContracts(app.db)
        // The scope rides beside the number, so a contract a
        // Contributor is not on reads as one that does not exist. A
        // locked page would tell them it is there.
        .where(and(eq(contracts.number, request.params.number), teamScope(request.user)))
        .limit(1);
      if (!row) throw httpError(404, NO_CONTRACT);
      const [team, parties, custom, renewals] = await Promise.all([
        selectTeam(app.db, row.row.id),
        selectCounterparties(app.db, row.row.id),
        customFieldsEnvelope(app.db, row, request.user),
        selectRenewals(app.db, row.row.id),
      ]);
      return {
        contract: toRow(row, custom.customFields),
        fields: custom.fields,
        customFieldRefs: custom.customFieldRefs,
        team,
        counterparties: parties,
        renewals,
      };
    },
  );

  app.post(
    "/contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createContract",
        summary:
          "Create a contract from a title, a live type, and any custom " +
          "fields that type hard-requires (CTR-016/MTR-014 — creation is " +
          "refused while one is empty); the status starts on the " +
          "protected draft seed (CTR-001) and the number comes from the " +
          "CTR-003 sequence. Everything else is set inline on the record " +
          "afterward — except the Confidential flag (DD-014), which may " +
          "be set here so a sensitive record is never visible to the " +
          "wrong audience, even briefly. " +
          "`renewalOf` routes a renewal into a new record (CTR-007's " +
          "third and fourth vehicles, M16/5): the successor is born " +
          "carrying its predecessor's business facts — our entity, the " +
          "value, the term shape, and the counterparties — and linked " +
          "to it, as a child by contracts.parent_id or as a standalone " +
          "successor by a CTR-015 `renews` row. The team, the status, " +
          "and the Confidential flag are **never** copied: CTR-015's " +
          "no-inheritance stance, applied at birth. The title and the " +
          "type are the body's, so whatever the person edited before " +
          "pressing Create is what the record is born with. Appends the " +
          "link's own activity action beside contract.created",
        tags: ["contracts"],
        // Strict: the number is the sequence's to give, so a body
        // carrying one is refused rather than silently ignored.
        body: z.strictObject({
          title: TitleSchema,
          contractTypeId: z.string(),
          /** The type's fields, keyed by slug. Only the required ones
           * have to be here — the rest are set on the record — and a
           * slug the type does not attach is refused. */
          customFields: CustomFieldsInput.optional(),
          /** DD-014's flag, from the first moment. No actor check is
           * needed: the person creating the record is its creator, and
           * the creator is one of the three who may set it. Omitted
           * means open, which is the product's default (DD-014). */
          isConfidential: z.boolean().optional(),
          /** CTR-007's routing (M16/5). Omitted is the ordinary create:
           * a record that renews nothing and sits under nobody. */
          renewalOf: RenewalOfSchema.optional(),
          /** MTR-007's optional broader-work container. Omitted keeps
           * the Contract standalone; an archived or unreachable Matter
           * is refused rather than accepted from a stale picker. */
          matterNumber: z.coerce.number().int().positive().optional(),
        }),
        response: {
          201: ContractEnvelope,
          // The two refusals a routed create can give that a client acts
          // on rather than prints. Neither is reachable through the
          // routing itself — a newborn contract has no descendants and
          // no links — but the write path is CTR-015's, and it answers
          // the same way whichever caller reaches it.
          409: problemTypeResponse(
            "The named types are CTR-015's guards: the link already exists, the parent " +
              "would close a loop, or both ends are one contract. An unnamed 409 is an " +
              "archived predecessor; print it.",
            [
              CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
              CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
              CONTRACT_SELF_LINK_PROBLEM_TYPE,
            ],
          ),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { title, contractTypeId, renewalOf, matterNumber } = request.body;
      const created = await app.db.transaction(async (tx) => {
        // The predecessor first, and under its own row lock, so the
        // facts copied onto the successor are the ones the record held
        // at the moment the renewal was routed. Reach is asked here as
        // it is everywhere else: a predecessor this viewer cannot reach
        // answers exactly as one that was never made, and an archived
        // one routes nothing until it is restored. It is asked *here*
        // rather than inside the write because reach is the route's
        // question — the write takes the row already locked.
        const renewal = renewalOf
          ? {
              vehicle: renewalOf.vehicle,
              predecessor: (await editableContract(tx, renewalOf.number, request.user)).row,
            }
          : null;
        const matter = matterNumber
          ? await reachedMatter(tx, request.user, matterNumber, { lock: true })
          : null;
        if (matterNumber && !matter) throw httpError(404, NO_MATTER);
        if (matter?.archivedAt) {
          throw httpError(409, "This matter is archived. Restore it before linking to it.");
        }
        const born = await createContract(tx, {
          actorId: request.user.id,
          title,
          contractTypeId,
          customFields: request.body.customFields,
          isConfidential: request.body.isConfidential,
          renewal,
          matter,
        });
        if (!renewal) {
          return {
            ...born,
            // A new contract is unassigned, which of ours signs is not
            // known yet, and nobody is recorded on the other side; all
            // three are set on the record afterwards.
            manager: null,
            entity: null,
            primaryCounterparty: null,
          };
        }

        // The copied facts read back off the row that now holds them,
        // rather than off the predecessor's context: the entity and the
        // primary party the answer names have to be the ones this record
        // was born with, and one joined read is what guarantees it.
        const [read] = await selectContracts(tx).where(eq(contracts.id, born.row.id)).limit(1);
        return read!;
      });
      return reply.status(201).send({ contract: toRow(created) });
    },
  );

  app.patch(
    "/contracts/:number",
    {
      preHandler: requireContractReader,
      schema: {
        operationId: "updateContract",
        summary:
          "Commit one field of a contract in place (DES-017 per-field " +
          "commits): title, description, the Owner, the signing entity, " +
          "priority, risk, the value, the CTR-006 term fields, the type, " +
          "a custom field, or the " +
          "status — any live status may follow any other (CTR-001). The " +
          "value is one field in three parts: amount, currency, and " +
          "cadence commit together and clear together. Re-typing " +
          "re-checks the new type's hard-required fields before it " +
          "commits (CTR-016/MTR-014), so the type and the values that " +
          "satisfy it may be sent together. The term is five fields with " +
          "one rule between them (CTR-006): an expiry on an evergreen " +
          "contract and a renewal period on a contract that does not " +
          "auto-renew are refused 400 with their own problem types, and " +
          "a term-type change clears the fields the new type cannot " +
          "hold, each clear narrated as the edit it is. The Confidential flag " +
          "(DD-014) commits here too, but only for an Administrator, the " +
          "contract's creator, or its Owner: anyone else who reaches the " +
          "record is refused 403, and anyone who does not reach it is " +
          "answered 404 like a contract that does not exist. A status " +
          "change that moves the contract past the approval stage while " +
          "approvals are pending or rejected meets CTR-012's soft gate: " +
          "it is refused 409 with the unresolved approvals named, and " +
          "the same commit with `overrideSoftGate` succeeds and is " +
          "logged as an override. Never on an archived contract",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          title: TitleSchema.optional(),
          description: DescriptionSchema.nullable().optional(),
          /** CTR-004's Owner. `null` clears it back to unassigned —
           * a real state (triage), not an absent field. */
          managerId: z.string().nullable().optional(),
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
        }),
        response: {
          200: ContractFieldsEnvelope,
          // CTR-006's two shape rules. A client branches on these
          // because the repair is a choice nothing else on this route
          // asks for — change the term type, or drop the value — and
          // because the record draws its term controls by the same rule.
          400: problemTypeResponse(
            "The term data would contradict its own type (CTR-006): an expiry on an " +
              "evergreen contract, or a renewal period on a contract that does not " +
              "auto-renew. Change the term type, or leave the value off.",
            [TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE, TERM_RENEWAL_PERIOD_PROBLEM_TYPE],
          ),
          // CTR-012's soft gate is the one refusal on this route a
          // caller has to act on rather than print: the same request
          // with `overrideSoftGate` succeeds, so a client that could
          // not tell this 409 from an ordinary one would have no way
          // to offer the confirmation.
          409: problemTypeResponse(
            "The status change crosses CTR-012's approval gate with approvals still " +
              "unresolved. Re-send with `overrideSoftGate` to record it as an override.",
            [SOFT_GATE_PROBLEM_TYPE],
          ),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const body = request.body;
      // The seam's transaction rather than the database's: this PATCH is
      // the one that can hand a record to somebody (CTR-004), and the
      // bell row for it belongs inside the same commit as the column.
      const updated = await app.notifier.notifying(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        let contributorAttached: AttachedCustomField[] | null = null;
        if (request.user.role === "contributor") {
          const allowed = new Set(["value", "effectiveDate", "customFields"]);
          if (Object.keys(body).some((key) => !allowed.has(key))) {
            throw httpError(
              403,
              "Contributors can edit only the value, effective date, and business Fields on this contract.",
            );
          }
          if (body.customFields !== undefined) {
            contributorAttached = await attachedFieldsOf(tx, current.row.contractTypeId);
            assertContributorCustomFieldWrite(contributorAttached, body.customFields);
          }
        }
        // Reach was answered above, for this patch and every other one,
        // whatever the body carries. What is left is the flag's own
        // narrower actor set, and it is asked before the archived
        // refusal: a viewer who may not decide the audience should not
        // learn from a 409 that the write was otherwise theirs to make.
        if (body.isConfidential !== undefined) {
          await assertMayFlagConfidential(tx, current, request.user);
        }
        assertEditable(current);
        const target = current.row;

        const patch: Partial<Contract> = {};
        /** The DD-017 changed map — old and new values per edited
         * field, feeding the M9 viewer's narration. */
        const changed: Record<string, { from: unknown; to: unknown }> = {};

        const title = body.title?.trim();
        if (title !== undefined && title !== target.title) {
          patch.title = title;
          changed.title = { from: target.title, to: title };
        }

        if (body.description !== undefined) {
          // Blank normalizes to NULL; null clears deliberately.
          const next = body.description?.trim() || null;
          if (next !== target.description) {
            patch.description = next;
            changed.description = { from: target.description, to: next };
          }
        }

        // The Owner is a person, so the audit map carries names, not
        // ids — the M9 viewer narrates "Owner changed from X to Y".
        let manager = current.manager;
        if (body.managerId !== undefined && body.managerId !== target.managerId) {
          manager =
            body.managerId === null
              ? null
              : await lockedUser(
                  tx,
                  body.managerId,
                  OWNER_ROLES,
                  "The Owner must be a live Administrator or Legal Team Member.",
                );
          patch.managerId = manager?.id ?? null;
          changed.owner = {
            from: current.manager?.displayName ?? null,
            to: manager?.displayName ?? null,
          };
        }

        // Our side of the contract (CTR-011). The picker offers live
        // entities only, so the write refuses an archived one: nothing
        // new gets signed by an entity that has left the registry. An
        // entity archived after the fact stays on the record untouched.
        let entity = current.entity;
        if (body.entityId !== undefined && body.entityId !== target.entityId) {
          if (body.entityId === null) {
            entity = null;
          } else {
            // Lock the entity row so a concurrent archive can't slip
            // between the check and the update.
            const [signatory] = await tx
              .select({
                id: entities.id,
                legalName: entities.legalName,
                archivedAt: entities.archivedAt,
              })
              .from(entities)
              .where(eq(entities.id, body.entityId))
              .limit(1)
              .for("update");
            if (!signatory || signatory.archivedAt) {
              throw httpError(400, "The signing entity must be a live entity.");
            }
            entity = { id: signatory.id, legalName: signatory.legalName };
          }
          patch.entityId = entity?.id ?? null;
          // The audit map carries legal names, not ids — the M9 viewer
          // narrates "Entity changed from X to Y".
          changed.entity = {
            from: current.entity?.legalName ?? null,
            to: entity?.legalName ?? null,
          };
        }

        if (body.priority !== undefined && body.priority !== target.priority) {
          patch.priority = body.priority;
          changed.priority = { from: target.priority, to: body.priority };
        }

        if (body.risk !== undefined && body.risk !== target.risk) {
          patch.risk = body.risk;
          changed.risk = { from: target.risk, to: body.risk };
        }

        // CTR-006's term: five fields with one rule running between
        // them. Each commits on its own like every other field
        // (DES-017), and the type is what decides which of the other
        // four the record may hold at all.
        //
        // The type this write lands on, whether it is being changed or
        // merely being read: everything below is checked against it, so
        // a term type and the dates that suit it may travel together.
        const termType = body.termType ?? target.termType;
        if (body.termType !== undefined && body.termType !== target.termType) {
          patch.termType = body.termType;
          changed.termType = { from: target.termType, to: body.termType };
        }

        // What the type will not hold, refused before anything is
        // written. A value sent in the same breath as the type that
        // forbids it is a contradiction rather than an oversight, so it
        // is refused rather than quietly dropped — the clearing below
        // is for what the record already held, which nobody re-sent.
        if (body.expiryDate != null && termType === "evergreen") {
          throw httpError(400, "An evergreen contract has no expiry date.", {
            type: TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE,
          });
        }
        if (body.renewalPeriodMonths != null && termType !== "auto_renew") {
          throw httpError(400, "Only an auto-renewing contract has a renewal period.", {
            type: TERM_RENEWAL_PERIOD_PROBLEM_TYPE,
          });
        }

        if (body.effectiveDate !== undefined && body.effectiveDate !== target.effectiveDate) {
          patch.effectiveDate = body.effectiveDate;
          changed.effectiveDate = { from: target.effectiveDate, to: body.effectiveDate };
        }
        if (body.expiryDate !== undefined && body.expiryDate !== target.expiryDate) {
          patch.expiryDate = body.expiryDate;
          changed.expiryDate = { from: target.expiryDate, to: body.expiryDate };
        }
        if (
          body.renewalPeriodMonths !== undefined &&
          body.renewalPeriodMonths !== target.renewalPeriodMonths
        ) {
          patch.renewalPeriodMonths = body.renewalPeriodMonths;
          changed.renewalPeriodMonths = {
            from: target.renewalPeriodMonths,
            to: body.renewalPeriodMonths,
          };
        }
        if (
          body.noticePeriodDays !== undefined &&
          body.noticePeriodDays !== target.noticePeriodDays
        ) {
          patch.noticePeriodDays = body.noticePeriodDays;
          changed.noticePeriodDays = {
            from: target.noticePeriodDays,
            to: body.noticePeriodDays,
          };
        }

        // The clears a type change forces, narrated as the edits they
        // are (CTR-006). Re-typing a contract to evergreen takes its
        // expiry off, and re-typing it off auto-renew takes its renewal
        // period off, because the record must not go on holding a fact
        // its type says it cannot have. Each lands in the same changed
        // map as an ordinary edit, so the feed says the expiry was
        // cleared rather than leaving a reader to infer it from the
        // type change beside it.
        //
        // The value read is the one this write will leave behind — a
        // clear sent in the same request has already been recorded, and
        // nothing here writes it twice.
        const nextExpiry = patch.expiryDate === undefined ? target.expiryDate : patch.expiryDate;
        if (termType === "evergreen" && nextExpiry !== null) {
          patch.expiryDate = null;
          changed.expiryDate = { from: nextExpiry, to: null };
        }
        const nextRenewalPeriod =
          patch.renewalPeriodMonths === undefined
            ? target.renewalPeriodMonths
            : patch.renewalPeriodMonths;
        if (termType !== "auto_renew" && nextRenewalPeriod !== null) {
          patch.renewalPeriodMonths = null;
          changed.renewalPeriodMonths = { from: nextRenewalPeriod, to: null };
        }

        // CTR-002's type, re-picked — and with it the whole CTR-016
        // question of which fields this record carries, since the
        // attachment join hangs off the type. A re-type is the second
        // place MTR-014's hard-required rule holds, and it is the one
        // that matters most: without it, re-typing would be the way
        // around a rule creation enforces.
        let contractTypeName = current.contractTypeName;
        const retyped =
          body.contractTypeId !== undefined && body.contractTypeId !== target.contractTypeId;
        if (retyped) {
          // Lock the type row so a concurrent archive can't slip
          // between the check and the update.
          const [contractType] = await tx
            .select({
              id: contractTypes.id,
              displayName: contractTypes.displayName,
              archivedAt: contractTypes.archivedAt,
            })
            .from(contractTypes)
            .where(eq(contractTypes.id, body.contractTypeId!))
            .limit(1)
            .for("update");
          if (!contractType || contractType.archivedAt) {
            throw httpError(400, "The contract type must be a live contract type.");
          }
          patch.contractTypeId = contractType.id;
          changed.contractType = { from: current.contractTypeName, to: contractType.displayName };
          contractTypeName = contractType.displayName;
        }

        // The fields the record carries once this write lands — the new
        // type's when it is being re-typed, the current type's
        // otherwise. Everything below is checked against these, so a
        // slug is only writable while the type that attaches it is the
        // type the contract will hold.
        const attached =
          contributorAttached ??
          (await attachedFieldsOf(tx, patch.contractTypeId ?? target.contractTypeId));
        if (body.customFields !== undefined || retyped) {
          const applied = await applyCustomFields(
            tx,
            attached,
            target.customFields,
            body.customFields ?? {},
          );
          const customFields = applied.values;
          if (retyped) {
            // The new type's whole required set, against the values the
            // record will hold. Values retained from before count: a
            // slug the old type also attached is already answered.
            assertRequiredCustomFields(attached, customFields);
          } else if (body.customFields !== undefined) {
            // No re-type, so only the fields this commit touched are
            // checked (MTR-014: the rule also holds when a required
            // field is cleared). A record that already carries a gap —
            // one made required after it was created — must still be
            // editable everywhere else.
            assertRequiredCustomFields(
              attached.filter((field) => field.slug in body.customFields!),
              customFields,
            );
          }
          if (Object.keys(applied.changed).length > 0) {
            patch.customFields = customFields;
            Object.assign(changed, applied.changed);
          }
        }

        // CTR-010's value: three columns, one field. They are written as
        // a group and compared as a group, so changing the currency
        // alone is one change to "the value", not a change to a column
        // nobody edits on its own. The audit map carries the whole trio
        // on both sides — "$120,000 /year" only reads as a change from
        // something if the something is there to read.
        if (body.value !== undefined) {
          const before = toValue(target);
          const next = body.value;
          if (!sameValue(before, next)) {
            patch.valueAmount = next?.amount ?? null;
            patch.valueCurrency = next?.currency ?? null;
            patch.valueCadence = next?.cadence ?? null;
            changed.value = { from: before, to: next };
          }
        }

        // The Confidential flag keeps its own audit verb for the reason
        // DD-014 gives: the walling-off of a record has to be
        // accountable in its own right, so it is a verb an Administrator
        // can filter on rather than one key inside an edit. Like the
        // status, it rides the same UPDATE and stays out of the changed
        // map.
        let confidentialityChange: boolean | undefined;
        if (body.isConfidential !== undefined && body.isConfidential !== target.isConfidential) {
          patch.isConfidential = body.isConfidential;
          confidentialityChange = body.isConfidential;
        }

        // The status keeps its own audit verb — surfaces branch on the
        // stage behind it (CTR-001) — so it rides the same UPDATE but
        // stays out of the changed map.
        // The two status names are free text — a status is a renameable
        // label (CTR-001) — and the two stages are the closed set
        // surfaces branch on, so they carry that type rather than
        // widening to string on the way to the seam.
        let statusChange:
          | { from: string; to: string; fromStage: ContractStage; toStage: ContractStage }
          | undefined;
        /** CTR-012's soft gate, pressed through: the asks that were
         * still open when the move committed, so the override entry can
         * name them. `null` whenever the gate had nothing to say. */
        let overridden: UnresolvedApproval[] | null = null;
        let statusName = current.statusName;
        let stage = current.stage;
        if (body.statusId !== undefined && body.statusId !== target.statusId) {
          // Lock the status row so a concurrent archive can't slip
          // between the check and the update.
          const [status] = await tx
            .select({
              id: contractStatuses.id,
              displayName: contractStatuses.displayName,
              stage: contractStatuses.stage,
              archivedAt: contractStatuses.archivedAt,
            })
            .from(contractStatuses)
            .where(eq(contractStatuses.id, body.statusId))
            .limit(1)
            .for("update");
          if (!status || status.archivedAt) {
            throw httpError(400, "The status must be a live contract status.");
          }
          // CTR-012's soft gate, and the first server-side branch on
          // stage (CTR-001). Both stages are already resolved here —
          // the one being left and the one being moved to — so the gate
          // costs a stage comparison on every status change and a read
          // of the approvals only on a move that crosses the line. It
          // refuses before anything is written; the contract row is
          // locked, so the set it names cannot move underneath the
          // UPDATE that follows.
          overridden = await assertApprovalGate(
            tx,
            target.id,
            current.stage,
            status.stage,
            body.overrideSoftGate ?? false,
          );
          patch.statusId = status.id;
          statusChange = {
            from: current.statusName,
            to: status.displayName,
            fromStage: current.stage,
            toStage: status.stage,
          };
          statusName = status.displayName;
          stage = status.stage;
          // CTR-019's side effect: `ended_at` stamped on entering the
          // ended stage, cleared on leaving it. The column is the
          // queryable summary the default list and the renewal-pending
          // predicate read; the activity log is the source of truth for
          // the transition history.
          if (status.stage === "ended" && current.stage !== "ended") {
            patch.endedAt = new Date();
          } else if (status.stage !== "ended" && current.stage === "ended") {
            patch.endedAt = null;
          }
        }

        // Nothing changed: answer with the row and write no misleading
        // from==to audit entry.
        if (Object.keys(patch).length === 0) return { ...current, attached };

        const [row] = await tx
          .update(contracts)
          .set(patch)
          .where(eq(contracts.id, target.id))
          .returning();
        if (Object.keys(changed).length > 0) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: "contract.updated",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              number: row!.number,
              title: row!.title,
              changed,
              ...(request.user.role === "contributor" ? { actorRole: request.user.role } : {}),
            },
          });
        }
        if (statusChange) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: "contract.status_changed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: row!.number, title: row!.title, ...statusChange },
          });
        }
        if (overridden && statusChange) {
          // Its own verb, beside the status change rather than inside
          // it (DD-017). Pushing past sign-off is a second thing that
          // happened, and CTR-012 requires it to be accountable in its
          // own right — so an Administrator filters the audit log on
          // this verb rather than hunting through status payloads for
          // the ones that crossed the line. The payload names the
          // people who were unresolved, because "who was skipped" is
          // the question the entry exists to answer.
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: "contract.stage_gate_overridden",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              number: row!.number,
              title: row!.title,
              fromStage: statusChange.fromStage,
              toStage: statusChange.toStage,
              approvers: overridden.map((approval) => ({
                approvalId: approval.id,
                approverId: approval.approverId,
                approverName: approval.approverName,
                status: approval.status,
              })),
            },
          });
        }
        // Being handed a contract is done *to* you, so it is NOT-002's
        // group 1: the bell rings and the email leaves at once. Raised
        // **after** the UPDATE, because a confidential record reaches
        // its Owner by them being its Owner (CTR-022) — before the
        // write, the wall is still answering about the previous one.
        // Clearing the Owner raises nothing: unassigned is a real state
        // (triage), and it hands the record to nobody.
        // A record moving is ambient movement on it, so it is NOT-002's
        // group 2: the bell rings for the Owner and the team, and no
        // email is owed under the default. Nothing is raised for the
        // rest of this PATCH — a title, a description, a term date are
        // edits the feed already narrates on the record, and a bell item
        // per field would be the noise the group's defaults exist to
        // avoid. The status is what surfaces branch on (CTR-001), and it
        // is what "my contract moved" means.
        if (statusChange) {
          await app.notifier.statusChanged(tx, {
            contractId: target.id,
            actorId: request.user.id,
            actorName: request.user.displayName,
            ...statusChange,
          });
        }
        if (patch.managerId) {
          await app.notifier.ownerAssigned(tx, {
            contractId: target.id,
            contractNumber: row!.number,
            contractTitle: row!.title,
            actorId: request.user.id,
            actorName: request.user.displayName,
            ownerId: patch.managerId,
          });
        }
        if (confidentialityChange !== undefined) {
          // One write, two DD-017 surfaces: the team's feed narrates it
          // at the record-action tier, and the Administrator-only audit
          // log — which reads every tier with no record scope — records
          // it with actor and timestamp. The audit-log module needs
          // nothing of its own for that.
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: confidentialityChange
              ? "contract.confidentiality_set"
              : "contract.confidentiality_cleared",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { number: row!.number, title: row!.title },
          });
        }
        return {
          row: row!,
          contractTypeName,
          statusName,
          stage,
          manager,
          entity,
          // No field of this PATCH touches the other side — the
          // counterparties have their own routes.
          primaryCounterparty: current.primaryCounterparty,
          attached,
        };
      });
      const { attached, ...context } = updated;
      // The attachments ride out because a re-type changed them: a
      // client that adopted only the row would keep drawing the old
      // type's fields over the new type's values.
      const projection = projectCustomFields(request.user.role, attached, context.row.customFields);
      return {
        contract: toRow(context, projection.customFields),
        fields: projection.fields,
        customFieldRefs: await customFieldRefs(app.db, projection.fields, projection.customFields),
      };
    },
  );

  app.post(
    "/contracts/:number/renewal",
    {
      preHandler: requireMember,
      schema: {
        operationId: "confirmContractRenewal",
        summary:
          "Confirm the roll (CTR-007's first renewal vehicle): the same " +
          "record's term advances, on the say-so of a person. CTR-006's " +
          "engine is notify-only and never advances a date on its own, " +
          "so a contract that passed its expiry un-actioned reads as " +
          "'renewal pending confirmation' — a predicate over its dates, " +
          "not a status — and waits for this. The request carries the " +
          "expiry it was raised against and the expiry to advance to; " +
          "the record proposes the second as the first plus the renewal " +
          "period, and the caller may send a different date, because a " +
          "roll whose dates shifted in negotiation is recorded as it " +
          "really landed. The comparison is made under the contract's " +
          "row lock, so two confirms racing for one roll advance the " +
          "term exactly once and the loser is refused 409 by name " +
          "rather than rolling it again. Only an auto-renewing contract " +
          "with an expiry rolls, and a roll must move the term forward. " +
          "The status and the stage are untouched: this moves one date. " +
          "Appends one contract.renewal_confirmed entry at the " +
          "working-team tier (DD-017) — the only record a renewal " +
          "leaves, and what the record's renewal history reads back. " +
          "Answers the record and its whole history. Member+: a " +
          "Contributor who reaches the record is refused 403 rather " +
          "than 404, because they can already see it. An archived " +
          "contract rolls nothing until it is restored",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          /** The expiry the person was looking at when they confirmed.
           * It is the precondition, not a value to write: the seam
           * refuses the roll when the record no longer holds it, which
           * is what makes a confirmed roll exactly-once. */
          fromExpiry: z.iso.date(),
          /** Where the term now runs to. The record proposes
           * `proposedRenewalExpiry` and the caller may send another
           * date, so long as it is later than `fromExpiry`. */
          toExpiry: z.iso.date(),
        }),
        response: {
          200: ContractRenewalsEnvelope,
          // The one refusal a client acts on rather than prints: the
          // record moved under the dialog, so the repair is to read the
          // new expiry and offer the roll again — which no other 409 on
          // this route asks for.
          409: problemTypeResponse(
            "The named type says this contract's expiry is no longer the one the roll " +
              "was raised against (CTR-006) — read the record again and confirm against " +
              "the expiry it now holds, which is the one refusal here a client acts on " +
              "rather than prints. An unnamed 409 is an archived record or one that " +
              "records no expiry to roll; print it.",
            [RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE],
          ),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { fromExpiry, toExpiry } = request.body;
      // A roll advances a term. A date on or before the one it starts
      // from is not a shorter roll, it is a correction — and a
      // correction is an edit of the expiry, which the record's own
      // PATCH already does and narrates as the edit it is.
      if (toExpiry <= fromExpiry) {
        throw httpError(400, "A confirmed roll must move the expiry date forward.");
      }

      return await app.db.transaction(async (tx) => {
        // The lock first, and every question asked under it: a confirm
        // that raced this one may have archived the record, re-typed
        // its term, or already advanced the expiry.
        const current = await editableContract(tx, request.params.number, request.user);
        const { row } = current;

        if (row.termType !== "auto_renew") {
          throw httpError(
            400,
            "Only an auto-renewing contract rolls. Change the term type, or edit the " +
              "expiry date directly.",
          );
        }
        if (row.expiryDate === null) {
          throw httpError(
            409,
            "This contract records no expiry date, so there is no term to roll forward.",
          );
        }
        // The precondition, decided on the locked row. Sending the
        // expiry the person saw is what turns two simultaneous confirms
        // into one advance: the first moves the column, and the second
        // no longer matches.
        if (row.expiryDate !== fromExpiry) {
          throw httpError(
            409,
            "This contract's expiry has already moved. Read the record again before " +
              "confirming the roll.",
            { type: RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE },
          );
        }

        const [updated] = await tx
          .update(contracts)
          // One column, and the timestamp every write moves. Not the
          // status and not the stage: CTR-006 says the pending state is
          // a banner rather than a transition, and confirming it is a
          // move of one date rather than a move through the lifecycle.
          .set({ expiryDate: toExpiry, updatedAt: new Date() })
          .where(eq(contracts.id, row.id))
          .returning();

        // The roll keeps its own verb rather than riding
        // `contract.updated`: nothing stores a renewal, so this entry is
        // the whole record that one happened, and it is what the
        // record's renewal history and its "Last renewal" fact read back
        // (G.R5).
        await recordActivity(tx, {
          entityType: "contract",
          entityId: row.id,
          actorId: request.user.id,
          action: "contract.renewal_confirmed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: row.number, title: row.title, from: fromExpiry, to: toExpiry },
        });

        return {
          contract: toRow({ ...current, row: updated! }),
          renewals: await selectRenewals(tx, row.id),
        };
      });
    },
  );

  app.post(
    "/contracts/:number/team",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractTeamMember",
        summary:
          "Put a person on the contract team under a role (CTR-004). The " +
          "key is contract + person + role, so the same person may hold " +
          "two roles; the `creator` role is the server's to write",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          userId: z.string(),
          role: z.enum(CONTRACT_TEAM_ROLES),
        }),
        response: { 201: TeamEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { userId, role } = request.body;
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        // On a walled record this add is an audience decision (CTR-023),
        // so it is asked before the archived refusal — the same order the
        // flag's own write takes, for the same reason.
        await assertMayChangeTeam(tx, current, request.user);
        assertEditable(current);
        if (role === CREATOR_TEAM_ROLE) {
          throw httpError(400, "The creator is recorded when the contract is created.");
        }
        // Anyone live may join a team — external counsel participate as
        // `contributor` (MTR-006), and a Business User can be a watcher.
        const person = await lockedUser(tx, userId, USER_ROLES, "That is not a person we can add.");

        // The compound key is the check: an insert that conflicts wrote
        // nothing, so an empty return is "they already hold that role" —
        // one statement, and two concurrent adds cannot both land.
        const inserted = await tx
          .insert(contractTeam)
          .values({ contractId: current.row.id, userId: person.id, role })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) throw httpError(409, "This person already holds that role.");
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.team_added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: current.row.number,
            title: current.row.title,
            member: person.displayName,
            role,
          },
        });
        return selectTeam(tx, current.row.id);
      });
      return reply.status(201).send({ team });
    },
  );

  app.delete(
    "/contracts/:number/team/:userId/:role",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractTeamMember",
        summary:
          "Take one role off the contract team (CTR-004). The role is " +
          "part of the address, so dropping a watcher leaves that same " +
          "person's member row standing; `creator` is provenance and stays",
        tags: ["contracts"],
        params: NumberParams.extend({
          userId: z.string(),
          role: z.enum(CONTRACT_TEAM_ROLES),
        }),
        response: { 200: TeamEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { userId, role } = request.params;
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        // Taking somebody off a walled record's team is the same
        // decision as putting them on it, read the other way (CTR-023).
        await assertMayChangeTeam(tx, current, request.user);
        assertEditable(current);
        if (role === CREATOR_TEAM_ROLE) {
          throw httpError(409, "The creator stays on the record — it is who made it.");
        }
        const [removed] = await tx
          .delete(contractTeam)
          .where(
            and(
              eq(contractTeam.contractId, current.row.id),
              eq(contractTeam.userId, userId),
              eq(contractTeam.role, role),
            ),
          )
          .returning();
        if (!removed) throw httpError(404, "Nobody holds that role on this contract.");

        const [person] = await tx
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.team_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: current.row.number,
            title: current.row.title,
            member: person?.displayName ?? userId,
            role,
          },
        });
        return selectTeam(tx, current.row.id);
      });
      return { team };
    },
  );

  app.post(
    "/contracts/:number/counterparties",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractCounterparty",
        summary:
          "Put a counterparty on the contract (CTR-011) — either one we " +
          "already hold, by id, or an unknown name, which is created " +
          "with just that name in the same transaction. A name we " +
          "already hold is reused, never duplicated. The first party on " +
          "a contract becomes its primary",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z
          .strictObject({
            counterpartyId: z.string().optional(),
            /** CTR-011's inline creation: a name and nothing else. */
            name: CounterpartyNameSchema.optional(),
          })
          // One or the other. Both together is a client that has not
          // decided whether it is picking or creating, and neither is a
          // request with no counterparty in it.
          .refine(
            (body) => (body.counterpartyId === undefined) !== (body.name === undefined),
            "Name a counterparty by id or by name, not both.",
          ),
        response: { 201: CounterpartiesEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { counterpartyId, name } = request.body;
      const result = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number, request.user);

        let party: JoinedCounterparty;
        let born = false;
        if (counterpartyId !== undefined) {
          // Lock the counterparty row so a concurrent archive cannot
          // slip between the check and the insert.
          const [existing] = await tx
            .select({
              id: counterparties.id,
              name: counterparties.name,
              archivedAt: counterparties.archivedAt,
            })
            .from(counterparties)
            .where(eq(counterparties.id, counterpartyId))
            .limit(1)
            .for("update");
          if (!existing || existing.archivedAt) {
            throw httpError(400, "The counterparty must be a live counterparty.");
          }
          party = { id: existing.id, name: existing.name };
        } else {
          const found = await findOrCreateCounterparty(tx, name!);
          party = found.party;
          born = found.born;
        }

        // Under the contract row's lock, so this read and the insert
        // that follows are one decision: two Legal Team Members adding
        // the first party at once cannot both see an empty contract.
        const held = await tx
          .select({
            counterpartyId: contractCounterparties.counterpartyId,
          })
          .from(contractCounterparties)
          .where(eq(contractCounterparties.contractId, current.row.id));
        if (held.some((row) => row.counterpartyId === party.id)) {
          throw httpError(409, "That counterparty is already on this contract.");
        }

        // CTR-011's invariant, in its simplest half: the first party on
        // a contract is its primary, because a contract with parties
        // and no primary is a contract no list can draw.
        const isPrimary = held.length === 0;
        await tx.insert(contractCounterparties).values({
          contractId: current.row.id,
          counterpartyId: party.id,
          isPrimary,
        });
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.counterparty_added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: current.row.number,
            title: current.row.title,
            counterparty: party.name,
            isPrimary,
            // Whether the organization itself was born here — the M9
            // viewer says "added Helix Labs GmbH (new)" only for this.
            created: born,
          },
        });
        return counterpartiesEnvelope(tx, current);
      });
      return reply.status(201).send(result);
    },
  );

  app.delete(
    "/contracts/:number/counterparties/:counterpartyId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractCounterparty",
        summary:
          "Take a counterparty off the contract (CTR-011). Removing the " +
          "primary passes the flag to the party who joined next, so a " +
          "contract with counterparties always has one; the counterparty " +
          "record itself is untouched and stays on its other contracts",
        tags: ["contracts"],
        params: NumberParams.extend({ counterpartyId: z.string() }),
        response: { 200: CounterpartiesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { counterpartyId } = request.params;
      const result = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number, request.user);
        const [removed] = await tx
          .delete(contractCounterparties)
          .where(
            and(
              eq(contractCounterparties.contractId, current.row.id),
              eq(contractCounterparties.counterpartyId, counterpartyId),
            ),
          )
          .returning();
        if (!removed) throw httpError(404, "That counterparty is not on this contract.");

        const [party] = await tx
          .select({ name: counterparties.name })
          .from(counterparties)
          .where(eq(counterparties.id, counterpartyId))
          .limit(1);
        const removedName = party?.name ?? counterpartyId;

        // The other half of CTR-011's invariant: the primary leaving
        // must hand the flag on, never drop it. The party who joined
        // next takes it — the record's own order, not an arbitrary one.
        // The last party out takes the flag with them, which is the one
        // state with no primary and no parties either.
        let promotedName: string | undefined;
        if (removed.isPrimary) {
          const [next] = await tx
            .select({ id: counterparties.id, name: counterparties.name })
            .from(contractCounterparties)
            .innerJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id))
            .where(eq(contractCounterparties.contractId, current.row.id))
            .orderBy(asc(contractCounterparties.createdAt), asc(sql`lower(${counterparties.name})`))
            .limit(1);
          if (next) {
            await promotePrimary(tx, current.row.id, next.id);
            promotedName = next.name;
          }
        }

        const audit = { number: current.row.number, title: current.row.title };
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.counterparty_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { ...audit, counterparty: removedName, wasPrimary: removed.isPrimary },
        });
        // The promotion is its own entry: nobody asked for it, so the
        // log has to say it happened rather than leave it implied by a
        // removal two lines above.
        if (promotedName !== undefined) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: current.row.id,
            actorId: request.user.id,
            action: "contract.counterparty_primary_changed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { ...audit, from: removedName, to: promotedName },
          });
        }
        return counterpartiesEnvelope(tx, current);
      });
      return result;
    },
  );

  app.post(
    "/contracts/:number/counterparties/:counterpartyId/primary",
    {
      preHandler: requireMember,
      schema: {
        operationId: "setPrimaryContractCounterparty",
        summary:
          "Name which counterparty the contract is listed under " +
          "(CTR-011). There is no route to clear the flag: the primary " +
          "moves to another party or it stays where it is",
        tags: ["contracts"],
        params: NumberParams.extend({ counterpartyId: z.string() }),
        response: { 200: CounterpartiesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { counterpartyId } = request.params;
      const result = await app.db.transaction(async (tx) => {
        const current = await editableContract(tx, request.params.number, request.user);
        const [target] = await tx
          .select({
            id: counterparties.id,
            name: counterparties.name,
            isPrimary: contractCounterparties.isPrimary,
          })
          .from(contractCounterparties)
          .innerJoin(counterparties, eq(contractCounterparties.counterpartyId, counterparties.id))
          .where(
            and(
              eq(contractCounterparties.contractId, current.row.id),
              eq(contractCounterparties.counterpartyId, counterpartyId),
            ),
          )
          .limit(1);
        if (!target) throw httpError(404, "That counterparty is not on this contract.");
        if (target.isPrimary) throw httpError(409, "That counterparty is already the primary.");

        await promotePrimary(tx, current.row.id, target.id);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.counterparty_primary_changed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: current.row.number,
            title: current.row.title,
            from: current.primaryCounterparty?.name ?? null,
            to: target.name,
          },
        });
        return counterpartiesEnvelope(tx, current);
      });
      return result;
    },
  );

  app.post(
    "/contracts/:number/archive",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveContract",
        summary:
          "Archive a contract (soft delete, for mistakes and imports — " +
          "not the same as ending it): it leaves the default list and " +
          "freezes; nothing is deleted, and restore is the way back",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const archived = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        if (current.row.archivedAt) throw httpError(409, "This contract is already archived.");

        const [row] = await tx
          .update(contracts)
          .set({ archivedAt: new Date() })
          .where(eq(contracts.id, current.row.id))
          .returning();
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.archived",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      return { contract: toRow(archived) };
    },
  );

  app.post(
    "/contracts/:number/restore",
    {
      preHandler: requireMember,
      schema: {
        operationId: "restoreContract",
        summary:
          "Restore an archived contract (archive's recovery story): it " +
          "rejoins the list and becomes editable again",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const restored = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        if (!current.row.archivedAt) throw httpError(409, "This contract is not archived.");

        const [row] = await tx
          .update(contracts)
          .set({ archivedAt: null })
          .where(eq(contracts.id, current.row.id))
          .returning();
        await recordActivity(tx, {
          entityType: "contract",
          entityId: current.row.id,
          actorId: request.user.id,
          action: "contract.restored",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      return { contract: toRow(restored) };
    },
  );
};
