// SPDX-License-Identifier: AGPL-3.0-only

/** Enable Description for workflow fixtures that submit it as an Intake answer. */
import {
  and,
  eq,
  requestTypes,
  contractTypes,
  matterTypes,
  contractTypeBuiltinRows,
  matterTypeBuiltinRows,
} from "@openlaw/db";
import type { InjectOptions } from "fastify";
import type { TestHarness } from "./harness.js";

export async function submitRequestFixture(h: TestHarness, options: InjectOptions) {
  const body = options.payload as Record<string, unknown> | undefined;
  const id = body?.requestTypeId;
  if (typeof id === "string") {
    const [rt] = await h.db.select().from(requestTypes).where(eq(requestTypes.id, id));
    if (rt) {
      const module = rt.targetModule;
      const types = module === "contract" ? contractTypes : matterTypes;
      const targetId = rt.targetContractTypeId ?? rt.targetMatterTypeId;
      const [target] = await h.db
        .select()
        .from(types)
        .where(targetId ? eq(types.id, targetId) : eq(types.isDefault, true));
      if (target) {
        const builtins = module === "contract" ? contractTypeBuiltinRows : matterTypeBuiltinRows;
        await h.db
          .update(builtins)
          .set({ onIntakeForm: true, isRequired: false })
          .where(and(eq(builtins.typeId, target.id), eq(builtins.builtinKey, "description")));
      }
    }
  }
  return h.app.inject(options);
}
