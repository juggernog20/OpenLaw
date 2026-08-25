// SPDX-License-Identifier: AGPL-3.0-only

/** DES-018's ordinal severity ramp, shared by Matters and Contracts. */
export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
