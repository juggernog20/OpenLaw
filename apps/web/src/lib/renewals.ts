// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The renewal vocabulary the contract record reads (M16/4, CTR-006,
 * CTR-007): the confirmed-roll row shape the API answers, and the one
 * call the Renew dialog makes.
 *
 * **Nothing here stores a renewal, and nothing here derives one.** The
 * pending state, the proposed new expiry, and the renewal history are
 * all the seam's answers — the first two ride the contract row and the
 * third rides the record read — so this module carries types and one
 * write and no rules. A second copy of "has this term lapsed" or "where
 * would a roll land" on the client is the copy that drifts the first
 * time either date moves (DES-040 clause 4).
 *
 * **Order is the server's.** Most recent roll first, so the last
 * renewal is the first row and the record's "Last renewal" fact is a
 * read rather than a scan. Nothing here sorts anything.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail, problemType } from "./messages";

/** The record read's answer, aliased to the generated schema so an API
 * change surfaces as a compile error here rather than as a runtime
 * surprise on the record page. */
type RecordResponse =
  paths["/api/v1/contracts/{number}"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * One confirmed roll (CTR-007's first vehicle), read back out of the
 * activity log — the grill's G.R5 resolution. It carries the expiry
 * either side of the roll, when it was confirmed, and who confirmed it.
 */
export type ConfirmedRenewal = RecordResponse["renewals"][number];

/** What the confirm answers: the record as it now stands, its whole
 * renewal history, or why not. */
export type RenewalOutcome =
  | { ok: true; contract: RecordResponse["contract"]; renewals: ConfirmedRenewal[] }
  | { ok: false; detail?: string; type?: string };

/**
 * Confirms the roll: the same record's term advances (CTR-007).
 *
 * `fromExpiry` is the expiry the person was looking at when they
 * pressed, and it is a **precondition rather than a value to write**.
 * The seam compares it under the contract's row lock and refuses the
 * roll when the record no longer holds it, which is what makes two
 * confirms racing for one roll advance the term exactly once. So this
 * call sends the record's own saved expiry, never a draft.
 *
 * `toExpiry` is where the term now runs to. The record proposes it and
 * the person may change it before pressing, because a roll whose dates
 * shifted in negotiation is recorded as it really landed.
 */
export async function confirmContractRenewal(
  contractNumber: number,
  fromExpiry: string,
  toExpiry: string,
): Promise<RenewalOutcome> {
  const { data, error } = await api.POST("/api/v1/contracts/{number}/renewal", {
    params: { path: { number: contractNumber } },
    body: { fromExpiry, toExpiry },
  });
  return data
    ? { ok: true, contract: data.contract, renewals: data.renewals }
    : { ok: false, detail: problemDetail(error), type: problemType(error) };
}
