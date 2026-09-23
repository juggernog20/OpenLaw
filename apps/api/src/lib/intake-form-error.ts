// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Named Intake Row refusals for service callers (DD-028, INT-002). The HTTP
 * Problem envelope keeps its existing message and omits the Row metadata.
 */

import { HttpError } from "./problem.js";

export interface IntakeFormRowIssue {
  name: string;
  reason: "missing" | "invalid";
}

/** Named Rows for service callers; HTTP keeps the existing Problem envelope. */
export class IntakeFormError extends HttpError {
  constructor(
    message: string,
    readonly rows: readonly IntakeFormRowIssue[],
  ) {
    super(400, message);
  }
}

export function invalidIntakeRows(message: string, ...names: string[]): IntakeFormError {
  return new IntakeFormError(
    message,
    names.map((name) => ({ name, reason: "invalid" })),
  );
}
