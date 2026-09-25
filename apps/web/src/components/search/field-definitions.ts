// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The live Field catalogue for search conditions (CTR-016), read from
 * `GET /api/v1/search/fields` once a kind that carries Fields is
 * selected. `dropUnavailableFields` is the drop rule: a condition on a
 * Field the catalogue no longer lists is removed and announced, and the
 * rest of the question stands (DD-019 clause 7).
 */

import { useEffect, useEffectEvent, useState } from "react";
import { fieldProperty, type SearchField, type SearchQuestion } from "@openlaw/shared";
import { defineMessages, useIntl } from "react-intl";
import { currencyOptions } from "../../lib/format";
import { api } from "../../lib/api";

export const FIELD_NOTICES = defineMessages({
  removed: {
    id: "search.fields.removed",
    defaultMessage: "Unavailable Field conditions were removed.",
  },
  error: { id: "search.fields.error", defaultMessage: "Search Fields could not load. Try again." },
});
export function dropUnavailableFields(
  question: SearchQuestion,
  fields: readonly SearchField[],
): SearchQuestion {
  const conditions = question.conditions.filter(
    (condition) =>
      !condition.property.startsWith("field:") ||
      fields.some(
        (field) =>
          field.moduleScope === condition.kind && `field:${field.slug}` === condition.property,
      ),
  );
  return conditions.length === question.conditions.length ? question : { ...question, conditions };
}
export async function readSearchFields() {
  const result = await api.GET("/api/v1/search/fields");
  return result.data ?? null;
}
export function useSearchFields(enabled: boolean, onLoad?: (fields: SearchField[]) => void) {
  const intl = useIntl();
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof readSearchFields>>>(null);
  const [error, setError] = useState<string | null>(null);
  const notifyLoaded = useEffectEvent((fields: SearchField[]) => onLoad?.(fields));
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void readSearchFields()
      .then((result) => {
        if (!live) return;
        setLoaded(result);
        setError(result ? null : intl.formatMessage(FIELD_NOTICES.error));
        if (result) notifyLoaded(result.fields);
      })
      .catch(() => {
        if (live) setError(intl.formatMessage(FIELD_NOTICES.error));
      });
    return () => {
      live = false;
    };
  }, [enabled, intl]);
  return {
    fields: loaded?.fields ?? [],
    ready: !enabled || loaded !== null,
    error,
    properties: loaded?.fields.map(fieldProperty) ?? [],
    choices: (kind: string, property: string) => {
      const field = loaded?.fields.find(
        (field) => field.moduleScope === kind && `field:${field.slug}` === property,
      );
      if (field?.fieldType === "currency")
        return currencyOptions({ locale: intl.locale }).map((option) => ({
          id: option.code,
          displayName: `${option.code} · ${option.displayName}`,
        }));
      if (field?.fieldType === "user")
        return [
          {
            id: "me",
            displayName: intl.formatMessage({ id: "recordFilters.me", defaultMessage: "Me" }),
          },
          ...(loaded?.people ?? []),
        ];
      if (field?.fieldType === "entity") return loaded?.entities ?? [];
      return (field?.options ?? []).map((id) => ({ id, displayName: id }));
    },
  };
}
