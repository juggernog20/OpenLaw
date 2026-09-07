// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, requests, requestTypes, users } from "@openlaw/db";
import {
  dispositionScaffold,
  settles,
  MEMBER,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let typeId: string;
beforeAll(async () => {
  harness = await startHarness();
  expect(
    (await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  cast = await dispositionScaffold(harness);
  const [type] = await harness.db
    .select()
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"));
  typeId = type!.id;
});
afterAll(async () => {
  await harness.stop();
});
async function submit() {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: cast.requesterCookies,
    payload: {
      requestTypeId: typeId,
      summary: "Choose who should triage",
      description: "Review the proposed NDA.",
      urgency: "medium",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}
function assign(number: number, assigneeId: string | null, cookies = cast.adminCookies) {
  return harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${number}/assignee`,
    cookies,
    payload: { assigneeId },
  });
}

it("persists assignment in the list and detail, with activity and an assignee notification", async () => {
  const request = await submit();
  const res = await assign(request.number, cast.memberId);
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().request).toMatchObject({
    status: "new",
    assignee: { id: cast.memberId, displayName: MEMBER.displayName },
  });
  expect((await cast.stored(request.id)).assigneeId).toBe(cast.memberId);
  const list = await harness.app.inject({
    method: "GET",
    url: "/api/v1/requests",
    cookies: cast.memberCookies,
  });
  expect(
    list.json().requests.find((row: { id: string }) => row.id === request.id).assignee.id,
  ).toBe(cast.memberId);
  const detail = await harness.app.inject({
    method: "GET",
    url: `/api/v1/requests/${request.number}`,
    cookies: cast.memberCookies,
  });
  expect(detail.json().request.assignee.id).toBe(cast.memberId);
  expect(
    (await cast.entriesOn(request.id)).filter((row) => row.action === "request.assignee_changed"),
  ).toHaveLength(1);
  expect(
    (await cast.bellRowsOn(cast.memberId, request.id)).filter(
      (row) => row.eventType === "request.assigned",
    ),
  ).toHaveLength(1);
  expect(
    (await cast.bellRowsOn(cast.requesterId, request.id)).some(
      (row) => row.eventType === "request.assigned",
    ),
  ).toBe(false);
  await settles("triage assignment email", () =>
    cast
      .mailAbout(MEMBER.email, request.number)
      .some((mail) => mail.subject.includes("assigned for triage")),
  );
  expect(
    cast
      .mailAbout(MEMBER.email, request.number)
      .find((mail) => mail.subject.includes("assigned for triage"))!.text,
  ).toContain(`/inbox/${request.number}`);
});

it("reassigns and clears without changing status; repeating an assignment does not duplicate events", async () => {
  const request = await submit();
  for (const id of [cast.memberId, cast.memberId])
    expect((await assign(request.number, id)).statusCode).toBe(200);
  expect(
    (await cast.entriesOn(request.id)).filter((row) => row.action === "request.assignee_changed"),
  ).toHaveLength(1);
  const [other] = await harness.db
    .select()
    .from(users)
    .where(eq(users.email, "other.member@example.com"));
  expect((await assign(request.number, other!.id, cast.memberCookies)).statusCode).toBe(200);
  expect((await cast.stored(request.id)).assigneeId).toBe(other!.id);
  expect((await assign(request.number, null, cast.memberCookies)).statusCode).toBe(200);
  expect(await cast.stored(request.id)).toMatchObject({ assigneeId: null, status: "new" });
});

it("limits candidates and assignment to active staff who can triage", async () => {
  const request = await submit();
  const [contributor] = await harness.db
    .select()
    .from(users)
    .where(eq(users.email, "contributor@example.com"));
  const [other] = await harness.db
    .select()
    .from(users)
    .where(eq(users.email, "other.member@example.com"));
  await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, other!.id));
  try {
    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests/assignees",
      cookies: cast.memberCookies,
    });
    expect(options.statusCode).toBe(200);
    const ids = options.json().people.map((person: { id: string }) => person.id);
    expect(ids).toContain(cast.memberId);
    for (const id of [cast.requesterId, contributor!.id, other!.id, "missing"]) {
      expect(ids).not.toContain(id);
      expect((await assign(request.number, id)).statusCode).toBe(400);
    }
    expect((await cast.stored(request.id)).assigneeId).toBeNull();
  } finally {
    await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, other!.id));
  }
});

it("refuses non-triagers and unauthenticated callers on both endpoints", async () => {
  const request = await submit();
  for (const cookies of [cast.requesterCookies, cast.contributorCookies, {}]) {
    const expected = Object.keys(cookies).length ? 403 : 401;
    expect((await assign(request.number, cast.memberId, cookies)).statusCode).toBe(expected);
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/requests/assignees", cookies }))
        .statusCode,
    ).toBe(expected);
  }
});

it("refuses assignment on closed, archived and missing requests", async () => {
  const request = await submit();
  expect(
    (
      await harness.app.inject({
        method: "POST",
        url: `/api/v1/requests/${request.number}/resolve`,
        cookies: cast.memberCookies,
        payload: { reply: "No further legal work needed." },
      })
    ).statusCode,
  ).toBe(200);
  expect((await assign(request.number, cast.memberId)).statusCode).toBe(409);
  await harness.db
    .update(requests)
    .set({ archivedAt: new Date() })
    .where(eq(requests.id, request.id));
  expect((await assign(request.number, cast.memberId)).statusCode).toBe(404);
  expect((await assign(999999, cast.memberId)).statusCode).toBe(404);
});

it("self-assignment does not notify the actor", async () => {
  const request = await submit();
  expect((await assign(request.number, cast.memberId, cast.memberCookies)).statusCode).toBe(200);
  expect(
    (await cast.bellRowsOn(cast.memberId, request.id)).some(
      (row) => row.eventType === "request.assigned",
    ),
  ).toBe(false);
});

it("serializes reassignment with resolution and never reopens the request", async () => {
  const request = await submit();
  const [assignment, resolution] = await Promise.all([
    assign(request.number, cast.memberId),
    harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/resolve`,
      cookies: cast.memberCookies,
      payload: { reply: "Answered; no record needed." },
    }),
  ]);
  expect(resolution.statusCode).toBe(200);
  expect([200, 409]).toContain(assignment.statusCode);
  expect((await cast.stored(request.id)).status).toBe("resolved");
  expect((await assign(request.number, null)).statusCode).toBe(409);
});
