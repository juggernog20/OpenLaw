// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-006 and NOT-009: Assignment, Claim, and reminder behavior over real Postgres. */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, and, contracts, eq, notifications, orgSettings, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { AutoDocFillError } from "../../lib/auto-doc-fill/engine.js";
import { runMorningRound } from "../../pipeline/morning-round.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let legalCookies: Record<string, string>;
let businessCookies: Record<string, string>;
let adminId: string;
let firstId: string;
let secondId: string;
let businessId: string;
let typeId: string;
const post = (path: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: "POST", url: `/api/v1${path}`, cookies, payload });
const save = (id: string, payload: Record<string, unknown>) =>
  h.app.inject({
    method: "PUT",
    url: `/api/v1/auto-docs/${id}/assignment-rules`,
    cookies,
    payload,
  });
const rule = (legalOwnerId: string, operator = "equals", value: unknown = "US") => ({
  fieldSlug: "jurisdiction",
  operator,
  value,
  legalOwnerId,
});

beforeAll(async () => {
  h = await startHarness({ runPipelineWorkers: false });
  await post("/auth/setup", TEST_ADMIN);
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const [admin] = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  adminId = admin!.id;
  for (const [key, role] of [
    ["first", "legal_team_member"],
    ["second", "legal_team_member"],
    ["buyer", "business_user"],
  ] as const) {
    const person = await provisionUser(h.app.auth, {
      email: `assignment-${key}@example.com`,
      displayName: `Assignment ${key}`,
      password: "correct-horse-battery",
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (key === "first") {
      firstId = person.id;
      legalCookies = await signInCookies(
        h.app,
        `assignment-${key}@example.com`,
        "correct-horse-battery",
      );
    } else if (key === "second") secondId = person.id;
    else {
      businessId = person.id;
      businessCookies = await signInCookies(
        h.app,
        `assignment-${key}@example.com`,
        "correct-horse-battery",
      );
    }
  }
  const made = await post("/contract-types", { displayName: "Assigned Auto-Doc NDA" });
  expect(made.statusCode, made.body).toBe(201);
  typeId = made.json().contractType.id;
});
afterAll(async () => {
  await h.stop();
});

async function prepare() {
  const made = await post("/auto-docs", { name: "Assignment NDA" });
  expect(made.statusCode, made.body).toBe(201);
  const id: string = made.json().autoDoc.id;
  const configured = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies,
    payload: {
      targetContractTypeId: typeId,
      formats: "docx",
      audience: "everyone",
      acknowledgementFrequency: "none",
    },
  });
  expect(configured.statusCode, configured.body).toBe(200);
  const bytes = await readFile(
    new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url),
  );
  const upload = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies,
    headers: { "content-type": "multipart/form-data; boundary=assignment" },
    payload: Buffer.concat([
      Buffer.from(
        '--assignment\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--assignment--\r\n"),
    ]),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const form = await post(`/auto-docs/${id}/form-versions`, {
    fields: [
      { slug: "counterparty_name", label: "Counterparty", fieldType: "text" },
      { slug: "signing_date", label: "Date", fieldType: "date" },
      { slug: "jurisdiction", label: "Jurisdiction", fieldType: "text" },
    ],
  });
  expect(form.statusCode, form.body).toBe(201);
  return {
    id,
    pair: {
      documentVersionId: upload.json().template.versions[0].id,
      formVersionId: form.json().formVersion.id,
    },
  };
}
async function generate(
  prepared: Awaited<ReturnType<typeof prepare>>,
  jurisdiction: string | null,
) {
  const response = await h.app.inject({
    method: "POST",
    url: `/api/v1/portal/auto-docs/${prepared.id}/generations`,
    cookies: businessCookies,
    payload: {
      ...prepared.pair,
      answers: { counterparty_name: "Acme Assignment", signing_date: "2026-10-01", jurisdiction },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const generation = response.json().generation;
  expect(generation.state).toBe("ready");
  const [row] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, generation.createdContract!.id));
  return { generation, row: row! };
}
async function publish(prepared: Awaited<ReturnType<typeof prepare>>) {
  const reply = await post(`/auto-docs/${prepared.id}/publish`, prepared.pair);
  expect(reply.statusCode, reply.body).toBe(200);
}

it("saves all four operators, preserves rule identities while reordering, and audits changes and a cleared default", async () => {
  const prepared = await prepare();
  const first = await save(prepared.id, {
    rules: [
      rule(firstId),
      rule(secondId, "is_one_of", ["UK", "FR"]),
      rule(firstId, "is_set", null),
      rule(secondId, "is_not", "US"),
    ],
    defaultLegalOwnerId: adminId,
  });
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().autoDoc.defaultLegalOwnerId).toBe(adminId);
  const original = first.json().assignmentRules;
  expect(original.map((item: { operator: string }) => item.operator)).toEqual([
    "equals",
    "is_one_of",
    "is_set",
    "is_not",
  ]);
  const editable = original.map(
    ({ id, fieldSlug, operator, value, legalOwnerId }: Record<string, unknown>) => ({
      id,
      fieldSlug,
      operator,
      value,
      legalOwnerId,
    }),
  );
  const reordered = await save(prepared.id, {
    rules: [{ ...editable[1], value: ["FR"] }, editable[0]],
    defaultLegalOwnerId: null,
  });
  expect(reordered.statusCode, reordered.body).toBe(200);
  expect(reordered.json().assignmentRules.map((item: { id: string }) => item.id)).toEqual([
    original[1].id,
    original[0].id,
  ]);
  expect(reordered.json().autoDoc.defaultLegalOwnerId).toBeNull();
  const cleared = await save(prepared.id, { rules: [], defaultLegalOwnerId: null });
  expect(cleared.statusCode, cleared.body).toBe(200);
  expect(cleared.json().assignmentRules).toEqual([]);
  const audit = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, prepared.id), eq(activityLog.action, "auto_doc.updated")));
  const changes = audit.filter((row) =>
    Object.hasOwn(row.payload.changed as object, "assignmentRules"),
  );
  expect(changes).toHaveLength(3);
  expect(changes[0]!.payload).toMatchObject({
    changed: { defaultLegalOwner: { from: null, to: TEST_ADMIN.displayName } },
  });
});

