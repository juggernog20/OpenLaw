// SPDX-License-Identifier: AGPL-3.0-only

import { SigningRefusedError, type SigningProvider } from "./provider.js";

export class EnvelopeIdentityError extends SigningRefusedError {}

/** Legacy sent history has no recorded account. Never fill one in from today's connector. */
export async function requireEnvelopeIdentity(
  signing: SigningProvider,
  envelope: {
    provider: string;
    providerAccountId: string | null;
    providerEnvironment: string | null;
    providerTransactionId: string | null;
    creationKind: string | null;
  },
): Promise<void> {
  const recordedCreation =
    envelope.providerTransactionId !== null || envelope.creationKind !== null;
  if (
    signing.provider !== envelope.provider ||
    (recordedCreation && (!envelope.providerAccountId || !envelope.providerEnvironment)) ||
    (envelope.providerEnvironment !== null &&
      signing.environment !== envelope.providerEnvironment) ||
    (envelope.providerAccountId !== null &&
      (await signing.testConnection()).accountId !== envelope.providerAccountId)
  ) {
    throw new EnvelopeIdentityError(
      "This Envelope belongs to a different or unavailable Signing identity. Restore its original account and environment. Its history remains saved.",
    );
  }
}
