// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { json, problem, stubApi, stubFetch } from "../testing/helpers";
import { search } from "./search";

describe("the settled search adapter", () => {
  it("reads stubApi's empty default", async () => {
    stubApi({});
    await expect(search("ordinary query")).resolves.toEqual({
      ok: true,
      results: [],
      nextCursor: null,
    });
  });

  it("answers a printable refusal instead of rejecting", async () => {
    stubFetch(() => problem(400, "Search queries must be 200 characters or fewer."));
    await expect(search("x".repeat(201))).resolves.toEqual({
      ok: false,
      detail: "Search queries must be 200 characters or fewer.",
    });
  });

  it("sends every flat-search option", async () => {
    let requestUrl: URL | undefined;
    stubFetch((call) => {
      requestUrl = call.url;
      return json(200, { results: [], nextCursor: null });
    });

    await expect(
      search("needle phrase", { kind: "matter", cursor: "matter-cursor", limit: 7 }),
    ).resolves.toMatchObject({ ok: true });
    expect(requestUrl?.pathname).toBe("/api/v1/search");
    expect(Object.fromEntries(requestUrl?.searchParams ?? [])).toEqual({
      q: "needle phrase",
      kind: "matter",
      cursor: "matter-cursor",
      limit: "7",
    });
  });
});
