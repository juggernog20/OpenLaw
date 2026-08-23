// SPDX-License-Identifier: AGPL-3.0-only

/** M22/6's matter conversation, history, unread, attachment, and notification seams. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const ACTOR = {
  email: "matter-comments-actor@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const MEMBER = {
  email: "matter-comments-member@example.com",
  displayName: "Mina Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "matter-comments-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-comments-outsider@example.com",
  displayName: "Ola Outsider",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const ids = new Map<string, string>();

const as = (fixture: { email: string }) => cookies.get(fixture.email)!;
const idOf = (fixture: { email: string }) => ids.get(fixture.email)!;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  for (const [fixture, role] of [
    [ACTOR, "legal_team_member"],
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [OUTSIDER, "legal_team_member"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    ids.set(fixture.email, person.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
});

afterAll(async () => {
  await harness.stop();
});

async function privateMatter(title: string): Promise<{ id: string; number: number }> {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: as(ACTOR),
  });
  expect(options.statusCode, options.body).toBe(200);
  const [type] = options.json().matterTypes as { id: string; slug: string }[];
  expect(type, "the seeded matter type").toBeDefined();
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: as(ACTOR),
    payload: {
      title,
      matterTypeId: type!.id,
      managerId: idOf(MEMBER),
      isConfidential: true,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const matter = created.json().matter as { id: string; number: number };
  const added = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matters/${matter.number}/team`,
    cookies: as(ACTOR),
    payload: { userId: idOf(CONTRIBUTOR), role: "contributor" },
  });
  expect(added.statusCode, added.body).toBe(201);
  return matter;
}

function post(
  fixture: { email: string },
  matterId: string,
  body: string,
  visibility: string,
  mentions?: readonly string[],
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(fixture),
    payload: {
      entityType: "matter",
      entityId: matterId,
      body,
      visibility,
      ...(mentions ? { mentions } : {}),
    },
  });
}

function thread(fixture: { email: string }, matterId: string) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=matter&entityId=${matterId}`,
    cookies: as(fixture),
  });
}

function unread(fixture: { email: string }, matterId: string) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/unread?entityType=matter&entityId=${matterId}`,
    cookies: as(fixture),
  });
}

async function bell(fixture: { email: string }, matterId: string) {
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/notifications",
    cookies: as(fixture),
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json().notifications as { entityId: string; eventType: string }[]).filter(
    (item) => item.entityId === matterId,
  );
}

const BOUNDARY = "openlaw-matter-comment-paper";
function paper(matterId: string, visibility = "working_team") {
  const payload = Buffer.from(
    `--${BOUNDARY}\r\ncontent-disposition: form-data; name="entityType"\r\n\r\nmatter\r\n` +
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="entityId"\r\n\r\n${matterId}\r\n` +
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="body"\r\n\r\nPaper attached.\r\n` +
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="visibility"\r\n\r\n${visibility}\r\n` +
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="advice.pdf"\r\ncontent-type: application/pdf\r\n\r\nadvice-bytes\r\n` +
      `--${BOUNDARY}--\r\n`,
  );
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(ACTOR),
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  });
}

describe("a matter speaks", () => {
  it("holds tiers, reach, unread watermarks, history, and both notification groups", async () => {
    const matter = await privateMatter("Confidential advice thread");
    const legal = await post(ACTOR, matter.id, "Legal analysis.", "legal_only");
    expect(legal.statusCode, legal.body).toBe(201);
    const full = await post(ACTOR, matter.id, "Team update.", "full_thread", [idOf(MEMBER)]);
    expect(full.statusCode, full.body).toBe(201);

    const member = await thread(MEMBER, matter.id);
    expect(member.statusCode, member.body).toBe(200);
    expect(member.json().comments.map((row: { body: string }) => row.body)).toEqual([
      "Legal analysis.",
      "Team update.",
    ]);
    const contributor = await thread(CONTRIBUTOR, matter.id);
    expect(contributor.statusCode, contributor.body).toBe(200);
    expect(contributor.json().comments.map((row: { body: string }) => row.body)).toEqual([
      "Team update.",
    ]);
    const outside = await thread(OUTSIDER, matter.id);
    expect(outside.statusCode, outside.body).toBe(404);
    // A mention does not grant the record: a Member outside a confidential
    // matter's team is not a person the thread can name.
    const named = await post(ACTOR, matter.id, "Psst.", "full_thread", [idOf(OUTSIDER)]);
    expect(named.statusCode, named.body).toBe(400);

    expect((await unread(MEMBER, matter.id)).json().unread).toBe(2);
    expect((await unread(CONTRIBUTOR, matter.id)).json().unread).toBe(1);
    const marked = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments/read",
      cookies: as(CONTRIBUTOR),
      payload: { entityType: "matter", entityId: matter.id },
    });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json().unread).toBe(0);

    expect((await bell(MEMBER, matter.id)).map((item) => item.eventType)).toEqual([
      "comment.mentioned",
      "comment.posted",
    ]);
    expect((await bell(CONTRIBUTOR, matter.id)).map((item) => item.eventType)).toEqual([
      "comment.posted",
    ]);
    expect(await bell(OUTSIDER, matter.id)).toEqual([]);

    const history = await harness.app.inject({
      method: "GET",
      url: `/api/v1/activity?entityType=matter&entityId=${matter.id}`,
      cookies: as(MEMBER),
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(
      history
        .json()
        .entries.filter((entry: { action: string }) => entry.action === "comment.posted")
        .map((entry: { payload: { commentId: string } }) => entry.payload.commentId),
    ).toEqual([full.json().comment.id, legal.json().comment.id]);
  });

  it("uploads and downloads an attachment at the comment's matter tier", async () => {
    const matter = await privateMatter("Advice with paper");
    const posted = await paper(matter.id);
    expect(posted.statusCode, posted.body).toBe(201);
    const comment = posted.json().comment as {
      id: string;
      attachments: { id: string; filename: string }[];
    };
    expect(comment.attachments).toMatchObject([{ filename: "advice.pdf" }]);

    const downloaded = await harness.app.inject({
      method: "GET",
      url:
        `/api/v1/comments/${comment.id}/attachments/${comment.attachments[0]!.id}` +
        `?entityType=matter&entityId=${matter.id}`,
      cookies: as(CONTRIBUTOR),
    });
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.rawPayload.toString()).toBe("advice-bytes");

    const outside = await harness.app.inject({
      method: "GET",
      url:
        `/api/v1/comments/${comment.id}/attachments/${comment.attachments[0]!.id}` +
        `?entityType=matter&entityId=${matter.id}`,
      cookies: as(OUTSIDER),
    });
    expect(outside.statusCode, outside.body).toBe(404);

    // The attachment takes its comment's tier: Legal Only paper is not
    // there for a Contributor, even one on the team.
    const sealed = await paper(matter.id, "legal_only");
    expect(sealed.statusCode, sealed.body).toBe(201);
    const sealedComment = sealed.json().comment as { id: string; attachments: { id: string }[] };
    const held = await harness.app.inject({
      method: "GET",
      url:
        `/api/v1/comments/${sealedComment.id}/attachments/${sealedComment.attachments[0]!.id}` +
        `?entityType=matter&entityId=${matter.id}`,
      cookies: as(CONTRIBUTOR),
    });
    expect(held.statusCode, held.body).toBe(404);
  });
});