it("refuses missing fields, invalid operator values, and a Business User as Legal Owner", async () => {
  const prepared = await prepare();
  for (const rules of [
    [{ ...rule(firstId), fieldSlug: "missing" }],
    [rule(firstId, "is_one_of", "US")],
    [rule(businessId)],
  ]) {
    const reply = await save(prepared.id, { rules, defaultLegalOwnerId: null });
    expect(reply.statusCode, reply.body).toBe(400);
  }
  const forbidden = await h.app.inject({
    method: "PUT",
    url: `/api/v1/auto-docs/${prepared.id}/assignment-rules`,
    cookies: businessCookies,
    payload: { rules: [], defaultLegalOwnerId: null },
  });
  expect(forbidden.statusCode).toBe(403);
});

it("uses the first match, then the default, and notifies the selected Legal Owner without notifying the Business User", async () => {
  const prepared = await prepare();
  expect(
    (
      await save(prepared.id, {
        rules: [rule(firstId), rule(secondId, "is_set", null)],
        defaultLegalOwnerId: adminId,
      })
    ).statusCode,
  ).toBe(200);
  await publish(prepared);
  for (const [answer, expected] of [
    ["US", firstId],
    ["UK", secondId],
    [null, adminId],
  ] as const) {
    const { generation, row } = await generate(prepared, answer);
    expect(row.managerId).toBe(expected);
    const events = await h.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.entityId, row.id), eq(notifications.eventType, "contract.generated")),
      );
    expect(events.map((event) => event.userId)).toEqual([expected]);
    expect(events[0]!.payload).toMatchObject({
      autoDocId: prepared.id,
      autoDocName: "Assignment NDA",
      generationId: generation.id,
      actorId: businessId,
      actorName: "Assignment buyer",
    });
    expect(
      await h.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.entityId, row.id), eq(notifications.userId, businessId))),
    ).toEqual([]);
  }
});

it.each([
  ["equals", "US", "US"],
  ["is_one_of", ["US", "UK"], "UK"],
  ["is_set", null, "FR"],
  ["is_not", "US", "FR"],
])("routes the %s condition using the Clause rule grammar", async (operator, value, answer) => {
  const prepared = await prepare();
  expect(
    (
      await save(prepared.id, {
        rules: [rule(firstId, operator as string, value)],
        defaultLegalOwnerId: null,
      })
    ).statusCode,
  ).toBe(200);
  await publish(prepared);
  expect((await generate(prepared, answer as string)).row.managerId).toBe(firstId);
});

