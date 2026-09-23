// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contract list, get, update and status operations admit Administrators and
 * Legal Team Members (DD-013, DD-023). The shared PATCH keeps field edits,
 * status moves, activity and notifications atomic (DD-017, CTR-012).
 */

import type { Db } from "@openlaw/db";
import {
  and,
  contracts,
  contractStatuses,
  contractTypes,
  entities,
  eq,
  isNull,
  ne,
  sql,
  USER_ROLES,
  type Contract,
  type ContractStage,
} from "@openlaw/db";
import {
  TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE,
  TERM_RENEWAL_PERIOD_PROBLEM_TYPE,
} from "@openlaw/shared";
import { z } from "zod";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import type { AiResolver } from "../../lib/ai/resolver.js";
import { NO_CONTRACT, OWNER_REFUSAL, OWNER_ROLES } from "../../lib/contract-access.js";
import { addContractTeamMember } from "../../lib/contract-team.js";
import {
  applyCustomFields,
  assertBusinessCustomFieldWrite,
  assertRequiredCustomFields,
  projectCustomFields,
  type AttachedCustomField,
} from "../../lib/custom-fields.js";
import { entityReachScope } from "../../lib/entity-access.js";
import type { Notifier } from "../../lib/notifications/notifier.js";
import { httpError } from "../../lib/problem.js";
import { choiceFilter, dateFilter } from "../../lib/record-filters.js";
import { recordPerson } from "../../lib/record-person.js";
import { assertApprovalGate, type UnresolvedApproval } from "../../lib/soft-gate.js";
import { readTypeForm } from "../../lib/type-form-routes.js";
import { latestAnalysisRun } from "../contract-analysis/routes.js";
import { lockedDepartment } from "../departments/references.js";
import { lockedRegionName } from "../regions/references.js";
import { originalIntake } from "../requests/original-intake.js";
import {
  assertEditable,
  assertMayChangeTeam,
  assertMayFlagConfidential,
  attachedFieldsOf,
  BUILTIN_ANALYSIS_SLUGS,
  ContractListQuery,
  ContractPatchBody,
  ContractStatusBody,
  ContractUpdateBody,
  customFieldRefs,
  customFieldsEnvelope,
  furtherDownThan,
  hasConversionFields,
  listOrder,
  lockedContract,
  lockedUser,
  PAGE_SIZE,
  readNextDeadline,
  sameValue,
  selectContracts,
  selectCounterparties,
  selectRenewals,
  selectTeam,
  teamScope,
  toRow,
  toValue,
  type SortRequest,
} from "./record.js";

const RETYPE_RETAINED_CONVERSION_SLUGS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "priority",
  "counterparties",
  "needed_by",
]);

function assertReader(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}

export async function listContracts(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof ContractListQuery> = {},
) {
  assertReader(user);
  const query = ContractListQuery.parse(input);

  /** Ascending is what "sort by expiry" means without a direction:
   * the soonest first is the answer somebody asking for a column
   * came for. `dir` without `sort` orders nothing, because there is
   * no column for it to run along. */
  const sort: SortRequest | null =
    query.sort === undefined ? null : { key: query.sort, dir: query.dir ?? "asc" };
  const predicates = and(
    query.includeArchived === "true" ? undefined : isNull(contracts.archivedAt),
    // The stage check also excludes legacy ended records without an endedAt stamp.
    query.includeEnded === "true"
      ? undefined
      : and(isNull(contracts.endedAt), ne(contractStatuses.stage, "ended")),
    choiceFilter(contracts.managerId, query.owner, user.id),
    choiceFilter(contracts.statusId, query.status),
    choiceFilter(contracts.contractTypeId, query.type),
    dateFilter(contracts.effectiveDate, query.effectiveFrom, query.effectiveTo),
    dateFilter(contracts.expiryDate, query.expiryFrom, query.expiryTo),
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
    teamScope(db, user),
  );
  const rows = await selectContracts(db, user)
    .where(
      and(
        predicates,
        query.cursor === undefined ? undefined : furtherDownThan(db, query.cursor, user, sort),
      ),
    )
    .orderBy(...listOrder(db, sort, user))
    // Read one extra row to determine whether to offer another page.
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const attachedByType = new Map(
    await Promise.all(
      [
        ...new Set(
          page
            .filter((context) => user.role === "business_user" || hasConversionFields(context))
            .map((context) => context.row.contractTypeId),
        ),
      ].map(
        async (contractTypeId) =>
          [contractTypeId, await attachedFieldsOf(db, contractTypeId)] as const,
      ),
    ),
  );
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(predicates);
  return {
    total: counted?.total ?? 0,
    contracts: page.map((context) => {
      const projection = projectCustomFields(
        user.role,
        attachedByType.get(context.row.contractTypeId) ?? [],
        context.row.customFields,
      );
      return toRow(context, projection.customFields, projection.fields);
    }),
    // Only when a further row was actually read. A cursor on the
    // last page would send the client for an empty one.
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.row.id ?? null) : null,
  };
}

