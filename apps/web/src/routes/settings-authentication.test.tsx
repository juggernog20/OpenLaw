// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const ADMIN = {
  id: "admin",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
};
function setup({ provider = true, fail = false } = {}) {
  let policy = {
    legal: { password: true, magicLink: false, sso: false, requireTwoFactor: false },
    business: { password: false, magicLink: true, sso: false, requireTwoFactor: false },
  };
  const writes: unknown[] = [];
  stubApi({
    signedIn: ADMIN,
    extra: (call) => {
      const path = call.url.pathname;
      if (path === "/api/v1/auth/methods")
        return json(200, {
          policy,
          mode: "built_in",
          magicLinkEnabled: true,
          emailConfigured: true,
          ssoProviderId: provider ? "idp" : null,
        });
      if (path === "/api/v1/auth/allowed-domains") return json(200, { domains: ["example.com"] });
      if (path === "/api/v1/auth/sso-providers")
        return json(200, {
          providers: provider
            ? [
                {
                  id: "p1",
                  providerId: "idp",
                  issuer: "https://idp.example.com",
                  domain: "example.com",
                  clientId: "app",
                },
              ]
            : [],
        });
      if (path.startsWith("/api/v1/auth/policy/")) {
        writes.push({ path, body: call.body });
        if (fail) return problem(400, "Enable at least one sign-in method.");
        policy = { ...policy, [path.endsWith("legal") ? "legal" : "business"]: call.body };
        return json(200, policy);
      }
      return undefined;
    },
  });
  renderAt("/settings/authentication");
  return { writes, user: userEvent.setup() };
}

it("offers the same independent methods for both groups and preserves other enabled methods", async () => {
  const { writes, user } = setup();
  const legal = await screen.findByRole("region", { name: "Legal User Authentication" });
  const business = screen.getByRole("region", { name: "Business Portal Authentication" });
  for (const region of [legal, business])
    for (const label of [
      "Email and password",
      "Email magic link",
      "Single sign-on (SSO)",
      "Require two-factor authentication",
    ])
      expect(within(region).getByRole("switch", { name: label })).toBeVisible();
  await user.click(within(business).getByRole("switch", { name: "Email and password" }));
  await waitFor(() =>
    expect(writes).toEqual([
      {
        path: "/api/v1/auth/policy/business",
        body: { password: true, magicLink: true, sso: false, requireTwoFactor: false },
      },
    ]),
  );
  expect(within(legal).getByRole("switch", { name: "Email magic link" })).not.toBeChecked();
  expect(within(business).getByRole("switch", { name: "Email magic link" })).toBeChecked();
});
it("keeps the last sign-in method when the server rejects disabling it", async () => {
  const { user } = setup({ fail: true });
  const legal = await screen.findByRole("region", { name: "Legal User Authentication" });
  await user.click(within(legal).getByRole("switch", { name: "Email and password" }));
  expect(await screen.findByText("Enable at least one sign-in method.")).toBeVisible();
  expect(within(legal).getByRole("switch", { name: "Email and password" })).toBeChecked();
});
it("requires an identity provider before either group can enable SSO", async () => {
  setup({ provider: false });
  const legal = await screen.findByRole("region", { name: "Legal User Authentication" });
  expect(within(legal).getByRole("switch", { name: "Single sign-on (SSO)" })).toBeDisabled();
  const business = screen.getByRole("region", { name: "Business Portal Authentication" });
  expect(within(business).getByRole("switch", { name: "Single sign-on (SSO)" })).toBeDisabled();
  expect(screen.getByRole("region", { name: "Identity provider" })).toBeVisible();
});