it("lists only reachable live unassigned generated Contracts and claims them with the existing Owner narration", async () => {
  const prepared = await prepare();
  await publish(prepared);
  const unassigned = await generate(prepared, "US");
  const elsewhere = await generate(prepared, "FR");
  const archived = await generate(prepared, "UK");
  await h.db
    .update(contracts)
    .set({ archivedAt: new Date() })
    .where(eq(contracts.id, archived.row.id));
  const hidden = await generate(prepared, "UK");
  await h.db.update(contracts).set({ isConfidential: true }).where(eq(contracts.id, hidden.row.id));
  const manual = await post("/contracts", { title: "Manual unassigned", contractTypeId: typeId });
  expect(manual.statusCode, manual.body).toBe(201);
  const events = await h.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.entityId, unassigned.row.id),
        eq(notifications.eventType, "contract.generated_unassigned"),
      ),
    );
  expect(events.map((event) => event.userId).sort()).toEqual([adminId, firstId, secondId].sort());
  const read = () =>
    h.app.inject({ url: "/api/v1/inbox/unassigned-contracts", cookies: legalCookies });
  const list = await read();
  expect(list.statusCode, list.body).toBe(200);
  expect(
    list
      .json()
      .contracts.map((item: { number: number }) => item.number)
      .sort(),
  ).toEqual([unassigned.row.number, elsewhere.row.number].sort());
  expect(list.json().total).toBe(2);
  const claimed = await h.app.inject({
    method: "POST",
    url: `/api/v1/inbox/unassigned-contracts/${unassigned.row.number}/claim`,
    cookies: legalCookies,
    payload: {},
  });
  expect(claimed.statusCode, claimed.body).toBe(200);
  const [row] = await h.db.select().from(contracts).where(eq(contracts.id, unassigned.row.id));
  expect(row!.managerId).toBe(firstId);
  const history = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, row!.id), eq(activityLog.action, "contract.updated")));
  expect(history.at(-1)!.payload).toMatchObject({
    changed: { owner: { from: null, to: "Assignment first" } },
  });
  expect((await read()).json().total).toBe(1);
  const choices = await h.app.inject({
    url: "/api/v1/inbox/unassigned-contracts/assignees",
    cookies: legalCookies,
  });
  expect(choices.statusCode, choices.body).toBe(200);
  expect(
    choices
      .json()
      .people.map((person: { id: string }) => person.id)
      .sort(),
  ).toEqual([adminId, firstId, secondId].sort());
  const assigned = await h.app.inject({
    method: "POST",
    url: `/api/v1/inbox/unassigned-contracts/${elsewhere.row.number}/assign`,
    cookies: legalCookies,
    payload: { legalOwnerId: secondId },
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const [assignedRow] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, elsewhere.row.id));
  expect(assignedRow!.managerId).toBe(secondId);
  expect((await read()).json().total).toBe(0);
  const duplicate = await h.app.inject({
    method: "POST",
    url: `/api/v1/inbox/unassigned-contracts/${row!.number}/claim`,
    cookies: legalCookies,
    payload: {},
  });
  expect(duplicate.statusCode).toBe(409);
  expect(
    (await h.app.inject({ url: "/api/v1/inbox/unassigned-contracts", cookies: businessCookies }))
      .statusCode,
  ).toBe(403);
});

