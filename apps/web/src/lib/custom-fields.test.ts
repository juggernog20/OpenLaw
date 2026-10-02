// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { commitsOnChange, type AttachedField, type CustomFieldType } from "./custom-fields";

function field(fieldType: CustomFieldType): AttachedField {
  return {
    fieldId: "f1",
    slug: "f1",
    displayName: "Field",
    description: null,
    fieldType,
    options: null,
    displayOrder: 0,
    isRequired: false,
  } as AttachedField;
}

describe("commitsOnChange", () => {
  it("commits a pick at once, a date from the calendar included", () => {
    for (const type of [
      "boolean",
      "currency",
      "date",
      "single_select",
      "multi_select",
      "user",
      "entity",
    ] as const) {
      expect(commitsOnChange(field(type))).toBe(true);
    }
  });

  it("leaves typed boxes to commit on blur", () => {
    for (const type of ["text", "long_text", "number"] as const) {
      expect(commitsOnChange(field(type))).toBe(false);
    }
  });
});
