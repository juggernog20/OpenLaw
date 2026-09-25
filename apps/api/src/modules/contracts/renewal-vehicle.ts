// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contract renewal vehicle values and type (CTR-007). A separate module keeps
 * record schemas from importing creation services.
 */
export const CONTRACT_RENEWAL_VEHICLES = ["child", "successor"] as const;
export type ContractRenewalVehicle = (typeof CONTRACT_RENEWAL_VEHICLES)[number];
