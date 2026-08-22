// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The custom-field value machinery (CTR-016, MTR-014): what a stored
 * value may be, which fields a record renders, and the hard-required
 * rule that closes the M6 `is_required` stub. Written once here because
 * matters (M22) mount the same catalog through the same attachment join
 * — `type-field-routes.ts` is the settings half of the pair, this is the
 * record half.
 *
 * Two rules govern everything below.
 *
 * **Values are keyed by slug.** The slug is the field's machine
 * identity and never changes, so a value outlives every rename — and it
 * outlives detachment, which is the point: detaching a field from a
 * type deletes the join row only, and re-attaching brings the value
 * back. Nothing here ever deletes a value it was not asked to clear.
 *
 * **The attachment join decides what renders.** A record's fields are
 * the live attachments of its type, in `display_order`. Values under
 * slugs the type does not attach are held, not shown, and not checked.
 *
 * The hard-required check has exactly one entry point,
 * `assertRequiredCustomFields`, so the paths that must skip it are
 * visible as the ones that do not call it. Two do:
 *
 * - **A system reassignment** — the SET-003 archive guard moving every
 *   contract off a type an Administrator is archiving. That is not a
 *   re-type a person chose, and refusing it would strand records on an
 *   archived type; it moves the rows and leaves the gaps to be filled
 *   on the record.
 * - **An ordinary edit of some other field.** A record can hold a gap
 *   — a field made required after the record was created has one — and
 *   editing its title must not be refused because of it.
 *
 * The write itself has one entry point too, `applyCustomFields`. Both
 * the create and the per-field PATCH go through it, so the refusals a
 * caller sees — a slug the type does not attach, a value the field type
 * will not take, an archived person or Entity — cannot depend on which
 * route it arrived at.
 */

