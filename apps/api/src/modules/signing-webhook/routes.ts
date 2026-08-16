// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The provider's own feed coming back in (M15/3, CTR-013, TECH-013) —
 * this install's **first unauthenticated inbound write path**.
 *
 * DocuSign Connect pushes an envelope's fate here: signed, declined, or
 * voided. The record then follows the paper without anybody watching
 * another company's inbox.
 *
 * **It is its own encapsulated plugin, on the better-auth handler's
 * precedent, and for the same reason.** Verification is an HMAC over
 * the **exact bytes** delivered, so this route must see the payload
 * untouched: it removes every content-type parser and installs a
 * raw-buffer one. Encapsulation is what keeps that from leaking into
 * the zod-validated `/api/v1` routes, which need their bodies parsed.
 *
 * **Nothing unsigned is believed.** There is no auth guard here, so the
 * signature is the whole gate: a delivery whose HMAC does not verify
 * against this install's stored Connect secret is refused, and so is
 * one carrying no signature at all. TECH-013's rule that the secret is
 * mandatory rather than optional-if-configured is what makes that a
 * gate and not a suggestion — an install with no connector verifies
 * nothing, so it believes nothing.
 *
 * **A forged delivery and a malformed one are answered identically.**
 * 401, one sentence, no detail about which check failed. Telling a
 * caller they got the signature right but the body wrong would be
 * telling an attacker where to spend their next attempt.
 *
 * **An envelope this install does not hold is acknowledged, not
 * refused.** Another tenant's id, a record that was deleted, a console
 * somebody tested by hand: none of them is an error here. Refusing one
 * would turn our own log into the provider's retry queue.
 *
 * **It answers fast and applies the change through one funnel.** All
 * the work is one locked row, one update, and one activity entry —
 * `applyEnvelopeStatus`, the single status funnel the reconciliation
 * sweep and the void route also go through. A replay changes nothing
 * the first delivery did not, because that function says so.
 *
 * The route is hidden from the OpenAPI document, exactly as the auth
 * handler is: it is DocuSign's address, not part of the API surface a
 * client integrates against, and its body is bytes rather than a
 * schema. The address itself comes from `webhookPath` — the same
 * function the Settings pane shows an Administrator — so what is
 * pasted into the provider's console and what this install answers on
 * cannot drift apart.
 */

import type { IncomingHttpHeaders } from "node:http";
import type { FastifyPluginAsync } from "fastify";
import { SIGNING_PROVIDERS, type SigningProviderKey } from "@openlaw/db";
import { httpError } from "../../lib/problem.js";
import { WebhookSignatureError } from "../../lib/signing/provider.js";
import { applyEnvelopeStatus } from "../../lib/signing/transitions.js";
import { webhookPath } from "../signing-connector/routes.js";

/**
 * The one sentence every refused delivery gets.
 *
 * Deliberately the same for a forged signature, a body that is not a
 * delivery, and an install with no connector to verify against: all
 * three mean "nothing here is signed by this install's Connect key",
 * and three different sentences would be three different hints.
 */
const UNSIGNED = "This delivery is not signed by this install's Connect key.";

/** Whether a path segment names an adapter this build has. */
function isKnownProvider(value: string): value is SigningProviderKey {
  return (SIGNING_PROVIDERS as readonly string[]).includes(value);
}

/**
 * The request headers as the signing seam takes them.
 *
 * Node types a header value as `string | string[] | undefined`, because
 * HTTP lets a name repeat. The seam takes one string per name, because
 * an HMAC is one value — so the conversion is this route's job, and it
 * is done here rather than left to a cast that would hand an array to
 * `Buffer.from(value, "base64")` and get a buffer of nothing.
 *
 * Only strings survive. An array is Node's short list of names it
 * refuses to join — `set-cookie` and its neighbours — and a signature
 * is never one of them: a name that genuinely repeated on the wire
 * reaches us already joined into one string. Picking a value out of an
 * array would be guessing which half of a repeat to believe, and
 * joining two signatures would make a third that is neither, so an
 * array is simply not carried. Verification then has one candidate
 * fewer, which is the safe direction to be wrong in.
 *
 * Null-prototyped, because these keys come off the network: an object
 * literal would answer `constructor` and `toString` from its prototype,
 * and verification walks the entries.
 */
