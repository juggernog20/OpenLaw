// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-007: a child uses the hierarchy; a successor uses a renews link. */
export const CONTRACT_RENEWAL_VEHICLES = ["child", "successor"] as const;
export type ContractRenewalVehicle = (typeof CONTRACT_RENEWAL_VEHICLES)[number];
