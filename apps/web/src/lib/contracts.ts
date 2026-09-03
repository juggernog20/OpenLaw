// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contracts vocabulary shared by the list (/contracts) and the
 * record page (/contracts/:number): the row shape the API answers, the
 * C-### reference (CTR-003), the DES-018 severity ramp behind priority
 * and risk, the stage-keyed status pill, the CTR-004 people — the Owner
 * and the contract team's roles — CTR-011's two sides (our Entity that
 * signs, and their Counterparties), CTR-010's value, which is three
 * parts that read and write as one field, and CTR-006's term — the
 * three kinds of commitment, and the days-remaining count the record
 * derives from the expiry rather than stores.
 *
 * The severity ramp's pill colors are not here yet: M8/1 edits priority
 * and risk as selects, and no surface renders them as pills. The ramp's
 * `Record<SeverityLevel, string>` lands with the surface that draws it.
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { CONTRACT_STAGES as SHARED_CONTRACT_STAGES } from "@openlaw/shared";
import { formatCurrency } from "./format";

/** One contract as the API answers it, aliased to the generated client
 * schema so a contract change surfaces as a compile error here, not as
 * a runtime surprise in a route. */
type RecordResponse =
  paths["/api/v1/contracts/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
export type ContractRow = RecordResponse["contract"];
export type ContractAnalysis = RecordResponse["analysis"];
export type ContractAnalysisRun = NonNullable<ContractAnalysis["latestRun"]>;
export type ContractAnalysisResult = NonNullable<
  NonNullable<ContractAnalysisRun["outcome"]>["results"]
>[number];

export type ContractStage = ContractRow["stage"];
export type SeverityLevel = ContractRow["priority"];

/** One `contract_team` row as the record renders it — the person and
 * the one role this row records. The same person appears once per role
 * they hold (CTR-004's compound key). */
export type ContractTeamMember = RecordResponse["team"][number];
export type ContractTeamRole = ContractTeamMember["role"];

/**
 * One party on the other side (CTR-011), as the record draws them: the
 * name, the jurisdiction that tells two same-named organizations apart,
 * and the flag saying which one the contract is listed under. The API
 * answers them primary first, so the record renders the order it is
 * given.
 */
export type ContractCounterparty = RecordResponse["counterparties"][number];

/** The live types, statuses, and people the create dialog and the
 * record's pickers read (the settings surfaces stay Administrator-only,
 * SET-002). */
type OptionsResponse =
  paths["/api/v1/contracts/options"]["get"]["responses"]["200"]["content"]["application/json"];
export type ContractTypeOption = OptionsResponse["contractTypes"][number];
export type ContractStatusOption = OptionsResponse["contractStatuses"][number];
export type UserOption = OptionsResponse["users"][number];
/** One live approver group the record's apply picker offers (CTR-012):
 * the name, and the ids of the people applying it would ask. The names
 * behind those ids are the `users` answer above — one copy of a person
 * on this page, so the picker and the roster cannot disagree. */
export type ApproverGroupOption = OptionsResponse["approverGroups"][number];

/**
 * One choice in the signing-entity picker (CTR-011): the id it commits
 * and the legal name it shows. It is the record's own saved shape, so
 * an entity already on a contract is offered back without translation.
 */
export type SigningEntityOption = Extract<
  NonNullable<ContractRow["entity"]>,
  { restricted: false }
>;

/** The M7 registry's Member+ list — the picker's source. It answers
 * full identity cards, ordered by legal name, with archived entities
 * left out; the picker narrows each row to the two columns it shows. */
type RegistryResponse =
  paths["/api/v1/entities"]["get"]["responses"]["200"]["content"]["application/json"];
export type RegistryEntity = RegistryResponse["entities"][number];

/**
 * What the picker offers: the live registry, plus the entity the record
 * already holds when the registry no longer lists it. An entity
 * archived after it signed stays on the record — dropping it would let
 * the select lie about what the contract says.
 */
export function signingEntityOptions(
  registry: readonly RegistryEntity[],
  saved: ContractRow["entity"],
): SigningEntityOption[] {
  const live = registry.map((entity) => ({
    restricted: false as const,
    id: entity.id,
    legalName: entity.legalName,
  }));
  return saved && !saved.restricted && !live.some((option) => option.id === saved.id)
    ? [saved, ...live]
    : live;
}

/** Generic factory for exhaustive enum lists: guards a literal so it can't
 * drift from the API's enum. `Exclude<T, U[number]>` resolves to `never` only
 * when every value of `T` appears in `U` — which needs `U` inferred from the
 * literal, so the type argument is never passed by hand. A value added to the
 * API schema and left out here fails to compile, as does a typo'd entry. */
function exhaustiveList<T extends string>() {
  return <U extends readonly T[]>(values: Exclude<T, U[number]> extends never ? U : never): U =>
    values;
}

/**
 * CTR-001's fixed six-stage backbone, in canonical forward order.
 *
 * The list itself lives in `@openlaw/shared`, because the soft gate and
 * this pipeline both read the *order* and only one of them would notice
 * a change: membership is checked against each end's own union, but a
 * reordering compiles clean on both sides.
 *
 * Re-exported through this module so callers keep one import for the
 * contract vocabulary, and guarded below against the generated API union
 * so the shared list can still never drift from what the seam answers.
 */
export const CONTRACT_STAGES = exhaustiveList<ContractStage>()(SHARED_CONTRACT_STAGES);

/** The fixed stage's own name. It is not the status label: the label is
 * renameable and the stage is not (CTR-001), so the two are written
 * separately and read side by side on the record. */
export function stageLabel(intl: IntlShape, stage: ContractStage): string {
  return intl.formatMessage(
    {
      id: "contracts.stageLabel",
      defaultMessage:
        "{stage, select, draft {Draft} review {Review} approval {Approval} " +
        "signature {Signature} active {Active} ended {Ended} other {Unknown}}",
    },
    { stage },
  );
}

/** DES-018's one ordinal severity ramp, low → critical. */
export const SEVERITY_LEVELS = exhaustiveList<SeverityLevel>()([
  "low",
  "medium",
  "high",
  "critical",
] as const);

/**
 * The status pill's family, keyed to the fixed stage rather than the
 * status (CTR-001: the label is renameable, the stage is not — so the
 * color follows the stage or it drifts the first time someone renames
 * a status). One nominal DES-005 family per stage, per DES-018's
 * status-pills-keep-their-families rule: nothing started yet is
 * neutral, work in progress is info, waiting on a named approver is
 * assigned, waiting on signature is warning, live is success, and over
 * takes the filled-dark register.
 */
export const STAGE_PILL: Record<ContractStage, string> = {
  draft: "bg-status-neutral-bg text-status-neutral-fg",
  review: "bg-status-info-bg text-status-info-fg",
  approval: "bg-status-assigned-bg text-status-assigned-fg",
  signature: "bg-status-warning-bg text-status-warning-fg",
  active: "bg-status-success-bg text-status-success-fg",
  ended: "bg-status-onhold-bg text-status-onhold-fg",
};

/**
 * DES-018's one severity ramp, as a pill.
 *
 * The ramp is fixed by decision — low is neutral grey, medium is
 * warning yellow, high is severe orange, critical is danger red — and
 * pills consume it by value rather than choosing per callsite, so every
 * ordinal column in the product reads the same. It lives beside
 * `severityLabel` because every ordinal scale in the product shares
 * both: a contract's priority and risk, and a Request's urgency.
 */
export const SEVERITY_PILL: Record<SeverityLevel, string> = {
  low: "bg-status-neutral-bg text-status-neutral-fg",
  medium: "bg-status-warning-bg text-status-warning-fg",
  high: "bg-status-severe-bg text-status-severe-fg",
  critical: "bg-status-danger-bg text-status-danger-fg",
};

/**
 * Where one contract record opens, by its C-### number.
 *
 * Beside `contractReference` because the two travel together: a surface
 * that names a record almost always links it, and the route shape is a
 * fact about the router rather than about the caller. The Inbox's
 * Outcome column and the staff detail's Outcome card are the first two
 * callers; `inboxRequestPath` is the same helper from the other side.
 */
export function contractPath(number: number): string {
  return `/contracts/${number}`;
}

/** CTR-003's reference, as spoken and as linked: C-42. */
export function contractReference(intl: IntlShape, number: number): string {
  return intl.formatMessage(
    { id: "contracts.reference", defaultMessage: "C-{number}" },
    { number },
  );
}

export function severityLabel(intl: IntlShape, level: SeverityLevel): string {
  return intl.formatMessage(
    {
      id: "contracts.severityLabel",
      defaultMessage:
        "{level, select, low {Low} medium {Medium} high {High} critical {Critical} " +
        "other {Unknown}}",
    },
    { level },
  );
}

/** Risk is nullable on purpose: not yet assessed is not low (CTR-005). */
export function riskLabel(intl: IntlShape, level: SeverityLevel | null): string {
  return level === null
    ? intl.formatMessage({ id: "contracts.riskUnassessed", defaultMessage: "Not assessed" })
    : severityLabel(intl, level);
}

/**
 * CTR-010's contract value: the amount as an integer count of the
 * currency's smallest unit, the ISO 4217 code that says which unit that
 * is, and what the amount is per. It is one field in three parts —
 * recorded together, cleared together — and null as a whole when no
 * value is recorded, which is what an NDA looks like.
 */
export type ContractValue = NonNullable<ContractRow["value"]>;
export type ValueCadence = ContractValue["cadence"];

/** CTR-010's cadences, in the order the picker reads: the plain one-off
 * first, then the two that repeat. */
export const VALUE_CADENCES = exhaustiveList<ValueCadence>()([
  "one_time",
  "monthly",
  "annually",
] as const);

export function cadenceLabel(intl: IntlShape, cadence: ValueCadence): string {
  return intl.formatMessage(
    {
      id: "contracts.cadenceLabel",
      defaultMessage:
        "{cadence, select, one_time {One time} monthly {Monthly} annually {Annually} " +
        "other {Unknown}}",
    },
    { cadence },
  );
}

/**
 * The value as DES-014 renders it — "$120,000.00 /year" — with the
 * money through the shared currency helper (locale-correct symbol,
 * grouping, and the precision the ISO code itself carries) and the
 * cadence suffix selected inside one ICU message, because the "/" and
 * the word after it are locale copy, not code (DES-013). A one-off
 * value takes no suffix: there is nothing it is per.
 */
export function formatContractValue(intl: IntlShape, value: ContractValue): string {
  const amount = formatCurrency(
    { amount: value.amount, currency: value.currency },
    { locale: intl.locale },
  );
  return intl.formatMessage(
    {
      id: "contracts.valueWithCadence",
      defaultMessage:
        "{cadence, select, monthly {{amount} /month} annually {{amount} /year} " +
        "other {{amount}}}",
    },
    { amount, cadence: value.cadence },
  );
}

/**
 * CTR-006's term type: what kind of commitment the contract is. Fixed
 * rather than configurable because code branches on it — an evergreen
 * contract holds no expiry, and only an auto-renewing one holds a
 * renewal period.
 */
export type TermType = ContractRow["termType"];

/** The three kinds, in the order the picker reads: the plain one that
 * ends, the one that rolls, and the one that never ends. */
export const TERM_TYPES = exhaustiveList<TermType>()(["fixed", "auto_renew", "evergreen"] as const);

export function termTypeLabel(intl: IntlShape, termType: TermType): string {
  return intl.formatMessage(
    {
      id: "contracts.termTypeLabel",
      defaultMessage:
        "{termType, select, fixed {Fixed term} auto_renew {Auto-renewing} " +
        "evergreen {Evergreen} other {Unknown}}",
    },
    { termType },
  );
}

/**
 * How much of the term is left, as the record says it (CTR-006).
 *
 * The count is derived from the expiry and never stored, so it is a
 * number here rather than a date. Null is the honest blank: an
 * evergreen contract has no end, and neither has a contract nobody has
 * recorded an expiry for. Past due counts the other way rather than
 * reading as none left — a term that ran out is a fact the record has
 * to be able to say.
 */
export function daysRemainingLabel(intl: IntlShape, days: number | null): string | null {
  if (days === null) return null;
  return days < 0
    ? intl.formatMessage(
        {
          id: "contracts.daysPastExpiry",
          defaultMessage: "{days, plural, one {# day past expiry} other {# days past expiry}}",
        },
        { days: -days },
      )
    : intl.formatMessage(
        {
          id: "contracts.daysRemaining",
          defaultMessage: "{days, plural, =0 {Expires today} one {# day left} other {# days left}}",
        },
        { days },
      );
}

/**
 * One stretch of the term, as the timeline draws it (CTR-006).
 *
 * `renewal` is the period's place in the run: 0 is the initial term,
 * and 1 upwards are the rolls the record's own dates imply. `end` is
 * null for the one period an evergreen contract has, which is the open
 * end the card draws rather than an end it invents.
 */
export interface TermPeriod {
  /** The day the period starts, as the stored civil date `YYYY-MM-DD`. */
  start: string;
  /** The day it ends, or null for an evergreen term's open period. */
  end: string | null;
  /** 0 for the initial term; 1 upwards for each implied roll. */
  renewal: number;
}

/**
 * How many rolls the timeline will draw before it stops counting.
 *
 * This is a render guard and not a renewal cap: CTR-006 keeps no
 * cap column, grill rows G.R6 and I.B7 removed the marker, and nothing
 * here draws one. It exists because a one-month roll across a
 * mistyped century implies thousands of bars, and a card that tries to
 * draw them all stops being readable long before it stops being slow.
 * Past the guard the initial term simply absorbs what is left, which
 * is the same shape a record with no renewal period draws.
 */
const MAX_DRAWN_ROLLS = 60;

/**
 * A civil date shifted by whole months, clamped to the target month's
 * last day — `2026-03-31` back one month is February's 28th, not
 * March's 3rd. Month arithmetic is done in UTC so no timezone can move
 * the calendar date it answers.
 *
 * **This is the second copy, and the copy is deliberate** (DES-041's
 * 2026-08-21 addendum). `shiftMonths` in `apps/api/src/lib/contract-term.ts`
 * is the same arithmetic, and it is the one that matters: it computes
 * the roll date the record actually takes, which the API stores and this
 * file reads rather than derives. This copy only walks *backwards* from
 * that stored date to place marks on the timeline's gutter, so a drift
 * between the two costs a bar boundary, never a date anybody confirms.
 * Do not use it to compute a confirmable date. A third caller anywhere
 * is the trigger to hoist all of them into one home.
 */
function shiftMonths(civil: string, months: number): string {
  // A stored civil date is fixed-width `YYYY-MM-DD`, so its three parts
  // are slices rather than a split whose length nothing guarantees.
  const year = Number(civil.slice(0, 4));
  const month = Number(civil.slice(5, 7));
  const day = Number(civil.slice(8, 10));
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The term's periods, derived from the record's own dates and nothing
 * else (CTR-006).
 *
 * A fixed term is one period. An evergreen term is one open period. An
 * auto-renewing term is the periods its dates and renewal period imply:
 * the run is walked back from the expiry a renewal period at a time
 * until the step would land on or before the effective date, and what
 * is left is the initial term. Backwards rather than forwards because
 * the expiry is the date a roll advances (CTR-006) — the record holds
 * where the term stands now, and where it started, and the boundaries
 * between are what those two and the period length say they are.
 *
 * The answer is empty when there is nothing honest to draw: a period
 * needs a start, and every period but an evergreen one needs an end.
 *
 * Rolls confirmed by a person are a different datum — the log entries
 * the confirmed roll writes (grill rows I.B3–I.B5) — and they are not
 * in the record read yet.
 */
export function termPeriods(contract: {
  termType: TermType;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalPeriodMonths: number | null;
}): TermPeriod[] {
  const { termType, effectiveDate, expiryDate, renewalPeriodMonths } = contract;
  if (effectiveDate === null) return [];
  if (termType === "evergreen") return [{ start: effectiveDate, end: null, renewal: 0 }];
  if (expiryDate === null || expiryDate <= effectiveDate) {
    return expiryDate === null ? [] : [{ start: effectiveDate, end: expiryDate, renewal: 0 }];
  }
  const months = termType === "auto_renew" ? (renewalPeriodMonths ?? 0) : 0;
  // Civil dates are zero-padded ISO, so a string compare is a date
  // compare — no parsing, and no timezone to get it wrong.
  const boundaries: string[] = [];
  if (months > 0) {
    // Every boundary is measured from the expiry itself, never from the
    // one before it: a month-end date clamps on the way back (March's
    // 31st is February's 28th), and stepping from a clamped date would
    // carry that clamp into every earlier boundary.
    for (let roll = 1; roll <= MAX_DRAWN_ROLLS; roll += 1) {
      const previous = shiftMonths(expiryDate, -months * roll);
      if (previous <= effectiveDate) break;
      boundaries.unshift(previous);
    }
  }
  const starts = [effectiveDate, ...boundaries];
  const ends = [...boundaries, expiryDate];
  return starts.map((start, index) => ({
    start,
    end: ends[index] ?? expiryDate,
    renewal: index,
  }));
}

/** CTR-004's role enum, in the order the roster and the picker read. */
export const CONTRACT_TEAM_ROLES = exhaustiveList<ContractTeamRole>()([
  "member",
  "watcher",
  "contributor",
  "creator",
] as const);

/** What the add-member picker offers. `creator` is provenance: the
 * server writes that row at creation, and nothing adds it by hand. */
export const ADDABLE_TEAM_ROLES: readonly ContractTeamRole[] = CONTRACT_TEAM_ROLES.filter(
  (role) => role !== "creator",
);

export function teamRoleLabel(intl: IntlShape, role: ContractTeamRole): string {
  return intl.formatMessage(
    {
      id: "contracts.teamRole",
      defaultMessage:
        "{role, select, member {Member} watcher {Watcher} creator {Creator} " +
        "contributor {Contributor} other {Unknown}}",
    },
    { role },
  );
}
