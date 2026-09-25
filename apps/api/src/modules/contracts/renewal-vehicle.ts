// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-007's two routed vehicles (M16/5). They live apart from the create
 * service so the record schemas can name them without importing it.
 *
 * `child` and `successor` are separate values rather than a relation
 * type, because they are two shapes and not two spellings: a child sits
 * *under* its predecessor in the CTR-015 hierarchy, and a successor
 * stands beside it holding a `renews` link. Naming the link type at the
 * seam would make the caller responsible for a choice the vehicle
 * already makes.
 */
export const CONTRACT_RENEWAL_VEHICLES = ["child", "successor"] as const;
export type ContractRenewalVehicle = (typeof CONTRACT_RENEWAL_VEHICLES)[number];
