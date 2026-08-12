// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record core routes (M8/1): list, create, the record
 * read, the DES-017 per-field update, archive, and restore, plus the
 * Member+ picker read the create dialog needs (the contract-types and
 * contract-statuses settings surfaces stay Administrator-only per
 * SET-002).
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
 * Access is Member+ throughout — Administrators and Legal Team Members
 * equally. Contributor record-level access waits for the DD-015 grid.
 * Every mutation appends to the activity log in the same transaction
 * (DD-017); the feed and audit surfaces read it in M9.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractStatuses,
  contracts,
  contractTypes,
  CONTRACT_STAGES,
  desc,
  eq,
  isNull,
  SEVERITY_LEVELS,
  type Contract,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** Contracts are Member+ everywhere, read and write. */
const requireMember = requireRole("administrator", "legal_team_member");

/** The protected CTR-001 seed every contract is born on. */
const DRAFT_STATUS_SLUG = "draft";

const SeveritySchema = z.enum(SEVERITY_LEVELS);

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
  priority: SeveritySchema,
  /** NULL = not yet assessed, which is not the same as low (CTR-005). */
  risk: SeveritySchema.nullable(),
  description: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const ContractEnvelope = z.object({ contract: ContractRowSchema });

/** The Member+ readable slice of a contract type. */
const TypeOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

/** The Member+ readable slice of a contract status: the label to show
 * and the fixed stage behind it. */
const StatusOptionSchema = TypeOptionSchema.extend({ stage: z.enum(CONTRACT_STAGES) });

const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(10_000);
/** The number is the path, so it is an integer or it is not a contract. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** The joined shape every route answers with — the stored row plus the
 * two display names and the derived stage. */
interface ContractContext {
  row: Contract;
  contractTypeName: string;
  statusName: string;
  stage: (typeof CONTRACT_STAGES)[number];
}

