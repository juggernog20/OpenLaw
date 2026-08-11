// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Security · Authentication (#63 shell, #64 pane) at the
 * route seam: the pane fronts the M2 auth-policy routes — mode cards,
 * the OIDC provider form, the portal toggle with its built-in-mode
 * lock, and the DD-010 allowed-domains editor — with SET-003 immediate
 * apply and DES-017 micro-states. The API behaviors themselves are
 * covered at the HTTP seam in apps/api.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "light",
};

const PROVIDER = {
  id: "sp1",
  providerId: "acme-idp",
  issuer: "https://idp.acme.example",
  domain: "acme.example",
  clientId: "openlaw",
};

interface AuthCalls {
  modePatches: unknown[];
  portalPatches: unknown[];
  domainPuts: unknown[];
  providerPosts: unknown[];
  providerPatches: unknown[];
}

function newCalls(): AuthCalls {
  return {
    modePatches: [],
    portalPatches: [],
    domainPuts: [],
    providerPosts: [],
    providerPatches: [],
  };
}

/** Answers the pane's endpoints statefully and captures its writes. */
function authApi(
  state: { mode?: "built_in" | "oidc"; domains?: string[]; provider?: typeof PROVIDER | null },
  calls: AuthCalls,
) {
  let mode = state.mode ?? "built_in";
  let domains = state.domains ?? ["acme.example"];
  let provider = state.provider === undefined ? PROVIDER : state.provider;
  let magicLinkEnabled = true;
  return (call: StubCall) => {
    const path = call.url.pathname;
    if (path === "/api/v1/auth/methods" && call.method === "GET") {
      return json(200, {
        mode,
        magicLinkEnabled,
        emailConfigured: true,
        ssoProviderId: provider?.providerId ?? null,
      });
    }
    if (path === "/api/v1/auth/mode") {
      if (call.method === "PATCH") {
        calls.modePatches.push(call.body);
        mode = (call.body as { mode: typeof mode }).mode;
      }
      return json(200, { mode });
    }
    if (path === "/api/v1/auth/portal" && call.method === "PATCH") {
      calls.portalPatches.push(call.body);
      magicLinkEnabled = (call.body as { magicLinkEnabled: boolean }).magicLinkEnabled;
      return json(200, { magicLinkEnabled });
    }
    if (path === "/api/v1/auth/allowed-domains") {
      if (call.method === "PUT") {
        calls.domainPuts.push(call.body);
        domains = (call.body as { domains: string[] }).domains;
      }
      return json(200, { domains });
    }
    if (path === "/api/v1/auth/sso-providers" && call.method === "GET") {
      return json(200, { providers: provider ? [provider] : [] });
    }
    if (path === "/api/v1/auth/sso-providers" && call.method === "POST") {
      calls.providerPosts.push(call.body);
      const body = call.body as Record<string, string>;
      provider = {
        id: "sp-new",
        providerId: body.providerId!,
        issuer: body.issuer!,
        domain: body.domain!,
        clientId: body.clientId!,
      };
      return json(201, {
        provider: {
          id: provider.id,
          providerId: provider.providerId,
          issuer: provider.issuer,
          domain: provider.domain,
        },
        callbackUrl: "http://localhost:3000/api/auth/sso/callback",
      });
    }
    if (path.startsWith("/api/v1/auth/sso-providers/") && call.method === "PATCH") {
      calls.providerPatches.push(call.body);
      const body = call.body as Partial<typeof PROVIDER>;
      provider = { ...provider!, ...body };
      return json(200, {
        provider: {
          id: provider.id,
          providerId: provider.providerId,
          issuer: provider.issuer,
          domain: provider.domain,
        },
        callbackUrl: "http://localhost:3000/api/auth/sso/callback",
      });
    }
    return undefined;
  };
}

