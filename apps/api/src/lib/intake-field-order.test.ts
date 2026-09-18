// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { INTAKE_BASIC_FIELD_KEYS, resolveIntakeFieldOrder } from "@openlaw/shared";

it("preserves the existing form order until one is saved", () => {
  expect(resolveIntakeFieldOrder(["field-a", "field-b"])).toEqual([
    ...INTAKE_BASIC_FIELD_KEYS,
    "field-a",
    "field-b",
  ]);
});

it("retains interleaved defaults, omits detached fields, and appends new fields once", () => {
  expect(
    resolveIntakeFieldOrder(
      ["field-a", "field-new"],
      [
        "field-a",
        "basic:urgency",
        "detached",
        "field-a",
        "basic:title",
        "basic:description",
        "basic:department",
        "basic:attachments",
      ],
    ),
  ).toEqual([
    "field-a",
    "basic:urgency",
    "basic:title",
    "basic:description",
    "basic:department",
    "basic:attachments",
    "field-new",
  ]);
});
