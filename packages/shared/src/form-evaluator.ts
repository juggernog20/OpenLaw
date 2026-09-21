// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-028's Form evaluation, record visibility, touchpoints and Branch validation.
 * These functions perform no I/O and do not mutate the Form or its answers.
 */

/** DD-028. Array order is document order; rowRef is a built-in key or Field slug. */
export type Form = readonly FormNode[];
export type FormNode = FormRow | FormBranch;
export type FormRowType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "currency"
  | "date"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "user"
  | "entity";

export interface FormRow {
  kind: "row";
  id: string;
  rowRef: string;
  fieldType: FormRowType;
  /** Absent on Entity Forms. */
  onIntakeForm?: boolean;
  isRequired: boolean;
  visibleOnPortal: boolean;
}

export interface FormBranch {
  kind: "branch";
  id: string;
  match: "all" | "any";
  conditions: readonly FormCondition[];
  children: Form;
}

export type FormOperator =
  "equals" | "is_not" | "is_one_of" | "is_set" | "greater_than" | "less_than";
export type FormScalar = string | number | boolean;
export interface FormCondition {
  rowRef: string;
  operator: FormOperator;
  /** is_set takes null; is_one_of takes a list; other operators take one scalar. */
  value: FormScalar | readonly FormScalar[] | null;
}

/** Money answers are minor-unit integers or { amount, currency, cadence } objects.
 * Conditions compare their amount only. Currency Fields hold codes, not amounts.
 * Date answers and operands are ISO calendar dates, YYYY-MM-DD.
 */
export type FormAnswers = Readonly<Record<string, unknown>>;
export type FormTouchpoint = "intake" | "creation" | "record";
export interface FormEvaluation {
  visibleRows: FormRow[];
  enforcedRequiredRows: FormRow[];
}

export function formRowTouchpoint(row: FormRow): FormTouchpoint {
  return row.onIntakeForm ? "intake" : row.isRequired ? "creation" : "record";
}

/** Apply to evaluated Rows for collection, or to all Rows when preparing AI targets. */
export function formRowsForTouchpoint(
  rows: readonly FormRow[],
  touchpoint: FormTouchpoint,
): FormRow[] {
  return rows.filter((row) => {
    const first = formRowTouchpoint(row);
    return (
      touchpoint === "record" ||
      first === "intake" ||
      (touchpoint === "creation" && first === "creation")
    );
  });
}

function answerFor(answers: FormAnswers, rowRef: string): unknown {
  return Object.hasOwn(answers, rowRef) ? answers[rowRef] : undefined;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && "amount" in value) return hasValue(value.amount);
  return true;
}

