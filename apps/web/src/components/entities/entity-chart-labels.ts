// SPDX-License-Identifier: AGPL-3.0-only

/** Shared chart and export labels for ENT-003 relationships and the DES-096 legend. */
import { defineMessages, type IntlShape } from "react-intl";
import { roleMessages } from "../../lib/trust-register";

export const chartMessages = defineMessages({
  branch: { id: "entities.chart.branch", defaultMessage: "Branch" },
  role: { id: "entities.chart.role", defaultMessage: "Trust role" },
  individual: { id: "entities.ownership.individual", defaultMessage: "Individual" },
  class: { id: "entities.chart.class", defaultMessage: "Class" },
  primary: { id: "entities.chart.primary", defaultMessage: "Primary Holding" },
  secondary: { id: "entities.chart.secondary", defaultMessage: "Other Holding" },
});
export function relationshipLabel(
  intl: IntlShape,
  edge: { role: keyof typeof roleMessages | null; roleLabel: string | null },
) {
  return edge.role === null
    ? intl.formatMessage(chartMessages.branch)
    : edge.role === "other" && edge.roleLabel
      ? edge.roleLabel
      : intl.formatMessage(roleMessages[edge.role]);
}