export async function getContract(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  resolveAiProvider: AiResolver,
) {
  assertReader(user);

  const [row] = await selectContracts(db, user)
    // The scope rides beside the number, so a contract a
    // Contributor is not on reads as one that does not exist. A
    // locked page would tell them it is there.
    .where(and(eq(contracts.number, number), teamScope(db, user)))
    .limit(1);
  if (!row) throw httpError(404, NO_CONTRACT);
  const [team, parties, custom, renewals, provider, latestRun, intake] = await Promise.all([
    selectTeam(db, row.row.id),
    selectCounterparties(db, row.row.id),
    customFieldsEnvelope(db, row, user),
    selectRenewals(db, row.row.id),
    resolveAiProvider(),
    latestAnalysisRun(db, row.row.id, user),
    originalIntake(db, user, "contract", row.row.id),
  ]);
  return {
    form: await readTypeForm(db, "contract", row.row.contractTypeId),
    contract: toRow(row, custom.customFields, custom.fields),
    originalIntake: intake,
    creator: await recordPerson(db, row.row.createdBy),
    fields: custom.fields,
    customFieldRefs: custom.customFieldRefs,
    team,
    counterparties: parties,
    renewals,
    analysis: { available: provider !== null, latestRun },
  };
}

/** Preserves the HTTP PATCH transaction when fields and status arrive together. */
export async function patchContract(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof ContractPatchBody>,
  notifier: Notifier,
) {
  assertReader(user);
  const body = ContractPatchBody.parse(input);

  // The seam's transaction rather than the database's: this PATCH is
  // the one that can hand a record to somebody (CTR-004), and the
  // bell row for it belongs inside the same commit as the column.
  const updated = await notifier.notifying(async (tx) => {
    const current = await lockedContract(tx, number, user);
    let businessAttached: AttachedCustomField[] | null = null;
    if (user.role === "business_user") {
      const allowed = new Set([
        "value",
        "effectiveDate",
        "owningDepartmentId",
        "region",
        "customFields",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        throw httpError(
          403,
          "Business Users can edit only the value, effective date, department, region, and Fields visible on the Portal on this Contract.",
        );
      }
      if (body.customFields !== undefined) {
        businessAttached = await attachedFieldsOf(tx, current.row.contractTypeId);
        assertBusinessCustomFieldWrite(businessAttached, body.customFields);
      }
    }
    // Reach was answered above, for this patch and every other one,
    // whatever the body carries. What is left is the flag's own
    // narrower actor set, and it is asked before the archived
    // refusal: a viewer who may not decide the audience should not
    // learn from a 409 that the write was otherwise theirs to make.
    if (body.isConfidential !== undefined) {
      await assertMayFlagConfidential(tx, current, user);
    }
    // The Owner reaches a confidential contract by being its Owner
    // (CTR-022), so naming one is an audience change. It takes the
    // same actor set the roster does (CTR-023), asked at the same
    // point: before the archived refusal, and before the named
    // person is read.
    if (body.managerId !== undefined && body.managerId !== current.row.managerId) {
      await assertMayChangeTeam(tx, current, user);
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

    let owningDepartment = current.owningDepartment;
    if (
      body.owningDepartmentId !== undefined &&
      body.owningDepartmentId !== target.owningDepartmentId
    ) {
      const next = body.owningDepartmentId
        ? await lockedDepartment(tx, body.owningDepartmentId)
        : null;
      patch.owningDepartmentId = next?.id ?? null;
      owningDepartment = next?.displayName ?? null;
      changed.owningDepartment = { from: current.owningDepartment, to: owningDepartment };
    }

    for (const key of ["region"] as const) {
      if (body[key] === undefined) continue;
      const next = body[key]?.trim() || null;
      if (next !== target[key]) {
        patch[key] = await lockedRegionName(tx, next);
        changed[key] = { from: target[key], to: next };
      }
    }

    // The Owner is a person, so the audit map carries names, not
    // ids — the M9 viewer narrates "Owner changed from X to Y".
    let manager = current.manager;
    if (body.managerId !== undefined && body.managerId !== target.managerId) {
      // Null and the empty string both unassign, the reading the
      // create seam and the Matters door already share.
      manager = body.managerId
        ? await lockedUser(tx, body.managerId, OWNER_ROLES, OWNER_REFUSAL)
        : null;
      patch.managerId = manager?.id ?? null;
      changed.owner = {
        from: current.manager?.displayName ?? null,
        to: manager?.displayName ?? null,
      };
    }

    let businessOwner = current.businessOwner ?? null;
    if (body.businessOwnerId !== undefined && body.businessOwnerId !== target.businessOwnerId) {
      businessOwner = body.businessOwnerId
        ? await lockedUser(
            tx,
            body.businessOwnerId,
            USER_ROLES,
            "The Business Owner must be a live person.",
          )
        : null;
      if (businessOwner) {
        await assertMayChangeTeam(tx, current, user);
        await addContractTeamMember(tx, notifier, target, user, businessOwner);
      }
      patch.businessOwnerId = businessOwner?.id ?? null;
      changed.businessOwner = {
        from: current.businessOwner?.displayName ?? null,
        to: businessOwner?.displayName ?? null,
      };
    }

    // Our side of the contract (CTR-011). The picker offers live
    // entities only, so the write refuses an archived one: nothing
    // new gets signed by an entity that has left the registry. An
    // entity archived after the fact stays on the record untouched.
    let entity = current.entity;
    let entityRestricted = current.entityRestricted;
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
          .where(and(eq(entities.id, body.entityId), entityReachScope(tx, user)))
          .limit(1)
          .for("update");
        if (!signatory || signatory.archivedAt) {
          throw httpError(400, "The signing entity must be a live entity.");
        }
        entity = { id: signatory.id, legalName: signatory.legalName };
      }
      entityRestricted = false;
      patch.entityId = entity?.id ?? null;
      // The audit map carries legal names, not ids — the M9 viewer
      // narrates "Entity changed from X to Y".
      changed.entity = {
        from: current.entityRestricted ? "Restricted Entity" : (current.entity?.legalName ?? null),
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
    if (body.noticePeriodDays !== undefined && body.noticePeriodDays !== target.noticePeriodDays) {
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
      businessAttached ??
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
        patch.valueCadenceDescription = next?.cadenceDescription ?? null;
        changed.value = { from: before, to: next };
      }
    }

    // A person's write verifies that slot by definition. Clear every
    // AI marker named by this PATCH in the same transaction and add
    // no second activity entry for the clearing itself (CTR-008).
    const humanWrittenSlugs = new Set<string>();
    if (body.title !== undefined) humanWrittenSlugs.add("title");
    if (body.description !== undefined) humanWrittenSlugs.add("description");
    if (body.priority !== undefined) humanWrittenSlugs.add("priority");
    if (body.contractTypeId !== undefined) {
      humanWrittenSlugs.add("contract_type");
      for (const [slug, flag] of Object.entries(target.aiUnverified ?? {}))
        if (
          flag.draftId &&
          flag.targetTypeId !== body.contractTypeId &&
          !RETYPE_RETAINED_CONVERSION_SLUGS.has(slug)
        )
          humanWrittenSlugs.add(slug);
    }
    if (body.termType !== undefined) humanWrittenSlugs.add("term_type");
    if (body.effectiveDate !== undefined) humanWrittenSlugs.add("effective_date");
    if (body.expiryDate !== undefined) humanWrittenSlugs.add("expiry_date");
    if (body.renewalPeriodMonths !== undefined) {
      humanWrittenSlugs.add("renewal_period_months");
    }
    if (body.noticePeriodDays !== undefined) humanWrittenSlugs.add("notice_period_days");
    if (body.value !== undefined) humanWrittenSlugs.add("value");
    for (const slug of Object.keys(body.customFields ?? {})) {
      // Older analysis markers use bare custom slugs. A legacy Field
      // named like a built-in must only clear its namespaced marker.
      if (!BUILTIN_ANALYSIS_SLUGS.has(slug)) humanWrittenSlugs.add(slug);
      humanWrittenSlugs.add(`field:${slug}`);
    }
    // A term-type write may clear a dependent even when the body did
    // not name it. That clear is a human write to the slot too.
    if (patch.expiryDate !== undefined) humanWrittenSlugs.add("expiry_date");
    if (patch.renewalPeriodMonths !== undefined) {
      humanWrittenSlugs.add("renewal_period_months");
    }
    const humanFields = new Set(target.analysisHumanFields);
    for (const slug of humanWrittenSlugs)
      humanFields.add(slug.startsWith("field:") ? slug.slice(6) : slug);
    if (humanFields.size > target.analysisHumanFields.length)
      patch.analysisHumanFields = [...humanFields];
    if (target.aiUnverified && humanWrittenSlugs.size > 0) {
      const remaining = { ...target.aiUnverified };
      for (const slug of humanWrittenSlugs) delete remaining[slug];
      if (Object.keys(remaining).length !== Object.keys(target.aiUnverified).length) {
        patch.aiUnverified = Object.keys(remaining).length > 0 ? remaining : null;
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
      { from: string; to: string; fromStage: ContractStage; toStage: ContractStage } | undefined;
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
        actorId: user.id,
        action: "contract.updated",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          number: row!.number,
          title: row!.title,
          changed,
          ...(user.role === "business_user" ? { actorRole: user.role } : {}),
        },
      });
    }
    if (statusChange) {
      await recordActivity(tx, {
        entityType: "contract",
        entityId: target.id,
        actorId: user.id,
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
        actorId: user.id,
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
      await notifier.statusChanged(tx, {
        contractId: target.id,
        actorId: user.id,
        actorName: user.displayName,
        ...statusChange,
      });
    }
    if (patch.managerId) {
      await notifier.ownerAssigned(tx, {
        contractId: target.id,
        contractNumber: row!.number,
        contractTitle: row!.title,
        actorId: user.id,
        actorName: user.displayName,
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
        actorId: user.id,
        action: confidentialityChange
          ? "contract.confidentiality_set"
          : "contract.confidentiality_cleared",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { number: row!.number, title: row!.title },
      });
    }
    return {
      row: row!,
      nextDeadline: await readNextDeadline(tx, user, row!.id),
      contractTypeName,
      statusName,
      stage,
      manager,
      businessOwner,
      owningDepartment,
      entity,
      entityRestricted,
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
  const projection = projectCustomFields(user.role, attached, context.row.customFields);
  return {
    contract: toRow(context, projection.customFields, projection.fields),
    fields: projection.fields,
    customFieldRefs: await customFieldRefs(db, projection.fields, projection.customFields, user),
  };
}

export type UpdateContractInput = z.input<typeof ContractUpdateBody>;

export async function updateContract(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof ContractUpdateBody>,
  notifier: Notifier,
) {
  assertReader(user);
  return patchContract(db, user, number, ContractUpdateBody.parse(input), notifier);
}

export type SetContractStatusInput = z.input<typeof ContractStatusBody>;

export async function setContractStatus(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof ContractStatusBody>,
  notifier: Notifier,
) {
  assertReader(user);
  return patchContract(db, user, number, ContractStatusBody.parse(input), notifier);
}
