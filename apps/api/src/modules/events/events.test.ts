// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The live channel's integration seam (TECH-009): a real Fastify server,
 * a real socket, and the testcontainer Postgres. `app.inject()` waits for
 * a response to finish, so it cannot observe a stream that stays open.
 * Every ordinary request in this suite still uses inject.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, createDb, eq, sql, users } from "@openlaw/db";
import {
  LIVE_EVENT_CHANNEL,
  parseLiveEvent,
  type LiveEvent,
  type RecordLiveEvent,
} from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import { recordActivity } from "../../lib/activity.js";
import { publishLiveEvent } from "../../lib/live-events.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "events-member@example.com",
  displayName: "Events Member",
  password: "correct-horse-battery",
} as const;

const CONTRIBUTOR = {
  email: "events-contributor@example.com",
  displayName: "Events Contributor",
  password: "correct-horse-battery",
} as const;

interface SseFrame {
  event?: string;
  data?: LiveEvent;
  comment?: string;
}

class EventStream {
  readonly response: Response;
  private readonly controller: AbortController;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly frames: SseFrame[] = [];
  private readonly waiters = new Set<() => void>();
  private buffer = "";
  private failure: unknown;

  private constructor(
    response: Response,
    controller: AbortController,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {
    this.response = response;
    this.controller = controller;
    this.reader = reader;
    void this.pump();
  }

  static async open(url: string, cookies: Record<string, string>): Promise<EventStream> {
    const controller = new AbortController();
    const response = await fetch(url, {
      headers: {
        cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
      },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();
    return new EventStream(response, controller, response.body!.getReader());
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private parseBlock(block: string): void {
    const lines = block.split("\n");
    const comment = lines.find((line) => line.startsWith(":"));
    if (comment !== undefined) {
      this.frames.push({ comment: comment.slice(1).trim() });
      return;
    }
    const event = lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    const data = lines
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();
    this.frames.push({
      event,
      data: data ? (parseLiveEvent(JSON.parse(data) as unknown) ?? undefined) : undefined,
    });
  }

  private async pump(): Promise<void> {
    try {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) return;
        this.buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary = this.buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = this.buffer.slice(0, boundary);
          this.buffer = this.buffer.slice(boundary + 2);
          if (block) this.parseBlock(block);
          boundary = this.buffer.indexOf("\n\n");
        }
        this.wake();
      }
    } catch (error) {
      if (!this.controller.signal.aborted) this.failure = error;
    } finally {
      this.wake();
    }
  }

  async next(predicate: (frame: SseFrame) => boolean, timeoutMs = 1_000): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.frames.findIndex(predicate);
      if (index >= 0) return this.frames.splice(index, 1)[0]!;
      if (this.failure) throw this.failure;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Timed out waiting for an SSE frame.");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters.delete(notify);
          resolve();
        }, remaining);
        const notify = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.add(notify);
      });
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.reader.cancel().catch(() => {});
  }
}

let harness: TestHarness;
let origin: string;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let adminId: string;
let memberId: string;
let firstRecord: { id: string; number: number };
let secondRecord: { id: string; number: number };

