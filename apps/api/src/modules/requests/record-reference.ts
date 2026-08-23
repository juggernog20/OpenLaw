// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record a Request conversion made.
 *
 * The reference deliberately names the module as well as the database
 * id. Conversion has one contract arm today; M22 adds the Matter arm to
 * this union. Keeping the permanent number beside the id lets the
 * conversion narrate and return the same reference without re-reading
 * the newborn record.
 */
export type ConversionRecordReference = {
  module: "contract";
  id: string;
  number: number;
};

/** M21's contract-only wire shape, retained byte-for-byte by the M22/1 prefactor. */
export function convertedContractOf(
  record: ConversionRecordReference | null,
): { number: number } | null {
  return record === null ? null : { number: record.number };
}
