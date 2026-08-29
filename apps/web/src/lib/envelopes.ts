// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing vocabulary the contract record's "Approvals & signing"
 * card reads (M15/2, CTR-013): the row shape the API answers, the
 * DES-005 pill family each envelope status draws in, and the one call
 * the card makes.
 *
 * **The record's signing state is answered whole.** A send answers
 * every envelope on the record, whether this install has a connector,
 * and the primary document the dialog offers — and the card replaces
 * what it holds. The send changes all three at once: a new row lands,
 * and the send control goes with it, because the record now has an
 * envelope out. The first read of the same three is the record
 * loader's, beside the roster and the paper.
 *
 * **Order is the server's.** Newest send first, so the round being
 * asked about is the first row. Nothing here sorts anything.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problem, type Problem } from "./problem";

/** The API's answer for one contract's signing state, aliased to the
 * generated schema so an API change surfaces as a compile error here
 * rather than as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/envelopes"]["get"]["responses"]["200"]["content"]["application/json"];

/** One round of signature on a record (CTR-013). */
export type ContractEnvelope = ListResponse["envelopes"][number];
export type EnvelopeStatus = ContractEnvelope["status"];
/** The contract's instrument and its chain, as the send dialog needs
 * it (CTR-014). Null when the record has no paper — or when DD-014
 * walls the paper it has off from this viewer. */
export type SendableDocument = NonNullable<ListResponse["primaryDocument"]>;
/** One person an envelope is sent to. Name and email, because that is
 * all a signer is: the other side of a deal has no account here. */
export interface EnvelopeSigner {
  name: string;
  email: string;
}

/** The record's whole signing state, as both calls answer it. */
export type SigningState = {
  envelopes: ContractEnvelope[];
  signingConfigured: boolean;
  primaryDocument: SendableDocument | null;
};

/**
 * What a read or a write over the record's signing state answers: the
 * state as it now stands, or why not.
 *
 * `type` is the refusal's own RFC 9457 URN, carried but not yet read.
 * Nothing on the card branches on a signing refusal today — every one
 * of them is printed in the dialog the act was taken from. It is here
 * so that the day one of them needs different handling, the caller
 * branches on the type as TECH-020 requires rather than reaching for
 * the sentence, which is copy and changes.
 */
export type SigningOutcome = ({ ok: true } & SigningState) | ({ ok: false } & Problem);

/**
 * The envelope pill's family (DES-005's paired status-pill families,
 * grill-plan X.2).
 *
 * `sent` is `warning`, which is the family the **signature stage**
 * already takes in `STAGE_PILL`: a contract with paper out and the
 * pipeline beside it say the same thing about the same record, so they
 * say it in the same colour. `signed` is `success` and `declined` is
 * `danger` — the two outcomes, and the families DES-005 already spends
 * on exactly that reading. `voided` is `neutral` rather than `danger`:
 * withdrawing a send is a normal act on the way to a better one, and
 * dressing it in red would read as a failure where there was only a
 * decision.
 */
export const ENVELOPE_PILL: Record<EnvelopeStatus, string> = {
  sent: "bg-status-warning-bg text-status-warning-fg",
  signed: "bg-status-success-bg text-status-success-fg",
  declined: "bg-status-danger-bg text-status-danger-fg",
  voided: "bg-status-neutral-bg text-status-neutral-fg",
};

/** The one envelope the record is waiting on, or none (CTR-013). At
 * most one is live at a time, which is the rule the seam holds and the
 * database backs. */
export const liveEnvelope = (envelopes: readonly ContractEnvelope[]): ContractEnvelope | null =>
  envelopes.find((envelope) => envelope.status === "sent") ?? null;

/**
 * Sends one version of the primary document out for signature
 * (CTR-013).
 *
 * Every signer named goes in one request, because they are one
 * envelope: the seam sends them together or refuses them together, and
 * all of them are asked at once.
 */
export async function sendContractEnvelope(
  contractNumber: number,
  input: { documentVersionId: string; signers: readonly EnvelopeSigner[]; subject?: string },
): Promise<SigningOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/envelopes", {
      params: { path: { number: contractNumber } },
      body: {
        documentVersionId: input.documentVersionId,
        signers: input.signers.map((signer) => ({ name: signer.name, email: signer.email })),
        ...(input.subject ? { subject: input.subject } : {}),
      },
    })
    .catch(() => undefined);
  return result?.data ? { ok: true, ...result.data } : { ok: false, ...(await problem(result)) };
}

/**
 * Withdraws a live envelope (CTR-013).
 *
 * The envelope is addressed by its own id rather than by the record it
 * sits on, because a void is about the round: the seam reads the
 * contract from the envelope, and answers the record's whole signing
 * state back — the ending on the row, and the send control that comes
 * back with it, in one answer.
 *
 * The reason is required. The provider records it with the withdrawal
 * and the row draws it under the status pill, so a void with no words
 * would leave the record unable to say why the round ended.
 */
export async function voidContractEnvelope(
  envelopeId: string,
  reason: string,
): Promise<SigningOutcome> {
  const result = await api
    .POST("/api/v1/envelopes/{envelopeId}/void", {
      params: { path: { envelopeId } },
      body: { reason },
    })
    .catch(() => undefined);
  return result?.data ? { ok: true, ...result.data } : { ok: false, ...(await problem(result)) };
}
