// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage } from "react-intl";
import { Alert } from "./ui/alert";

/**
 * The warning before a Business User joins the team of a confidential
 * Contract or Matter (DES-080 addendum, 2026-10-02). Team membership
 * gives a Business User the record in the Portal, so every control that
 * adds one to a confidential record draws this first.
 */
export function BusinessUserConfidentialWarning({
  name,
  module,
}: Readonly<{ name: string; module: "contract" | "matter" }>) {
  return (
    <Alert variant="warning" className="text-sm">
      <FormattedMessage
        id="record.team.businessUserConfidential"
        defaultMessage="{name} is a Business User. They will see this confidential {module, select, contract {Contract} other {Matter}} in the Portal, with its Documents and Full Thread comments."
        values={{ name, module }}
      />
    </Alert>
  );
}