describe("the Authentication pane (#64)", () => {
  it("bounces a non-Administrator to their settings home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/authentication");

    // Landed on Profile, the settings home for everyone (#67).
    expect(await screen.findByLabelText("Full name")).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Security")).not.toBeInTheDocument();
  });

  it("auto-expands the Security rail group and marks Authentication current", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: authApi({}, newCalls()) });
    renderAt("/settings/authentication");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    const disclosure = within(rail).getByRole("button", { name: "Security" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(within(rail).getByRole("link", { name: "Authentication" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The disclosure's say beats the auto-open default.
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(within(rail).queryByRole("link", { name: "Authentication" })).not.toBeInTheDocument();
  });

  it("renders the built-in state: mode checked, portal toggle locked on", async () => {
    stubApi({ signedIn: ADMIN, extra: authApi({ mode: "built_in" }, newCalls()) });
    renderAt("/settings/authentication");

    expect(await screen.findByRole("radio", { name: "Built-in" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Identity provider (OIDC)" })).not.toBeChecked();

    // The built-in-mode lock (DD-010): on, disabled, and explained.
    const toggle = screen.getByRole("switch", { name: "Magic-link sign-in" });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText(
        "Magic links are the only portal sign-in method in built-in mode, so they can't be turned off.",
      ),
    ).toBeVisible();
  });

  it("switches to OIDC immediately when a provider is registered", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: authApi({ mode: "built_in" }, calls) });
    renderAt("/settings/authentication");

    await user.click(await screen.findByRole("radio", { name: "Identity provider (OIDC)" }));

    await waitFor(() => expect(calls.modePatches).toEqual([{ mode: "oidc" }]));
    expect(await screen.findByText("Saved")).toBeVisible();

    // The portal toggle unlocks, with the SSO-only caption.
    expect(screen.getByRole("switch", { name: "Magic-link sign-in" })).toBeEnabled();
    expect(screen.getByText(/Turn off to require SSO for everyone/)).toBeVisible();
  });

  it("snaps the mode radio back with the error micro-state when the switch fails", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    const happy = authApi({ mode: "built_in" }, calls);
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/auth/mode" && call.method === "PATCH") {
          return problem(500, "The database is unavailable.");
        }
        return happy(call);
      },
    });
    renderAt("/settings/authentication");

    await user.click(await screen.findByRole("radio", { name: "Identity provider (OIDC)" }));

    // The API's own refusal sentence beats the generic line.
    expect(await screen.findByText("The database is unavailable.")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Built-in" })).toBeChecked();
  });

  it("demands a registered provider before the switch commits", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: authApi({ mode: "built_in", provider: null }, calls) });
    renderAt("/settings/authentication");

    await user.click(await screen.findByRole("radio", { name: "Identity provider (OIDC)" }));

    // No mode PATCH yet — the registration form opens instead.
    expect(calls.modePatches).toEqual([]);
    expect(screen.getByText("Register your identity provider to finish the switch.")).toBeVisible();

    await user.type(screen.getByLabelText("Provider ID"), "okta");
    await user.type(screen.getByLabelText("Issuer URL"), "https://acme.okta.com");
    await user.type(screen.getByLabelText("Email domain"), "acme.example");
    await user.type(screen.getByLabelText("Client ID"), "0oa7fk3q9rXw2LbT5697");
    await user.type(screen.getByLabelText("Client secret"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Register provider" }));

    await waitFor(() =>
      expect(calls.providerPosts).toEqual([
        {
          providerId: "okta",
          issuer: "https://acme.okta.com",
          domain: "acme.example",
          clientId: "0oa7fk3q9rXw2LbT5697",
          clientSecret: "s3cret",
        },
      ]),
    );
    // Registration finishes the drafted switch.
    await waitFor(() => expect(calls.modePatches).toEqual([{ mode: "oidc" }]));
    // The callback URL for the IdP console appears once registered.
    expect(await screen.findByText(/api\/auth\/sso\/callback/)).toBeVisible();
  });

  it("saves only the provider fields that changed", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: authApi({ mode: "oidc" }, calls) });
    renderAt("/settings/authentication");

    const issuer = await screen.findByLabelText("Issuer URL");
    expect(issuer).toHaveValue(PROVIDER.issuer);
    await user.clear(issuer);
    await user.type(issuer, "https://idp2.acme.example");
    await user.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() =>
      expect(calls.providerPatches).toEqual([{ issuer: "https://idp2.acme.example" }]),
    );
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("rotates the secret only when one is entered", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: authApi({ mode: "oidc" }, calls) });
    renderAt("/settings/authentication");

    const secret = await screen.findByLabelText("Client secret");
    expect(secret).toHaveValue("");
    await user.type(secret, "fresh-secret");
    await user.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(calls.providerPatches).toEqual([{ clientSecret: "fresh-secret" }]));
  });

  it("commits the portal toggle in OIDC mode", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: authApi({ mode: "oidc" }, calls) });
    renderAt("/settings/authentication");

    await user.click(await screen.findByRole("switch", { name: "Magic-link sign-in" }));

    await waitFor(() => expect(calls.portalPatches).toEqual([{ magicLinkEnabled: false }]));
    expect(screen.getByRole("switch", { name: "Magic-link sign-in" })).not.toBeChecked();
  });

  it("adds and removes allowed domains as whole-list replacements (DD-010)", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: authApi({ domains: ["acme.example"] }, calls) });
    renderAt("/settings/authentication");

    const input = await screen.findByLabelText("Allowed email domains");
    await user.type(input, "Partners.Example");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(calls.domainPuts).toEqual([{ domains: ["acme.example", "partners.example"] }]),
    );

    await user.click(screen.getByRole("button", { name: "Remove acme.example" }));
    await waitFor(() =>
      expect(calls.domainPuts).toEqual([
        { domains: ["acme.example", "partners.example"] },
        { domains: ["partners.example"] },
      ]),
    );
  });
});