import { z } from "zod";
import {
  and,
  asc,
  entities,
  eq,
  fields,
  FIELD_TYPES,
  isNull,
  users,
  type CustomFieldValue,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { httpError } from "./problem.js";
import type { TypeFieldsTable } from "./type-field-routes.js";

/**
 * One stored value, in the four shapes the nine field types reduce to.
 * `date` is an ISO calendar date and `user`/`entity` are the referenced
 * row's id, so both are strings; only `number`, `boolean`, and
 * `multi_select` need shapes of their own.
 */
export const CustomFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

/** A record's custom fields as every read answers them: slug → value,
 * with absent meaning empty. `{}` is where every record starts. */
export const CustomFieldsSchema = z.record(z.string(), CustomFieldValueSchema);

/**
 * A record's custom fields on the way in: a partial map, so one commit
 * carries one field (DES-017). `null` clears a value — the key leaves
 * the stored object rather than sitting there holding a null, because
 * two ways to say "nothing recorded" is one too many.
 */
export const CustomFieldsInput = z.record(z.string(), CustomFieldValueSchema.nullable());

/**
 * One attached field as a record surface reads it: the catalog's
 * definition plus what the attachment says about it here. `options` and
 * `description` ride along because the record draws the control, not
 * just the value — a select with no options is not a control.
 */
export const AttachedCustomFieldSchema = z.object({
  fieldId: z.string(),
  /** What the value is keyed by, here and in the jsonb column. */
  slug: z.string(),
  displayName: z.string(),
  /** Help text under the control; null = the field renders without it. */
  description: z.string().nullable(),
  fieldType: z.enum(FIELD_TYPES),
  /** The select types' option labels, in order; null on the other seven. */
  options: z.array(z.string()).nullable(),
  /** The per-type form order, 1-based — the order the record renders. */
  displayOrder: z.number().int(),
  /** MTR-014, hard-enforced from this milestone on. */
  isRequired: z.boolean(),
});

export type AttachedCustomField = z.infer<typeof AttachedCustomFieldSchema>;

/**
 * One type's attached fields, in the order the record renders them.
 * Attachments to archived fields are left out: archived means hidden
 * everywhere, and their values are retained by the same rule that
 * retains a detached field's.
 */
export async function selectAttachedFields(
  db: Executor,
  joinTable: TypeFieldsTable,
  typeId: string,
): Promise<AttachedCustomField[]> {
  const rows = await db
    .select({
      fieldId: fields.id,
      slug: fields.slug,
      displayName: fields.displayName,
      description: fields.description,
      fieldType: fields.fieldType,
      options: fields.options,
      displayOrder: joinTable.displayOrder,
      isRequired: joinTable.isRequired,
    })
    .from(joinTable)
    .innerJoin(fields, eq(joinTable.fieldId, fields.id))
    .where(and(eq(joinTable.typeId, typeId), isNull(fields.archivedAt)))
    .orderBy(asc(joinTable.displayOrder), asc(joinTable.createdAt));
  return rows.map((row) => ({ ...row, options: row.options ?? null }));
}

/**
 * Whether a value counts as recorded. Only two things are empty: an
 * absent key, and — for the shapes that can be blank — an empty string
 * or an empty list. `false` and `0` are answers, not gaps: a boolean
 * field asked "is this auto-renewing?" and got told no.
 */
export function hasCustomFieldValue(value: CustomFieldValue | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * MTR-014's hard-required rule, as the one refusal every user-driven
 * path shares: a record cannot be created on a type, or re-typed onto
 * one, while a field that type marks required has no value.
 *
 * Deliberately not called by the SET-003 archive guard's bulk
 * reassignment (#113) — see this module's header. That path moves rows
 * a system decision moved, and a refusal there would strand them.
 */
export function assertRequiredCustomFields(
  attached: readonly AttachedCustomField[],
  values: Readonly<Record<string, CustomFieldValue>>,
): void {
  const missing = attached.filter(
    (field) => field.isRequired && !hasCustomFieldValue(values[field.slug]),
  );
  if (missing.length === 0) return;
  // The refusal names the fields rather than counting them: a person
  // who has to fill something in needs to know which something.
  const names = listNames(missing.map((field) => field.displayName));
  throw httpError(
    400,
    `Fill ${names} first — the type requires ${missing.length === 1 ? "it" : "them"}.`,
  );
}

/** "A", "A and B", "A, B, and C" — the refusal reads as a sentence.
 * Exported for the refusals that name basics and attached fields in
 * one list (the Request submission), so every missing-field sentence
 * reads the same. */
export function listNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/**
 * One incoming value, checked against its field's type and reduced to
 * the stored shape — or `null`, which means clear the key.
 *
 * Every type is checked here except the two that name a row: `user` and
 * `entity` reduce to an id, and whether that id is a live person or a
 * live Entity is the record module's question, since it is the module
 * that knows which registries it may point into.
 */
export function coerceCustomFieldValue(
  field: AttachedCustomField,
  raw: CustomFieldValue | null,
): CustomFieldValue | null {
  const refuse = (detail: string): never => {
    throw httpError(400, `${field.displayName}: ${detail}`);
  };
  if (raw === null) return null;

  switch (field.fieldType) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string") return refuse("give this a text value.");
      const text = raw.trim();
      // A blank box is how a text field is cleared — the same normal
      // form `description` already uses, so readers test one absence.
      if (text === "") return null;
      if (text.length > (field.fieldType === "text" ? 500 : 10_000)) {
        return refuse("that is longer than this field holds.");
      }
      return text;
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return refuse("give this a number.");
      return raw;
    }
    case "date": {
      if (typeof raw !== "string") return refuse("give this a date.");
      const date = raw.trim();
      if (date === "") return null;
      // A calendar date, not an instant: a governing-law deadline is
      // the same day in every timezone that reads it.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        return refuse("give this a date as YYYY-MM-DD.");
      }
      return date;
    }
    case "boolean": {
      if (typeof raw !== "boolean") return refuse("answer this yes or no.");
      return raw;
    }
    case "single_select": {
      if (typeof raw !== "string") return refuse("pick one of the options.");
      const choice = raw.trim();
      if (choice === "") return null;
      if (!field.options?.includes(choice)) return refuse("pick one of the options.");
      return choice;
    }
    case "multi_select": {
      if (!Array.isArray(raw)) return refuse("pick from the options.");
      if (raw.length === 0) return null;
      if (new Set(raw).size !== raw.length) return refuse("pick each option once.");
      if (raw.some((choice) => !field.options?.includes(choice))) {
        return refuse("pick from the options.");
      }
      // Stored in the catalog's own order, so two records that hold the
      // same set read the same on every surface.
      return field.options!.filter((option) => raw.includes(option));
    }
    case "user":
    case "entity": {
      if (typeof raw !== "string") return refuse("pick one from the list.");
      const id = raw.trim();
      return id === "" ? null : id;
    }
  }
}

