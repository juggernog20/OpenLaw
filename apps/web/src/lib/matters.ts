// SPDX-License-Identifier: AGPL-3.0-only

/** Matter wire vocabulary shared by the list, dialog, and record hero. */
import type { paths } from "@openlaw/api-client";
import type { IntlShape } from "react-intl";

type RecordResponse =
  paths["/api/v1/matters/{number}"]["get"]["responses"]["200"]["content"]["application/json"];
type OptionsResponse =
  paths["/api/v1/matters/options"]["get"]["responses"]["200"]["content"]["application/json"];

export type MatterRow = RecordResponse["matter"];
export type MatterField = RecordResponse["fields"][number];
export type MatterTypeOption = OptionsResponse["matterTypes"][number];
export type MatterUserOption = OptionsResponse["users"][number];
export type MatterSeverity = MatterRow["priority"];

export const MATTER_SEVERITIES: readonly MatterSeverity[] = ["low", "medium", "high", "critical"];

export function matterPath(number: number): string {
  return `/matters/${number}`;
}

export function matterReference(intl: IntlShape, number: number): string {
  return intl.formatMessage({ id: "matters.reference", defaultMessage: "M-{number}" }, { number });
}

export function matterSeverityLabel(intl: IntlShape, value: MatterSeverity): string {
  return intl.formatMessage(
    {
      id: "matters.severity",
      defaultMessage:
        "{value, select, low {Low} medium {Medium} high {High} critical {Critical} other {Unknown}}",
    },
    { value },
  );
}
