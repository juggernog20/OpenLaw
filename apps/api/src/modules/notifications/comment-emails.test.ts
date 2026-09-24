// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { activityLog, commentAttachments, eq, notifications, users } from "@openlaw/db";
import { buildApp } from "../../app.js";
import { provisionUser } from "../../auth/instance.js";
import { handleNotificationEmail } from "../../pipeline/notification-email.js";
import { testDeps } from "../../testing/deps.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { requestDepartment } from "../../testing/request-department.js";

let h: TestHarness;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookies: Record<string, string>;
let staffId: string;
let requesterId: string;
const records = new Map<string, { id: string; number: number }>();
const staff = {
  email: "comment-reader@example.com",
  displayName: "Sam Reader",
  password: "correct-horse-battery",
};
const requester = {
  email: "comment-requester@example.com",
  displayName: "Rae Requester",
  password: "correct-horse-battery",
};

beforeAll(async () => {
  h = await startHarness();
  // Hold delivery until each real comment mutation has committed.
  app = await buildApp(testDeps({ db: h.db }));
  const setup = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(app, TEST_ADMIN.email, TEST_ADMIN.password);
  staffId = (await provisionUser(app.auth, staff)).id;
  requesterId = (await provisionUser(app.auth, requester)).id;
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, staffId));
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, requesterId));
  for (const kind of ["contract", "matter"] as const) {
    const options = await app.inject({ method: "GET", url: `/api/v1/${kind}s/options`, cookies });
    const typeId = options.json()[`${kind}Types`][0].id as string;
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/${kind}s`,
      cookies,
      payload: { title: `Comment email ${kind}`, [`${kind}TypeId`]: typeId, managerId: staffId },
    });
    expect(created.statusCode, created.body).toBe(201);
    records.set(kind, created.json()[kind]);
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/${kind}s/${created.json()[kind].number}/team`,
      cookies,
      payload: { userId: requesterId },
    });
    expect(added.statusCode, added.body).toBe(201);
  }
  const staffCookies = await signInCookies(app, staff.email, staff.password);
  const preference = await app.inject({
    method: "PATCH",
    url: "/api/v1/me/notification-preferences",
    cookies: staffCookies,
    payload: { eventGroup: "activity_on_your_records", channel: "email", enabled: true },
  });
  expect(preference.statusCode, preference.body).toBe(200);
  const types = await app.inject({ method: "GET", url: "/api/v1/request-types", cookies });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: await signInCookies(app, requester.email, requester.password),
    payload: {
      title: "Comment email Request",
      requestTypeId: types.json().requestTypes[0].id,
      departmentId: await requestDepartment(h.db),
      urgency: "medium",
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  records.set("request", created.json().request);
});
afterAll(async () => {
  await app?.close();
  await h?.stop();
});

afterEach(async () => {
  const saved = await app.inject({
    method: "PATCH",
    url: "/api/v1/org/notifications",
    cookies,
    payload: { commentWordsInEmail: true },
  });
  expect(saved.statusCode, saved.body).toBe(200);
});

