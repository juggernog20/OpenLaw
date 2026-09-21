// SPDX-License-Identifier: AGPL-3.0-only
import {
  contractTypes,
  matterTypes,
  regions,
  eq,
  type Transaction,
  type Request,
} from "@openlaw/db";
import { z } from "zod";
import { intakeRows, intakeRowKeys } from "../../lib/intake-form.js";
import { readTypeForm } from "../../lib/type-form-routes.js";
import { readIntakeContractFacts } from "../../lib/intake-default-fields.js";
import { CounterpartyNameSchema } from "../../lib/counterparty-link.js";
import { httpError } from "../../lib/problem.js";
import type { CustomFieldValue } from "@openlaw/db";

export const ConversionParties = z
  .array(
    z.union([
      z.strictObject({ counterpartyId: z.string().min(1) }),
      z.strictObject({ name: CounterpartyNameSchema }),
    ]),
  )
  .max(50);
const severity = z.enum(["low", "medium", "high", "critical"]);
const NativeAnswers = z.object({
  description: z.string().trim().max(10000).nullable().optional(),
  entityId: z.string().min(1).nullable().optional(),
  owningDepartmentId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  region: z.string().nullable().optional(),
  priority: severity.optional(),
  risk: severity.nullable().optional(),
  termType: z
    .enum(["fixed", "auto_renew", "evergreen"])
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  effectiveDate: z.iso.date().nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
  renewalPeriodMonths: z.int().min(1).max(1200).nullable().optional(),
  noticePeriodDays: z.int().min(0).max(36500).nullable().optional(),
  neededBy: z.iso.date().nullable().optional(),
  value: z
    .object({
      amount: z.int().nonnegative(),
      currency: z.string().refine((v) => Intl.supportedValuesOf("currency").includes(v)),
      cadence: z.enum(["one_time", "monthly", "annually"]),
    })
    .nullable()
    .optional(),
});
const keys = {
  description: "description",
  entity: "entityId",
  owning_department: "owningDepartmentId",
  department: "departmentId",
  region: "region",
  priority: "priority",
  risk: "risk",
  term_type: "termType",
  effective_date: "effectiveDate",
  expiry_date: "expiryDate",
  renewal_period_months: "renewalPeriodMonths",
  notice_period_days: "noticePeriodDays",
  needed_by: "neededBy",
} as const;

