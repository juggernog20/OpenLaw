// SPDX-License-Identifier: AGPL-3.0-only

import {
  fields,
  isNotNull,
  type Executor,
  type CustomFieldValue,
  type Contract,
} from "@openlaw/db";
import type { AttachedCustomField } from "./custom-fields.js";
import { CounterpartyNameSchema } from "./counterparty-link.js";
import { httpError } from "./problem.js";

export type IntakeContractFacts = Partial<
  Pick<
    Contract,
    | "entityId"
    | "effectiveDate"
    | "expiryDate"
    | "termType"
    | "renewalPeriodMonths"
    | "noticePeriodDays"
    | "valueAmount"
    | "valueCurrency"
    | "valueCadence"
  >
>;

/** Native Row keys take precedence over the protected intake slugs retained until migration. */
export async function readIntakeContractFacts(
  db: Executor,
  answers: Readonly<Record<string, CustomFieldValue>>,
) {
  const definitions = await db
    .select({ slug: fields.slug, key: fields.builtInKey })
    .from(fields)
    .where(isNotNull(fields.builtInKey));
  const values: Record<string, CustomFieldValue> = {};
  for (const field of definitions) {
    if (field.key && answers[field.slug] !== undefined) values[field.key] = answers[field.slug]!;
  }
  const nativeKeys = {
    entity: "entityId",
    effective_date: "effectiveDate",
    expiry_date: "expiryDate",
    term_type: "termType",
    renewal_period_months: "renewalPeriodMonths",
    notice_period_days: "noticePeriodDays",
  } as const;
  for (const [key, native] of Object.entries(nativeKeys)) {
    if (answers[key] !== undefined) values[native] = answers[key]!;
  }
  const terms: Record<string, string> = {
    fixed: "Fixed term",
    auto_renew: "Auto-renewing",
    evergreen: "Evergreen",
  };
  if (typeof answers.term_type === "string")
    values.termType = terms[answers.term_type] ?? answers.term_type;
  const parsed = parseIntakeContractFacts(values);
  if (
    ["value_amount", "value_currency", "value_cadence"].some((key) => answers[key] !== undefined)
  ) {
    const amount = answers.value_amount;
    const currency = answers.value_currency;
    const cadence = answers.value_cadence;
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      typeof currency !== "string" ||
      !Intl.supportedValuesOf("currency").includes(currency) ||
      (cadence !== "one_time" && cadence !== "monthly" && cadence !== "annually")
    )
      throw httpError(400, "Value: enter an amount, currency and frequency.");
    Object.assign(parsed.facts, {
      valueAmount: amount,
      valueCurrency: currency,
      valueCadence: cadence,
    });
  }
  return parsed;
}

export function parseIntakeContractFacts(values: Readonly<Record<string, CustomFieldValue>>) {
  const facts: IntakeContractFacts = {};
  const string = (key: string) =>
    typeof values[key] === "string" ? (values[key] as string) : undefined;
  if (string("entityId")) facts.entityId = string("entityId")!;
  for (const key of ["effectiveDate", "expiryDate"] as const) {
    const date = string(key);
    if (date) {
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
        throw httpError(
          400,
          `${key === "effectiveDate" ? "Effective" : "Expiry"} date: enter a valid calendar date.`,
        );
      facts[key] = date;
    }
  }
  const term = string("termType");
  if (term) {
    const terms = {
      "Fixed term": "fixed",
      "Auto-renewing": "auto_renew",
      Evergreen: "evergreen",
    } as const;
    if (!(term in terms)) throw httpError(400, "Choose a valid term type.");
    facts.termType = terms[term as keyof typeof terms];
  }
  for (const [key, label, min, max] of [
    ["renewalPeriodMonths", "Renewal period", 1, 1200],
    ["noticePeriodDays", "Notice period", 0, 36500],
  ] as const) {
    const value = values[key];
    if (value !== undefined) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
        throw httpError(400, `${label}: enter a whole number between ${min} and ${max}.`);
      facts[key] = value;
    }
  }
  if (facts.renewalPeriodMonths !== undefined && facts.termType === undefined)
    facts.termType = "auto_renew";
  if (facts.renewalPeriodMonths !== undefined && facts.termType !== "auto_renew")
    throw httpError(400, "A renewal period applies only to an auto-renewing contract.");
  if (facts.termType === "evergreen" && facts.expiryDate)
    throw httpError(400, "An evergreen contract has no expiry date.");
  const amount = values.valueAmount;
  const currency = string("valueCurrency");
  const cadence = string("valueCadence");
  if (
    amount !== undefined &&
    (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)
  )
    throw httpError(400, "Value amount: enter a non-negative number.");
  // Partial value answers remain on the Request; a Contract needs the complete value trio.
  if (typeof amount === "number" && currency && cadence) {
    const frequency = { "One-time": "one_time", Monthly: "monthly", Annually: "annually" } as const;
    if (!(cadence in frequency)) throw httpError(400, "Choose a valid value frequency.");
    const digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    const minor = Math.round(amount * 10 ** digits);
    if (!Number.isSafeInteger(minor) || Math.abs(minor / 10 ** digits - amount) > 1e-8)
      throw httpError(
        400,
        "Value amount: use an amount within the currency’s precision and supported range.",
      );
    facts.valueAmount = minor;
    facts.valueCurrency = currency;
    facts.valueCadence = frequency[cadence as keyof typeof frequency];
  }
  const names = [
    ...new Map(
      (string("counterparties") ?? "")
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [name.toLocaleLowerCase("en"), name]),
    ).values(),
  ];
  if (names.length > 50 || names.some((name) => !CounterpartyNameSchema.safeParse(name).success))
    throw httpError(
      400,
      "Counterparties: enter up to 50 legal names, one per line, each no longer than 200 characters.",
    );
  return { facts, counterparties: names };
}

/** Retain the labels needed to review submitted defaults after a form is edited. */
export async function withAnsweredIntakeDefaults(
  db: Executor,
  attached: AttachedCustomField[],
  answers: Readonly<Record<string, CustomFieldValue>>,
): Promise<AttachedCustomField[]> {
  const definitions = await db.select().from(fields).where(isNotNull(fields.builtInKey));
  const missing = definitions.filter(
    (field) =>
      answers[field.slug] !== undefined && !attached.some((row) => row.fieldId === field.id),
  );
  return [
    ...attached,
    ...missing.map((field, index) => ({
      builtInKey: field.builtInKey,
      fieldId: field.id,
      slug: field.slug,
      displayName: field.displayName,
      description: field.description,
      fieldType: field.fieldType,
      fieldTag: field.fieldTag,
      options: field.options,
      displayOrder: attached.length + index + 1,
      isRequired: false,
    })),
  ];
}