function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") flat[name] = value;
  }
  return flat;
}

export const signingWebhookRoutes: FastifyPluginAsync = async (app) => {
  // The raw bytes, untouched. Verification is arithmetic over exactly
  // what was delivered, and a re-serialized JSON object is not that.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, payload, done) => {
    done(null, payload);
  });

  app.post<{ Params: { provider: string } }>(
    webhookPath(":provider"),
    { schema: { hide: true } },
    async (request, reply) => {
      const { provider } = request.params;
      // An address that names no adapter is a wrong address, not a
      // failed credential. It is the one refusal here that says which
      // it was, because the set of adapters is public.
      if (!isKnownProvider(provider)) {
        throw httpError(404, "This install answers no webhook for that provider.");
      }

      // Resolved live, so a key an Administrator rotated a second ago
      // is the key this delivery is checked against. An install with no
      // connector resolves to nothing and believes nothing.
      const signing = await app.resolveSigningProvider().catch((error: unknown) => {
        // A stored connector that cannot be built into a driver — an
        // unreadable RSA key, a row a later adapter wrote — verifies
        // nothing, so the delivery is unsigned as far as this install
        // is concerned. It is logged rather than answered, because it
        // is a configuration fault a deployer has to see and not a
        // fact a caller should be told, and because a 500 here would
        // put this install into the provider's retry queue.
        request.log.error({ err: error, provider }, "signing: the connector could not be resolved");
        return null;
      });
      // The adapter is checked as well as its presence: a delivery
      // addressed to one provider must never be verified with another
      // one's secret.
      if (!signing || signing.provider !== provider) throw httpError(401, UNSIGNED);

      const body = request.body;
      if (!Buffer.isBuffer(body)) throw httpError(401, UNSIGNED);

      let delivery;
      try {
        delivery = signing.verifyWebhook(body, flattenHeaders(request.headers));
      } catch (error) {
        if (error instanceof WebhookSignatureError) {
          // Logged, not answered: the reason a delivery failed is
          // useful to the deployer reading the log and is exactly what
          // an attacker is probing for.
          request.log.warn({ err: error, provider }, "signing: a delivery was refused");
          throw httpError(401, UNSIGNED);
        }
        throw error;
      }

      const result = await applyEnvelopeStatus(app.db, {
        provider,
        providerEnvelopeId: delivery.providerEnvelopeId,
        status: delivery.status,
        ...(delivery.reason !== undefined ? { reason: delivery.reason } : {}),
        ...(delivery.completedAt !== undefined ? { completedAt: delivery.completedAt } : {}),
        // No actor: nobody here signed or declined anything. The entry
        // with no actor is what makes the feed read it as the
        // integration speaking rather than as a person.
      });
      if (result.outcome === "unknown") {
        request.log.info(
          { provider, providerEnvelopeId: delivery.providerEnvelopeId },
          "signing: a delivery named an envelope this install does not hold",
        );
      } else if (result.outcome === "unchanged" && result.envelope.status !== delivery.status) {
        // A finished envelope being told a different ending. Not an
        // error — the first ending stands (see `transitions.ts`) — but
        // worth a line, because it is the one case where the provider
        // and the record disagree about a fact neither will change.
        request.log.info(
          {
            provider,
            providerEnvelopeId: delivery.providerEnvelopeId,
            held: result.envelope.status,
            delivered: delivery.status,
          },
          "signing: a delivery reported a status a finished envelope had already passed",
        );
      }

      // Nothing to say back. The provider wants an acknowledgement, not
      // a document, and an empty one is the fastest honest answer.
      return reply.status(204).send();
    },
  );
};
