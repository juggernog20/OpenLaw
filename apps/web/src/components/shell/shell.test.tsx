// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The application shell (#41): after sign-in the chrome renders — the
 * header with the product mark, search, and user menu; the top nav
 * driven by the destination registry, filtered to the signed-in role
 * (Home first, for everyone; the M21 Inbox next, Member+ only per
 * INT-006; Contracts for Member+ and Contributors per M9; Entities is
 * Member+ per ENT-004); and the page
 * sub-bar carrying the page title. Visuals come from the Light frames
 * in designs/final-themes.pen; geometry is asserted in the e2e suite
 * where real layout exists.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

describe("app shell chrome", () => {
  it("renders the header: product mark, search box, and the user-menu trigger", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    const header = await screen.findByRole("banner");
    expect(within(header).getByText("openlaw")).toBeInTheDocument();
    expect(within(header).getByText("workspace")).toBeInTheDocument();

    const search = within(header).getByRole("searchbox", { name: "Search" });
    expect(search).toHaveAttribute("placeholder", "Type / to search");

    // The trigger's accessible name is the signed-in user's display
    // name; the visible face is the initials avatar.
    const trigger = within(header).getByRole("button", { name: MEMBER.displayName });
    expect(trigger).toHaveTextContent("CC");
  });

  it("renders the nav from the destination registry, filtered to the signed-in role", async () => {
    // Member+ gets every registered destination — Home in slot one,
    // then the M21 Inbox, M22 Matters, the M8 contract record, and the
    // M7 Entities registry — with the current one marked.
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    const nav = await screen.findByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Inbox",
      "Matters",
      "Contracts",
      "Entities",
    ]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).not.toHaveAttribute("aria-current");
  });

  it("draws a Contributor the scoped record destinations and nothing else", async () => {
    // A Contributor sees Matters and Contracts; each API narrows those
    // lists to records they are on the team of. Entities stays Member+.
    stubApi({
      signedIn: {
        id: "u3",
        email: "casey@example.com",
        displayName: "Casey Contributor",
        role: "contributor",
      },
    });
    renderAt("/");

    const nav = await screen.findByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Home", "Matters", "Contracts"]);
  });

  it("never draws the shell for a Business User at all (INT-001)", async () => {
    // ENT-004's floor used to read here as a nav carrying Home alone.
    // The portal took the whole question over (#376): a Business User's
    // surface is the portal, so the staff shell is somewhere they never
    // arrive — which is a stronger answer than an emptied nav.
    stubApi({
      signedIn: { id: "u9", email: "bao@example.com", displayName: "Bao B", role: "business_user" },
    });
    renderAt("/");

    await screen.findByRole("heading", { name: "What do you need from Legal?" });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders the page sub-bar with the page title as the page's h1", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("mounts the skip link in the shell", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    await screen.findByRole("banner");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it("opens the user menu: settings entry point and sign out", async () => {
    const user = userEvent.setup();
    // Stateful on purpose: once sign-out lands, the session probe must
    // answer 401 or the login guard would bounce right back to home.
    let signedOut = false;
    stubApi({
      signedIn: MEMBER,
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
    renderAt("/");

    const header = await screen.findByRole("banner");
    await user.click(within(header).getByRole("button", { name: MEMBER.displayName }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    // Two-factor management moved to the Profile pane (SET-006, #67).
    expect(
      within(menu).queryByRole("menuitem", { name: "Two-factor authentication" }),
    ).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
