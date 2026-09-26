// SPDX-License-Identifier: AGPL-3.0-only

/** Old and new Envelope history through the migrated HTTP application (CTR-013). */
import { expect, it, vi } from "vitest";
import { contractEnvelopes, documentVersions, eq, sql, type Db } from "@openlaw/db";
import { provisionUser } from "./auth/instance.js";
import { FAKE_VALID_INTEGRATION_KEY } from "./lib/signing/fake.js";
import { migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";
import { signInCookies, startHarness, TEST_ADMIN } from "./testing/harness.js";

const originalRows = (db: Db) =>
  db.execute(sql`
  select id, provider_envelope_id, document_version_id, status, sent_by, sent_at,
    completed_at, executed_version_id, executed_fetch, reason, created_at
  from contract_envelopes where id like 'old-%' order by id`);

it("preserves historical rounds, reads and Void beside preparation, erasure and reordered completion", async () => {
  let before: unknown;
  const h = await startHarness({
    signingPreparationEnabled: true,
    beforeMigrations: async (db) => {
      await migrateThrough(db, "0171_m41-oauth-clients", migrationEntries());
      await db.execute(sql`insert into users (id, email, display_name, role)
        values ('old-preparer', 'old-preparer@example.test', 'Historical sender', 'legal_team_member')`);
      await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id)
        select 'history-contract', 'Upgraded history', ct.id, cs.id from contract_types ct cross join contract_statuses cs where ct.slug = 'other' and cs.slug = 'draft'`);
      await db.execute(sql`insert into documents (id, title, contract_id, created_by)
        values ('history-document', 'Original agreement', 'history-contract', 'old-preparer')`);
      await db.execute(sql`insert into document_versions (id, document_id, version_number, file_ref, kind, original_filename, mime_type, byte_size, checksum_sha256, created_by)
        values ('old-source', 'history-document', 1, 'local:old-source', 'draft_ours', 'agreement.pdf', 'application/pdf', 42, repeat('a', 64), 'old-preparer'),
        ('old-executed', 'history-document', 2, 'local:old-executed', 'executed', 'signed.pdf', 'application/pdf', 44, repeat('b', 64), 'old-preparer')`);
      await db.execute(
        sql`update contracts set primary_document_id = 'history-document' where id = 'history-contract'`,
      );
      // Import order deliberately differs from Sent order. Both timestamps are real facts.
      for (const [index, status] of ["sent", "signed", "declined", "voided"].entries()) {
        const sentAt = new Date(Date.UTC(2026, 7, 10 - index));
        await db.execute(sql`insert into contract_envelopes (id, contract_id, provider, provider_envelope_id, document_version_id, status, sent_by, sent_at, completed_at, executed_version_id, executed_fetch, reason, created_at)
          values (${`old-${status}`}, 'history-contract', 'docusign', ${`provider-${status}`}, 'old-source', ${status}, 'old-preparer', ${sentAt},
          ${status === "sent" ? null : new Date(sentAt.getTime() + 86400000)}, ${status === "signed" ? "old-executed" : null}, ${status === "signed" ? "ready" : "pending"}, ${["declined", "voided"].includes(status) ? "Historical reason" : null}, ${new Date(Date.UTC(2026, 8, index + 1))})`);
        await db.execute(sql`insert into contract_envelope_signers (id, envelope_id, name, email, signing_order)
          values (${`old-signer-${status}`}, ${`old-${status}`}, 'Historical Signer', 'historical-signer@example.test', 1)`);
        await db.execute(sql`insert into activity_log (id, entity_type, entity_id, actor_id, action, visibility, payload, created_at)
          values (${`old-activity-${status}`}, 'contract', 'history-contract', ${status === "sent" ? "old-preparer" : null}, ${`envelope.${status}`}, 'working_team',
          ${JSON.stringify({ envelopeId: `old-${status}`, provider: "docusign", providerEnvelopeId: `provider-${status}`, status, ...(status === "sent" ? { signers: [{ name: "Historical Signer", email: "historical-signer@example.test" }] } : {}) })}::jsonb, ${sentAt})`);
      }
      before = (await originalRows(db)).rows;
    },
  });
  try {
    expect((await originalRows(h.db)).rows).toEqual(before);
    const admin = await provisionUser(h.app.auth, TEST_ADMIN);
    await h.db.execute(sql`update users set role = 'administrator' where id = ${admin.id}`);
    const cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const contract = (
      await h.db.execute<{ number: number }>(
        sql`select number from contracts where id = 'history-contract'`,
      )
    ).rows[0]!;
    const read = async () => {
      const response = await h.app.inject({
        method: "GET",
        url: `/api/v1/contracts/${contract.number}/envelopes`,
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    const rows = (await read()).envelopes;
    expect(rows.map((row: { id: string }) => row.id)).toEqual([
      "old-sent",
      "old-signed",
      "old-declined",
      "old-voided",
    ]);
    expect(rows[0]).toMatchObject({
      sentBy: { id: "old-preparer" },
      sentAt: "2026-08-10T00:00:00.000Z",
      preparationState: null,
      documentVersionId: "old-source",
    });
    expect(rows[1]).toMatchObject({
      executedCopy: { versionId: "old-executed", documentId: "history-document" },
    });
    const activity = await h.app.inject({
      method: "GET",
      url: "/api/v1/activity?entityType=contract&entityId=history-contract",
      cookies,
    });
    expect(activity.statusCode, activity.body).toBe(200);
    expect(activity.json().entries).toHaveLength(4);
    expect(activity.json().entries[0]).toMatchObject({
      id: "old-activity-sent",
      actor: { id: "old-preparer" },
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    const configured = await h.app.inject({
      method: "PUT",
      url: "/api/v1/signing-connectors/docusign",
      cookies,
      payload: {
        environment: "demo",
        updateMode: "webhook",
        integrationKey: FAKE_VALID_INTEGRATION_KEY,
        apiUserId: "99999999-8888-7777-6666-555555555555",
        privateKey:
          "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAopenlawfixturekeyneverusedanywhereexceptthissuite\n-----END RSA PRIVATE KEY-----",
        webhookSecret: "history-fixture-webhook",
      },
    });
    expect(configured.statusCode, configured.body).toBe(200);
    const voided = await h.app.inject({
      method: "POST",
      url: "/api/v1/envelopes/old-sent/void",
      cookies,
      payload: { reason: "Replace historical round" },
    });
    expect(voided.statusCode, voided.body).toBe(200);
    const erased = await h.app.inject({
      method: "POST",
      url: "/api/v1/signer-erasures",
      cookies,
      payload: { email: "historical-signer@example.test" },
    });
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json().erasure).toEqual({ entriesRedacted: 1, signerRowsDeleted: 4 });
    const oldLog = await h.app.inject({
      method: "GET",
      url: "/api/v1/activity?entityType=contract&entityId=history-contract",
      cookies,
    });
    expect(
      oldLog.json().entries.find((entry: { id: string }) => entry.id === "old-activity-sent"),
    ).toMatchObject({
      payload: { signers: [{ name: "[erased]", email: "[erased]" }] },
      createdAt: "2026-08-10T00:00:00.000Z",
    });

    const upload = await h.app.inject({
      method: "POST",
      url: "/api/v1/documents/history-document/versions",
      cookies,
      headers: { "content-type": "multipart/form-data; boundary=history" },
      payload: Buffer.from(
        '--history\r\nContent-Disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n--history\r\nContent-Disposition: form-data; name="file"; filename="new.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\n%%EOF\r\n--history--\r\n',
      ),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const source = (await read()).primaryDocument.versions[0].id as string;
    const prepared = await h.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      cookies,
      payload: {
        documentVersionId: source,
        signers: [{ name: "New Signer", email: "new-signer@example.test" }],
        idempotencyKey: "upgraded-preparation",
      },
    });
    expect(prepared.statusCode, prepared.body).toBe(201);
    const round = prepared.json().envelopes[0];
    expect(round).toMatchObject({ status: "draft", sentAt: null, sentBy: { id: admin.id } });
    const [stored] = await h.db
      .select()
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.id, round.id));
    h.signing!.complete(stored!.providerEnvelopeId!);
    // There is no launch or browser return, and completion arrives before Sent.
    for (const status of ["signed", "sent", "signed"] as const) {
      const signed = h.signing!.signedDelivery({
        providerEnvelopeId: stored!.providerEnvelopeId!,
        status,
      });
      const response = await h.app.inject({
        method: "POST",
        url: "/api/v1/signing/docusign/webhook",
        headers: { ...signed.headers, "content-type": "application/json" },
        payload: signed.body,
      });
      expect(response.statusCode, response.body).toBe(204);
    }
    await vi.waitFor(
      async () =>
        expect((await read()).envelopes[0]).toMatchObject({
          status: "signed",
          executedFetch: "ready",
        }),
      { timeout: 15000 },
    );
    const completed = (await read()).envelopes[0];
    const [copy] = await h.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, completed.executedCopy.versionId));
    expect(copy).toMatchObject({
      documentId: "history-document",
      createdBy: admin.id,
      versionNumber: 4,
    });
    expect(
      await h.db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, "history-document")),
    ).toHaveLength(4);
    const finalActivity = await h.app.inject({
      method: "GET",
      url: "/api/v1/activity?entityType=contract&entityId=history-contract",
      cookies,
    });
    const newHistory = finalActivity
      .json()
      .entries.filter(
        (entry: { payload: { envelopeId?: string } }) => entry.payload.envelopeId === round.id,
      );
    expect(newHistory.map((entry: { action: string }) => entry.action).sort()).toEqual([
      "envelope.confirmed",
      "envelope.preparation_started",
      "envelope.signed",
    ]);
    expect(
      newHistory.find((entry: { action: string }) => entry.action === "envelope.signed"),
    ).toMatchObject({ actor: null });
  } finally {
    await h.stop();
  }
});
