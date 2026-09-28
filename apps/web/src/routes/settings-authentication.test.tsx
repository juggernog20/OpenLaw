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
const PROVIDERS = [
  {
    id: "p1",
    providerId: "idp",
    name: "Calloway identity provider",
    issuer: "https://idp.example.com",
    domain: "calloway.test,legal.calloway.test",
    domains: ["calloway.test", "legal.calloway.test"],
    clientId: "app",
  },
  {
    id: "p2",
    providerId: "family-office",
    name: "Family Office identity provider",
    issuer: "https://idp.familyoffice.test",
    domain: "familyoffice.test",
    domains: ["familyoffice.test"],
    clientId: null,
  },
];

function setup({ provider = true, fail = false, failRow = false } = {}) {
  let domains = ["example.com"];
  let policy = {
    legal: { password: true, magicLink: false, sso: false, requireTwoFactor: false },
    business: { password: false, magicLink: true, sso: false, requireTwoFactor: false },
  };
  const writes: unknown[] = [];
  const providerCalls: { method: string; path: string; body: unknown }[] = [];
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
          ssoProviderId: null,
          ssoProviderCount: provider ? 2 : 0,
        });
      if (path === "/api/v1/auth/allowed-domains") {
        if (call.method === "PUT") {
          if (fail) return problem(500, "Domains could not be saved.");
          domains = (call.body as { domains: string[] }).domains;
        }
        return json(200, { domains });
      }
      if (path === "/api/v1/auth/sso-providers" && call.method === "GET")
        return json(200, { providers: provider ? PROVIDERS : [] });
      if (path === "/api/v1/auth/sso-providers" && call.method === "POST") {
        providerCalls.push({ method: call.method, path, body: call.body });
        const body = call.body as { providerId: string; name?: string; domain: string };
        if (fail) return problem(409, "acme.example is already assigned to Calloway.");
        return json(201, {
          provider: {
            id: "p3",
            providerId: body.providerId,
            name: body.name ?? body.providerId,
            issuer: "https://idp.acme.example",
            domain: body.domain,
            domains: body.domain.split(",").map((entry) => entry.trim()),
          },
          callbackUrl: "https://openlaw.example/api/auth/sso/callback",
        });
      }
      if (path.startsWith("/api/v1/auth/sso-providers/")) {
        providerCalls.push({ method: call.method, path, body: call.body });
        if (failRow) return problem(409, "Another provider update is in progress. Try again.");
        if (call.method === "DELETE") return new Response(null, { status: 204 });
        const target = PROVIDERS.find((row) => path.endsWith(row.providerId))!;
        const body = call.body as { name?: string; domain?: string };
        return json(200, {
          provider: {
            ...target,
            name: body.name ?? target.name,
            domain: body.domain ?? target.domain,
            domains: (body.domain ?? target.domain).split(",").map((entry) => entry.trim()),
          },
          callbackUrl: "https://openlaw.example/api/auth/sso/callback",
        });
      }
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
  return { writes, providerCalls, user: userEvent.setup() };
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
  expect(screen.getByRole("region", { name: "Identity providers" })).toBeVisible();
  expect(screen.getByText("0 providers")).toBeVisible();
});

it("turns Business sign-in methods off after removing the last domain and keeps them off when re-added", async () => {
  const { user } = setup();
  const business = await screen.findByRole("region", { name: "Business Portal Authentication" });
  const magicLink = within(business).getByRole("switch", { name: "Email magic link" });
  expect(magicLink).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Remove example.com" }));
  await waitFor(() => expect(magicLink).toBeDisabled());
  expect(magicLink).not.toBeChecked();
  const legal = screen.getByRole("region", { name: "Legal User Authentication" });
  expect(within(legal).getByRole("switch", { name: "Email and password" })).toBeChecked();
  await user.type(screen.getByLabelText("Allowed email domains"), "example.com");
  await user.click(within(business).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(magicLink).toBeEnabled());
  expect(magicLink).not.toBeChecked();
});

