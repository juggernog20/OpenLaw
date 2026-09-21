// SPDX-License-Identifier: AGPL-3.0-only
import {
  and,
  eq,
  requestTypes,
  requestTypeFields,
  fields,
  contractTypes,
  matterTypes,
  contractTypeFields,
  matterTypeFields,
  contractTypeBuiltinRows,
  matterTypeBuiltinRows,
} from "@openlaw/db";
import type { InjectOptions } from "fastify";
import type { TestHarness } from "./harness.js";

/** Older workflow fixtures declare their questions through Request attachments.
 * Install those declarations on the destination Form before submitting the fixture.
 * New Form behavior tests configure the destination directly and call inject themselves.
 */
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
        const joins = module === "contract" ? contractTypeFields : matterTypeFields;
        const builtins = module === "contract" ? contractTypeBuiltinRows : matterTypeBuiltinRows;
        await h.db
          .update(builtins)
          .set({ onIntakeForm: true, isRequired: false })
          .where(and(eq(builtins.typeId, target.id), eq(builtins.builtinKey, "description")));
        const attached = await h.db
          .select({ join: requestTypeFields, field: fields })
          .from(requestTypeFields)
          .innerJoin(fields, eq(fields.id, requestTypeFields.fieldId))
          .where(eq(requestTypeFields.typeId, id));
        for (const { join, field } of attached) {
          if (field.builtInKey) continue;
          await h.db
            .insert(joins)
            .values({
              typeId: target.id,
              fieldId: field.id,
              isRequired: join.isRequired,
              displayOrder: join.displayOrder,
              onIntakeForm: true,
              visibleOnPortal: true,
            })
            .onConflictDoUpdate({
              target: [joins.typeId, joins.fieldId],
              set: { isRequired: join.isRequired, onIntakeForm: true, visibleOnPortal: true },
            });
        }
      }
    }
  }
  return h.app.inject(options);
}
