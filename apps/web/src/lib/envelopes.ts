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
import { problemDetail, problemType } from "./messages";

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

/** What a read or a write over the record's signing state answers: the
 * state as it now stands, or why not — with the refusal's own RFC 9457
 * type, for the two the card acts on rather than prints. */
export type SigningOutcome =
  ({ ok: true } & SigningState) | { ok: false; detail?: string; type?: string };

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
  const { data, error } = await api.POST("/api/v1/contracts/{number}/envelopes", {
    params: { path: { number: contractNumber } },
    body: {
      documentVersionId: input.documentVersionId,
      signers: input.signers.map((signer) => ({ name: signer.name, email: signer.email })),
      ...(input.subject ? { subject: input.subject } : {}),
    },
  });
  return data
    ? { ok: true, ...data }
    : { ok: false, detail: problemDetail(error), type: problemType(error) };
}
