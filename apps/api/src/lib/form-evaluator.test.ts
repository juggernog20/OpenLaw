// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  evaluateForm,
  formRowsForTouchpoint,
  formRowTouchpoint,
  recordFormRows,
  validateForm,
  type Form,
  type FormBranch,
  type FormCondition,
  type FormRow,
} from "@openlaw/shared";

const row = (rowRef: string, overrides: Partial<FormRow> = {}): FormRow => ({
  kind: "row",
  id: `row-${rowRef}`,
  rowRef,
  fieldType: "text",
  onIntakeForm: false,
  isRequired: false,
  visibleOnPortal: true,
  ...overrides,
});
const branch = (
  id: string,
  conditions: readonly FormCondition[],
  children: Form,
  match: "all" | "any" = "all",
): FormBranch => ({ kind: "branch", id, match, conditions, children });
const condition = (
  operator: FormCondition["operator"],
  value: FormCondition["value"] = null,
  rowRef = "source",
): FormCondition => ({ rowRef, operator, value });
const refs = (rows: readonly FormRow[]) => rows.map((row) => row.rowRef);
const conditionalForm = (rule: FormCondition, fieldType: FormRow["fieldType"] = "text"): Form => [
  row("source", { fieldType }),
  branch("conditional", [rule], [row("child", { isRequired: true, onIntakeForm: true })]),
];

// All assertions cross the shared package's public entry point.
describe("Form conditions", () => {
  it.each([
    ["equals", "yes", "yes", true],
    ["equals", "yes", "no", false],
    ["is_not", "yes", "no", true],
    ["is_not", "yes", "yes", false],
    ["is_one_of", ["yes", "maybe"], "maybe", true],
    ["is_one_of", ["yes", "maybe"], "no", false],
    ["is_set", null, "yes", true],
    ["is_set", null, "", false],
    ["greater_than", 10, 11, true],
    ["greater_than", 10, 10, false],
    ["less_than", 10, 9, true],
    ["less_than", 10, 10, false],
  ] as const)("%s %j with answer %j is %s", (operator, value, answer, shown) => {
    const form = conditionalForm(
      condition(operator, value),
      typeof answer === "number" ? "number" : "text",
    );
    expect(validateForm(form)).toEqual([]);
    expect(refs(evaluateForm(form, { source: answer }).visibleRows)).toEqual(
      shown ? ["source", "child"] : ["source"],
    );
  });

  for (const answer of [undefined, null, "", "   ", []]) {
    it.each(["equals", "is_not", "is_one_of", "is_set", "greater_than", "less_than"] as const)(
      `%s obeys the unanswered rule for ${JSON.stringify(answer)}`,
      (operator) => {
        const value = operator === "is_one_of" ? [0] : operator === "is_set" ? null : 0;
        const result = evaluateForm(conditionalForm(condition(operator, value), "number"), {
          source: answer,
        });
        expect(refs(result.enforcedRequiredRows)).toEqual(operator === "is_not" ? ["child"] : []);
      },
    );
  }

  it.each([false, 0])("treats %s as an answer", (answer) => {
    const form = conditionalForm(
      condition("is_set"),
      typeof answer === "boolean" ? "boolean" : "number",
    );
    expect(refs(evaluateForm(form, { source: answer }).visibleRows)).toContain("child");
  });

  it.each([
    ["equals", "UK", true],
    ["equals", "US", false],
    ["is_not", "UK", false],
    ["is_not", "US", true],
    ["is_one_of", ["US", "FR"], true],
    ["is_one_of", ["US", "DE"], false],
  ] as const)("%s tests membership for multi-select", (operator, value, shown) => {
    const form = conditionalForm(condition(operator, value), "multi_select");
    expect(refs(evaluateForm(form, { source: ["UK", "FR"] }).visibleRows).includes("child")).toBe(
      shown,
    );
  });

  it.each([
    ["greater_than", 10000, 10001, true],
    ["greater_than", 10000, 10000, false],
    ["less_than", 10000, 9999, true],
    ["less_than", 10000, 10000, false],
  ] as const)("%s compares money in minor units", (operator, value, amount, shown) => {
    const form = conditionalForm(condition(operator, value), "money");
    expect(validateForm(form)).toEqual([]);
    for (const source of [amount, { amount, currency: "GBP", cadence: "annual" }]) {
      expect(refs(evaluateForm(form, { source }).visibleRows).includes("child")).toBe(shown);
    }
  });

  it.each([
    ["greater_than", "2026-09-21", "2026-10-01", true],
    ["greater_than", "2026-09-21", "2026-09-21", false],
    ["less_than", "2026-09-21", "2025-12-31", true],
    ["less_than", "2026-09-21", "2026-09-21", false],
  ] as const)("%s compares ISO calendar dates", (operator, value, source, shown) => {
    const form = conditionalForm(condition(operator, value), "date");
    expect(validateForm(form)).toEqual([]);
    expect(refs(evaluateForm(form, { source }).visibleRows).includes("child")).toBe(shown);
  });

  it("does not coerce answers or read inherited properties", () => {
    expect(
      refs(evaluateForm(conditionalForm(condition("equals", 1)), { source: "1" }).visibleRows),
    ).toEqual(["source"]);
    const form: Form = [
      row("toString"),
      branch("inherited", [condition("is_set", null, "toString")], [row("child")]),
    ];
    expect(validateForm(form)).toEqual([]);
    expect(refs(evaluateForm(form, {}).visibleRows)).toEqual(["toString"]);
  });

  it("does not compare malformed number, money or date answers", () => {
    for (const [fieldType, value, source] of [
      ["number", 10, "11"],
      ["number", 10, Infinity],
      ["money", 100, { amount: 100.5, currency: "GBP" }],
      ["date", "2026-02-01", "2026-02-30"],
    ] as const) {
      expect(
        refs(
          evaluateForm(conditionalForm(condition("greater_than", value), fieldType), { source })
            .visibleRows,
        ),
      ).toEqual(["source"]);
    }
  });

  it("treats a money Row without an amount as unanswered", () => {
    for (const operator of [
      "equals",
      "is_not",
      "is_one_of",
      "is_set",
      "greater_than",
      "less_than",
    ] as const) {
      const value = operator === "is_set" ? null : operator === "is_one_of" ? [0] : 0;
      const form = conditionalForm(condition(operator, value), "money");
      const result = evaluateForm(form, { source: { amount: null, currency: "GBP" } });
      expect(refs(result.enforcedRequiredRows)).toEqual(operator === "is_not" ? ["child"] : []);
    }
  });
});

