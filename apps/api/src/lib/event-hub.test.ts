// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The subscriber caps (M11 of the 2026-09-17 security review), checked on
 * the in-process registry alone. The Postgres listener shares it, and
 * `modules/events/events.test.ts` covers the route over a real socket.
 */

import { describe, expect, it } from "vitest";
import type { LiveEvent } from "@openlaw/shared";
import {
  createTestingEventHub,
  DEFAULT_MAX_SUBSCRIPTIONS,
  DEFAULT_MAX_SUBSCRIPTIONS_PER_USER,
  EventHubFullError,
  type EventConnectionScope,
} from "./event-hub.js";

function scope(userId: string): EventConnectionScope {
  return { userId, role: "legal_team_member" };
}

describe("event hub subscriber caps", () => {
  it("ships with five streams per user and five hundred per process", () => {
    expect(DEFAULT_MAX_SUBSCRIPTIONS_PER_USER).toBe(5);
    expect(DEFAULT_MAX_SUBSCRIPTIONS).toBe(500);
  });

  it("closes a user's oldest stream when they open one past the cap", () => {
    const hub = createTestingEventHub(1_000, { maxPerUser: 2 });
    const received: string[] = [];
    const closed: string[] = [];
    const open = (name: string) =>
      hub.subscribe(
        scope("alice"),
        () => received.push(name),
        () => closed.push(name),
      );
    open("first");
    open("second");
    expect(hub.size).toBe(2);

    open("third");
    expect(closed).toEqual(["first"]);
    expect(hub.size).toBe(2);

    const bell: LiveEvent = { kind: "bell", userId: "alice" };
    hub.fanOut(bell);
    expect(received).toEqual(["second", "third"]);

    // Another person's streams are not counted against alice.
    open("fourth");
    expect(closed).toEqual(["first", "second"]);
    hub.subscribe(scope("bob"), () => received.push("bob"));
    expect(hub.size).toBe(3);
    hub.fanOut({ kind: "bell", userId: "bob" });
    expect(received).toEqual(["second", "third", "bob"]);
  });

  it("refuses a new stream at the process cap instead of closing another user's", () => {
    const hub = createTestingEventHub(1_000, { maxPerUser: 5, maxTotal: 3 });
    const closed: string[] = [];
    hub.subscribe(
      scope("alice"),
      () => {},
      () => closed.push("alice"),
    );
    hub.subscribe(
      scope("bob"),
      () => {},
      () => closed.push("bob"),
    );
    hub.subscribe(
      scope("carol"),
      () => {},
      () => closed.push("carol"),
    );

    expect(() => hub.subscribe(scope("dave"), () => {})).toThrow(EventHubFullError);
    expect(closed).toEqual([]);
    expect(hub.size).toBe(3);
  });

  it("lets a user at their own cap reconnect at the process cap by closing their oldest", () => {
    const hub = createTestingEventHub(1_000, { maxPerUser: 1, maxTotal: 2 });
    const closed: string[] = [];
    hub.subscribe(
      scope("alice"),
      () => {},
      () => closed.push("alice"),
    );
    hub.subscribe(
      scope("bob"),
      () => {},
      () => closed.push("bob"),
    );
    expect(() => hub.subscribe(scope("alice"), () => {})).not.toThrow();
    expect(closed).toEqual(["alice"]);
    expect(hub.size).toBe(2);
  });

  it("frees the slot when a stream unsubscribes", () => {
    const hub = createTestingEventHub(1_000, { maxTotal: 1 });
    const unsubscribe = hub.subscribe(scope("alice"), () => {});
    expect(() => hub.subscribe(scope("bob"), () => {})).toThrow(EventHubFullError);
    unsubscribe();
    expect(() => hub.subscribe(scope("bob"), () => {})).not.toThrow();
  });

  it("survives a close hook that throws", () => {
    const hub = createTestingEventHub(1_000, { maxPerUser: 1 });
    hub.subscribe(
      scope("alice"),
      () => {},
      () => {
        throw new Error("socket already gone");
      },
    );
    expect(() => hub.subscribe(scope("alice"), () => {})).not.toThrow();
    expect(hub.size).toBe(1);
  });
});