function moneyAmount(value: unknown): unknown {
  return typeof value === "object" && value !== null && "amount" in value ? value.amount : value;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function comparable(value: unknown, type: FormRowType): number | string | undefined {
  if (type === "date") return isDate(value) ? value : undefined;
  if (type === "money") {
    const amount = moneyAmount(value);
    return typeof amount === "number" && Number.isSafeInteger(amount) ? amount : undefined;
  }
  return type === "number" && typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function matches(
  condition: FormCondition,
  row: FormRow | undefined,
  answers: FormAnswers,
): boolean {
  const answer = answerFor(answers, condition.rowRef);
  if (!hasValue(answer)) return condition.operator === "is_not";
  if (condition.operator === "is_set") return true;
  if (!row) return false;
  if (condition.operator === "greater_than" || condition.operator === "less_than") {
    const left = comparable(answer, row.fieldType);
    const right = comparable(condition.value, row.fieldType);
    if (left === undefined || right === undefined) return false;
    return condition.operator === "greater_than" ? left > right : left < right;
  }
  const actual = row.fieldType === "money" ? moneyAmount(answer) : answer;
  const values = row.fieldType === "multi_select" && Array.isArray(actual) ? actual : [actual];
  const expected =
    condition.operator === "is_one_of" && Array.isArray(condition.value)
      ? condition.value
      : [condition.value];
  const equal = values.some((value) => expected.some((candidate) => candidate === value));
  return condition.operator === "is_not" ? !equal : equal;
}

/** Visit hidden Rows too: stored answers remain available to later Branches. */
function visitForm(
  form: Form,
  answers: FormAnswers,
  visit: (row: FormRow, visible: boolean) => void,
): void {
  const precedingRows = new Map<string, FormRow>();
  function walk(nodes: Form, parentVisible: boolean): void {
    for (const node of nodes) {
      if (node.kind === "row") {
        precedingRows.set(node.rowRef, node);
        visit(node, parentVisible);
      } else {
        const test = (condition: FormCondition) =>
          matches(condition, precedingRows.get(condition.rowRef), answers);
        const visible =
          parentVisible &&
          (node.match === "all" ? node.conditions.every(test) : node.conditions.some(test));
        walk(node.children, visible);
      }
    }
  }
  walk(form, true);
}

/** Evaluate a validated Form. Callers select the touchpoint from both returned sets.
 * Required Rows remain in the subset even when answered. This is enforcement policy,
 * not a list of missing answers. Neither function mutates the Form or stored answers.
 */
export function evaluateForm(form: Form, answers: FormAnswers): FormEvaluation {
  const visibleRows: FormRow[] = [];
  visitForm(form, answers, (row, visible) => {
    if (visible) visibleRows.push(row);
  });
  return { visibleRows, enforcedRequiredRows: visibleRows.filter((row) => row.isRequired) };
}

/** Record visibility never changes enforcement. Callers still apply Portal access rules. */
export function recordFormRows(form: Form, answers: FormAnswers): FormRow[] {
  const rows: FormRow[] = [];
  visitForm(form, answers, (row, visible) => {
    if (visible || hasValue(answerFor(answers, row.rowRef))) rows.push(row);
  });
  return rows;
}

export interface FormValidationIssue {
  nodeId: string;
  conditionIndex: number;
  rowRef: string;
  code:
    "self_reference" | "forward_reference" | "unknown_row" | "invalid_operator" | "invalid_value";
  message: string;
}

/** Validate Branch references and operands after parsing the tree shape.
 * The Form writer separately checks unique Rows and node IDs, pinned Rows and switches.
 * A reference into the Branch's own children is a self-reference.
 */
export function validateForm(form: Form): FormValidationIssue[] {
  const rows = new Map<string, { row: FormRow; position: number }>();
  const branches: { branch: FormBranch; position: number; end: number }[] = [];
  let position = 0;
  function index(nodes: Form): void {
    for (const node of nodes) {
      const current = position++;
      if (node.kind === "row") rows.set(node.rowRef, { row: node, position: current });
      else {
        const entry = { branch: node, position: current, end: current };
        branches.push(entry);
        index(node.children);
        entry.end = position;
      }
    }
  }
  index(form);
  const issues: FormValidationIssue[] = [];
  for (const { branch, position, end } of branches) {
    branch.conditions.forEach((condition, conditionIndex) => {
      const referenced = rows.get(condition.rowRef);
      const refuse = (code: FormValidationIssue["code"], detail: string) => {
        issues.push({
          nodeId: branch.id,
          conditionIndex,
          rowRef: condition.rowRef,
          code,
          message: `Branch "${branch.id}", Row "${condition.rowRef}": ${detail}`,
        });
      };
      if (
        condition.rowRef === branch.id ||
        (referenced && referenced.position > position && referenced.position < end)
      ) {
        refuse("self_reference", "a condition cannot reference its own Branch or children.");
        return;
      }
      if (!referenced) {
        refuse("unknown_row", "the Row does not exist.");
        return;
      }
      if (referenced.position > position) {
        refuse("forward_reference", "place the Row above the Branch.");
        return;
      }
      const ordered = condition.operator === "greater_than" || condition.operator === "less_than";
      if (ordered && !["number", "money", "date"].includes(referenced.row.fieldType)) {
        refuse("invalid_operator", `${condition.operator} needs a number, money or date Row.`);
        return;
      }
      const scalar = (value: unknown): value is FormScalar =>
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value));
      const valid =
        condition.operator === "is_set"
          ? condition.value === null
          : condition.operator === "is_one_of"
            ? Array.isArray(condition.value) &&
              condition.value.length > 0 &&
              condition.value.every(scalar)
            : ordered
              ? comparable(condition.value, referenced.row.fieldType) !== undefined
              : scalar(condition.value);
      if (!valid)
        refuse(
          "invalid_value",
          "use a valid operand: no value for is_set, a list for is_one_of, or one value of the comparison type.",
        );
    });
  }
  return issues;
}
