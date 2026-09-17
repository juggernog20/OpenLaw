// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { approverGroups, contractTypes, eq, orgSettings } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { getOrgSettings } from "../../lib/org-settings.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Policy = z.object({ allowLegalApproverGroupOverride: z.boolean() }).strict();
const Default = z.object({ groupId: z.string().min(1).max(64).nullable() }).strict();
const Params = z.object({ id: z.string().min(1).max(64) });

export const approvalDefaultsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/org/approval-policy",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getApprovalPolicy",
        tags: ["org"],
        response: { 200: Policy, default: problemResponse },
      },
    },
    async () => {
      const settings = await getOrgSettings(app.db);
      return { allowLegalApproverGroupOverride: settings.allowLegalApproverGroupOverride };
    },
  );

  app.put(
    "/org/approval-policy",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setApprovalPolicy",
        tags: ["org"],
        body: Policy,
        response: { 200: Policy, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const [settings] = await tx.select().from(orgSettings).limit(1).for("update");
        if (!settings) throw httpError(500, "Organization settings are unavailable.");
        const next = request.body.allowLegalApproverGroupOverride;
        if (settings.allowLegalApproverGroupOverride !== next) {
          await tx
            .update(orgSettings)
            .set({ allowLegalApproverGroupOverride: next, updatedAt: new Date() })
            .where(eq(orgSettings.id, settings.id));
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "org_settings.updated",
            visibility: "admin_only",
            payload: {
              field: "allowLegalApproverGroupOverride",
              old: settings.allowLegalApproverGroupOverride,
              new: next,
            },
          });
        }
        return { allowLegalApproverGroupOverride: next };
      }),
  );

  app.get(
    "/contract-types/:id/approval-default",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getContractTypeApprovalDefault",
        tags: ["contract-types"],
        params: Params,
        response: { 200: Default, default: problemResponse },
      },
    },
    async (request) => {
      const [type] = await app.db
        .select()
        .from(contractTypes)
        .where(eq(contractTypes.id, request.params.id));
      if (!type) throw httpError(404, "No contract type exists with this id.");
      return { groupId: type.defaultApproverGroupId };
    },
  );

  app.put(
    "/contract-types/:id/approval-default",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setContractTypeApprovalDefault",
        tags: ["contract-types"],
        params: Params,
        body: Default,
        response: { 200: Default, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const [type] = await tx
          .select()
          .from(contractTypes)
          .where(eq(contractTypes.id, request.params.id))
          .for("update");
        if (!type) throw httpError(404, "No contract type exists with this id.");
        if (type.archivedAt)
          throw httpError(
            409,
            "Restore this contract type before changing its default approver group.",
          );
        const groupId = request.body.groupId;
        if (groupId) {
          const [group] = await tx
            .select()
            .from(approverGroups)
            .where(eq(approverGroups.id, groupId))
            .for("share");
          if (!group || group.archivedAt) throw httpError(400, "Choose an active approver group.");
        }
        if (type.defaultApproverGroupId !== groupId) {
          await tx
            .update(contractTypes)
            .set({ defaultApproverGroupId: groupId, updatedAt: new Date() })
            .where(eq(contractTypes.id, type.id));
          await recordActivity(tx, {
            entityType: "system",
            entityId: type.id,
            actorId: request.user.id,
            action: "contract_type.updated",
            visibility: "admin_only",
            payload: {
              slug: type.slug,
              changed: {
                defaultApproverGroupId: { from: type.defaultApproverGroupId, to: groupId },
              },
            },
          });
        }
        return { groupId };
      }),
  );
};
