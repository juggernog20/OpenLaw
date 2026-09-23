// SPDX-License-Identifier: AGPL-3.0-only
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";
import { buildApp } from "./app.js";
import { testDeps } from "./testing/deps.js";
import { provisionUser } from "./auth/instance.js";
import { signInCookies, TEST_ADMIN } from "./testing/harness.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("upgrades existing open Contract Approval items into Your approvals", async () => {
  const db = await freshDb(container, "approval_upgrade");
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await migrateThrough(db, "0162_api-key-notifications", migrationEntries());
    app = await buildApp(testDeps({ db }));
    const person = await provisionUser(app.auth, TEST_ADMIN);
    await db.execute(sql`update users set role = 'administrator' where id = ${person.id}`);
    await db.execute(
      sql`insert into users (id, email, display_name) values ('requester', 'requester@example.com', 'Requester')`,
    );
    await db.execute(
      sql`insert into contracts (id, title, contract_type_id, status_id) select 'contract', 'Upgrade approval', t.id, s.id from contract_types t cross join contract_statuses s limit 1`,
    );
    await db.execute(
      sql`insert into contract_approvals (id, contract_id, approver_id, requested_by, source) values ('open', 'contract', ${person.id}, 'requester', 'manual')`,
    );
    await db.execute(
      sql`insert into contract_approvals (id, contract_id, approver_id, requested_by, source, status, decided_at) values ('done', 'contract', ${person.id}, 'requester', 'manual', 'approved', now())`,
    );
    await db.execute(sql`insert into notifications (id, user_id, event_type, entity_type, entity_id, payload, read_at) values
      ('open-item', ${person.id}, 'approval.requested', 'contract', 'contract', '{"approvalId":"open"}', now()),
      ('done-item', ${person.id}, 'approval.requested', 'contract', 'contract', '{"approvalId":"done"}', null),
      ('cancelled-item', ${person.id}, 'approval.requested', 'contract', 'contract', '{"approvalId":"gone"}', null)`);
    await runMigrations(db);
    await runMigrations(db);
    expect(
      (await db.execute(sql`select id, approval_kind, handled_at from notifications order by id`))
        .rows,
    ).toEqual([
      { id: "cancelled-item", approval_kind: null, handled_at: null },
      { id: "done-item", approval_kind: null, handled_at: null },
      { id: "open-item", approval_kind: "contract", handled_at: null },
    ]);
    const cookies = await signInCookies(app, TEST_ADMIN.email, TEST_ADMIN.password);
    const list = await app.inject({ method: "GET", url: "/api/v1/notifications", cookies });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().notifications[0]).toMatchObject({
      id: "open-item",
      approvalKind: "contract",
      handledAt: null,
    });
  } finally {
    await app?.close();
    await db.$client.end();
  }
});
