// SPDX-License-Identifier: AGPL-3.0-only
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => {
  await container?.stop();
});

it("preserves sent history, timestamps, Signers and executed-copy references on expansion", async () => {
  const db = await freshDb(container, "envelope_preparation");
  try {
    await migrateThrough(db, "0171_m41-oauth-clients", migrationEntries());
    await db.execute(sql`insert into users (id, email, display_name, role)
      values ('preparer', 'preparer@example.test', 'Preparer', 'legal_team_member')`);
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id)
      select 'contract', 'Existing Contract', ct.id, cs.id from contract_types ct cross join contract_statuses cs
      where ct.slug = 'other' and cs.slug = 'draft'`);
    await db.execute(sql`insert into documents (id, title, contract_id, created_by)
      values ('document', 'Agreement', 'contract', 'preparer')`);
    await db.execute(sql`insert into document_versions (id, document_id, version_number, file_ref, kind, original_filename, mime_type, byte_size, checksum_sha256, created_by)
      values ('source', 'document', 1, 'local:source', 'draft_ours', 'agreement.pdf', 'application/pdf', 42, repeat('a', 64), 'preparer'),
      ('executed', 'document', 2, 'local:executed', 'executed', 'signed.pdf', 'application/pdf', 44, repeat('b', 64), 'preparer')`);
    for (const status of ["sent", "signed", "declined", "voided"]) {
      await db.execute(sql`insert into contract_envelopes (id, contract_id, provider, provider_envelope_id, document_version_id, status, sent_by, sent_at, completed_at, executed_version_id, executed_fetch, reason)
        values (${status}, 'contract', 'docusign', ${`provider-${status}`}, 'source', ${status}, 'preparer', '2026-08-01',
        ${status === "sent" ? null : "2026-08-02"}::timestamptz, ${status === "signed" ? "executed" : null}, ${status === "signed" ? "ready" : "pending"}, ${status === "declined" || status === "voided" ? "Recorded reason" : null})`);
      await db.execute(sql`insert into contract_envelope_signers (id, envelope_id, name, email, signing_order)
        values (${`signer-${status}`}, ${status}, 'Signer', 'signer@example.test', 1)`);
    }
    const read = () =>
      db.execute(
        sql`select id, provider_envelope_id, document_version_id, status, sent_by, sent_at, completed_at, executed_version_id, executed_fetch, reason from contract_envelopes order by id`,
      );
    const before = await read();
    await runMigrations(db);
    expect((await read()).rows).toEqual(before.rows);
    expect((await db.execute(sql`select * from contract_envelope_signers`)).rows).toHaveLength(4);
    expect(
      (await db.execute(sql`select provider_account_id, preparation_state from contract_envelopes`))
        .rows,
    ).toEqual(
      Array.from({ length: 4 }, () => ({ provider_account_id: null, preparation_state: null })),
    );
    await db.execute(sql`delete from contract_envelopes where status = 'sent'`);
    await db.execute(sql`insert into contract_envelopes (id, contract_id, provider, status, sent_by, sent_at, preparation_state)
      values ('draft', 'contract', 'docusign', 'preparing', 'preparer', null, 'uncertain')`);
    await expect(
      db.execute(sql`insert into contract_envelopes (id, contract_id, provider, provider_envelope_id, status, sent_by)
      values ('racing-send', 'contract', 'docusign', 'external-send', 'sent', 'preparer')`),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  } finally {
    await db.$client.end();
  }
});

it("leaves the intent of older interrupted operations unknown", async () => {
  const db = await freshDb(container, "envelope_recovery_intent");
  try {
    await migrateThrough(db, "0176_envelope-recovery", migrationEntries());
    await db.execute(
      sql`insert into users (id, email, display_name, role) values ('sender', 'sender@example.test', 'Sender', 'legal_team_member')`,
    );
    await db.execute(sql`insert into contracts (id, title, contract_type_id, status_id)
      select 'contract', 'Interrupted', ct.id, cs.id from contract_types ct cross join contract_statuses cs where ct.slug = 'other' and cs.slug = 'draft'`);
    await db.execute(sql`insert into contract_envelopes (id, contract_id, provider, status, sent_by, sent_at, preparation_state, provider_transaction_id)
      values ('interrupted', 'contract', 'docusign', 'preparing', 'sender', null, 'uncertain', 'original-operation')`);
    await runMigrations(db);
    expect(
      (
        await db.execute(
          sql`select status, preparation_state, provider_transaction_id, creation_kind, creation_status_id, creation_status_revision from contract_envelopes`,
        )
      ).rows,
    ).toEqual([
      {
        status: "preparing",
        preparation_state: "uncertain",
        provider_transaction_id: "original-operation",
        creation_kind: null,
        creation_status_id: null,
        creation_status_revision: null,
      },
    ]);
  } finally {
    await db.$client.end();
  }
});