function toRow(context: ContractContext) {
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
    priority: row.priority,
    risk: row.risk,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const contractsRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];
  type Executor = typeof app.db | Tx;

  /** The one read shape: the contract with its type name, status label,
   * and derived stage. */
  const selectContracts = (db: Executor) =>
    db
      .select({
        row: contracts,
        contractTypeName: contractTypes.displayName,
        statusName: contractStatuses.displayName,
        stage: contractStatuses.stage,
      })
      .from(contracts)
      .innerJoin(contractTypes, eq(contracts.contractTypeId, contractTypes.id))
      .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id));

  /**
   * Locks one contract by number and returns it with its display
   * names, or 404s — every mutation starts here. One query, the same
   * join the reads use; `of: contracts` locks the contract row alone,
   * because the joined taxonomy rows are only read here.
   */
  async function lockedContract(tx: Tx, number: number): Promise<ContractContext> {
    const [target] = await selectContracts(tx)
      .where(eq(contracts.number, number))
      .limit(1)
      .for("update", { of: contracts });
    if (!target) throw httpError(404, "No contract exists with this number.");
    return target;
  }

  app.get(
    "/contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listContracts",
        summary:
          "The contract list, newest reference first: number, title, " +
          "type, and status; archived contracts only with includeArchived=true",
        tags: ["contracts"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: {
          200: z.object({ contracts: z.array(ContractRowSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await selectContracts(app.db)
        .where(request.query.includeArchived === "true" ? undefined : isNull(contracts.archivedAt))
        // The reference is monotonic, so newest-first is the number
        // descending — no second sort key can tie.
        .orderBy(desc(contracts.number));
      return { contracts: rows.map(toRow) };
    },
  );

  app.get(
    "/contracts/options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listContractOptions",
        summary:
          "The live contract types and statuses in display order — the " +
          "create dialog's and the record's Member+ picker source (the " +
          "settings surfaces stay Administrator-only per SET-002)",
        tags: ["contracts"],
        response: {
          200: z.object({
            contractTypes: z.array(TypeOptionSchema),
            contractStatuses: z.array(StatusOptionSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const [types, statuses] = await Promise.all([
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
      ]);
      return { contractTypes: types, contractStatuses: statuses };
    },
  );

  app.get(
    "/contracts/:number",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getContract",
        summary:
          "One contract by its CTR-003 number — the record page's read; " +
          "archived contracts answer too, so restore stays reachable",
        tags: ["contracts"],
        params: NumberParams,
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const [row] = await selectContracts(app.db)
        .where(eq(contracts.number, request.params.number))
        .limit(1);
      if (!row) throw httpError(404, "No contract exists with this number.");
      return { contract: toRow(row) };
    },
  );

  app.post(
    "/contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createContract",
        summary:
          "Create a contract from a title and a live type; the status " +
          "starts on the protected draft seed (CTR-001) and the number " +
          "comes from the CTR-003 sequence. Everything else is set inline " +
          "on the record afterward",
        tags: ["contracts"],
        // Strict: the number is the sequence's to give, so a body
        // carrying one is refused rather than silently ignored.
        body: z.strictObject({ title: TitleSchema, contractTypeId: z.string() }),
        response: { 201: ContractEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { title, contractTypeId } = request.body;
      const created = await app.db.transaction(async (tx) => {
        // Lock the type row so a concurrent archive can't slip between
        // the check and the insert.
        const [contractType] = await tx
          .select({
            id: contractTypes.id,
            displayName: contractTypes.displayName,
            archivedAt: contractTypes.archivedAt,
          })
          .from(contractTypes)
          .where(eq(contractTypes.id, contractTypeId))
          .limit(1)
          .for("update");
        if (!contractType || contractType.archivedAt) {
          throw httpError(400, "The contract type must be a live contract type.");
        }

        // The draft seed is system-protected — no archive, no delete —
        // so it is always there to be born on. The live filter states
        // that invariant rather than assuming it: a contract must never
        // start on a status the pickers refuse to show.
        const [draft] = await tx
          .select({
            id: contractStatuses.id,
            displayName: contractStatuses.displayName,
            stage: contractStatuses.stage,
          })
          .from(contractStatuses)
          .where(
            and(eq(contractStatuses.slug, DRAFT_STATUS_SLUG), isNull(contractStatuses.archivedAt)),
          )
          .limit(1);
        if (!draft) throw httpError(500, "The draft contract status is missing.");

        const [row] = await tx
          .insert(contracts)
          .values({ title: title.trim(), contractTypeId: contractType.id, statusId: draft.id })
          .returning();
        await recordActivity(tx, {
          entityType: "contract",
          entityId: row!.id,
          actorId: request.user.id,
          action: "contract.created",
          visibility: "legal_only",
          payload: {
            number: row!.number,
            title: row!.title,
            contractType: contractType.displayName,
            status: draft.displayName,
          },
        });
        return {
          row: row!,
          contractTypeName: contractType.displayName,
          statusName: draft.displayName,
          stage: draft.stage,
        };
      });
      return reply.status(201).send({ contract: toRow(created) });
    },
  );

  app.patch(
    "/contracts/:number",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContract",
        summary:
          "Commit one field of a contract in place (DES-017 per-field " +
          "commits): title, description, priority, risk, or the status — " +
          "any live status may follow any other (CTR-001). Never on an " +
          "archived contract",
        tags: ["contracts"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          title: TitleSchema.optional(),
          description: DescriptionSchema.nullable().optional(),
          priority: SeveritySchema.optional(),
          risk: SeveritySchema.nullable().optional(),
          statusId: z.string().optional(),
        }),
        response: { 200: ContractEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const body = request.body;
      const updated = await app.db.transaction(async (tx) => {
        const current = await lockedContract(tx, request.params.number);
        const target = current.row;
        if (target.archivedAt) {
          throw httpError(409, "This contract is archived. Restore it before editing.");
        }

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

        if (body.priority !== undefined && body.priority !== target.priority) {
          patch.priority = body.priority;
          changed.priority = { from: target.priority, to: body.priority };
        }

        if (body.risk !== undefined && body.risk !== target.risk) {
          patch.risk = body.risk;
          changed.risk = { from: target.risk, to: body.risk };
        }

        // The status keeps its own audit verb — surfaces branch on the
        // stage behind it (CTR-001) — so it rides the same UPDATE but
        // stays out of the changed map.
        let statusChange:
          { from: string; to: string; fromStage: string; toStage: string } | undefined;
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
          patch.statusId = status.id;
          statusChange = {
            from: current.statusName,
            to: status.displayName,
            fromStage: current.stage,
            toStage: status.stage,
          };
          statusName = status.displayName;
          stage = status.stage;
        }

        // Nothing changed: answer with the row and write no misleading
        // from==to audit entry.
        if (Object.keys(patch).length === 0) return current;

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
            visibility: "legal_only",
            payload: { number: row!.number, title: row!.title, changed },
          });
        }
        if (statusChange) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.id,
            actorId: request.user.id,
            action: "contract.status_changed",
            visibility: "legal_only",
            payload: { number: row!.number, title: row!.title, ...statusChange },
          });
        }
        return { row: row!, contractTypeName: current.contractTypeName, statusName, stage };
      });
      return { contract: toRow(updated) };
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
        const current = await lockedContract(tx, request.params.number);
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
          visibility: "legal_only",
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
        const current = await lockedContract(tx, request.params.number);
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
          visibility: "legal_only",
          payload: { number: row!.number, title: row!.title },
        });
        return { ...current, row: row! };
      });
      return { contract: toRow(restored) };
    },
  );
};
