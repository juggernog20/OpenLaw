// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Contract Tools in TECH-035's register reuse the Contract services. DD-029 gives
 * Business Users the Portal projection and excludes every mutation.
 */
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractTypes,
  contractApprovals,
  contractCounterparties,
  contractKeyDates,
  entities,
  eq,
  isNull,
  lt,
  regions,
  sql,
  users,
  type Db,
} from "@openlaw/db";
import { contractTeamScope, NO_CONTRACT } from "../lib/contract-access.js";
import { portalContractScope } from "../lib/portal-contract-access.js";
import { entityReachScope } from "../lib/entity-access.js";
import { HttpError, httpError } from "../lib/problem.js";
import {
  CustomFieldsInput,
  AttachedCustomFieldSchema,
  coerceCustomFieldValue,
} from "../lib/custom-fields.js";
import { createContract } from "../modules/contracts/create.js";
import { getContract, updateContract, setContractStatus } from "../modules/contracts/service.js";
import {
  ContractRowSchema,
  ContractUpdateBody,
  ContractStatusBody,
  TitleSchema,
  DescriptionSchema,
  selectContracts,
  toRow,
  customFieldsEnvelope,
  selectTeam,
  attachedFieldsOf,
  TeamEnvelope,
  memberRow,
} from "../modules/contracts/record.js";
import { listContractDocuments } from "../modules/documents/service.js";
import { listPortalDocuments } from "../modules/portal/document-service.js";
import { AnalysisRunSchema, toAnalysisRun } from "../modules/contract-analysis/routes.js";
import { runContractAnalysis } from "../modules/contract-analysis/service.js";
import { ToolError, type ToolDefinition } from "./tool.js";
import { readTool } from "./workspace.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";

const reference = z.number().int().min(1);
const id = z.string().min(1).max(128);
const listInput = z
  .object({
    statusId: id.optional(),
    typeId: id.optional(),
    counterpartyId: id.optional(),
    ownerId: id.optional(),
    expiringWithinDays: z.number().int().min(0).max(36500).optional(),
    ...pageInput,
  })
  .strict();
const getInput = z
  .object({
    number: reference,
    documentsCursor: id.optional(),
    documentsLimit: z.number().int().min(1).max(50).default(10),
  })
  .strict();
const createInput = z
  .object({
    contractTypeId: id,
    answers: z.record(z.string(), z.unknown()),
    managerId: id.nullable().optional(),
    isConfidential: z.boolean().optional(),
  })
  .strict();
