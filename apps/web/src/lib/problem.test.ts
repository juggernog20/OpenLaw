// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { problem } from "./problem";

describe("problem", () => {
  it("reads one problem shape from an openapi-fetch refusal", async () => {
    const response = new Response(null, { status: 409 });

    await expect(
      problem({
        error: {
          detail: "Two approvals are pending.",
          type: "urn:openlaw:problem:approval-soft-gate",
        },
        response,
      }),
    ).resolves.toEqual({
      detail: "Two approvals are pending.",
      type: "urn:openlaw:problem:approval-soft-gate",
      status: 409,
      network: false,
    });
  });

  it("reads the same shape from a raw fetch refusal", async () => {
    const response = Response.json(
      {
        detail: "The upload is too large.",
        type: "about:blank",
      },
      { status: 413 },
    );

    await expect(problem(response)).resolves.toEqual({
      detail: "The upload is too large.",
      type: "about:blank",
      status: 413,
      network: false,
    });
  });

  it("keeps a non-JSON response distinct from a network failure", async () => {
    const response = new Response("upstream unavailable", { status: 502 });

    await expect(problem(response)).resolves.toEqual({
      detail: undefined,
      type: undefined,
      status: 502,
      network: false,
    });
  });

  it("marks a request that received no response as a network failure", async () => {
    await expect(problem(undefined)).resolves.toEqual({
      detail: undefined,
      type: undefined,
      status: undefined,
      network: true,
    });
  });
});
