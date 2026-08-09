// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run setup screen: creates the Administrator and lands signed
 * in; the 409 race (someone else finished setup first) is surfaced with
 * a path to sign-in. The server-side invariant is covered in apps/api.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type ApiState } from "../testing/helpers";

async function fillAndSubmit() {
  await userEvent.type(await screen.findByLabelText("Name"), "Ada Admin");
  await userEvent.type(screen.getByLabelText("Email"), "admin@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "a-long-password");
  await userEvent.type(screen.getByLabelText("Confirm password"), "a-long-password");
  await userEvent.click(screen.getByRole("button", { name: "Create Administrator" }));
}

describe("first-run setup", () => {
  it("creates the Administrator and lands signed in", async () => {
    // Mutable state: the moment setup succeeds, the stubbed instance has
    // a user and a session — exactly what the real API's Set-Cookie does.
    const state: ApiState = { signedIn: null, needsSetup: true };
    state.extra = (call) => {
      if (call.url.pathname === "/api/v1/auth/setup" && call.method === "POST") {
        state.signedIn = {
          id: "u1",
          email: "admin@example.com",
          displayName: "Ada Admin",
          role: "administrator",
        };
        state.needsSetup = false;
        return json(201, { user: state.signedIn });
      }
      return undefined;
    };
    stubApi(state);
    renderAt("/auth/setup");

    await fillAndSubmit();
    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("surfaces the lost setup race with a path to sign-in", async () => {
    stubApi({
      signedIn: null,
      needsSetup: true,
      extra: (call) =>
        call.url.pathname === "/api/v1/auth/setup" && call.method === "POST"
          ? problem(409, "Setup has already been completed.")
          : undefined,
    });
    renderAt("/auth/setup");

    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Setup has already been completed.");
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});