const changesSchema = ContractUpdateBody.omit({ isConfidential: true, contractTypeId: true });
const updateInput = z.object({ number: reference, changes: changesSchema }).strict();
const statusInput = ContractStatusBody.extend({ number: reference });
const analysisInput = z.object({ number: reference, versionId: id.optional() }).strict();
const writeTool = {
  toolset: "contracts",
  kind: "write",
  legalUser: "on",
  businessUser: "off",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: false,
  },
} as const;
const mutationOutput = z.object({ number: reference });
// These are the facts the Portal Contract and work reads expose. Legal-only facts never enter this projection.
const portalRow = ContractRowSchema.pick({
  id: true,
  number: true,
  title: true,
  contractTypeId: true,
  contractTypeName: true,
  statusId: true,
  statusName: true,
  stage: true,
  manager: true,
  businessOwner: true,
  primaryCounterparty: true,
  description: true,
  owningDepartmentId: true,
  owningDepartment: true,
  region: true,
  value: true,
  termType: true,
  effectiveDate: true,
  expiryDate: true,
  renewalPeriodMonths: true,
  noticePeriodDays: true,
  noticeDeadline: true,
  renewalPendingConfirmation: true,
});
const recordRow = z.union([ContractRowSchema, portalRow]);
const object = z.record(z.string(), z.unknown());
const getOutput = z.object({
  contract: recordRow,
  fields: z.array(AttachedCustomFieldSchema),
  customFields: CustomFieldsInput,
  team: TeamEnvelope.shape.team,
  counterparties: z.array(object).optional(),
  documents: z.array(object),
  documentsNextCursor: z.string().nullable(),
  keyDates: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        label: z.string(),
        note: z.string().nullable(),
      }),
    )
    .optional(),
  analysis: z
    .object({ available: z.boolean(), latestRun: AnalysisRunSchema.nullable() })
    .optional(),
  approvals: z
    .array(
      z.object({
        id: z.string(),
        approverId: z.string(),
        approverName: z.string(),
        requestedAt: z.string(),
      }),
    )
    .optional(),
});
const answerNames: Record<string, string> = {
  title: "title",
  description: "description",
  entity: "entityId",
  priority: "priority",
  risk: "risk",
  term_type: "termType",
  effective_date: "effectiveDate",
  expiry_date: "expiryDate",
  renewal_period_months: "renewalPeriodMonths",
  notice_period_days: "noticePeriodDays",
  value: "value",
  needed_by: "neededBy",
  counterparties: "counterparties",
  owning_department: "owningDepartmentId",
  region: "region",
};
const creationAnswers = changesSchema.omit({ managerId: true, businessOwnerId: true }).extend({
  title: TitleSchema,
  description: DescriptionSchema.nullable().optional(),
  neededBy: z.iso.date().nullable().optional(),
  counterparties: z
    .array(
      z.union([
        z.object({ counterpartyId: id }).strict(),
        z.object({ name: z.string().trim().min(1).max(200) }).strict(),
      ]),
    )
    .max(50)
    .optional(),
});
function parseAnswers(answers: Record<string, unknown>, contractTypeId: string) {
  const native: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key === "contract_type") {
      if (value !== contractTypeId)
        throw new ToolError(
          "validation_error",
          "Contract type: the answer must match contractTypeId.",
        );
      continue;
    }
    if (Object.hasOwn(answerNames, key)) native[answerNames[key]!] = value;
    else custom[key] = value;
  }
  const parsed = creationAnswers.safeParse({ ...native, customFields: custom });
  if (!parsed.success)
    throw new ToolError(
      "validation_error",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return parsed.data;
}
async function pendingApprovals(db: Db, contractId: string, approverId?: string) {
  const rows = await db
    .select({
      id: contractApprovals.id,
      approverId: users.id,
      approverName: users.displayName,
      requestedAt: contractApprovals.createdAt,
    })
    .from(contractApprovals)
    .innerJoin(users, eq(users.id, contractApprovals.approverId))
    .where(
      and(
        eq(contractApprovals.contractId, contractId),
        eq(contractApprovals.status, "pending"),
        approverId ? eq(contractApprovals.approverId, approverId) : undefined,
      ),
    )
    .orderBy(asc(contractApprovals.createdAt), asc(contractApprovals.id));
  return rows.map((row) => ({ ...row, requestedAt: row.requestedAt.toISOString() }));
}
export const contractTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "contracts",
    name: "openlaw_contracts_list",
    title: "List Contracts",
    description:
      "List non-archived Contracts you can reach, including ended Contracts. Filter by statusId, typeId, counterpartyId, ownerId and expiringWithinDays, from today through that many days inclusive. Business Users read Portal facts on their team records. Continue with nextCursor and the same filters.",
    inputSchema: listInput,
    outputSchema: z.object({ contracts: z.array(recordRow), nextCursor: z.string().nullable() }),
    run: async (input, { db, user }) => {
      const { statusId, typeId, counterpartyId, ownerId, expiringWithinDays, cursor, limit } =
        listInput.parse(input);
      const scope = and(
        isNull(contracts.archivedAt),
        user.role === "business_user" ? portalContractScope(db, user) : contractTeamScope(db, user),
        statusId ? eq(contracts.statusId, statusId) : undefined,
        typeId ? eq(contracts.contractTypeId, typeId) : undefined,
        ownerId ? eq(contracts.managerId, ownerId) : undefined,
        counterpartyId
          ? sql`exists (select 1 from ${contractCounterparties} where ${contractCounterparties.contractId} = ${contracts.id} and ${contractCounterparties.counterpartyId} = ${counterpartyId})`
          : undefined,
        expiringWithinDays !== undefined
          ? sql`${contracts.expiryDate} between current_date and current_date + ${expiringWithinDays}::integer`
          : undefined,
      );
      const cursorNumber = cursor === undefined ? undefined : Number(cursor);
      if (
        cursorNumber !== undefined &&
        (!/^\d+$/.test(cursor!) || !Number.isSafeInteger(cursorNumber) || cursorNumber < 1)
      )
        throw new ToolError("validation_error", "cursor must be a positive Contract number.");
      const boundary =
        cursorNumber === undefined ? undefined : lt(contracts.number, sql`${cursorNumber}::bigint`);
      const rows = await selectContracts(db, user)
        .where(and(scope, boundary))
        .orderBy(sql`${contracts.number} desc`)
        .limit(limit + 1);
      const projected = await Promise.all(
        rows.map(async (r) =>
          user.role === "business_user"
            ? portalRow.parse(toRow(r, {}, []))
            : ContractRowSchema.parse(await memberRow(db, r)),
        ),
      );
      const page = boundedPage(projected, limit, (r) => String(r.number));
      return bounded({ contracts: page.items, nextCursor: page.nextCursor });
    },
  },
  {
    ...readTool,
    toolset: "contracts",
    name: "openlaw_contract_get",
    title: "Read a Contract",
    description:
      "Read a Contract by its C-number: overview, Fields, team, Key dates, Documents, latest Analysis run answers and open Approval requests. Business Users receive only Portal facts, Portal-visible Fields, team, Documents and their own open Approval requests. documentsNextCursor continues Documents with documentsCursor. documentsLimit bounds that page; reduce it if the whole record exceeds the byte budget.",
    inputSchema: getInput,
    outputSchema: getOutput,
    run: async (input, context) =>
      serviceResult(async () => {
        const { number, documentsCursor, documentsLimit } = getInput.parse(input);
        const { db, user } = context;
        const portal = user.role === "business_user";
        let result;
        if (portal) {
          const [row] = await selectContracts(db, user)
            .where(and(eq(contracts.number, number), portalContractScope(db, user)))
            .limit(1);
          if (!row) throw httpError(404, NO_CONTRACT);
          const custom = await customFieldsEnvelope(db, row, user);
          result = {
            contract: portalRow.parse(toRow(row, {}, [])),
            fields: custom.fields,
            customFields: custom.customFields,
            team: await selectTeam(db, row.row.id),
          };
        } else {
          const details = await getContract(db, user, number, context.resolveAiProvider);
          result = {
            contract: ContractRowSchema.parse(details.contract),
            fields: details.fields,
            customFields: details.contract.customFields,
            team: details.team,
            analysis: details.analysis,
            counterparties: details.counterparties,
          };
        }
        const paper = portal
          ? await listPortalDocuments(db, user, "contract", number, { cursor: documentsCursor })
          : await listContractDocuments(db, user, number, { cursor: documentsCursor });
        const documentPage = boundedPage<{ id: string } & Record<string, unknown>>(
          paper.documents,
          documentsLimit,
          (d) => d.id,
          paper.nextCursor,
        );
        const withDocuments = {
          ...result,
          documents: documentPage.items,
          documentsNextCursor: documentPage.nextCursor,
        };
        if (portal)
          return bounded({
            ...withDocuments,
            approvals: await pendingApprovals(db, result.contract.id, user.id),
          });
        const [keyDates, approvals] = await Promise.all([
          db
            .select({
              id: contractKeyDates.id,
              date: contractKeyDates.date,
              label: contractKeyDates.label,
              note: contractKeyDates.note,
            })
            .from(contractKeyDates)
            .where(eq(contractKeyDates.contractId, result.contract.id))
            .orderBy(asc(contractKeyDates.date), asc(contractKeyDates.id)),
          pendingApprovals(db, result.contract.id),
        ]);
        return bounded({
          ...withDocuments,
          keyDates,
          approvals,
        });
      }),
  },
  {
    ...writeTool,
    name: "openlaw_contract_create",
    title: "Create a Contract",
    description:
      "Create a Contract from a creation Form answer set. First read openlaw_form_get with kind contract. Key answers by rowRef, including title and attached Field slugs. Use Entity and Department ids, Region name or id, and counterparties as objects with counterpartyId or name. Ask the person for missing answers with your Client's question tool. Missing or invalid Fields return validation_error. Creates a new Contract each time.",
    inputSchema: createInput,
    outputSchema: mutationOutput,
    run: async (input, { user, notifier }) =>
      serviceResult(async () => {
        const { contractTypeId, answers, managerId, isConfidential } = createInput.parse(input);
        const facts = parseAnswers(answers, contractTypeId);
        const born = await notifier.notifying(async (tx) => {
          const [type] = await tx
            .select({ id: contractTypes.id })
            .from(contractTypes)
            .where(and(eq(contractTypes.id, contractTypeId), isNull(contractTypes.archivedAt)))
            .for("update");
          if (!type) throw httpError(400, "The contract type must be a live contract type.");
          const attached = await attachedFieldsOf(tx, contractTypeId);
          const invalid: string[] = [];
          for (const [slug, value] of Object.entries(facts.customFields ?? {})) {
            const field = attached.find((f) => f.slug === slug);
            if (!field) {
              invalid.push(`${slug}: this Field is not on the Contract type.`);
              continue;
            }
            try {
              coerceCustomFieldValue(field, value);
            } catch (error) {
              if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
              invalid.push(`${slug}: ${error.message}`);
            }
          }
          if (invalid.length) throw new ToolError("validation_error", invalid.join("; "));

          if (facts.entityId) {
            const [entity] = await tx
              .select({ id: entities.id })
              .from(entities)
              .where(and(eq(entities.id, facts.entityId), entityReachScope(tx, user)))
              .for("update");
            if (!entity) throw httpError(400, "Our entity must be an Entity you can reach.");
          }
          if (facts.region) {
            const [region] = await tx
              .select({ name: regions.displayName })
              .from(regions)
              .where(eq(regions.id, facts.region));
            if (region) facts.region = region.name;
          }
          return createContract(tx, notifier, {
            ...facts,
            actorId: user.id,
            contractTypeId,
            managerId,
            isConfidential,
          });
        });
        return { number: born.row.number };
      }),
  },
  {
    ...writeTool,
    annotations: { ...writeTool.annotations, idempotentHint: true },
    name: "openlaw_contract_update",
    title: "Update Contract Fields and owners",
    description:
      "Change Contract Fields, Legal Owner managerId, Business Owner businessOwnerId, owningDepartmentId or Region name. Null clears nullable values. Status uses openlaw_contract_set_status. priority and risk: low, medium, high, critical. termType: fixed, auto_renew, evergreen. Value cadence: one_time, monthly, annually, other. Fields use customFields keyed by slug.",
    inputSchema: updateInput,
    outputSchema: mutationOutput,
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { number, changes } = updateInput.parse(input);
        await updateContract(db, user, number, changes, notifier);
        return { number };
      }),
  },
  {
    ...writeTool,
    name: "openlaw_contract_set_status",
    title: "Move Contract status",
    description:
      "Move a Contract to a configured statusId. The soft gate returns its reason when unresolved Approval requests need confirmation. Ask the person before repeating with overrideSoftGate true. A status move can trigger activity and notifications.",
    inputSchema: statusInput,
    outputSchema: mutationOutput,
    run: async (input, { db, user, notifier }) =>
      serviceResult(async () => {
        const { number, ...change } = statusInput.parse(input);
        await setContractStatus(db, user, number, change, notifier);
        return { number };
      }),
  },
  {
    ...writeTool,
    name: "openlaw_analysis_run",
    title: "Run Contract analysis",
    description:
      "Queue an Analysis run on a Contract's primary Document executed pin, or its current Version when unpinned. Supply versionId to select a reachable Version belonging to this Contract. Requires ready text and an enabled AI connector. Analysis writes unverified answers into Fields; repeated calls can create new runs.",
    inputSchema: analysisInput,
    outputSchema: z.object({ run: AnalysisRunSchema }),
    run: async (input, context) =>
      serviceResult(async () => {
        const { number, versionId } = analysisInput.parse(input);
        const run = await runContractAnalysis(
          context.db,
          context.user,
          number,
          context.resolveAiProvider,
          context.jobs,
          versionId,
        );
        return { run: toAnalysisRun(run) };
      }),
  },
];
