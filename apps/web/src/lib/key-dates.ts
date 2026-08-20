// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The key-dates vocabulary the contract record's Key dates section reads
 * (M16/3, CTR-009): the row shape the API answers, the DES-005 pill
 * family a row draws in, and the four calls the section makes.
 *
 * **What the section holds is the union, not the rows.** The seam
 * answers the CTR-009 deadline union — the record's key dates, its
 * expiry, and its derived notice deadline — as one list. Two of the
 * three sources have no row behind them: they carry a null `keyDateId`,
 * which is what says they are read here and edited on the record's own
 * Contract card.
 *
 * **Order, the day counts, and the next deadline are the server's.**
 * Every write answers the whole union rather than the row it was
 * addressed at, and the section replaces what it holds — because adding,
 * moving, or removing one date can change which date is next. Nothing
 * here sorts anything and nothing here counts anything.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail } from "./messages";

/** The API's answer for one contract's deadline surface, aliased to the
 * generated schema so an API change surfaces as a compile error here
 * rather than as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/key-dates"]["get"]["responses"]["200"]["content"]["application/json"];

/** One date on the record's deadline surface, whichever of CTR-009's
 * three sources it came from. */
export type ContractDeadline = ListResponse["deadlines"][number];
export type DeadlineSource = ContractDeadline["source"];

/** What one key date carries when it is written. The note is optional on
 * the way in and `null` is how an existing one is cleared. */
export interface KeyDateInput {
  date: string;
  label: string;
  note: string | null;
}

/** What a read or a write over the record's deadlines answers: the union
 * as it now stands, or why not. */
export type DeadlinesOutcome =
  { ok: true; deadlines: ContractDeadline[] } | { ok: false; detail?: string };

/** A row the section may edit and remove — one the record itself holds,
 * as opposed to the two the term derives. Written as a type guard so a
 * caller that has narrowed a row keeps the non-null id. */
export const isKeyDate = (row: ContractDeadline): row is ContractDeadline & { keyDateId: string } =>
  row.keyDateId !== null;

/**
 * Reads one contract's deadline surface, whole.
 *
 * Every call here settles rather than rejects. A refused answer and a
 * request that never arrived are the same event to the section that
 * awaited it — both mean "this did not happen" — and a rejection that
 * escaped would leave the surface disabled at `saving` with nothing on
 * screen to say why. The record's own field commit guards its write the
 * same way, and the caller's fallback sentence is what a caught
 * rejection ends up printing.
 */
export async function readContractKeyDates(contractNumber: number): Promise<DeadlinesOutcome> {
  const { data, error } = await api
    .GET("/api/v1/contracts/{number}/key-dates", {
      params: { path: { number: contractNumber } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, deadlines: data.deadlines }
    : { ok: false, detail: problemDetail(error) };
}

/** Puts a named date on the record (CTR-009). */
export async function addContractKeyDate(
  contractNumber: number,
  input: KeyDateInput,
): Promise<DeadlinesOutcome> {
  const { data, error } = await api
    .POST("/api/v1/contracts/{number}/key-dates", {
      params: { path: { number: contractNumber } },
      body: { date: input.date, label: input.label, note: input.note },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, deadlines: data.deadlines }
    : { ok: false, detail: problemDetail(error) };
}

/**
 * Moves a key date, renames it, or changes its note.
 *
 * All three go together, because the dialog collects all three: it is
 * the compound edit DES-017 carves out of the inline rule, and a date
 * whose label was corrected in the same pass as its day should land as
 * one act rather than as two.
 */
export async function updateContractKeyDate(
  keyDateId: string,
  input: KeyDateInput,
): Promise<DeadlinesOutcome> {
  const { data, error } = await api
    .PATCH("/api/v1/key-dates/{keyDateId}", {
      params: { path: { keyDateId } },
      body: { date: input.date, label: input.label, note: input.note },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, deadlines: data.deadlines }
    : { ok: false, detail: problemDetail(error) };
}

/**
 * Takes a key date off the record.
 *
 * The row is deleted and the activity entry is what is left of it
 * (CTR-009, DD-017), so the union comes back one row shorter and the
 * section replaces what it holds rather than working out which row went.
 */
export async function removeContractKeyDate(keyDateId: string): Promise<DeadlinesOutcome> {
  const { data, error } = await api
    .DELETE("/api/v1/key-dates/{keyDateId}", {
      params: { path: { keyDateId } },
    })
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, deadlines: data.deadlines }
    : { ok: false, detail: problemDetail(error) };
}