describe("Form tree and touchpoints", () => {
  const form: Form = [
    row("source"),
    branch(
      "outer",
      [condition("equals", "yes")],
      [
        row("first", { onIntakeForm: true, isRequired: true }),
        branch(
          "nested",
          [condition("is_set", null, "first")],
          [row("nested-child", { isRequired: true })],
        ),
      ],
    ),
    branch("sibling", [condition("equals", "no")], [row("sibling-child", { isRequired: true })]),
    row("last"),
  ];

  it.each([
    [
      { source: "yes", first: "set" },
      ["source", "first", "nested-child", "last"],
      ["first", "nested-child"],
    ],
    [{ source: "yes" }, ["source", "first", "last"], ["first"]],
    [{ source: "no", first: "set" }, ["source", "sibling-child", "last"], ["sibling-child"]],
    [{ source: "other", first: "set" }, ["source", "last"], []],
  ])("keeps nested AND and independent siblings in Form order", (answers, visible, required) => {
    expect(validateForm(form)).toEqual([]);
    const result = evaluateForm(form, answers as Record<string, unknown>);
    expect(refs(result.visibleRows)).toEqual(visible);
    expect(refs(result.enforcedRequiredRows)).toEqual(required);
  });

  it("shows both sibling Branches when each matches", () => {
    const form: Form = [
      row("source"),
      branch("one", [condition("equals", "yes")], [row("one")]),
      branch("two", [condition("is_set")], [row("two")]),
    ];
    expect(refs(evaluateForm(form, { source: "yes" }).visibleRows)).toEqual([
      "source",
      "one",
      "two",
    ]);
  });

  it("distinguishes match all and any for mixed conditions", () => {
    const rules = [condition("equals", "yes"), condition("equals", "no")];
    const form: Form = [
      row("source"),
      branch("all", rules, [row("all")]),
      branch("any", rules, [row("any")], "any"),
    ];
    expect(refs(evaluateForm(form, { source: "yes" }).visibleRows)).toEqual(["source", "any"]);
  });

  it("restores hidden stored values only for record visibility, in Form order", () => {
    const answers = { source: "no", first: "stored", "nested-child": 0 };
    expect(refs(recordFormRows(form, answers))).toEqual([
      "source",
      "first",
      "nested-child",
      "sibling-child",
      "last",
    ]);
    expect(refs(evaluateForm(form, answers).enforcedRequiredRows)).toEqual(["sibling-child"]);
    expect(answers.first).toBe("stored");
  });

  it.each([null, "", "  ", [], { amount: null, currency: "GBP" }])(
    "does not restore a hidden empty value %j",
    (value) => {
      const form = conditionalForm(condition("equals", "yes"));
      expect(refs(recordFormRows(form, { source: "no", child: value }))).toEqual(["source"]);
    },
  );

  it.each([
    [false, false, "record"],
    [false, true, "creation"],
    [true, false, "intake"],
    [true, true, "intake"],
  ] as const)("derives intake=%s required=%s as %s", (onIntakeForm, isRequired, expected) => {
    for (const visibleOnPortal of [false, true]) {
      expect(formRowTouchpoint(row("field", { onIntakeForm, isRequired, visibleOnPortal }))).toBe(
        expected,
      );
    }
  });

  it("collects Intake, Intake plus Creation, and all Rows in their original order", () => {
    const rows = [
      row("record"),
      row("intake", { onIntakeForm: true }),
      row("creation", { isRequired: true }),
      row("required-intake", { onIntakeForm: true, isRequired: true }),
    ];
    expect(refs(formRowsForTouchpoint(rows, "intake"))).toEqual(["intake", "required-intake"]);
    expect(refs(formRowsForTouchpoint(rows, "creation"))).toEqual([
      "intake",
      "creation",
      "required-intake",
    ]);
    expect(refs(formRowsForTouchpoint(rows, "record"))).toEqual(refs(rows));
    const entityRow = row("entity-required", { isRequired: true });
    delete entityRow.onIntakeForm;
    expect(formRowTouchpoint(entityRow)).toBe("creation");
  });

  it("returns empty results for an empty Form", () => {
    expect(evaluateForm([], {})).toEqual({ visibleRows: [], enforcedRequiredRows: [] });
    expect(recordFormRows([], {})).toEqual([]);
    expect(validateForm([])).toEqual([]);
  });

  describe("a hidden Row is unanswered for every later Branch", () => {
    const form: Form = [
      row("source"),
      branch("hidden", [condition("equals", "yes")], [row("stored", { isRequired: true })]),
      branch(
        "later",
        [condition("equals", "kept", "stored")],
        [row("dependent", { onIntakeForm: true, isRequired: true })],
      ),
    ];

    it("opens the later Branch only while the stored Row is shown", () => {
      expect(refs(evaluateForm(form, { source: "yes", stored: "kept" }).visibleRows)).toEqual([
        "source",
        "stored",
        "dependent",
      ]);
      const answers = Object.freeze({ source: "no", stored: "kept" });
      const before = JSON.stringify(form);
      const result = evaluateForm(form, answers);
      expect(refs(result.visibleRows)).toEqual(["source"]);
      expect(refs(result.enforcedRequiredRows)).toEqual([]);
      expect(JSON.stringify(form)).toBe(before);
      expect(answers.stored).toBe("kept");
    });

    it("keeps the record page on the same rule, drawing hidden Rows that hold a value", () => {
      expect(refs(recordFormRows(form, { source: "no", stored: "kept" }))).toEqual([
        "source",
        "stored",
      ]);
      expect(refs(recordFormRows(form, { source: "no", stored: "kept", dependent: "x" }))).toEqual([
        "source",
        "stored",
        "dependent",
      ]);
    });
  });
});

