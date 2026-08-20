// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal shell and its front door (#376), and the home it opens on
 * (#377). A Business User asks for a link, is told one is on its way,
 * and lands in the portal; the portal wears its own chrome and turns no
 * signed-in person away; the whole email step disappears when the
 * Administrator's magic-link toggle is off; and the home offers the
 * live request types over the "Before you submit…" panel.
 *
 * The magic-link mechanics — issuance, the domain allowlist, the
 * identical answer for an ineligible address, redemption — are covered
 * at the API's HTTP seam and are deliberately not re-tested here. So is
 * which rows the two portal reads answer with. What this suite asserts
 * is what a visitor at a URL can see.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

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

interface HomeType {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  displayOrder: number;
}

interface HomeLink {
  id: string;
  label: string;
  url: string;
  displayOrder: number;
}

/** The two reads the home makes, answered from a fixture. */
function portalHome(state: { requestTypes?: HomeType[]; intakeLinks?: HomeLink[] }) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/portal/request-types" && call.method === "GET") {
      return json(200, { requestTypes: state.requestTypes ?? [] });
    }
    if (call.url.pathname === "/api/v1/portal/intake-links" && call.method === "GET") {
      return json(200, { intakeLinks: state.intakeLinks ?? [] });
    }
    return undefined;
  };
}

/** The seeded types, in the order an Administrator arranged them. */
const SEED_TYPES: HomeType[] = [
  {
    id: "rt1",
    slug: "nda_request",
    displayName: "NDA request",
    description: "Mutual or one-way NDA with a counterparty.",
    displayOrder: 1,
  },
  {
    id: "rt2",
    slug: "contract_review",
    displayName: "Contract review",
    description: "Review of a counterparty contract or redline.",
    displayOrder: 2,
  },
  {
    id: "rt3",
    slug: "legal_question",
    displayName: "Legal question",
    description: null,
    displayOrder: 3,
  },
];

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

  it("routes a Business User off the settings surface to the portal", async () => {
    // Settings has no Member+ floor — every signed-in person owns a
    // profile — so it needs its own business_user bounce for the
    // "always at the portal" rule to hold across the whole staff tree.
    stubApi({ signedIn: REQUESTER });
    renderAt("/settings/appearance");
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

describe("the request type picker", () => {
  it("offers the live types in the Administrator's display order", async () => {
    stubApi({ signedIn: REQUESTER, extra: portalHome({ requestTypes: SEED_TYPES }) });
    renderAt("/portal");

    const picker = await screen.findByRole("list", { name: "Request types" });
    const names = within(picker)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      "NDA requestMutual or one-way NDA with a counterparty.",
      "Contract reviewReview of a counterparty contract or redline.",
      "Legal question",
    ]);
  });

  it("starts each type's form from its slug", async () => {
    stubApi({ signedIn: REQUESTER, extra: portalHome({ requestTypes: SEED_TYPES }) });
    renderAt("/portal");

    expect(await screen.findByRole("link", { name: /^NDA request/ })).toHaveAttribute(
      "href",
      "/portal/new/nda_request",
    );
  });

  it("draws a type with no description as its name alone", async () => {
    stubApi({ signedIn: REQUESTER, extra: portalHome({ requestTypes: [SEED_TYPES[2]!] }) });
    renderAt("/portal");

    const card = await screen.findByRole("link", { name: "Legal question" });
    expect(card).toBeInTheDocument();
  });

  it("says so when there is nothing to pick", async () => {
    // The API leaves archived types out, so an instance whose
    // Administrator has archived every one of them arrives here.
    stubApi({ signedIn: REQUESTER, extra: portalHome({ requestTypes: [] }) });
    renderAt("/portal");

    expect(await screen.findByRole("heading", { name: PORTAL_HOME })).toBeInTheDocument();
    expect(screen.getByText(/No request types are available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Request types" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick a request type/)).not.toBeInTheDocument();
  });

  it.each([
    ["the request types", "/api/v1/portal/request-types"],
    ["the deflection links", "/api/v1/portal/intake-links"],
  ])("lands on the error boundary when %s cannot be read", async (_name, path) => {
    // A half-drawn home is worse than none: a picker with no panel
    // reads as an instance that configured no deflection, and a panel
    // with no picker reads as one that archived every type. Either
    // failed read takes the whole page.
    stubApi({
      signedIn: REQUESTER,
      extra: (call) =>
        call.url.pathname === path && call.method === "GET"
          ? problem(500, "The portal home could not be read.")
          : undefined,
    });
    renderAt("/portal");

    expect(
      await screen.findByRole("heading", { name: "Something went wrong." }),
    ).toBeInTheDocument();
  });
});

describe("the deflection panel", () => {
  const LINKS: HomeLink[] = [
    {
      id: "dl1",
      label: "Standard NDA template — self-serve",
      url: "https://Wiki.Acme.com/Legal/NDA?from=Portal",
      displayOrder: 1,
    },
    {
      id: "dl2",
      label: "When does a contract need legal review?",
      url: "http://intranet.acme.com/legal/review",
      displayOrder: 2,
    },
  ];

  it("lists the home panel's links in panel order", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: portalHome({ requestTypes: SEED_TYPES, intakeLinks: LINKS }),
    });
    renderAt("/portal");

    const panel = await screen.findByRole("region", { name: "Before you submit" });
    expect(
      within(panel)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(LINKS.map((link) => link.label));
  });

  it("points each link at the address exactly as it was stored", async () => {
    // INT-004: nothing normalizes the URL. The panel shows the label
    // and follows the string the Administrator pasted.
    stubApi({
      signedIn: REQUESTER,
      extra: portalHome({ requestTypes: SEED_TYPES, intakeLinks: LINKS }),
    });
    renderAt("/portal");

    const panel = await screen.findByRole("region", { name: "Before you submit" });
    for (const link of LINKS) {
      expect(within(panel).getByRole("link", { name: link.label })).toHaveAttribute(
        "href",
        link.url,
      );
    }
  });

  it("draws no panel when the Administrator has placed no link on the home", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: portalHome({ requestTypes: SEED_TYPES, intakeLinks: [] }),
    });
    renderAt("/portal");

    await screen.findByRole("list", { name: "Request types" });
    expect(screen.queryByRole("region", { name: "Before you submit" })).not.toBeInTheDocument();
  });

  it("stays on the home when there is no form to fill in", async () => {
    // A deflection link is still worth following when the picker is
    // empty — it may be the answer the requester came for.
    stubApi({ signedIn: REQUESTER, extra: portalHome({ requestTypes: [], intakeLinks: LINKS }) });
    renderAt("/portal");

    expect(await screen.findByRole("region", { name: "Before you submit" })).toBeInTheDocument();
    expect(screen.getByText(/No request types are available yet/)).toBeInTheDocument();
  });
});
