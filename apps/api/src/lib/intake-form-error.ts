// SPDX-License-Identifier: AGPL-3.0-only

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
