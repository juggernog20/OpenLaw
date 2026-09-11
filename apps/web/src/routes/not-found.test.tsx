// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An address that names no route lands on a not-found page inside the
 * chrome the visitor already has, with one way back. Before this the
 * router handed an unmatched URL to the home route's error boundary,
 * which drew the crash page with a Reload that did nothing.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAt, stubApi } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "lee@example.com",
  displayName: "Lee Member",
  role: "legal_team_member",
};

const REQUESTER = {
  id: "u9",
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  role: "business_user",
};

describe("an address that names no route", () => {
  it("draws the not-found page inside the staff shell with a way home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/reports");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("There is nothing at this address.")).toBeInTheDocument();
    // The shell is still there: the primary nav, and the main region.
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Page not found · OpenLaw"));
  });

  it("sends a signed-out visitor to login first", async () => {
    stubApi({ methods: { mode: "built_in", magicLinkEnabled: false, ssoProviderId: null } });
    renderAt("/reports");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends a signed-in Business User to the portal", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/request-types")
          return new Response(JSON.stringify({ requestTypes: [] }), {
            headers: { "content-type": "application/json" },
          });
        if (call.url.pathname === "/api/v1/portal/intake-links")
          return new Response(JSON.stringify({ intakeLinks: [] }), {
            headers: { "content-type": "application/json" },
          });
        if (call.url.pathname === "/api/v1/portal/requests")
          return new Response(JSON.stringify({ requests: [] }), {
            headers: { "content-type": "application/json" },
          });
        return undefined;
      },
    });
    renderAt("/reports");

    expect(
      await screen.findByRole("heading", { name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
  });

  it("draws it in the portal's own chrome for a portal address", async () => {
    stubApi({ signedIn: REQUESTER });
    renderAt("/portal/knowledge");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("There is nothing at this address.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the portal" })).toHaveAttribute(
      "href",
      "/portal",
    );
    // The portal has no staff nav, and still does not here.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Page not found · OpenLaw"));
  });

  it("draws it beside the settings rail for a settings address", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/request-types");

    expect(
      await screen.findByRole("heading", { level: 2, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(document.title).toBe("Page not found · OpenLaw"));
  });
});
