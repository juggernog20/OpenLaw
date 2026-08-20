// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal shell and its front door (#376). A Business User asks for
 * a link, is told one is on its way, and lands in the portal; the
 * portal wears its own chrome and turns no signed-in person away; and
 * the whole email step disappears when the Administrator's magic-link
 * toggle is off.
 *
 * The magic-link mechanics — issuance, the domain allowlist, the
 * identical answer for an ineligible address, redemption — are covered
 * at the API's HTTP seam and are deliberately not re-tested here. What
 * this suite asserts is what a visitor at a URL can see.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const REQUESTER = {
  id: "u9",
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  role: "business_user",
};

const MEMBER = {
  id: "u2",
  email: "lee@example.com",
  displayName: "Lee Member",
  role: "legal_team_member",
};

const PORTAL_HOME = "What do you need from Legal?";
const PORTAL_DOOR = "Legal request portal";

describe("the portal front door", () => {
  it("sends an unauthenticated visitor to the entry screen", async () => {
    stubApi({ signedIn: null });
    renderAt("/portal");
    expect(await screen.findByRole("heading", { name: PORTAL_DOOR })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("answers a requested link with the same neutral message", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: null,
      extra: (call) =>
        call.url.pathname === "/api/v1/auth/magic-link" && call.method === "POST"
          ? json(202, { message: "If the address is eligible, a sign-in link is on its way." })
          : undefined,
    });
    renderAt("/portal/enter");

    await user.type(await screen.findByLabelText("Email"), REQUESTER.email);
    await user.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText(/a sign-in link is on its way/)).toBeInTheDocument();
  });

  it("offers no email step when the magic-link toggle is off", async () => {
    // The Administrator's SSO-only policy: the floor is theirs to
    // remove, and the door then points at their identity provider.
    stubApi({
      signedIn: null,
      methods: { mode: "oidc", magicLinkEnabled: false, ssoProviderId: "acme-idp" },
    });
    renderAt("/portal/enter");

    expect(await screen.findByRole("heading", { name: PORTAL_DOOR })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send link" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("offers no email step when the deployment cannot send email", async () => {
    stubApi({
      signedIn: null,
      methods: {
        mode: "built_in",
        magicLinkEnabled: true,
        emailConfigured: false,
        ssoProviderId: null,
      },
    });
    renderAt("/portal/enter");

    expect(await screen.findByRole("heading", { name: PORTAL_DOOR })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("sends a session holder past the door and into the portal", async () => {
    stubApi({ signedIn: REQUESTER });
    renderAt("/portal/enter");
    expect(await screen.findByRole("heading", { name: PORTAL_HOME })).toBeInTheDocument();
  });
});

describe("role-based landing", () => {
  it("routes a signed-in Business User from the staff application to the portal", async () => {
    stubApi({ signedIn: REQUESTER });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: PORTAL_HOME })).toBeInTheDocument();
  });

  it("routes a Business User bounced off a staff destination to the portal", async () => {
    // Every staff destination refuses its role floor by bouncing to "/",
    // which is the redirect this leans on.
    stubApi({ signedIn: REQUESTER });
    renderAt("/entities");
    expect(await screen.findByRole("heading", { name: PORTAL_HOME })).toBeInTheDocument();
  });

  it("keeps Member+ staff in the full application", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("admits Member+ staff to the portal", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/portal");
    expect(await screen.findByRole("heading", { name: PORTAL_HOME })).toBeInTheDocument();
  });
});

describe("the portal chrome", () => {
  it("carries the signed-in identity and the way out", async () => {
    stubApi({ signedIn: REQUESTER });
    renderAt("/portal");

    const header = await screen.findByRole("banner");
    expect(within(header).getByText(REQUESTER.email)).toBeInTheDocument();
    expect(within(header).getByText(PORTAL_DOOR)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it("says so when there is nothing to pick", async () => {
    stubApi({ signedIn: REQUESTER });
    renderAt("/portal");
    expect(await screen.findByRole("heading", { name: PORTAL_HOME })).toBeInTheDocument();
    expect(screen.getByText(/No request types are available yet/)).toBeInTheDocument();
  });

  it("draws no staff navigation and no staff-only affordances", async () => {
    // Asserted for a Member+ session on purpose: this role has every
    // staff destination, so anything staff-shaped leaking into the
    // portal would show up here.
    stubApi({ signedIn: MEMBER });
    renderAt("/portal");
    await screen.findByRole("heading", { name: PORTAL_HOME });

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Contracts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Entities" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("returns a signed-out requester to the portal door", async () => {
    const user = userEvent.setup();
    let signedOut = false;
    stubApi({
      signedIn: REQUESTER,
      extra: (call) => {
        if (call.url.pathname === "/api/auth/sign-out" && call.method === "POST") {
          signedOut = true;
          return json(200, { success: true });
        }
        if (signedOut && call.url.pathname === "/api/v1/me") {
          return problem(401, "Authentication required.");
        }
        return undefined;
      },
    });
    renderAt("/portal");

    const header = await screen.findByRole("banner");
    await user.click(within(header).getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: PORTAL_DOOR })).toBeInTheDocument();
  });
});