it("keeps Business sign-in choices when removing a domain fails", async () => {
  const { user } = setup({ fail: true });
  const business = await screen.findByRole("region", { name: "Business Portal Authentication" });
  await user.click(screen.getByRole("button", { name: "Remove example.com" }));
  await within(business).findByText("Domains could not be saved.");
  const magicLink = within(business).getByRole("switch", { name: "Email magic link" });
  expect(magicLink).toBeEnabled();
  expect(magicLink).toBeChecked();
});

it("lists each provider with its name, domains and configuration status", async () => {
  setup();
  const card = await screen.findByRole("region", { name: "Identity providers" });
  expect(within(card).getByText("2 providers")).toBeVisible();
  const rows = within(card).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]!).getByText("Calloway identity provider")).toBeVisible();
  expect(within(rows[0]!).getByText("calloway.test, legal.calloway.test")).toBeVisible();
  expect(within(rows[0]!).getByText("Configured")).toBeVisible();
  expect(within(rows[1]!).getByText("Family Office identity provider")).toBeVisible();
  expect(within(rows[1]!).getByText("familyoffice.test")).toBeVisible();
  expect(within(rows[1]!).getByText("Missing credentials")).toBeVisible();
  const legal = screen.getByRole("region", { name: "Legal User Authentication" });
  expect(within(legal).getByRole("switch", { name: "Single sign-on (SSO)" })).toBeEnabled();
});

