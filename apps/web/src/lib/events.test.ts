// SPDX-License-Identifier: AGPL-3.0-only

/** The browser-owned live connection, including record navigation (TECH-009). */

import { expect, it, vi } from "vitest";
import { stubEventSource } from "../testing/helpers";

it("closes the record-scoped connection and reopens at the next record's scope", async () => {
  const sources = stubEventSource();
  const { retainLiveEvents } = await import("./events");

  const leaveFirst = retainLiveEvents({ entityType: "contract", entityId: "contract one" });
  expect(sources).toHaveLength(1);
  expect(sources[0]?.url).toBe("/api/events?entityType=contract&entityId=contract+one");

  leaveFirst();
  const leaveSecond = retainLiveEvents({ entityType: "matter", entityId: "matter-two" });
  expect(sources).toHaveLength(2);
  expect(sources[0]?.readyState).toBe(EventSource.CLOSED);
  expect(sources[1]?.url).toBe("/api/events?entityType=matter&entityId=matter-two");

  leaveSecond();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(sources[1]?.readyState).toBe(EventSource.CLOSED);
});

it("hands the same connection from one shell to the next when the scope does not change", async () => {
  const sources = stubEventSource();
  const { retainLiveEvents } = await import("./events");

  // A route change replaces one shell with another in the same task:
  // the old owner releases, the new one retains, and no reconnect
  // happens in between.
  const leaveOld = retainLiveEvents({ entityType: "contract", entityId: "same" });
  leaveOld();
  const leaveNew = retainLiveEvents({ entityType: "contract", entityId: "same" });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(sources).toHaveLength(1);
  expect(sources[0]?.readyState).not.toBe(EventSource.CLOSED);

  leaveNew();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(sources[0]?.readyState).toBe(EventSource.CLOSED);
});

it("drops a frame that is not JSON or not a live event, and keeps dispatching", async () => {
  const sources = stubEventSource();
  const { retainLiveEvents, subscribeLiveEvents } = await import("./events");
  const listener = vi.fn();
  const unsubscribe = subscribeLiveEvents(listener);
  const leave = retainLiveEvents();
  const source = sources[0]!;

  source.emitRaw("bell", "not json");
  source.emitRaw("bell", JSON.stringify({ kind: "bell" }));
  expect(listener).not.toHaveBeenCalled();

  source.emit({ kind: "bell", userId: "user-1" });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ kind: "bell", userId: "user-1" });

  unsubscribe();
  leave();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
});
