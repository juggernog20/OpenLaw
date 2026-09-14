// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005 and CTR-026: resolve the form answers a targeted Contract is born with. */
import {
  and,
  asc,
  desc,
  contractTypeFields,
  contractTypes,
  departments,
  entities,
  eq,
  isNull,
  or,
  TERM_TYPES,
  VALUE_CADENCES,
  users,
  type AutoDoc,
  type AutoDocContractSnapshot,
  type AutoDocFormDefinition,
  type AutoDocFormField,
  type CustomFieldValue,
  type Transaction,
} from "@openlaw/db";
import { MAX_CONTRACT_TITLE_LENGTH } from "@openlaw/shared";
import { z } from "zod";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { AUTO_DOC_SLUG } from "../../lib/auto-doc-template.js";
import { CounterpartyNameSchema } from "../../lib/counterparty-link.js";
import { CurrencySchema } from "../../lib/currencies.js";
import {
  applyCustomFields,
  assertRequiredCustomFields,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { generationEntityScope } from "./answers.js";
import { chooseLegalOwner } from "./assignment.js";
import { httpError } from "../../lib/problem.js";

/**
 * Which answers each built-in destination can read. The Value map takes
 * the number a currency or number field gives; every other attribute
 * reads a string. The resolver below refuses the rest anyway, but it
 * refuses them at Generation, where the person filling the form cannot
 * act on the answer. Publish is where the person who drew the map is.
 */
const NUMERIC_ANSWERS: AutoDocFormField["fieldType"][] = ["currency", "number"];
const TEXT_ANSWERS: AutoDocFormField["fieldType"][] = [
  "text",
  "long_text",
  "single_select",
  "date",
  "entity",
];

const titleTokens = /\{\{([^{}]*)\}\}/g;
export function contractPublicationGaps(
  autoDoc: Pick<AutoDoc, "titlePattern" | "targetContractTypeId">,
  definition: AutoDocFormDefinition,
): string[] {
  const gaps: string[] = [];
  const pattern = autoDoc.titlePattern;
  if (pattern) {
    for (const token of pattern.matchAll(titleTokens)) {
      const slug = token[1]!.trim();
      if (!AUTO_DOC_SLUG.test(slug) || !definition.fields.some((field) => field.slug === slug))
        gaps.push(`The title pattern names missing form field "${slug}".`);
    }
    if (/[{}]/.test(pattern.replace(titleTokens, "")))
      gaps.push("Use complete {{field_slug}} Placeholders in the title pattern.");
  }
  if (!autoDoc.targetContractTypeId) return gaps;
  const destinations = new Set<string>();
  for (const field of definition.fields) {
    const destination = field.contractAttribute ?? field.catalogFieldId;
    if (destination && destinations.has(destination))
      gaps.push(`Map only one form field to "${destination}".`);
    if (destination) destinations.add(destination);
    if (field.contractAttribute === "value") {
      if (
        !CurrencySchema.safeParse(field.valueCurrency).success ||
        !VALUE_CADENCES.includes(field.valueCadence!)
      )
        gaps.push(`Choose the currency and cadence for the Value map on "${field.label}".`);
      if (!NUMERIC_ANSWERS.includes(field.fieldType))
        gaps.push(`The Value map needs a number answer. "${field.label}" gives another kind.`);
    } else if (field.contractAttribute && !TEXT_ANSWERS.includes(field.fieldType))
      gaps.push(
        `The "${field.contractAttribute}" map needs a text answer. "${field.label}" gives another kind.`,
      );
  }
  return gaps;
}

/** A fixed Entity fills Entity answers without asking the person to choose it again. */
export function generationDefinition(
  autoDoc: Pick<AutoDoc, "targetContractTypeId" | "fixedEntityId">,
  definition: AutoDocFormDefinition,
): AutoDocFormDefinition {
  if (!autoDoc.targetContractTypeId) return definition;
  return {
    ...definition,
    fields: definition.fields.map((field) =>
      field.fieldType === "entity" ? { ...field, required: false } : field,
    ),
  };
}

export async function prepareContractDestination(
  tx: Transaction,
  user: AuthenticatedUser,
  autoDoc: AutoDoc,
  definition: AutoDocFormDefinition,
  answers: Record<string, CustomFieldValue>,
  displayValues: Record<string, string>,
  requestedBusinessOwnerId?: string | null,
): Promise<AutoDocContractSnapshot | null> {
  if (!autoDoc.targetContractTypeId) {
    if (requestedBusinessOwnerId)
      throw httpError(400, "Choose a Business Owner only for a targeted Auto-Doc.");
    return null;
  }
  const gaps = contractPublicationGaps(autoDoc, definition);
  if (gaps.length) throw httpError(409, gaps.join(" "));
  const [type] = await tx
    .select()
    .from(contractTypes)
    .where(
      and(eq(contractTypes.id, autoDoc.targetContractTypeId), isNull(contractTypes.archivedAt)),
    )
    .for("share");
  if (!type) throw httpError(409, "The target Contract Type is no longer available.");
  const attached = await selectAttachedFields(tx, contractTypeFields, type.id);
  const carried: Record<string, CustomFieldValue> = {};
  const attributes = new Map<string, CustomFieldValue>();
  for (const field of definition.fields) {
    const value = Object.hasOwn(answers, field.slug) ? answers[field.slug] : undefined;
    if (value === undefined) continue;
    if (field.catalogFieldId) {
      const target = attached.find((item) => item.fieldId === field.catalogFieldId);
      if (target) carried[target.slug] = value;
    } else if (field.contractAttribute) attributes.set(field.contractAttribute, value);
  }
  const { values: customFields } = await applyCustomFields(tx, attached, {}, carried);
  assertRequiredCustomFields(attached, customFields);
  const text = (attribute: string): string | null => {
    const value = attributes.get(attribute);
    if (value === undefined) return null;
    if (typeof value !== "string") throw httpError(400, `Map "${attribute}" from a text answer.`);
    return value.trim() || null;
  };
  const title = (
    autoDoc.titlePattern
      ? autoDoc.titlePattern.replace(titleTokens, (_token, raw: string) => {
          const slug = raw.trim();
          const value = Object.hasOwn(displayValues, slug)
            ? displayValues[slug]
            : Object.hasOwn(answers, slug)
              ? answers[slug]
              : undefined;
          return value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);
        })
      : (text("title") ?? autoDoc.name)
  ).trim();
  if (!title || title.length > MAX_CONTRACT_TITLE_LENGTH)
    throw httpError(
      400,
      `The generated Contract title must have 1 to ${MAX_CONTRACT_TITLE_LENGTH} characters.`,
    );
  const entityId = autoDoc.fixedEntityId ?? text("entity_id");
  const entityIds = new Set<string>(entityId ? [entityId] : []);
  for (const field of attached)
    if (field.fieldType === "entity" && typeof customFields[field.slug] === "string")
      entityIds.add(customFields[field.slug] as string);
  for (const id of entityIds) {
    const [entity] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, id), isNull(entities.archivedAt), generationEntityScope(tx, user)))
      .for("share");
    if (!entity) throw httpError(400, "Choose a live Entity you can access.");
  }
  if (
    user.role === "business_user" &&
    requestedBusinessOwnerId &&
    requestedBusinessOwnerId !== user.id
  )
    throw httpError(403, "Your generated Contract names you as Business Owner.");
  const businessOwnerId =
    user.role === "business_user" ? user.id : (requestedBusinessOwnerId ?? null);
  if (businessOwnerId) {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, businessOwnerId), isNull(users.archivedAt)))
      .for("share");
    if (!owner) throw httpError(400, "Choose a live person as Business Owner.");
  }
  const department = text("owning_department_id");
  let owningDepartmentId: string | null = null;
  if (department) {
    const [row] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          or(eq(departments.id, department), eq(departments.displayName, department)),
          isNull(departments.archivedAt),
        ),
      )
      .orderBy(desc(eq(departments.id, department)), asc(departments.id))
      .limit(1)
      .for("share");
    if (!row) throw httpError(400, "The Owning department answer must name a live Department.");
    owningDepartmentId = row.id;
  }
  const term = text("term_type") ?? "fixed";
  const termType = z.enum(TERM_TYPES).safeParse(term);
  if (!termType.success)
    throw httpError(400, "Choose fixed, auto_renew, or evergreen for the Contract term.");
  const date = (attribute: string) => {
    const value = text(attribute);
    if (value !== null && !z.iso.date().safeParse(value).success)
      throw httpError(400, `Give "${attribute}" a valid calendar date.`);
    return value;
  };
  const effectiveDate = date("effective_date");
  const expiryDate = date("expiry_date");
  if (termType.data === "evergreen" && expiryDate)
    throw httpError(400, "An evergreen Contract has no expiry date.");
  const counterparty = text("primary_counterparty_name");
  if (counterparty && !CounterpartyNameSchema.safeParse(counterparty).success)
    throw httpError(400, "The primary Counterparty name is too long.");
  let value: AutoDocContractSnapshot["value"] = null;
  if (attributes.has("value")) {
    const amount = attributes.get("value");
    const field = definition.fields.find((item) => item.contractAttribute === "value")!;
    const currency = CurrencySchema.parse(field.valueCurrency);
    const digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    const minor = typeof amount === "number" ? Math.round(amount * 10 ** digits) : Number.NaN;
    if (typeof amount !== "number" || amount < 0 || !Number.isSafeInteger(minor))
      throw httpError(
        400,
        "Give the Contract Value a nonnegative amount within the supported range.",
      );
    value = { amount: minor, currency, cadence: field.valueCadence! };
  }
  return {
    autoDocName: autoDoc.name,
    contractTypeId: type.id,
    title,
    entityId,
    businessOwnerId,
    legalOwnerId: await chooseLegalOwner(tx, autoDoc, definition, answers),
    owningDepartmentId,
    region: text("region"),
    primaryCounterpartyName: counterparty,
    customFields,
    value,
    effectiveDate,
    expiryDate,
    termType: termType.data,
  };
}
