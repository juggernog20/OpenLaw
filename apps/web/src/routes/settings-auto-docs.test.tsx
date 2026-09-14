// SPDX-License-Identifier: AGPL-3.0-only

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

it("lets an Administrator edit the organisation's acknowledgement text", async () => {
  let saved: unknown;
  stubApi({
    signedIn: {
      id: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      role: "administrator",
    },
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/auto-docs/settings") return undefined;
      if (call.method === "PUT") saved = call.body;
      return json(200, { acknowledgementText: "Do not edit the generated document." });
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/auto-docs");
  const input = await screen.findByLabelText("Default acknowledgement text");
  await user.clear(input);
  await user.type(input, "Ask Legal for changes.");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(saved).toEqual({ acknowledgementText: "Ask Legal for changes." }));
});

it("redirects a Member to Profile without reading Auto-Docs settings", async () => {
  const reads: string[] = [];
  stubApi({
    signedIn: {
      id: "member",
      email: "member@example.com",
      displayName: "Member",
      role: "legal_team_member",
    },
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs/settings") {
        reads.push(call.method);
        return json(200, { acknowledgementText: "Do not edit." });
      }
      return undefined;
    },
  });
  const { router } = renderAt("/settings/auto-docs");
  await waitFor(() => expect(router.state.location.pathname).toBe("/settings/profile"));
  expect(reads).toEqual([]);
});

it("keeps the draft and displays a refused default acknowledgement save", async () => {
  stubApi({
    signedIn: {
      id: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      role: "administrator",
    },
    extra: (call) => {
      if (call.url.pathname !== "/api/v1/auto-docs/settings") return undefined;
      return call.method === "PUT"
        ? problem(400, "Choose a shorter statement.")
        : json(200, { acknowledgementText: "Do not edit." });
    },
  });
  const user = userEvent.setup();
  renderAt("/settings/auto-docs");
  const input = await screen.findByLabelText("Default acknowledgement text");
  await user.clear(input);
  await user.type(input, "Keep my draft here.");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose a shorter statement.");
  expect(input).toHaveValue("Keep my draft here.");
});
