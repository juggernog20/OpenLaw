// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, orgSettings } from "@openlaw/db";
import { requireAuth, requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { CurrencySchema } from "../../lib/currencies.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Envelope = z.object({ currencies: z.array(z.string()), canManage: z.boolean() });

export const currencyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/org/currencies",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getCurrenciesInUse",
        tags: ["org"],
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select({ currencies: orgSettings.currenciesInUse })
        .from(orgSettings)
        .limit(1);
      if (!row) throw httpError(500, "The currency settings could not be read.");
      return { currencies: row.currencies, canManage: request.user.role === "administrator" };
    },
  );

  async function update(code: string, add: boolean, actorId: string) {
    return app.db.transaction(async (tx) => {
      const [row] = await tx.select().from(orgSettings).limit(1).for("update");
      if (!row) throw httpError(500, "The currency settings could not be read.");
      const before = row.currenciesInUse;
      const currencies = add
        ? [...new Set([...before, code])].sort()
        : before.filter((value) => value !== code);
      if (JSON.stringify(before) !== JSON.stringify(currencies)) {
        await tx
          .update(orgSettings)
          .set({ currenciesInUse: currencies })
          .where(eq(orgSettings.id, row.id));
        await recordActivity(tx, {
          actorId,
          entityType: "system",
          visibility: "admin_only",
          action: "org_settings.updated",
          payload: { field: "currenciesInUse", old: before, new: currencies },
        });
      }
      return { currencies, canManage: true };
    });
  }

  app.post(
    "/org/currencies",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "addCurrencyInUse",
        tags: ["org"],
        body: z.strictObject({ code: CurrencySchema }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    (request) => update(request.body.code, true, request.user.id),
  );

  app.delete(
    "/org/currencies/:code",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "removeCurrencyInUse",
        tags: ["org"],
        params: z.object({ code: CurrencySchema }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    (request) => update(request.params.code, false, request.user.id),
  );
};
