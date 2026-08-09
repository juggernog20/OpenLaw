// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The SET-004 wizard's guard and its portal step — the step that closes
 * the fresh-install gap (issue #34): an un-onboarded Administrator is
 * routed in from home, non-admins and completed instances never see it,
 * and saving the portal step writes the allowlist through the API.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
};

const MEMBER = { ...ADMIN, id: "u2", email: "sam@example.com", role: "legal_team_member" };

/** Loader answers the wizard needs beyond stubApi's defaults. */
function wizardExtra(domains: string[] = []) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "GET") {
      return json(200, { domains });
    }
    return undefined;
  };
}

describe("welcome wizard guard", () => {
  it("routes an un-onboarded Administrator from home into the wizard", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: true },
      extra: wizardExtra(),
    });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Welcome to OpenLaw" })).toBeInTheDocument();
  });

  it("keeps a completed instance on home", async () => {
    stubApi({ signedIn: ADMIN, onboarding: { completed: true, emailConfigured: true } });
    renderAt("/welcome");
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("bounces a non-Administrator to home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/welcome");
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  });
});

describe("welcome wizard portal step", () => {
  it("saves the domain allowlist through the API and reports email status", async () => {
    let putBody: unknown;
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: false },
      extra: (call) => {
        const fromLoader = wizardExtra()(call);
        if (fromLoader) return fromLoader;
        if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "PUT") {
          putBody = call.body;
          return json(200, call.body);
        }
        return undefined;
      },
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    // Authentication step: keep built-in and continue (no API call needed).
    await user.click(await screen.findByRole("button", { name: "Continue" }));

    // Portal step: add a domain and continue — the PUT must carry it.
    await user.type(screen.getByLabelText("Allowed email domains"), "acme.example");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("acme.example")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Email step reflects the unconfigured deployment loudly.
    expect(await screen.findByText(/Outbound email is not configured/)).toBeInTheDocument();
    expect(putBody).toEqual({ domains: ["acme.example"] });
  });
});
