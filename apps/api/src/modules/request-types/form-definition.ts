// SPDX-License-Identifier: AGPL-3.0-only
export const TARGET_MODULES = ["matter", "contract"] as const;
export type TargetModule = (typeof TARGET_MODULES)[number];
