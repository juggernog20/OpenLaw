// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contracts vocabulary shared by the list (/contracts) and the
 * record page (/contracts/:number): the row shape the API answers, the
 * C-### reference (CTR-003), the DES-018 severity ramp behind priority
 * and risk, and the stage-keyed status pill.
 */

import type { IntlShape } from "react-intl";
import type { paths } from "@openlaw/api-client";

/** One contract as the API answers it, aliased to the generated client
 * schema so a contract change surfaces as a compile error here, not as
 * a runtime surprise in a route. */
export type ContractRow =
  paths["/api/v1/contracts/{number}"]["get"]["responses"]["200"]["content"]["application/json"]["contract"];

export type ContractStage = ContractRow["stage"];
export type SeverityLevel = ContractRow["priority"];

/** The live types and statuses the create dialog and the status select
 * read (the settings surfaces stay Administrator-only, SET-002). */
type OptionsResponse =
  paths["/api/v1/contracts/options"]["get"]["responses"]["200"]["content"]["application/json"];
export type ContractTypeOption = OptionsResponse["contractTypes"][number];
export type ContractStatusOption = OptionsResponse["contractStatuses"][number];

/** Guards a level list literal so it can't drift from the API's enum:
 * `Exclude<SeverityLevel, U[number]>` resolves to `never` only when
 * every level appears in `U` — which needs `U` inferred from the
 * literal, so the type argument is never passed by hand. A level added
 * to the API schema and left out here then fails to compile, as does a
 * typo'd entry. */
function exhaustiveSeverityList<U extends readonly SeverityLevel[]>(
  levels: Exclude<SeverityLevel, U[number]> extends never ? U : never,
): U {
  return levels;
}

/** DES-018's one ordinal severity ramp, low → critical. */
export const SEVERITY_LEVELS = exhaustiveSeverityList([
  "low",
  "medium",
  "high",
  "critical",
] as const);

/** The DES-018 ramp by value, not by callsite choice: low = neutral
 * grey, medium = warning yellow, high = severe orange, critical =
 * danger red. Priority and risk share it, so "how bad" reads the same
 * across every column. */
export const SEVERITY_PILL: Record<SeverityLevel, string> = {
  low: "bg-status-neutral-bg text-status-neutral-fg",
  medium: "bg-status-warning-bg text-status-warning-fg",
  high: "bg-status-severe-bg text-status-severe-fg",
  critical: "bg-status-danger-bg text-status-danger-fg",
};

/**
 * The status pill's family, keyed to the fixed stage rather than the
 * status (CTR-001: the label is renameable, the stage is not — so the
 * color follows the stage or it drifts the first time someone renames
 * a status). One nominal DES-005 family per stage, per DES-018's
 * status-pills-keep-their-families rule: nothing started yet is
 * neutral, work in progress is info, waiting on a named approver is
 * assigned, waiting on signature is warning, live is success, and over
 * takes the filled-dark register.
 */
export const STAGE_PILL: Record<ContractStage, string> = {
  draft: "bg-status-neutral-bg text-status-neutral-fg",
  review: "bg-status-info-bg text-status-info-fg",
  approval: "bg-status-assigned-bg text-status-assigned-fg",
  signature: "bg-status-warning-bg text-status-warning-fg",
  active: "bg-status-success-bg text-status-success-fg",
  ended: "bg-status-onhold-bg text-status-onhold-fg",
};

/** CTR-003's reference, as spoken and as linked: C-42. */
export function contractReference(intl: IntlShape, number: number): string {
  return intl.formatMessage(
    { id: "contracts.reference", defaultMessage: "C-{number}" },
    { number },
  );
}

export function severityLabel(intl: IntlShape, level: SeverityLevel): string {
  return intl.formatMessage(
    {
      id: "contracts.severityLabel",
      defaultMessage:
        "{level, select, low {Low} medium {Medium} high {High} critical {Critical} " +
        "other {Unknown}}",
    },
    { level },
  );
}

/** Risk is nullable on purpose: not yet assessed is not low (CTR-005). */
export function riskLabel(intl: IntlShape, level: SeverityLevel | null): string {
  return level === null
    ? intl.formatMessage({ id: "contracts.riskUnassessed", defaultMessage: "Not assessed" })
    : severityLabel(intl, level);
}
