// SPDX-License-Identifier: AGPL-3.0-only

import { and, counterparties, eq, isNull, type Transaction } from "@openlaw/db";
import { z } from "zod";
import { CounterpartyNameSchema } from "./counterparty-link.js";
import { httpError } from "./problem.js";

export const IntakeCounterpartiesInput = z
  .array(
    z.union([
      z.strictObject({ counterpartyId: z.string().min(1) }),
      z.strictObject({
        name: CounterpartyNameSchema.regex(/^[^\r\n]+$/, "Enter one counterparty name at a time."),
      }),
    ]),
  )
  .max(50);

export async function resolveIntakeCounterparties(
  tx: Transaction,
  picks: z.infer<typeof IntakeCounterpartiesInput>,
) {
  const resolved: Array<{ counterpartyId?: string; name: string }> = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    let selected: { counterpartyId?: string; name: string };
    if ("counterpartyId" in pick) {
      const [party] = await tx
        .select({ counterpartyId: counterparties.id, name: counterparties.name })
        .from(counterparties)
        .where(and(eq(counterparties.id, pick.counterpartyId), isNull(counterparties.archivedAt)))
        .limit(1)
        .for("update");
      if (!party)
        throw httpError(
          400,
          "A selected counterparty is no longer available. Remove it and choose another.",
        );
      selected = party;
    } else selected = { name: pick.name };
    const key = selected.counterpartyId ?? `new:${selected.name.toLocaleLowerCase("en")}`;
    if (!seen.has(key)) {
      resolved.push(selected);
      seen.add(key);
    }
  }
  return resolved;
}
