// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { emailTimingOf, EVENT_GROUP } from "./catalog.js";

describe("the briefing-ready notification event", () => {
  it("uses the existing dates group for the bell but never creates email debt", () => {
    expect(EVENT_GROUP["briefing.ready"]).toBe("dates_approaching");
    expect(emailTimingOf("briefing.ready")).toBe("none");
  });
});