it("broadcasts generated Contract expiry and notice reminders until Claim, then tells only the Owner", async () => {
  await h.db.update(orgSettings).set({ reminderOffsetDays: [30] });
  const prepared = await prepare();
  await publish(prepared);
  const { row } = await generate(prepared, "US");
  const configure = async (expiryDate: string) => {
    const patched = await h.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${row.number}`,
      cookies,
      payload: { termType: "fixed", expiryDate, noticePeriodDays: 7 },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().contract.expiryDate).toBe(expiryDate);
  };
  const round = async (day: string) => {
    const errors: unknown[] = [];
    const result = await runMorningRound(
      {
        db: h.db,
        notifier: h.notifier,
        resolveMailer: h.resolveMailer,
        baseUrl: "http://localhost",
        log: {
          info() {},
          warn() {},
          error(fields, message) {
            errors.push({ fields, message });
          },
        },
      },
      h.pipeline,
      { now: new Date(`${day}T12:00:00Z`) },
    );
    expect(errors).toEqual([]);
    expect(result.served).toBe(3);
    expect(result.reminders, JSON.stringify({ day, result })).toBeGreaterThan(0);
  };
  await configure("2040-03-31");
  await round("2040-03-01");
  await round("2040-02-23");
  for (const eventType of [
    "date.expiry_approaching",
    "date.notice_deadline_approaching",
  ] as const) {
    const events = await h.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.entityId, row.id), eq(notifications.eventType, eventType)));
    expect(events.map((event) => event.userId).sort()).toEqual([adminId, firstId, secondId].sort());
  }
  const claimed = await h.app.inject({
    method: "POST",
    url: `/api/v1/inbox/unassigned-contracts/${row.number}/claim`,
    cookies: legalCookies,
    payload: {},
  });
  expect(claimed.statusCode, claimed.body).toBe(200);
  await configure("2040-05-31");
  await round("2040-05-01");
  await round("2040-04-24");
  for (const eventType of [
    "date.expiry_approaching",
    "date.notice_deadline_approaching",
  ] as const) {
    const events = await h.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.entityId, row.id), eq(notifications.eventType, eventType)));
    const afterClaim = events.filter((event) =>
      String(event.payload.reminderDate).startsWith("2040-05"),
    );
    expect(afterClaim.map((event) => event.userId)).toEqual([firstId]);
  }
});

it("keeps the accepted Owner and original generator when failed fill is retried after a settings edit", async () => {
  const prepared = await prepare();
  expect((await save(prepared.id, { rules: [], defaultLegalOwnerId: firstId })).statusCode).toBe(
    200,
  );
  await publish(prepared);
  h.fillEngine.failure = new AutoDocFillError("Retry this fill.");
  let failed;
  try {
    const response = await h.app.inject({
      method: "POST",
      url: `/api/v1/portal/auto-docs/${prepared.id}/generations`,
      cookies: businessCookies,
      payload: {
        ...prepared.pair,
        answers: {
          counterparty_name: "Retry Owner",
          signing_date: "2026-10-01",
          jurisdiction: "US",
        },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    failed = response.json().generation;
  } finally {
    h.fillEngine.failure = null;
  }
  expect(failed.state).toBe("failed");
  expect(failed.createdContract).toBeNull();
  expect((await save(prepared.id, { rules: [], defaultLegalOwnerId: secondId })).statusCode).toBe(
    200,
  );
  const retried = await post(`/auto-docs/${prepared.id}/generations/${failed.id}/retry`, {});
  expect(retried.statusCode, retried.body).toBe(200);
  const generation = retried.json().generation;
  expect(generation.state).toBe("ready");
  const [row] = await h.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, generation.createdContract.id));
  expect(row!.managerId).toBe(firstId);
  const events = await h.db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.entityId, row!.id), eq(notifications.eventType, "contract.generated")),
    );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    userId: firstId,
    payload: { actorId: businessId, generationId: failed.id },
  });
});

it("allows only one simultaneous Claim and writes one Owner change", async () => {
  const prepared = await prepare();
  await publish(prepared);
  const { row } = await generate(prepared, "US");
  const replies = await Promise.all(
    [cookies, legalCookies].map((jar) =>
      h.app.inject({
        method: "POST",
        url: `/api/v1/inbox/unassigned-contracts/${row.number}/claim`,
        cookies: jar,
        payload: {},
      }),
    ),
  );
  expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 409]);
  const events = await h.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, row.id), eq(activityLog.action, "contract.updated")));
  expect(
    events.filter((event) => Object.hasOwn(event.payload.changed as object, "owner")),
  ).toHaveLength(1);
});

it.each(["archived", "demoted"])(
  "leaves the generated Contract unassigned when its selected Owner was %s",
  async (kind) => {
    const prepared = await prepare();
    expect(
      (
        await save(prepared.id, {
          rules: [rule(firstId), rule(secondId, "is_set", null)],
          defaultLegalOwnerId: firstId,
        })
      ).statusCode,
    ).toBe(200);
    await publish(prepared);
    await h.db
      .update(users)
      .set(kind === "archived" ? { archivedAt: new Date() } : { role: "business_user" })
      .where(eq(users.id, firstId));
    try {
      expect((await generate(prepared, "US")).row.managerId).toBeNull();
      expect((await generate(prepared, null)).row.managerId).toBeNull();
    } finally {
      await h.db
        .update(users)
        .set({ role: "legal_team_member", archivedAt: null })
        .where(eq(users.id, firstId));
    }
  },
);
