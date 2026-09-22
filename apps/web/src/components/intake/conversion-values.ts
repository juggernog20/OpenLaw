// SPDX-License-Identifier: AGPL-3.0-only

/** INT-002 / DD-028 maps Request answers into conversion controls and back to
 * Row keys, using built-in keys. */

import type { CustomFieldValue } from "../../lib/custom-fields";
import type { StaffRequest, StaffRequestFieldRefs } from "../../lib/requests";
import { creationKeys, type CreationValues } from "../type-form/creation-rows";

/** Prefill native controls from Row answers. */
export function conversionValues(
  request: StaffRequest,
  refs: StaffRequestFieldRefs,
): CreationValues {
  const answers = request.customFields;
  const native: Record<string, unknown> = {
    owningDepartmentId: request.departmentId,
    departmentId: request.departmentId,
  };
  for (const [key, prop] of Object.entries(creationKeys))
    if (answers[key] !== undefined) native[prop] = answers[key];
  const parties = native.counterparties;
  native.counterparties = (
    Array.isArray(parties)
      ? parties
      : typeof parties === "string"
        ? parties.split(/\r?\n/).filter(Boolean)
        : []
  ).map((value: string) => (refs.builtins?.[value] ? { counterpartyId: value } : { name: value }));
  if (request.intakeCounterparties?.length)
    native.counterparties = request.intakeCounterparties.map((party) =>
      party.counterpartyId ? { counterpartyId: party.counterpartyId } : { name: party.name },
    );
  if (typeof answers.region === "string") {
    native.regionId = answers.region;
    native.region = refs.builtins?.[answers.region] ?? answers.region;
  }
  if (answers.value_amount !== undefined)
    native.value = {
      amount: answers.value_amount,
      currency: answers.value_currency,
      cadence: answers.value_cadence,
    };
  return native as CreationValues;
}

export function conversionRowAnswers(
  native: CreationValues,
): Record<string, CustomFieldValue | null> {
  const answers: Record<string, CustomFieldValue | null> = {};
  for (const [ref, key] of Object.entries(creationKeys)) {
    const value = native[key];
    if (value !== undefined && key !== "counterparties" && key !== "value")
      answers[ref] = value as CustomFieldValue | null;
  }
  if (native.regionId !== undefined) answers.region = native.regionId;
  if (native.value !== undefined) {
    answers.value_amount = native.value?.amount ?? null;
    answers.value_currency = native.value?.currency ?? null;
    answers.value_cadence = native.value?.cadence ?? null;
  }
  return answers;
}