beforeAll(async () => {
  harness = await startHarness({ eventHeartbeatMs: 25 });
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberId = member.id;
  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));

  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  adminId = admin!.id;

  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  const contractTypeId = (options.json().contractTypes as Array<{ id: string; slug: string }>).find(
    (type) => type.slug === "nda",
  )!.id;

  const makeRecord = async (title: string) => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: adminCookies,
      payload: { title, contractTypeId },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().contract as { id: string; number: number };
  };
  firstRecord = await makeRecord("Live channel one");
  secondRecord = await makeRecord("Live channel two");
  const team = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${secondRecord.number}/team`,
    cookies: adminCookies,
    payload: { userId: contributor.id, role: "contributor" },
  });
  expect(team.statusCode, team.body).toBe(201);

  origin = await harness.app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await harness.stop();
});

const streamUrl = (record?: { id: string }) =>
  record
    ? `${origin}/api/events?entityType=contract&entityId=${record.id}`
    : `${origin}/api/events`;

const recordEvent = (recordId: string, entryId: string): RecordLiveEvent => ({
  kind: "record",
  action: "contract.updated",
  entityType: "contract",
  entityId: recordId,
  entryId,
  visibility: "working_team",
});

const liveFrame = (kind: LiveEvent["kind"]) => (frame: SseFrame) =>
  frame.event === kind && frame.data?.kind === kind;

async function expectNoFrame(
  stream: EventStream,
  predicate: (frame: SseFrame) => boolean,
): Promise<void> {
  await expect(stream.next(predicate, 150)).rejects.toThrow("Timed out waiting for an SSE frame.");
}

describe("GET /api/events", () => {
  it("refuses an unauthenticated open with the ordinary problem vocabulary before streaming", async () => {
    const response = await fetch(streamUrl());
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({
      type: "about:blank",
      title: "Authentication required.",
      status: 401,
      instance: "/api/events",
    });
  });

  it("refuses a record the viewer cannot reach and opens one they can", async () => {
    await harness.db
      .update(contracts)
      .set({ isConfidential: true })
      .where(eq(contracts.id, firstRecord.id));

    const refused = await fetch(streamUrl(firstRecord), {
      headers: {
        cookie: Object.entries(memberCookies)
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
      },
    });
    expect(refused.status).toBe(404);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
    await expect(refused.json()).resolves.toMatchObject({
      type: "about:blank",
      status: 404,
    });

    const reached = await EventStream.open(streamUrl(firstRecord), adminCookies);
    await expect(reached.next((frame) => frame.comment === "heartbeat")).resolves.toBeDefined();
    await reached.close();
  });

  it("keeps a quiet stream alive with heartbeat comments", async () => {
    const stream = await EventStream.open(streamUrl(), adminCookies);
    const first = await stream.next((frame) => frame.comment === "heartbeat", 250);
    const second = await stream.next((frame) => frame.comment === "heartbeat", 250);
    expect(first.comment).toBe("heartbeat");
    expect(second.comment).toBe("heartbeat");
    await stream.close();
  });

  it("delivers a record frame only after commit and only to that record's scope", async () => {
    const first = await EventStream.open(streamUrl(firstRecord), adminCookies);
    const second = await EventStream.open(streamUrl(secondRecord), adminCookies);
    let releaseCommit!: () => void;
    let published!: () => void;
    const sent = new Promise<void>((resolve) => {
      published = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const event = recordEvent(firstRecord.id, "record-after-commit");

    const transaction = harness.db.transaction(async (tx) => {
      await publishLiveEvent(tx, event);
      published();
      await hold;
    });
    await sent;
    await expectNoFrame(first, liveFrame("record"));
    releaseCommit();
    await transaction;

    await expect(first.next(liveFrame("record"))).resolves.toMatchObject({ data: event });
    await expectNoFrame(second, liveFrame("record"));
    await Promise.all([first.close(), second.close()]);
  });

  it("publishes nothing when the writing transaction rolls back", async () => {
    const stream = await EventStream.open(streamUrl(secondRecord), adminCookies);
    await expect(
      harness.db.transaction(async (tx) => {
        await publishLiveEvent(tx, recordEvent(secondRecord.id, "rolled-back-entry"));
        throw new Error("roll back the fixture");
      }),
    ).rejects.toThrow("roll back the fixture");
    await expectNoFrame(stream, liveFrame("record"));
    await stream.close();
  });

  it("publishes every record activity append from its writing transaction", async () => {
    const stream = await EventStream.open(streamUrl(secondRecord), adminCookies);
    let releaseCommit!: () => void;
    let appended!: () => void;
    const written = new Promise<void>((resolve) => {
      appended = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    let entryIds: string[] = [];
    const transaction = harness.db.transaction(async (tx) => {
      const rows = await recordActivity(tx, [
        {
          entityType: "contract",
          entityId: secondRecord.id,
          actorId: adminId,
          action: "contract.updated",
          visibility: "working_team",
          payload: {
            number: secondRecord.number,
            title: "Live channel two",
            changed: { title: { from: "Before", to: "After" } },
          },
        },
        {
          entityType: "contract",
          entityId: secondRecord.id,
          actorId: adminId,
          action: "contract.updated",
          visibility: "legal_only",
          payload: {
            number: secondRecord.number,
            title: "Live channel two",
            changed: { priority: { from: "medium", to: "high" } },
          },
        },
      ]);
      entryIds = rows.map((row) => row.id);
      appended();
      await hold;
    });

    await written;
    await expectNoFrame(stream, liveFrame("record"));
    releaseCommit();
    await transaction;

    const frames = await Promise.all([
      stream.next(liveFrame("record")),
      stream.next(liveFrame("record")),
    ]);
    expect(frames.map((frame) => frame.data)).toEqual([
      {
        kind: "record",
        action: "contract.updated",
        entityType: "contract",
        entityId: secondRecord.id,
        entryId: entryIds[0],
        visibility: "working_team",
      },
      {
        kind: "record",
        action: "contract.updated",
        entityType: "contract",
        entityId: secondRecord.id,
        entryId: entryIds[1],
        visibility: "legal_only",
      },
    ]);
    await stream.close();
  });

  it("delivers record frames only at a visibility tier the viewer can read", async () => {
    const stream = await EventStream.open(streamUrl(secondRecord), contributorCookies);
    await harness.db.transaction((tx) =>
      publishLiveEvent(tx, {
        ...recordEvent(secondRecord.id, "legal-only-entry"),
        visibility: "legal_only",
      }),
    );
    await expectNoFrame(stream, liveFrame("record"));

    const event = recordEvent(secondRecord.id, "working-team-entry");
    await harness.db.transaction((tx) => publishLiveEvent(tx, event));
    await expect(stream.next(liveFrame("record"))).resolves.toMatchObject({ data: event });
    await stream.close();
  });

  it("delivers a bell frame only to the named user", async () => {
    const admin = await EventStream.open(streamUrl(), adminCookies);
    const member = await EventStream.open(streamUrl(), memberCookies);
    const event: LiveEvent = { kind: "bell", userId: adminId };

    await harness.db.transaction((tx) => publishLiveEvent(tx, event));

    await expect(admin.next(liveFrame("bell"))).resolves.toMatchObject({ data: event });
    await expectNoFrame(member, liveFrame("bell"));
    await Promise.all([admin.close(), member.close()]);
  });

  it("delivers the notifier's bell frame through the HTTP stream", async () => {
    const stream = await EventStream.open(streamUrl(), memberCookies);
    const assigned = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${secondRecord.number}`,
      cookies: adminCookies,
      payload: { managerId: memberId },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);

    await expect(stream.next(liveFrame("bell"))).resolves.toMatchObject({
      event: "bell",
      data: { kind: "bell", userId: memberId },
    });
    await stream.close();
  });

  it("delivers Inbox totals to Member+ connections and not Contributors", async () => {
    const member = await EventStream.open(streamUrl(), memberCookies);
    const contributor = await EventStream.open(streamUrl(), contributorCookies);
    const event: LiveEvent = { kind: "inbox", total: 7 };

    await harness.db.transaction((tx) => publishLiveEvent(tx, event));

    await expect(member.next(liveFrame("inbox"))).resolves.toMatchObject({ data: event });
    await expectNoFrame(contributor, liveFrame("inbox"));
    await Promise.all([member.close(), contributor.close()]);
  });

  it("drops a malformed payload without dropping the stream", async () => {
    const stream = await EventStream.open(streamUrl(), memberCookies);
    // Postgres authenticates the process, not the payload: one payload
    // that is not JSON, and one that parses but is not a live event.
    await harness.db.execute(sql`select pg_notify(${LIVE_EVENT_CHANNEL}, ${"not json"})`);
    await harness.db.execute(
      sql`select pg_notify(${LIVE_EVENT_CHANNEL}, ${JSON.stringify({ kind: "bell" })})`,
    );
    await expectNoFrame(stream, liveFrame("bell"));

    // The listener survived both: a well-formed frame still arrives.
    const event: LiveEvent = { kind: "bell", userId: memberId };
    await harness.db.transaction((tx) => publishLiveEvent(tx, event));
    await expect(stream.next(liveFrame("bell"))).resolves.toMatchObject({ data: event });
    expect(
      harness.jobLog.some((line) => line.message === "live event payload could not be read"),
    ).toBe(true);
    await stream.close();
  });

  it("receives a publish from a second process handle over the shared Postgres channel", async () => {
    const stream = await EventStream.open(streamUrl(), memberCookies);
    const secondProcessDb = createDb(harness.databaseUrl);
    const event: LiveEvent = { kind: "bell", userId: memberId };
    try {
      await secondProcessDb.transaction((tx) => publishLiveEvent(tx, event));
      await expect(stream.next(liveFrame("bell"))).resolves.toMatchObject({ data: event });
      expect(LIVE_EVENT_CHANNEL).toBe("openlaw_live_events");
    } finally {
      await stream.close();
      await secondProcessDb.$client.end();
    }
  });
});
