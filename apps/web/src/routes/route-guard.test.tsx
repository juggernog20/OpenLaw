// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The route guard: unauthenticated visitors land on login, an empty
 * instance lands on setup, failed magic-link redemptions land on the
 * expired-link page, and signed-in users never see the auth screens.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderAt, stubApi } from "../testing/helpers";

const BLAIR = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
};

describe("route guard", () => {
  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends an empty instance to first-run setup", async () => {
    stubApi({ signedIn: null, needsSetup: true });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Set up OpenLaw" })).toBeInTheDocument();
  });

  it("forwards a failed magic-link redemption to the expired-link page", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/?error=INVALID_TOKEN");
    expect(
      await screen.findByRole("heading", { name: "Sign-in link expired" }),
    ).toBeInTheDocument();
  });

  it("shows the signed-in home to a session holder", async () => {
    stubApi({ signedIn: BLAIR });
    renderAt("/");
    // The shell's user menu carries the signed-in identity (#41): the
    // avatar trigger is named after the person.
    expect(await screen.findByRole("button", { name: "Ada Admin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("bounces a signed-in user away from the login screen", async () => {
    stubApi({ signedIn: BLAIR });
    renderAt("/auth/login");
    expect(await screen.findByRole("button", { name: "Ada Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("disables the setup screen once a user exists", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/auth/setup");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