describe("Form validation", () => {
  it.each([
    ["later", "forward_reference"],
    ["bad-branch", "self_reference"],
    ["child", "self_reference"],
    ["missing", "unknown_row"],
  ] as const)("refuses %s and names the offending Branch", (rowRef, code) => {
    const form: Form = [
      branch("bad-branch", [condition("is_set", null, rowRef)], [row("child")]),
      row("later"),
    ];
    expect(validateForm(form)).toEqual([
      expect.objectContaining({
        nodeId: "bad-branch",
        conditionIndex: 0,
        rowRef,
        code,
        message: expect.stringContaining("bad-branch"),
      }),
    ]);
  });

  it.each([
    "text",
    "long_text",
    "currency",
    "boolean",
    "single_select",
    "multi_select",
    "user",
    "entity",
  ] as const)("refuses ordered comparisons on %s", (fieldType) => {
    for (const operator of ["greater_than", "less_than"] as const) {
      expect(validateForm(conditionalForm(condition(operator, 10), fieldType))).toEqual([
        expect.objectContaining({
          nodeId: "conditional",
          code: "invalid_operator",
          rowRef: "source",
        }),
      ]);
    }
  });

  it("accepts preceding Rows inside an earlier sibling Branch", () => {
    const form: Form = [
      row("source"),
      branch("one", [condition("is_set")], [row("earlier")]),
      branch("two", [condition("is_set", null, "earlier")], []),
    ];
    expect(validateForm(form)).toEqual([]);
  });

  it.each([
    ["is_one_of", "one", "text"],
    ["is_one_of", [], "text"],
    ["equals", ["one"], "text"],
    ["is_set", true, "text"],
    ["greater_than", "10", "number"],
    ["greater_than", 1.5, "money"],
    ["less_than", "2026-02-30", "date"],
  ] as const)("refuses an invalid %s operand", (operator, value, fieldType) => {
    expect(validateForm(conditionalForm(condition(operator, value), fieldType))).toEqual([
      expect.objectContaining({ nodeId: "conditional", code: "invalid_value" }),
    ]);
  });
});
