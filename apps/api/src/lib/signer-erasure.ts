// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Erasing an external signer (CTR-013 M15/7, DD-017,
 * [#280](https://github.com/juggernog20/OpenLaw/issues/280)).
 *
 * **The problem this exists for.** Sending a contract for signature
 * writes each signer's name and email address into the `envelope.sent`
 * activity payload. That is deliberate: the envelope's own signer rows
 * go when the record does, and the entry is then the only thing left
 * that says who was asked. Every other address in a payload belongs to a
 * **user of this install** — somebody with an account, a relationship,
 * and somewhere to make a request. An external signer has none of those.
 * They were named in a dialog by somebody else, and they may never have
 * heard of the install. So the address is here, and the person it
 * belongs to has no route to it.
 *
 * **What an erasure does, and what it deliberately keeps.** The name and
 * the address are rewritten to {@link ERASED} in place, and the
 * envelope's signer rows for that address are deleted. **The shape
 * stays**: the array keeps its length and its order, so the entry still
 * says how many people were asked and in what position — which is the
 * part of the record that is about the contract rather than about the
 * person. An entry that lost its signer array would stop being an audit
 * record of the send; an entry that keeps a tombstone in each slot is
 * still one, and says plainly that somebody exercised a right.
 *
 * **This is the one `UPDATE` on `activity_log`, and it is named.**
 * DD-017 makes the table append-only and says corrections are appended,
 * never written over. That rule is about corrections, and this is not
 * one: no fact recorded here was wrong. It is a lawful-erasure route,
 * DOC-010's for documents applied to a person who is only ever a signer,
 * and there is no way to honour one by appending. The exception is
 * confined to this module, to one action slug, and to two keys inside
 * it; every other row and every other key stays untouchable. The
 * erasure itself is then **appended** like anything else, so the log
 * still says what happened to it.
 *
 * **The erasure entry carries no address.** An entry naming the person
 * who asked to be forgotten would put the address straight back into the
 * table this just took it out of. What it carries is the count — how
 * many entries were rewritten, how many signer rows went — which is what
 * makes the act accountable without undoing it.
 *
 * **A user of this install is refused.** Their address is in payloads
 * that are about them as a colleague, not as a counterparty, and those
 * have a different answer (an account, and DD-013's archival). Erasing
 * only their signer appearances would half-answer a request in a way
 * nobody could reason about afterwards.
 *
 * **The copies already shipped are not ours to reach.** DD-017's SIEM
 * clause emits every appended row through the application logger, so a
 * signer's address has already left this process by the time a request
 * arrives, under whatever retention the deployer's shipper runs. Nothing
 * here can recall it and nothing here pretends to. That is said out loud
 * in the self-hosting documentation rather than left to be discovered.
 */

import { activityLog, contractEnvelopeSigners, sql, type Executor } from "@openlaw/db";

/**
 * What an erased name and an erased address read as.
 *
 * `[secret]`'s shape, and for a related reason: a reader has to be able
 * to tell "this was taken out" from "this was never there". A blank
 * would read as the second.
 */
export const ERASED = "[erased]";

/** The one action slug an erasure may rewrite. */
const ERASABLE_ACTION = "envelope.sent";

/** What one erasure did. */
export interface SignerErasure {
  /** `envelope.sent` entries whose payload was rewritten. */
  entriesRedacted: number;
  /** `contract_envelope_signers` rows deleted. These are ordinary data
   * and are simply removed — the append-only argument never applied to
   * them, and the envelope's row keeps the round itself. */
  signerRowsDeleted: number;
}

/**
 * Erases one address everywhere it appears as an external signer.
 *
 * Runs inside the caller's transaction, so the rewrite, the deletion,
 * and the entry that records them commit or roll back together — a
 * half-done erasure is the one outcome nobody could act on.
 *
 * Answers zeros for an address that was never a signer's. That is a
 * satisfied request rather than a missing one: there was nothing to
 * erase, and the caller is owed the same answer either way.
 */
export async function eraseSigner(tx: Executor, email: string): Promise<SignerErasure> {
  // Addresses are compared case-insensitively and stored verbatim. The
  // send keeps what the sender typed, because that is what the record
  // has to show a week later — and a request arrives in whatever case
  // the person writes it in.
  const target = email.trim().toLowerCase();

  // One statement, because the rewrite has to be driven by what is in
  // each row rather than by anything read out and sent back. The array
  // is rebuilt element by element, in order: a matching element becomes
  // the tombstone and every other one is carried across untouched, so
  // the other signers on the same envelope keep their names and the
  // positions do not move.
  const redacted = await tx.execute<{ id: string }>(sql`
    UPDATE ${activityLog}
       SET payload = jsonb_set(
             payload,
             '{signers}',
             (
               SELECT jsonb_agg(
                        CASE
                          WHEN lower(signer->>'email') = ${target}
                          THEN jsonb_build_object('name', ${ERASED}::text, 'email', ${ERASED}::text)
                          ELSE signer
                        END
                        ORDER BY position
                      )
                 FROM jsonb_array_elements(payload->'signers')
                      WITH ORDINALITY AS elements(signer, position)
             )
           )
     WHERE action = ${ERASABLE_ACTION}
       AND jsonb_typeof(payload->'signers') = 'array'
       AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(payload->'signers') AS signer
              WHERE lower(signer->>'email') = ${target}
           )
    RETURNING id
  `);

  const deleted = await tx
    .delete(contractEnvelopeSigners)
    .where(sql`lower(${contractEnvelopeSigners.email}) = ${target}`)
    .returning({ id: contractEnvelopeSigners.id });

  return { entriesRedacted: redacted.rows.length, signerRowsDeleted: deleted.length };
}

/**
 * Whether this address is still readable as a signer anywhere.
 *
 * Used by the suite rather than by the route: an erasure that answered
 * "done" while a payload still held the address would be the one failure
 * that matters, and it is worth being able to ask the question directly.
 */
export async function signerAppearances(tx: Executor, email: string): Promise<number> {
  const target = email.trim().toLowerCase();
  const found = await tx.execute<{ id: string }>(sql`
    SELECT id FROM ${activityLog}
     WHERE action = ${ERASABLE_ACTION}
       AND jsonb_typeof(payload->'signers') = 'array'
       AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(payload->'signers') AS signer
              WHERE lower(signer->>'email') = ${target}
           )
  `);
  const rows = await tx
    .select({ id: contractEnvelopeSigners.id })
    .from(contractEnvelopeSigners)
    .where(sql`lower(${contractEnvelopeSigners.email}) = ${target}`);
  return found.rows.length + rows.length;
}
