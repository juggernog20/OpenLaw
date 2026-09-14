// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 compares saved definitions without changing either snapshot. */
import type { AutoDocFormDefinition, AutoDocFormField } from "@openlaw/db";
import { z } from "zod";

export const FormChange = z.object({
  kind: z.enum([
    "added",
    "removed",
    "retyped",
    "relabelled",
    "reordered",
    "edited",
    "mapped",
    "rules_changed",
  ]),
  name: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
type Change = z.infer<typeof FormChange>;
const mapOf = (field: AutoDocFormField) =>
  field.contractAttribute === "value"
    ? JSON.stringify({
        attribute: "value",
        currency: field.valueCurrency ?? null,
        cadence: field.valueCadence ?? null,
      })
    : (field.catalogFieldId ?? field.contractAttribute ?? null);

export function diffForms(before: AutoDocFormDefinition, after: AutoDocFormDefinition): Change[] {
  const changes: Change[] = [];
  const old = new Map(before.fields.map((field) => [field.slug, field]));
  const current = new Map(after.fields.map((field) => [field.slug, field]));
  for (const field of before.fields)
    if (!current.has(field.slug))
      changes.push({ kind: "removed", name: field.slug, before: field.label, after: null });
  for (const field of after.fields) {
    const prior = old.get(field.slug);
    if (!prior) {
      changes.push({ kind: "added", name: field.slug, before: null, after: field.label });
      continue;
    }
    for (const [key, kind] of [
      ["fieldType", "retyped"],
      ["label", "relabelled"],
      ["displayOrder", "reordered"],
    ] as const)
      if (prior[key] !== field[key])
        changes.push({
          kind,
          name: field.slug,
          before: String(key === "displayOrder" ? prior[key] + 1 : prior[key]),
          after: String(key === "displayOrder" ? field[key] + 1 : field[key]),
        });
    if (mapOf(prior) !== mapOf(field))
      changes.push({ kind: "mapped", name: field.slug, before: mapOf(prior), after: mapOf(field) });
    const details = (row: AutoDocFormField) =>
      JSON.stringify({ help: row.help, required: row.required, options: row.options });
    if (details(prior) !== details(field))
      changes.push({
        kind: "edited",
        name: field.slug,
        before: details(prior),
        after: details(field),
      });
  }
  const oldRules = new Map((before.clauseRules ?? []).map((rule) => [rule.blockName, rule]));
  const rules = new Map((after.clauseRules ?? []).map((rule) => [rule.blockName, rule]));
  for (const name of new Set([...oldRules.keys(), ...rules.keys()])) {
    const prior = JSON.stringify(oldRules.get(name)) ?? null;
    const next = JSON.stringify(rules.get(name)) ?? null;
    if (prior !== next) changes.push({ kind: "rules_changed", name, before: prior, after: next });
  }
  return changes;
}
