// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users, matterTeam, contractTeam, notifications } from "@openlaw/db";
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
beforeAll(async () => {
  harness = await startHarness();
  expect(
    (await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
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