const arms = [
  { kind: "contract", event: "comment.mentioned", tier: "legal_only", label: "Legal Only" },
  { kind: "contract", event: "comment.posted", tier: "working_team", label: "Working Team" },
  { kind: "matter", event: "comment.mentioned", tier: "working_team", label: "Working Team" },
  { kind: "matter", event: "comment.posted", tier: "full_thread", label: "Full Thread" },
  { kind: "request", event: "comment.mentioned", tier: "legal_only", label: "Legal Only" },
  { kind: "request", event: "request.replied", tier: "full_thread", label: "Full Thread" },
  {
    kind: "contract",
    event: "comment.mentioned",
    tier: "full_thread",
    label: "Full Thread",
    portal: true,
  },
  {
    kind: "matter",
    event: "comment.mentioned",
    tier: "full_thread",
    label: "Full Thread",
    portal: true,
  },
] as const;
const states = ["present", "edited", "deleted", "redacted", "cut", "disabled"] as const;
it.each(arms.flatMap((arm) => states.map((state) => ({ portal: false, ...arm, state }))))(
  "$kind $event carries the send-time words when $state",
  async ({ kind, event, tier, label, state, portal: recordPortal }) => {
    const record = records.get(kind)!;
    const portal = recordPortal || event === "request.replied";
    const reader = portal ? requester : staff;
    const recipientId = portal ? requesterId : staffId;
    // The reader sees a document reference (CMT-011) as its title.
    const short = `@${reader.displayName} check <this> & that. Read @Brief [v2].pdf first.\nThe second line.`;
    const stored = short.replace(
      "@Brief [v2].pdf",
      `[@Brief \\[v2\\].pdf](/${kind === "request" ? "matter" : kind}s/7/documents?doc=doc-a&version=ver-a)`,
    );
    const prefix = "word ".repeat(54).trimEnd();
    const original = state === "cut" ? `${prefix} extraordinary omitted ending` : stored;
    const posted = await app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies,
      payload: {
        entityType: kind,
        entityId: record.id,
        body: original,
        visibility: tier,
        mentions: event === "comment.posted" ? [] : [recipientId],
      },
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const commentId = posted.json().comment.id as string;
    if (state === "present") {
      const [author] = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
      await h.db.insert(commentAttachments).values({
        commentId,
        uploadedBy: author!.id,
        filename: "do-not-email-this-attachment.pdf",
        fileRef: "local:comment-mail-fixture",
      });
    }
    const rows = await h.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, record.id));
    const notification = rows.find(
      (item) =>
        item.userId === recipientId &&
        item.eventType === event &&
        item.payload.commentId === commentId,
    );
    expect(notification?.emailOwed).toBe(true);
    if (state === "edited" || state === "deleted" || state === "redacted") {
      const changed = await app.inject({
        method: state === "edited" ? "PATCH" : state === "deleted" ? "DELETE" : "POST",
        url: `/api/v1/comments/${commentId}${state === "redacted" ? "/redact" : ""}`,
        cookies,
        ...(state === "edited" ? { payload: { body: "Changed before delivery." } } : {}),
      });
      expect(changed.statusCode, changed.body).toBe(200);
    }
    if (state === "disabled") {
      const saved = await app.inject({
        method: "PATCH",
        url: "/api/v1/org/notifications",
        cookies,
        payload: { commentWordsInEmail: false },
      });
      expect(saved.statusCode, saved.body).toBe(200);
    }
    const before = h.mailer.messages.length;
    await handleNotificationEmail(
      {
        db: h.db,
        resolveMailer: async () => ({ source: "env", from: "legal@example.com", mailer: h.mailer }),
        baseUrl: "http://localhost",
        log: { info() {}, warn() {}, error() {} },
      },
      { notificationId: notification!.id, retryCount: 0, retryLimit: 3 },
    );
    expect(h.mailer.messages).toHaveLength(before + 1);
    const message = h.mailer.messages[before]!;
    const link = `http://localhost/${kind === "request" ? (portal ? "portal/requests" : "inbox") : `${portal ? "portal/" : ""}${kind}s`}/${record.number}`;
    expect(message.html).toContain(`Reply on the ${kind}`);
    expect(message.html).toContain(`href="${link}"`);
    expect(message.html).toContain(portal ? "/portal/settings" : "/settings/notifications");
    expect(message.attachments).toHaveLength(1);
    expect(message.text).not.toContain("do-not-email-this-attachment.pdf");
    expect(message.html).not.toContain("do-not-email-this-attachment.pdf");
    expect(
      message.attachments?.some((file) => file.filename === "do-not-email-this-attachment.pdf"),
    ).toBe(false);
    expect(message.attachments?.[0]?.cid).toBeTruthy();
    if (state === "deleted" || state === "redacted" || state === "disabled") {
      expect(message.text).not.toContain("check <this>");
      expect(message.html).not.toContain("check &lt;this&gt;");
      expect(message.text).not.toContain("> ");
      expect(message.html).not.toContain("Read the full comment");
    } else {
      const words =
        state === "edited" ? "Changed before delivery." : state === "cut" ? `${prefix}…` : short;
      expect(message.text).toContain(
        words
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n"),
      );
      expect(message.html).toContain(
        state === "present" ? "check &lt;this&gt; &amp; that. Read @Brief [v2].pdf first." : words,
      );
      expect(message.text).not.toContain("?doc=");
      expect(message.html).not.toContain("?doc=");
      expect(message.html).toContain(TEST_ADMIN.displayName);
      expect(message.html).toContain('width="20" height="20"');
      expect(message.text.indexOf("> ")).toBeLessThan(message.text.indexOf(link));
      if (!portal) expect(message.html).toContain(label);
      if (state === "present" && event !== "comment.posted")
        expect(message.html).toMatch(new RegExp(`<span[^>]*>@${reader.displayName}</span>`));
    }
    if (portal) expect(message.html).not.toMatch(/Legal Only|Working Team|Full Thread/);
    if (state === "edited") {
      expect(message.text).not.toContain("check <this>");
      expect(message.html).not.toContain("check &lt;this&gt;");
    }
    if (state === "cut") {
      expect(message.text).toContain(`Read the full comment → ${link}`);
      expect(message.html).toContain("Read the full comment &rarr;");
      expect(message.text).not.toContain("extraordinary");
      expect(message.html).not.toContain("extraordinary");
    }
    const entries = await h.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, record.id));
    for (const payload of [
      ...rows.map((item) => item.payload),
      ...entries.map((item) => item.payload),
    ]) {
      expect(JSON.stringify(payload)).not.toContain("check <this>");
      expect(JSON.stringify(payload)).not.toContain("Changed before delivery");
      expect(JSON.stringify(payload)).not.toContain("omitted ending");
    }
  },
);

it("shows no tier on a Task comment's email, as the Task thread shows no badge", async () => {
  const contract = records.get("contract")!;
  const task = await app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/tasks`,
    cookies,
    payload: { title: "Check the indemnity" },
  });
  expect(task.statusCode, task.body).toBe(201);
  const posted = await app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    payload: {
      entityType: "contract_task",
      entityId: task.json().createdTaskId,
      body: `@${staff.displayName} the task note.`,
      visibility: "legal_only",
      mentions: [staffId],
    },
  });
  expect(posted.statusCode, posted.body).toBe(201);
  const commentId = posted.json().comment.id as string;
  const rows = await h.db.select().from(notifications).where(eq(notifications.userId, staffId));
  const notification = rows.find(
    (item) => item.eventType === "comment.mentioned" && item.payload.commentId === commentId,
  );
  expect(notification?.emailOwed).toBe(true);
  const before = h.mailer.messages.length;
  await handleNotificationEmail(
    {
      db: h.db,
      resolveMailer: async () => ({ source: "env", from: "legal@example.com", mailer: h.mailer }),
      baseUrl: "http://localhost",
      log: { info() {}, warn() {}, error() {} },
    },
    { notificationId: notification!.id, retryCount: 0, retryLimit: 3 },
  );
  expect(h.mailer.messages).toHaveLength(before + 1);
  const message = h.mailer.messages[before]!;
  expect(message.html).toContain("the task note.");
  expect(message.text).toContain("> @Sam Reader the task note.");
  expect(message.html).not.toMatch(/Legal Only|Working Team|Full Thread/);
});
