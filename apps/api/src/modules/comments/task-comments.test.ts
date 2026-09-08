// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  eq,
  users,
  comments,
  commentLastRead,
  contractTasks,
  matterTasks,
  matterTeam,
  contractTeam,
  notifications,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
let contributor: Record<string, string>;
let outsider: Record<string, string>;
let teammateId: string;
let adminId: string;
beforeAll(async () => {
  harness = await startHarness();
  expect(
    (await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const [administrator] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEST_ADMIN.email))
    .limit(1);
  adminId = administrator!.id;
  for (const [name, role] of [
    ["Teammate", "contributor"],
    ["Outsider", "legal_team_member"],
  ] as const) {
    const email = `${name.toLowerCase()}@task-comments.example`;
    const password = "correct-horse-battery";
    const user = await provisionUser(harness.app.auth, { email, password, displayName: name });
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    const cookies = await signInCookies(harness.app, email, password);
    if (name === "Teammate") {
      contributor = cookies;
      teammateId = user.id;
    } else outsider = cookies;
  }
});
afterAll(async () => harness.stop());

describe.each(["matter", "contract"] as const)("%s Task details", (module) => {
  it("stores descriptions and isolated conversations, inherits access, and protects attachments", async () => {
    const options = await harness.app.inject({
      method: "GET",
      url: `/api/v1/${module}s/options`,
      cookies: admin,
    });
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s`,
      cookies: admin,
      payload: {
        title: "Private work",
        [`${module}TypeId`]: options.json()[`${module}Types`][0].id,
        isConfidential: true,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const record = created.json()[module];
    if (module === "matter")
      await harness.db
        .insert(matterTeam)
        .values({ matterId: record.id, userId: teammateId, role: "contributor" });
    else
      await harness.db
        .insert(contractTeam)
        .values({ contractId: record.id, userId: teammateId, role: "contributor" });
    const add = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s/${record.number}/tasks`,
      cookies: admin,
      payload: { title: "Draft response", description: "Explain the negotiation strategy." },
    });
    expect(add.statusCode, add.body).toBe(201);
    const taskId = add.json().createdTaskId;
    expect(add.json().tasks[0]).toMatchObject({
      id: taskId,
      description: "Explain the negotiation strategy.",
    });
    const taskPath = module === "matter" ? "matter-tasks" : "tasks";
    const edited = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/${taskPath}/${taskId}`,
      cookies: admin,
      payload: { description: "Revised instructions" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().tasks[0].description).toBe("Revised instructions");
    const query = `entityType=${module}_task&entityId=${taskId}`;
    const post = async (body: string, visibility = "working_team", cookies = admin) =>
      harness.app.inject({
        method: "POST",
        url: "/api/v1/comments",
        cookies,
        payload: { entityType: `${module}_task`, entityId: taskId, body, visibility },
      });
    const note = await post("Please review this before Friday.");
    expect(note.statusCode, note.body).toBe(201);
    expect((await post("Legal strategy", "legal_only")).statusCode).toBe(201);
    expect((await post("Unavailable audience", "full_thread")).statusCode).toBe(403);
    const thread = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?${query}`,
      cookies: contributor,
    });
    expect(thread.statusCode, thread.body).toBe(200);
    expect(thread.json().comments.map((row: { body: string }) => row.body)).toEqual([
      "Please review this before Friday.",
    ]);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/comments?${query}`,
          cookies: outsider,
        })
      ).statusCode,
    ).toBe(404);
    const parentThread = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=${module}&entityId=${record.id}`,
      cookies: admin,
    });
    expect(parentThread.json().comments).toEqual([]);
    const boundary = "task-attachment-boundary";
    const fields = {
      entityType: `${module}_task`,
      entityId: taskId,
      body: "Working paper",
      visibility: "working_team",
    };
    const form =
      Object.entries(fields)
        .map(
          ([name, value]) =>
            `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join("") +
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="instructions.txt"\r\ncontent-type: text/plain\r\n\r\nDrafting instructions\r\n--${boundary}--\r\n`;
    const upload = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: admin,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(form),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const comment = upload.json().comment;
    const attachment = comment.attachments[0];
    const downloadUrl = `/api/v1/comments/${comment.id}/attachments/${attachment.id}?${query}`;
    const download = await harness.app.inject({
      method: "GET",
      url: downloadUrl,
      cookies: contributor,
    });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toBe("Drafting instructions");
    expect(
      (await harness.app.inject({ method: "GET", url: downloadUrl, cookies: outsider })).statusCode,
    ).toBe(404);
    const bell = await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, teammateId));
    expect(bell.some((row) => row.payload.taskId === taskId)).toBe(true);
    const clear = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/${taskPath}/${taskId}`,
      cookies: admin,
      payload: { description: null },
    });
    expect(clear.json().tasks[0].description).toBeNull();
  });
});

/**
 * Removing a Task and the conversation on it (CMT-006 Task addendum).
 *
 * A Task row is deleted outright, and its comments hang off its id with
 * no foreign key to follow them. So the removal is refused while
 * anything is on the thread rather than taking somebody else's words
 * with it, and the refusal names the way out: mark the Task done. The
 * cases below are the whole rule — a live comment, each of the two
 * tombstones, the empty Task that still goes, and the post that arrives
 * while the removal is deciding.
 */
describe.each(["matter", "contract"] as const)("%s Task removal", (module) => {
  const taskPath = module === "matter" ? "matter-tasks" : "tasks";
  const entityType = `${module}_task` as "matter_task" | "contract_task";
  const table = module === "matter" ? matterTasks : contractTasks;

  /** One record of this module with one Task on it, made through the API. */
  async function seedTask(title: string): Promise<string> {
    const options = await harness.app.inject({
      method: "GET",
      url: `/api/v1/${module}s/options`,
      cookies: admin,
    });
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s`,
      cookies: admin,
      payload: { title, [`${module}TypeId`]: options.json()[`${module}Types`][0].id },
    });
    expect(created.statusCode, created.body).toBe(201);
    const added = await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s/${created.json()[module].number}/tasks`,
      cookies: admin,
      payload: { title: "Draft the position" },
    });
    expect(added.statusCode, added.body).toBe(201);
    return added.json().createdTaskId;
  }

  const post = async (taskId: string, body: string) =>
    harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: admin,
      payload: { entityType, entityId: taskId, body, visibility: "working_team" },
    });
  const remove = async (taskId: string) =>
    harness.app.inject({ method: "DELETE", url: `/api/v1/${taskPath}/${taskId}`, cookies: admin });
  const commentRows = async (taskId: string) =>
    harness.db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.entityType, entityType), eq(comments.entityId, taskId)));

  it.each(["live", "deleted", "redacted"] as const)(
    "keeps a Task carrying a %s comment and says to mark it done instead",
    async (state) => {
      const taskId = await seedTask(`Removal with a ${state} comment`);
      const said = await post(taskId, "The counterparty answered on Tuesday.");
      expect(said.statusCode, said.body).toBe(201);
      const commentId = said.json().comment.id;
      if (state === "deleted")
        expect(
          (
            await harness.app.inject({
              method: "DELETE",
              url: `/api/v1/comments/${commentId}`,
              cookies: admin,
            })
          ).statusCode,
        ).toBe(200);
      if (state === "redacted")
        expect(
          (
            await harness.app.inject({
              method: "POST",
              url: `/api/v1/comments/${commentId}/redact`,
              cookies: admin,
            })
          ).statusCode,
        ).toBe(200);

      const refused = await remove(taskId);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().detail).toBe(
        "This Task has a conversation on it, so it cannot be removed. Mark it done instead.",
      );
      // Neither the Task nor the words it carries moved.
      expect(await commentRows(taskId)).toHaveLength(1);
      expect(
        await harness.db.select({ id: table.id }).from(table).where(eq(table.id, taskId)),
      ).toHaveLength(1);
      // The way out the refusal names is open.
      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: `/api/v1/${taskPath}/${taskId}/toggle`,
            cookies: admin,
          })
        ).statusCode,
      ).toBe(200);
    },
  );

  it("removes a Task nobody said anything on and takes its read marks with it", async () => {
    const taskId = await seedTask("Removal with an empty thread");
    // Opening the panel writes a watermark. A bookmark into a thread
    // with nothing in it must not hold the Task hostage, and must not
    // outlive it either.
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: "/api/v1/comments/read",
          cookies: admin,
          payload: { entityType, entityId: taskId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await harness.db
        .select({ userId: commentLastRead.userId })
        .from(commentLastRead)
        .where(
          and(eq(commentLastRead.entityType, entityType), eq(commentLastRead.entityId, taskId)),
        ),
    ).toHaveLength(1);

    const gone = await remove(taskId);
    expect(gone.statusCode, gone.body).toBe(200);
    expect(gone.json().tasks.some((row: { id: string }) => row.id === taskId)).toBe(false);
    expect(
      await harness.db
        .select({ userId: commentLastRead.userId })
        .from(commentLastRead)
        .where(
          and(eq(commentLastRead.entityType, entityType), eq(commentLastRead.entityId, taskId)),
        ),
    ).toEqual([]);
  });

  it("waits for a comment already in flight and then refuses the removal", async () => {
    const taskId = await seedTask("Removal racing a post");
    // A post that has taken the Task's share lock and written its row,
    // as the comment seam does, and has not committed yet.
    let posted!: () => void;
    let commit!: () => void;
    const holding = new Promise<void>((resolve) => (posted = resolve));
    const release = new Promise<void>((resolve) => (commit = resolve));
    const posting = harness.db.transaction(async (tx) => {
      await tx
        .select({ id: table.id })
        .from(table)
        .where(eq(table.id, taskId))
        .limit(1)
        .for("share");
      await tx.insert(comments).values({
        entityType,
        entityId: taskId,
        authorId: adminId,
        body: "Landed while the removal was deciding.",
        visibility: "working_team",
      });
      posted();
      await release;
    });
    await holding;

    const removal = remove(taskId);
    // Long enough for the removal to reach the Task row and wait there.
    await new Promise((resolve) => setTimeout(resolve, 250));
    commit();
    await posting;

    const refused = await removal;
    expect(refused.statusCode, refused.body).toBe(409);
    expect(await commentRows(taskId)).toHaveLength(1);
    expect(
      await harness.db.select({ id: table.id }).from(table).where(eq(table.id, taskId)),
    ).toHaveLength(1);
  });

  it("makes a post wait for a removal already deciding, and land nowhere", async () => {
    const taskId = await seedTask("A post racing a removal");
    // The other order: the removal has the Task row and has not
    // finished. The post resolves the thread under a share lock, so it
    // waits here rather than reading a Task that is about to go and
    // inserting after it went.
    let holding!: () => void;
    let commit!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const release = new Promise<void>((resolve) => (commit = resolve));
    const removing = harness.db.transaction(async (tx) => {
      await tx
        .select({ id: table.id })
        .from(table)
        .where(eq(table.id, taskId))
        .limit(1)
        .for("update");
      holding();
      await release;
      await tx.delete(table).where(eq(table.id, taskId));
    });
    await held;

    const posting = post(taskId, "Sent while the Task was being taken off.");
    let answered = false;
    void posting.then(() => (answered = true));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(answered, "the post did not wait for the Task row").toBe(false);
    commit();
    await removing;

    const late = await posting;
    expect(late.statusCode, late.body).toBe(404);
    expect(await commentRows(taskId)).toEqual([]);
  });

  it("answers no thread at all once the Task is gone, so late words cannot land", async () => {
    const taskId = await seedTask("Removal then a late post");
    expect((await remove(taskId)).statusCode).toBe(200);
    const late = await post(taskId, "Sent after the Task was taken off.");
    expect(late.statusCode, late.body).toBe(404);
    expect(await commentRows(taskId)).toEqual([]);
  });
});
