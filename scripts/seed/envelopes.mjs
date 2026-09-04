/* Sending contracts out for signature (CTR-013).
 *
 * One round of signature on one version of one document, held by the
 * provider. The seed sends real envelopes through the real driver, at
 * the stand-in in `signing-stub.mjs`, and then plays the four things
 * that can happen to one: it is still out, it comes back signed, a
 * signer declines it, or somebody voids it.
 *
 * The signed ones are worth the trouble on their own. A completed
 * envelope makes the app fetch the executed copy from the provider and
 * append it to the document's chain as a version nobody uploaded, which
 * is a state no amount of clicking about in the app can produce.
 *
 * This phase is opt-in, because the driver's host comes from the
 * environment rather than from the connector row. Start the loop with
 * both halves and pass `--with-signing`:
 *
 *   SIGNING_STANDIN=true DOCUSIGN_BASE_URL=http://127.0.0.1:8129 pnpm dev:hot
 */

import { generateKeyPairSync } from "node:crypto";
import { DEFAULT_BASE_URL, pool } from "./client.mjs";
import { startSigningStub } from "./signing-stub.mjs";

/** Who signs for the counterparty. Nobody with an OpenLaw account. */
const SIGNATORIES = [
  "Marianne Whitlock",
  "Desmond Achterberg",
  "Priyanka Bhatt",
  "Gordon Reyes",
  "Astrid Lehmann",
  "Colm Devereux",
  "Yuki Matsuda",
  "Beatriz Salgado",
];

/** A plausible work address at a counterparty, on a domain that cannot resolve. */
function signerEmail(name, counterparty) {
  const local = name.toLowerCase().replace(/[^a-z]+/g, ".");
  const domain = counterparty
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .split(/\s+/)
    .slice(0, 2)
    .join("");
  return `${local}@${domain || "counterparty"}.example`;
}

/** What became of each envelope, and how often. */
const OUTCOMES = [
  ["sent", 4],
  ["completed", 5],
  ["declined", 2],
  ["voided", 1],
];

/**
 * Saves the connector and proves it reaches the stand-in.
 *
 * A connector that cannot be reached is removed again rather than left
 * behind: a settings pane showing a configured provider that answers
 * nothing is worse than one showing none, and CTR-013's manual hand-off
 * is what an install with no connector falls back to.
 */
async function configureConnector(admin, stub, log) {
  // The driver signs an RS256 assertion with this key, so it has to be a
  // real one. Minted per run and never written down.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await admin.put("/api/v1/signing-connectors/docusign", {
    environment: "demo",
    integrationKey: stub.integrationKey,
    apiUserId: "9f3b1c40-7e2a-4d15-9c8b-51a0e6d24f77",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    webhookSecret: stub.webhookSecret,
  });
  const { status, body } = await admin.request("POST", "/api/v1/signing-connectors/docusign/test", {
    expect: [400, 401, 409, 502, 503],
  });
  if (status >= 300) {
    await admin.request("DELETE", "/api/v1/signing-connectors/docusign", {
      expect: [200, 204, 404],
    });
    log(
      "the signing stand-in was not reached, so the connector was removed. " +
        "Start the loop with SIGNING_STANDIN=true and DOCUSIGN_BASE_URL=http://127.0.0.1:8129.",
    );
    return false;
  }
  log(`signing connector reaches ${body?.accountName ?? stub.accountName}`);
  return true;
}

/** The version an envelope is sent on: the current one on the primary document. */
async function currentVersion(contract) {
  const { body } = await contract.author.get(`${contract.at}/documents`);
  const document =
    (body.documents ?? []).find((row) => row.id === contract.documentId) ?? body.documents?.[0];
  const versions = document?.versions ?? [];
  return versions.find((version) => version.isCurrent) ?? versions[versions.length - 1] ?? null;
}

/**
 * Sends the rounds and plays out what happened to them.
 *
 * Returns false when the phase could not run, so the caller can say so
 * rather than reporting a silent success.
 */
