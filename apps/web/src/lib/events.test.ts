// SPDX-License-Identifier: AGPL-3.0-only

/** The browser-owned live connection, including record navigation (TECH-009). */

import { expect, it } from "vitest";
import { stubEventSource } from "../testing/helpers";

it("opens at a record scope and reopens at the next record's scope", async () => {
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
