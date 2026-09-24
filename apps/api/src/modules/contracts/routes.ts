// SPDX-License-Identifier: AGPL-3.0-only
import { listAssignableUsers } from "../../lib/assignable-users.js";

import { formForTouchpoint } from "@openlaw/shared";
import { readTypeForm } from "../../lib/type-form-routes.js";

import { regionOptions } from "../regions/references.js";

/** Contract HTTP schemas and handlers. Record operations live in service.ts. */

import {
  and,
  approverGroupMembers,
  approverGroups,
  asc,
  contractCounterparties,
  contracts,
  contractStatuses,
  contractTeam,
  contractTypes,
  counterparties,
  entities,
  eq,
  isNull,
  sql,
  USER_ROLES,
  users,
} from "@openlaw/db";
import {
  CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
  CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
  CONTRACT_SELF_LINK_PROBLEM_TYPE,
  MAX_CONTRACT_CLASSIFICATION_LENGTH,
  RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE,
  SOFT_GATE_PROBLEM_TYPE,
  TERM_EXPIRY_ON_EVERGREEN_PROBLEM_TYPE,
  TERM_RENEWAL_PERIOD_PROBLEM_TYPE,
} from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import { clearAiUnverified } from "../../lib/ai-unverified.js";
import { NO_CONTRACT } from "../../lib/contract-access.js";
import { addContractTeamMember } from "../../lib/contract-team.js";
import { CounterpartyNameSchema, findOrCreateCounterparty } from "../../lib/counterparty-link.js";
import { CustomFieldsInput } from "../../lib/custom-fields.js";
import { entityReachScope } from "../../lib/entity-access.js";
import { NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import { FilterOptionsSchema } from "../../lib/record-filters.js";
import { departmentOptions } from "../departments/references.js";
import { createContract } from "./create.js";
import {
  ApproverGroupOptionSchema,
  assertEditable,
  assertMayChangeTeam,
  attachedFieldsOf,
  ContractEnvelope,
  ContractFieldsEnvelope,
  ContractListQuery,
  ContractPatchBody,
  ContractRecordEnvelope,
  ContractRenewalsEnvelope,
  ContractRowSchema,
  ContractValueInput,
  CounterpartiesEnvelope,
  counterpartiesEnvelope,
  DescriptionSchema,
  editableContract,
  lockedContract,
  lockedUser,
  memberRow,
  NoticePeriodSchema,
  NumberParams,
  promotePrimary,
  readNextDeadline,
  RenewalOfSchema,
  RenewalPeriodSchema,
  selectContracts,
  selectRenewals,
  selectTeam,
  SeveritySchema,
  StatusOptionSchema,
  TeamEnvelope,
  teamScope,
  TermTypeSchema,
  TitleSchema,
  toPerson,
  TypeChoiceSchema,
  UserOptionSchema,
  type JoinedCounterparty,
} from "./record.js";
import { getContract, listContracts, patchContract } from "./service.js";

/** Every mutation, and every picker read behind one, is Member+. */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * The full-app read surfaces are Member+ (DD-023). `teamScope` still
 * takes a confidential contract away from anyone outside its named team
 * and its Owner, including Administrators (DD-014). A Business User works
 * on a contract through the Portal routes, never here.
 */
const requireContractReader = requireRole("administrator", "legal_team_member");

const ConfirmAnalysisFieldBody = z.object({
  slug: z.string().trim().min(1).max(200),
});

export const contractsRoutes: FastifyPluginAsyncZod = async (app) => {
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
          "or its Owner — silently absent for " +
          "everyone else, so no count can reveal it",
        tags: ["contracts"],
        querystring: ContractListQuery,
        response: {
          200: z.object({
            contracts: z.array(ContractRowSchema),
            total: z.number().int(),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the list. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => listContracts(app.db, request.user, request.query),
  );

  app.get(
    "/contracts/filter-options",
    {
      preHandler: requireContractReader,
      schema: {
        operationId: "listContractFilterOptions",
        tags: ["contracts"],
        response: { 200: FilterOptionsSchema, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db
        .selectDistinct({
          typeId: contracts.contractTypeId,
          typeName: contractTypes.displayName,
          statusId: contracts.statusId,
          statusName: contractStatuses.displayName,
          personId: users.id,
          personName: users.displayName,
        })
        .from(contracts)
        .innerJoin(contractTypes, eq(contracts.contractTypeId, contractTypes.id))
        .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
        .leftJoin(users, eq(contracts.managerId, users.id))
        .where(teamScope(app.db, request.user));
      const unique = (values: { id: string; displayName: string }[]) =>
        [...new Map(values.map((value) => [value.id, value])).values()].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
      return {
        types: unique(rows.map((row) => ({ id: row.typeId, displayName: row.typeName }))),
        statuses: unique(rows.map((row) => ({ id: row.statusId, displayName: row.statusName }))),
        people: unique(
          rows.flatMap((row) =>
            row.personId && row.personName
              ? [{ id: row.personId, displayName: row.personName }]
              : [],
          ),
        ),
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
          "Live Contract types with their Forms, creation trees and Field definitions; " +
          "live Statuses, Departments, Regions, people and approver groups for Member+ pickers",
        tags: ["contracts"],
        response: {
          200: z.object({
            departments: z.array(z.object({ id: z.string(), displayName: z.string() })),
            regions: z.array(z.object({ id: z.string(), displayName: z.string() })),
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
            isDefault: contractTypes.isDefault,
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
        listAssignableUsers(app.db),
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
      const forms = await Promise.all(
        types.map((type) => readTypeForm(app.db, "contract", type.id)),
      );
      // Each type's own attachments, so the dialog knows what picking
      // that type will demand before it asks for it. One query per live
      // type: the taxonomy is a handful of rows, and the alternative —
      // one join grouped in memory — buys nothing at this size.
      const attached = await Promise.all(
        types.map((contractType) => attachedFieldsOf(app.db, contractType.id)),
      );
      return {
        departments: await departmentOptions(app.db),
        regions: await regionOptions(app.db),
        contractTypes: types.map((contractType, index) => ({
          ...contractType,
          fields: attached[index]!,
          form: forms[index]!,
          creationForm: formForTouchpoint(forms[index]!, "creation"),
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
          "anyone outside its named team and Owner",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractRecordEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      getContract(app.db, request.user, request.params.number, app.resolveAiProvider),
  );

  /**
   * Clears one or every unverified marker under the Contract row lock.
   * The value itself does not move: confirmation is the person's
   * assertion that the AI-written value already on the record is right.
   */
  async function confirmAnalysisFields(
    number: number,
    user: AuthenticatedUser,
    requestedSlug?: string,
  ) {
    return app.db.transaction(async (tx) => {
      const current = await editableContract(tx, number, user);
      const flags = current.row.aiUnverified;
      const slugs = requestedSlug === undefined ? Object.keys(flags ?? {}) : [requestedSlug];
      if (
        slugs.length === 0 ||
        (requestedSlug !== undefined && (!flags || !Object.hasOwn(flags, requestedSlug)))
      ) {
        throw httpError(400, "That field is not awaiting confirmation.");
      }

      const remaining = { ...flags };
      for (const slug of slugs) delete remaining[slug];
      await tx
        .update(contracts)
        .set({
          aiUnverified: Object.keys(remaining).length > 0 ? remaining : null,
          analysisHumanFields: [
            ...new Set([
              ...current.row.analysisHumanFields,
              ...slugs.map((slug) => (slug.startsWith("field:") ? slug.slice(6) : slug)),
            ]),
          ],
        })
        .where(eq(contracts.id, current.row.id));
      await recordActivity(
        tx,
        slugs.map((slug) => ({
          entityType: "contract" as const,
          entityId: current.row.id,
          actorId: user.id,
          action: "contract.field_confirmed" as const,
          visibility: RECORD_ACTIVITY_TIER,
          payload: { number: current.row.number, title: current.row.title, slug },
        })),
      );

      const [fresh] = await selectContracts(tx, user)
        .where(eq(contracts.id, current.row.id))
        .limit(1);
      if (!fresh) throw httpError(404, NO_CONTRACT);
      return { contract: await memberRow(tx, fresh) };
    });
  }

  app.post(
    "/contracts/:number/analysis/confirm",
    {
      preHandler: requireMember,
      schema: {
        operationId: "confirmContractAnalysisField",
        summary:
          "Confirm one AI-written Contract value, clear its unverified marker, and append one record-tier confirmation entry",
        tags: ["contracts"],
        params: NumberParams,
        body: ConfirmAnalysisFieldBody,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      confirmAnalysisFields(request.params.number, request.user, request.body.slug),
  );

  app.post(
    "/contracts/:number/analysis/confirm-all",
    {
      preHandler: requireMember,
      schema: {
        operationId: "confirmAllContractAnalysisFields",
        summary:
          "Confirm every AI-written Contract value in one transaction and append one record-tier confirmation entry per cleared slug",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => confirmAnalysisFields(request.params.number, request.user),
  );

  app.post(
    "/contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createContract",
        description:
          "M35 pre-release breaking change: send nullable owningDepartmentId instead of the former owningDepartment text input. A non-null id must name a live Department. Responses retain owningDepartment as the display name alongside owningDepartmentId.",
        summary:
          "Create a Contract from the chosen type's Intake and Creation Rows. " +
          "Required applies only to visible Rows after Branch evaluation. " +
          "Built-in answers populate native columns, Counterparties and the Needed by Key date. " +
          "The record starts in Draft; Owner and Confidential are explicit choices. " +
          "renewalOf copies the predecessor's business facts and links the new Contract as a child or successor.",
        tags: ["contracts"],
        // Strict: the number is the sequence's to give, so a body
        // carrying one is refused rather than silently ignored.
        body: z.strictObject({
          title: TitleSchema,
          description: DescriptionSchema.nullable().optional(),
          entityId: z.string().nullable().optional(),
          priority: SeveritySchema.optional(),
          risk: SeveritySchema.nullable().optional(),
          termType: TermTypeSchema.optional(),
          effectiveDate: z.iso.date().nullable().optional(),
          expiryDate: z.iso.date().nullable().optional(),
          renewalPeriodMonths: RenewalPeriodSchema.nullable().optional(),
          noticePeriodDays: NoticePeriodSchema.nullable().optional(),
          value: ContractValueInput.nullable().optional(),
          neededBy: z.iso.date().nullable().optional(),
          counterparties: z
            .array(
              z.union([
                z.strictObject({ counterpartyId: z.string().min(1) }),
                z.strictObject({ name: CounterpartyNameSchema }),
              ]),
            )
            .max(50)
            .optional(),
          owningDepartmentId: z.string().min(1).nullable().optional(),
          region: z.string().trim().max(MAX_CONTRACT_CLASSIFICATION_LENGTH).nullable().optional(),
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
          /** The Owner the record is born with (CTR-004, focus-group
           * addendum 2026-09-09). Omitted or null is unassigned, which
           * stays a real state; a named person must be a live Member+
           * user or the create is refused. A routed renewal never
           * copies its predecessor's Owner — only what the body names
           * is written. */
          managerId: z.string().nullable().optional(),
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
      const created = await app.notifier.notifying(async (tx) => {
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
        if (request.body.entityId) {
          const [entity] = await tx
            .select({ id: entities.id })
            .from(entities)
            .where(and(eq(entities.id, request.body.entityId), entityReachScope(tx, request.user)))
            .for("update");
          // Reach is refused here; liveness is createContract's own refusal.
          if (!entity) throw httpError(400, "Our entity must be an Entity you can reach.");
        }
        const born = await createContract(tx, app.notifier, {
          ...request.body,
          actorId: request.user.id,
          title,
          contractTypeId,
          owningDepartmentId: request.body.owningDepartmentId,
          region: request.body.region,
          customFields: request.body.customFields,
          isConfidential: request.body.isConfidential,
          managerId: request.body.managerId,
          renewal,
          matter,
        });
        // The copied facts, and the Owner the body named, read back off
        // the row that now holds them rather than off the request: the
        // entity, the primary party, and the Owner the answer names
        // have to be the ones this record was born with, and one joined
        // read is what guarantees it.
        const [read] = await selectContracts(tx, request.user)
          .where(eq(contracts.id, born.row.id))
          .limit(1);
        return read!;
      });
      return reply.status(201).send({ contract: await memberRow(app.db, created) });
    },
  );

  app.patch(
    "/contracts/:number",
    {
      preHandler: requireContractReader,
      schema: {
        operationId: "updateContract",
        description:
          "Business Owner assignment is Member+ only: Administrator or Legal Team Member. The person must be live; null clears ownership without removing team membership. " +
          "M35 pre-release breaking change: send nullable owningDepartmentId instead of the former owningDepartment text input. A non-null id must name a live Department. Responses retain owningDepartment as the display name alongside owningDepartmentId.",
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
        body: ContractPatchBody,
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
    async (request) =>
      patchContract(app.db, request.user, request.params.number, request.body, app.notifier),
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
          contract: await memberRow(tx, {
            ...current,
            row: updated!,
            nextDeadline: await readNextDeadline(tx, request.user, updated!.id),
          }),
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
          "Put a person on the contract team (DD-023). One membership per " +
          "person; the account type says what the membership lets them do",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          userId: z.string(),
        }),
        response: { 201: TeamEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { userId } = request.body;
      const team = await app.notifier.notifying(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        // On a walled record this add is an audience decision (CTR-023),
        // so it is asked before the archived refusal, the same order the
        // flag's own write takes.
        await assertMayChangeTeam(tx, current, request.user);
        assertEditable(current);
        // Anyone live may join: a Business User's row is their Portal grant.
        const person = await lockedUser(tx, userId, USER_ROLES, "That is not a person we can add.");

        const inserted = await addContractTeamMember(
          tx,
          app.notifier,
          current.row,
          request.user,
          person,
        );
        if (!inserted) throw httpError(409, "This person is already on the team.");
        return selectTeam(tx, current.row.id);
      });
      return reply.status(201).send({ team });
    },
  );

  app.delete(
    "/contracts/:number/team/:userId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractTeamMember",
        summary:
          "Take a person off the contract team (DD-023). A Business User " +
          "loses Portal access to the record on the next read. The current Business Owner must be reassigned or cleared first",
        tags: ["contracts"],
        params: NumberParams.extend({
          userId: z.string(),
        }),
        response: { 200: TeamEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { userId } = request.params;
      const team = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number, request.user);
        // Taking somebody off a walled record's team is the same
        // decision as putting them on it, read the other way (CTR-023).
        await assertMayChangeTeam(tx, current, request.user);
        assertEditable(current);
        if (userId === current.row.businessOwnerId) {
          throw httpError(
            409,
            "Change the Business Owner before removing this person from the team.",
          );
        }
        const [removed] = await tx
          .delete(contractTeam)
          .where(and(eq(contractTeam.contractId, current.row.id), eq(contractTeam.userId, userId)))
          .returning();
        if (!removed) throw httpError(404, "This person is not on the contract team.");

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
          party = found.counterparty;
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
        if (
          removed.isPrimary &&
          (!current.row.analysisHumanFields.includes("counterparties") ||
            current.row.aiUnverified?.counterparties)
        ) {
          const remaining = { ...current.row.aiUnverified };
          delete remaining.counterparties;
          const [updated] = await tx
            .update(contracts)
            .set({
              analysisHumanFields: [
                ...new Set([...current.row.analysisHumanFields, "counterparties"]),
              ],
              aiUnverified: Object.keys(remaining).length ? remaining : null,
            })
            .where(eq(contracts.id, current.row.id))
            .returning();
          Object.assign(current.row, updated);
        }

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
          // A person taking the primary off verifies that slot (CTR-008):
          // an analysis run may have linked it, and its marker must not
          // outlive the link.
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
        // The person chose the primary, so the slot is theirs (CTR-008).
        await clearAiUnverified(tx, current.row.id, "counterparties");
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
        return {
          ...current,
          row: row!,
          nextDeadline: await readNextDeadline(tx, request.user, row!.id),
        };
      });
      return { contract: await memberRow(app.db, archived) };
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
        return {
          ...current,
          row: row!,
          nextDeadline: await readNextDeadline(tx, request.user, row!.id),
        };
      });
      return { contract: await memberRow(app.db, restored) };
    },
  );
};
