// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-009: reconcile saved Generation answers with the current published Auto-Doc form. */
import type { Draft } from "../components/auto-docs/form-control";
import type { AutoDocGeneration } from "./auto-docs";

type PreviousForm = {
  fields: { slug: string; label: string; fieldType: string }[];
  entities: { id: string; name: string }[];
};
type CurrentForm = Omit<PreviousForm, "fields"> & {
  fields: (PreviousForm["fields"][number] & { options: string[] | null })[];
};
export type PreviousAnswer = { label: string; value: string };
export function toDraft(answers: Record<string, unknown> | undefined): Draft {
  return Object.fromEntries(
    Object.entries(answers ?? {}).map(([slug, value]) => [
      slug,
      Array.isArray(value) ? value.map(String) : String(value ?? ""),
    ]),
  );
}
export function previousGenerationForm(
  generation: AutoDocGeneration | undefined,
): PreviousForm | null {
  if (!generation) return null;
  return {
    fields: generation.answerFields ?? [],
    entities: (generation.answerFields ?? [])
      .filter((field) => field.fieldType === "entity")
      .flatMap((field) => {
        const id = generation.answers[field.slug];
        const name = generation.displayValues?.[field.slug];
        return typeof id === "string" && name ? [{ id, name }] : [];
      }),
  };
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Reconcile before rendering: an unrepresentable value must never submit as a different answer. */
export function reconcile(draft: Draft, previous: PreviousForm | null, current: CurrentForm) {
  const retained = { ...draft };
  const dropped: PreviousAnswer[] = [];
  for (const [slug, value] of Object.entries(draft)) {
    const old = previous?.fields.find((field) => field.slug === slug);
    const field = current.fields.find((field) => field.slug === slug);
    const choices = Array.isArray(value) ? value : [value];
    const compatible =
      field &&
      (previous === null || old?.fieldType === field.fieldType) &&
      (field.fieldType === "multi_select" ? Array.isArray(value) : !Array.isArray(value)) &&
      (!["single_select", "multi_select"].includes(field.fieldType) ||
        choices.every((choice) => !choice || field.options?.includes(choice))) &&
      (field.fieldType !== "entity" ||
        !value ||
        current.entities.some((entity) => entity.id === value)) &&
      (field.fieldType !== "boolean" || value === "" || value === "true" || value === "false") &&
      (!["number", "currency"].includes(field.fieldType) ||
        value === "" ||
        (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))) &&
      (field.fieldType !== "date" ||
        value === "" ||
        (typeof value === "string" && validDate(value)));
    if (compatible) continue;
    delete retained[slug];
    if (choices.some(Boolean))
      dropped.push({
        label: old?.label ?? field?.label ?? slug,
        value:
          (old ?? field)?.fieldType === "entity"
            ? (previous?.entities.find((entity) => entity.id === value)?.name ??
              current.entities.find((entity) => entity.id === value)?.name ??
              "")
            : choices.join(", "),
      });
  }
  return { retained, dropped };
}
