// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { recordNumberFrom } from "./record-number.js";

describe("recordNumberFrom", () => {
  it("reads a bare number and the printed reference alike", () => {
    expect(recordNumberFrom("92", "C")).toBe(92);
    expect(recordNumberFrom("C-92", "C")).toBe(92);
    expect(recordNumberFrom("c-92", "C")).toBe(92);
    expect(recordNumberFrom("C92", "C")).toBe(92);
    expect(recordNumberFrom(" M-7 ", "M")).toBe(7);
  });

  it("names nothing for another kind's prefix or for a title", () => {
    expect(recordNumberFrom("M-92", "C")).toBeNull();
    expect(recordNumberFrom("Contoso", "C")).toBeNull();
    expect(recordNumberFrom("C-", "C")).toBeNull();
  });

  it("names nothing past what the column holds", () => {
    expect(recordNumberFrom("2147483647", "C")).toBe(2_147_483_647);
    expect(recordNumberFrom("C-2147483648", "C")).toBeNull();
  });
});