/** Called under the Request lock. The type lock also holds its Form stable through creation. */
export async function conversionForm(
  tx: Transaction,
  module: "contract" | "matter",
  typeId: string,
  request: Pick<
    Request,
    "customFields" | "intakeCounterparties" | "description" | "urgency" | "departmentId"
  >,
  input: {
    customFields?: Record<string, CustomFieldValue | null>;
    counterparties?: z.infer<typeof ConversionParties>;
    description?: string | null;
    priority?: z.infer<typeof severity>;
  },
) {
  const table = module === "contract" ? contractTypes : matterTypes;
  const [type] = await tx.select().from(table).where(eq(table.id, typeId)).for("update");
  if (!type || type.archivedAt)
    throw httpError(400, `The ${module} type must be a live ${module} type.`);
  const rows = intakeRows(await readTypeForm(tx, module, typeId));
  const refs = new Set(rows.map((r) => r.rowRef));
  const allowed = new Set(rows.flatMap((r) => intakeRowKeys(r.rowRef)));
  for (const key of Object.keys(input.customFields ?? {})) {
    if (!allowed.has(key)) throw httpError(400, `The target Form has no Row for "${key}".`);
  }
  if (input.counterparties && !refs.has("counterparties"))
    throw httpError(400, "The target Form has no Counterparties Row.");

  // M39/11 removes this read after re-keying stored __intake_* answers.
  const legacy =
    module === "contract"
      ? await readIntakeContractFacts(
          tx,
          Object.fromEntries(
            Object.entries(request.customFields).filter(([key]) => key.startsWith("__intake_")),
          ),
        )
      : null;
  const defaults: Record<string, CustomFieldValue | null> = {
    description: request.description,
    priority: request.urgency,
    [module === "contract" ? "owning_department" : "department"]: request.departmentId,
  };
  if (legacy) {
    for (const [ref, key] of Object.entries(keys)) {
      const value = legacy.facts[key as keyof typeof legacy.facts];
      if (value !== undefined) defaults[ref] = value;
    }
    if (legacy.facts.valueAmount !== undefined) {
      defaults.value_amount = legacy.facts.valueAmount;
      defaults.value_currency = legacy.facts.valueCurrency ?? null;
      defaults.value_cadence = legacy.facts.valueCadence ?? null;
    }
  }
  const carried = Object.fromEntries(
    Object.entries({ ...defaults, ...request.customFields }).filter(([key]) => allowed.has(key)),
  );
  const merged = { ...carried, ...input.customFields };
  if (input.description !== undefined) merged.description = input.description;
  if (input.priority !== undefined) merged.priority = input.priority;
  const departmentKey = module === "contract" ? "owning_department" : "department";
  if (
    !Object.hasOwn(input.customFields ?? {}, departmentKey) &&
    typeof merged[departmentKey] === "string" &&
    !z.uuid().safeParse(merged[departmentKey]).success
  )
    merged[departmentKey] = request.departmentId;
  const native: Record<string, unknown> = {};
  for (const [ref, key] of Object.entries(keys))
    if (refs.has(ref) && merged[ref] !== undefined) native[key] = merged[ref];
  // Priority remains the dialog's fixed control even when its Row is Record-only.
  native.priority = input.priority ?? merged.priority ?? request.urgency;
  native.description =
    input.description !== undefined
      ? input.description
      : merged.description !== undefined
        ? merged.description
        : request.description;
  if (
    refs.has("value") &&
    ["value_amount", "value_currency", "value_cadence"].some((key) => merged[key] !== undefined)
  )
    native.value =
      merged.value_amount === null
        ? null
        : {
            amount: merged.value_amount,
            currency: merged.value_currency,
            cadence: merged.value_cadence,
          };
  const parsed = NativeAnswers.safeParse(native);
  if (!parsed.success)
    throw httpError(
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  if (parsed.data.region) {
    const [region] = await tx.select().from(regions).where(eq(regions.id, parsed.data.region));
    parsed.data.region = region?.displayName ?? parsed.data.region;
  }
  const partyValues = merged.counterparties;
  if (refs.has("counterparties") && partyValues != null && !Array.isArray(partyValues))
    throw httpError(400, "Choose valid Counterparties.");
  const picks = (values: string[]) =>
    values.map((value) =>
      z.uuid().safeParse(value).success ? { counterpartyId: value } : { name: value },
    );
  const parties = !refs.has("counterparties")
    ? undefined
    : (input.counterparties ??
      (Object.hasOwn(input.customFields ?? {}, "counterparties")
        ? picks(Array.isArray(merged.counterparties) ? merged.counterparties : [])
        : request.intakeCounterparties.length
          ? request.intakeCounterparties.map((p) =>
              p.counterpartyId ? { counterpartyId: p.counterpartyId } : { name: p.name },
            )
          : picks(
              Array.isArray(merged.counterparties)
                ? merged.counterparties
                : (legacy?.counterparties ?? []),
            )));
  const parsedParties = parties === undefined ? undefined : ConversionParties.safeParse(parties);
  if (parsedParties && !parsedParties.success) throw httpError(400, "Choose valid Counterparties.");
  const builtin = new Set([
    ...Object.keys(keys),
    "value_amount",
    "value_currency",
    "value_cadence",
    "counterparties",
    "title",
    "contract_type",
    "matter_type",
  ]);
  return {
    native: parsed.data,
    counterparties: parsedParties?.success ? parsedParties.data : undefined,
    customFields: Object.fromEntries(Object.entries(merged).filter(([key]) => !builtin.has(key))),
    carried,
  };
}
