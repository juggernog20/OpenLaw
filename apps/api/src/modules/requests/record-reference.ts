// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record a Request conversion made.
 *
 * The reference deliberately names the module as well as the database
 * id. Conversion has contract and matter arms. Keeping the permanent number beside the id lets the
 * conversion narrate and return the same reference without re-reading
 * the newborn record.
 */
export type ConversionRecordReference = {
  module: "contract" | "matter";
  id: string;
  number: number;
};

/** The module-aware wire reference used by M22's second conversion arm. */
export function convertedRecordOf(
  record: ConversionRecordReference | null,
): { module: "contract" | "matter"; number: number } | null {
  return record === null ? null : { module: record.module, number: record.number };
}

/** M21's contract-only wire shape, retained byte-for-byte by the M22/1 prefactor. */
export function convertedContractOf(
  record: ConversionRecordReference | null,
): { number: number } | null {
  return record?.module === "contract" ? { number: record.number } : null;
}