it("registers another provider from the dialog and shows the callback URL", async () => {
  const { providerCalls, user } = setup();
  const card = await screen.findByRole("region", { name: "Identity providers" });
  await user.click(within(card).getByRole("button", { name: "Add provider" }));
  const dialog = await screen.findByRole("dialog", { name: "Add provider" });
  await user.type(within(dialog).getByLabelText("Display name"), "Acme identity provider");
  await user.type(within(dialog).getByLabelText("Provider ID"), "acme");
  await user.type(within(dialog).getByLabelText("Issuer URL"), "https://idp.acme.example");
  await user.type(
    within(dialog).getByLabelText("Email domains"),
    "acme.example, acme-group.example",
  );
  await user.type(within(dialog).getByLabelText("Client ID"), "openlaw");
  await user.type(within(dialog).getByLabelText("Client secret"), "s3cret");
  await user.click(within(dialog).getByRole("button", { name: "Register provider" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(providerCalls).toEqual([
    {
      method: "POST",
      path: "/api/v1/auth/sso-providers",
      body: {
        name: "Acme identity provider",
        providerId: "acme",
        issuer: "https://idp.acme.example",
        domain: "acme.example, acme-group.example",
        clientId: "openlaw",
        clientSecret: "s3cret",
      },
    },
  ]);
  expect(within(card).getByText("3 providers")).toBeVisible();
  expect(within(card).getByText("Acme identity provider")).toBeVisible();
  expect(within(card).getByText("acme.example, acme-group.example")).toBeVisible();
  // The help caption sits under the card, outside the region landmark.
  expect(screen.getByText("https://openlaw.example/api/auth/sso/callback")).toBeVisible();
});

it("keeps the dialog open and shows the refusal when a domain is already taken", async () => {
  const { user } = setup({ fail: true });
  const card = await screen.findByRole("region", { name: "Identity providers" });
  await user.click(within(card).getByRole("button", { name: "Add provider" }));
  const dialog = await screen.findByRole("dialog", { name: "Add provider" });
  await user.type(within(dialog).getByLabelText("Provider ID"), "acme");
  await user.type(within(dialog).getByLabelText("Issuer URL"), "https://idp.acme.example");
  await user.type(within(dialog).getByLabelText("Email domains"), "acme.example");
  await user.type(within(dialog).getByLabelText("Client ID"), "openlaw");
  await user.type(within(dialog).getByLabelText("Client secret"), "s3cret");
  await user.click(within(dialog).getByRole("button", { name: "Register provider" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "acme.example is already assigned to Calloway.",
  );
  expect(within(card).getByText("2 providers")).toBeVisible();
});

it("edits only the changed fields and leaves a blank secret alone", async () => {
  const { providerCalls, user } = setup();
  const card = await screen.findByRole("region", { name: "Identity providers" });
  await user.click(within(card).getByRole("button", { name: "Edit Calloway identity provider" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Calloway identity provider" });
  expect(within(dialog).queryByLabelText("Provider ID")).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Email domains")).toHaveValue(
    "calloway.test, legal.calloway.test",
  );
  await user.type(within(dialog).getByLabelText("Email domains"), ", hr.calloway.test");
  await user.click(within(dialog).getByRole("button", { name: "Save provider" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(providerCalls).toEqual([
    {
      method: "PATCH",
      path: "/api/v1/auth/sso-providers/idp",
      body: { domain: "calloway.test, legal.calloway.test, hr.calloway.test" },
    },
  ]);
  expect(
    within(card).getByText("calloway.test, legal.calloway.test, hr.calloway.test"),
  ).toBeVisible();
});

it("asks for a client ID before a provider missing credentials can be saved", async () => {
  const { providerCalls, user } = setup();
  const card = await screen.findByRole("region", { name: "Identity providers" });
  await user.click(
    within(card).getByRole("button", { name: "Edit Family Office identity provider" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Edit Family Office identity provider",
  });
  expect(within(dialog).getByLabelText("Client ID")).toBeRequired();
  expect(within(dialog).getByLabelText("Client ID")).toHaveValue("");
  // The secret went with the client ID, so a repair needs both.
  expect(within(dialog).getByLabelText("Client secret")).toBeRequired();
  expect(screen.queryByText(/Leave blank to keep the current secret/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Save provider" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(providerCalls).toEqual([]);
});

it("removes a provider and disables SSO once none is left", async () => {
  const { providerCalls, user } = setup();
  const card = await screen.findByRole("region", { name: "Identity providers" });
  for (const toggle of screen.getAllByRole("switch", { name: "Single sign-on (SSO)" })) {
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  }
  await user.click(
    within(card).getByRole("button", { name: "Remove Family Office identity provider" }),
  );
  await waitFor(() =>
    expect(within(card).queryByText("Family Office identity provider")).not.toBeInTheDocument(),
  );
  for (const toggle of screen.getAllByRole("switch", { name: "Single sign-on (SSO)" })) {
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
  }
  await user.click(within(card).getByRole("button", { name: "Remove Calloway identity provider" }));
  await waitFor(() => expect(within(card).getByText("0 providers")).toBeVisible());
  expect(providerCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "DELETE /api/v1/auth/sso-providers/family-office",
    "DELETE /api/v1/auth/sso-providers/idp",
  ]);
  const legal = screen.getByRole("region", { name: "Legal User Authentication" });
  expect(within(legal).getByRole("switch", { name: "Single sign-on (SSO)" })).toBeDisabled();
  for (const toggle of screen.getAllByRole("switch", { name: "Single sign-on (SSO)" })) {
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
  }
});

it("keeps the edit dialog open and shows the refusal when the save is rejected", async () => {
  const { user } = setup({ failRow: true });
  const card = await screen.findByRole("region", { name: "Identity providers" });
  await user.click(within(card).getByRole("button", { name: "Edit Calloway identity provider" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Calloway identity provider" });
  await user.type(within(dialog).getByLabelText("Email domains"), ", hr.calloway.test");
  await user.click(within(dialog).getByRole("button", { name: "Save provider" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Another provider update is in progress. Try again.",
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(within(card).getByText("calloway.test, legal.calloway.test")).toBeVisible();
});

it("keeps the row and shows its error when a removal is refused", async () => {
  const { user } = setup({ failRow: true });
  const card = await screen.findByRole("region", { name: "Identity providers" });
  const remove = within(card).getByRole("button", { name: "Remove Calloway identity provider" });
  await user.click(remove);
  expect(
    await within(card).findByText("Another provider update is in progress. Try again."),
  ).toBeVisible();
  expect(within(card).getByText("Calloway identity provider")).toBeVisible();
  expect(within(card).getByText("2 providers")).toBeVisible();
  expect(remove).toHaveFocus();
});