/** One custom-field value equals another when it reads the same. The
 * multi-select is the only shape that is not a primitive, and it is
 * stored in the catalog's own option order, so comparing position by
 * position is comparing the set. */
function sameCustomFieldValue(
  left: CustomFieldValue | undefined,
  right: CustomFieldValue,
): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

/**
 * The two field types that name a row: `user` and `entity` store an
 * id, so the write checks the id is a live one. Archived is refused
 * for the same reason the Owner and the signing entity refuse it —
 * nothing new gets pointed at someone who has left. A row archived
 * after the fact stays on the record untouched.
 *
 * Anyone live satisfies a `user` field: a custom person field is not
 * the Owner, so it is not held to the Member+ floor the Owner is
 * (CTR-004). The lock stops a concurrent archive slipping between the
 * check and the write.
 */
async function lockedReference(tx: Transaction, field: AttachedCustomField, id: string) {
  if (field.fieldType === "user") {
    const [person] = await tx
      .select({ archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for("update");
    return !person || person.archivedAt ? `${field.displayName}: pick a live person.` : null;
  }
  const [signatory] = await tx
    .select({ archivedAt: entities.archivedAt })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1)
    .for("update");
  return !signatory || signatory.archivedAt ? `${field.displayName}: pick a live entity.` : null;
}

/**
 * Applies a partial custom-field map onto the stored one and answers
 * the result, plus the DD-017 changed entries the write should log.
 *
 * Three rules hold here. A key the map does not carry is untouched —
 * that is what makes one PATCH one field (DES-017). A `null` clears
 * the key rather than storing one, so "nothing recorded" has one
 * shape. And a slug the type does not attach is refused, because
 * writing under it would put a value on a record no surface could
 * ever show or clear.
 *
 * Creation passes `{}` as the stored map, which is the same rule read
 * at birth: every incoming slug is a change, and none of them can be a
 * clear. That is why the create and the per-field PATCH share this
 * rather than each stating it — the refusals a caller sees must not
 * depend on which of the two it went through.
 */
export async function applyCustomFields(
  tx: Transaction,
  attached: readonly AttachedCustomField[],
  stored: Readonly<Record<string, CustomFieldValue>>,
  incoming: Readonly<Record<string, CustomFieldValue | null>>,
) {
  const next: Record<string, CustomFieldValue> = { ...stored };
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const prepared = Object.entries(incoming).map(([slug, raw]) => {
    const field = attached.find((candidate) => candidate.slug === slug);
    if (!field) {
      throw httpError(400, "That field is not on this contract's type.");
    }
    const value = coerceCustomFieldValue(field, raw);
    return { slug, field, value };
  });

  // Validation above keeps caller-order refusal precedence. Locks are a
  // separate pass in table-and-row order, so two writes naming the same rows can
  // never take them in opposite orders (#425). Liveness refusals are
  // held until every reference lock is acquired, then read below in the
  // caller's order with the changed-entry map.
  const referenceRefusals = new Map<string, string>();
  const references = prepared.toSorted((left, right) => {
    const leftKey = `${left.field.fieldType}\0${String(left.value)}\0${left.slug}`;
    const rightKey = `${right.field.fieldType}\0${String(right.value)}\0${right.slug}`;
    return leftKey.localeCompare(rightKey);
  });
  for (const { slug, field, value } of references) {
    if (typeof value !== "string" || (field.fieldType !== "user" && field.fieldType !== "entity")) {
      continue;
    }
    const refusal = await lockedReference(tx, field, value);
    if (refusal) referenceRefusals.set(slug, refusal);
  }

  for (const { slug, value } of prepared) {
    const refusal = referenceRefusals.get(slug);
    if (refusal) throw httpError(400, refusal);
    const before = stored[slug];
    if (value === null) {
      if (before === undefined) continue;
      delete next[slug];
    } else {
      if (sameCustomFieldValue(before, value)) continue;
      next[slug] = value;
    }
    // Namespaced by slug: a custom field named "Title" and the
    // record's own title are two different things, and the audit map
    // must not let them collide. The M9 viewer resolves the slug to
    // the field's display name from the catalog.
    changed[`field.${slug}`] = { from: before ?? null, to: value };
  }
  return { values: next, changed };
}