export async function seedEnvelopes(admin, contracts, random, log) {
  const stub = await startSigningStub();
  try {
    if (!(await configureConnector(admin, stub, log))) return false;

    // Every contract at signature, plus a slice of the ones that got
    // through it: an active contract that was signed has a completed
    // envelope behind it, and that history is half of what the panel shows.
    const candidates = contracts.filter(
      (contract) =>
        contract.documentId &&
        (contract.plan.stage === "signature" ||
          (["active", "ended"].includes(contract.plan.stage) && random.chance(0.18))),
    );

    const sent = [];
    await pool(candidates, 3, async (contract) => {
      const version = await currentVersion(contract);
      if (!version) return;
      const counterparty = contract.plan.counterparty ?? "the counterparty";
      const theirSigner = random.pick(SIGNATORIES);
      const signers = [
        { name: contract.owner.displayName, email: contract.owner.email },
        { name: theirSigner, email: signerEmail(theirSigner, counterparty) },
      ];
      // The reference in the subject is what ties the record's envelope
      // back to the one the provider is holding: OpenLaw does not put the
      // provider's id on the wire, and the subject is the one string both
      // ends can see.
      const subject = `${contract.plan.title} - for signature (ref ${contract.reference})`.slice(
        0,
        200,
      );
      const { status, body } = await contract.author.request("POST", `${contract.at}/envelopes`, {
        json: { documentVersionId: version.id, signers, subject },
        expect: [400, 409, 422, 502, 503],
      });
      if (status >= 300) return;
      const envelope = (body.envelopes ?? []).find((row) => row.status === "sent");
      if (envelope?.id) sent.push({ contract, envelope, subject });
    });
    log(`${sent.length} envelopes sent`);

    // What happened next. A signed or declined round comes back as a
    // Connect delivery, which is the path a real one arrives on; a void
    // is something we do, so it goes through the app.
    const counts = { sent: 0, completed: 0, declined: 0, voided: 0 };
    for (const { contract, envelope, subject } of sent) {
      const outcome = random.weighted(OUTCOMES);
      counts[outcome] += 1;
      if (outcome === "sent") continue;

      if (outcome === "voided") {
        await contract.author.request("POST", `/api/v1/envelopes/${envelope.id}/void`, {
          json: {
            reason: random.pick([
              "Superseded by a revised draft.",
              "Sent to the wrong signatory.",
              "The commercial terms changed after it went out.",
            ]),
          },
          expect: [200, 204, 409, 422, 502],
        });
        continue;
      }

      const providerId = stub.idBySubject(subject);
      if (!providerId) continue;
      const reason =
        outcome === "declined"
          ? random.pick([
              "Our legal team has not finished its review.",
              "The signatory named is not authorised to sign this.",
              "We need the payment terms changed before signing.",
            ])
          : undefined;
      if (outcome === "completed") stub.complete(providerId);
      else stub.decline(providerId, reason);

      const delivery = stub.delivery(providerId, outcome, reason);
      await admin.request("POST", `${DEFAULT_BASE_URL}/api/v1/signing/docusign/webhook`, {
        headers: delivery.headers,
        form: delivery.body,
        expect: [200, 202, 204, 400, 401, 409],
      });
    }
    log(
      `${counts.completed} signed, ${counts.declined} declined, ` +
        `${counts.voided} voided, ${counts.sent} still out`,
    );

    // The executed copies arrive on a queue. Give the worker a moment to
    // pull them, so the document chains are complete when the seed ends.
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // The stand-in dies with this script, so the connector is switched
    // off rather than left pointing at nothing. The envelopes it sent
    // stay on their records either way; what goes is the send control,
    // which could only have failed. `node scripts/seed/signing-stub.mjs`
    // brings the provider back, and the toggle in Settings brings the
    // connector back with it.
    await admin.request("POST", "/api/v1/signing-connectors/docusign/disable", {
      expect: [200, 204, 404, 409],
    });
    log("signing connector switched off; the envelopes it sent remain");
    return true;
  } finally {
    await stub.close();
  }
}
