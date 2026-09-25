// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginLoader } from "./login";
import { json, renderAt, stubApi, type ApiState } from "../testing/helpers";

const query =
  "client_id=claude&scope=toolset%3Amatters+write&state=a%2fb&sig=signed%2Bvalue&exp=123&ba_iat=100&ba_param=scope";
const authorize = `/api/auth/oauth2/authorize?${query}`;
const person = {
  id: "u1",
  displayName: "Sarah Chen",
  email: "sarah@example.com",
  role: "legal_team_member",
};
afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(["/auth/login", "/portal/login"])(
  "resumes the exact signed query after a callback at %s",
  async (path) => {
    stubApi({
      signedIn: { ...person, role: path === "/portal/login" ? "business_user" : person.role },
    });
    const url = new URL(`http://localhost${path}?${query}`);
    const result = await loginLoader({
      request: new Request(url),
      url,
      pattern: path,
      params: {},
      context: new RouterContextProvider(),
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe(authorize);
    expect((result as Response).headers.get("X-Remix-Reload-Document")).toBe("true");
  },
);

it.each(["/auth/login", "/portal/login"])(
  "resumes authorize after password sign-in at %s",
  async (path) => {
    const assign = vi.fn();
    const state: ApiState = {
      signedIn: null,
      extra: (call) => {
        if (call.url.pathname === "/api/auth/sign-in/email") {
          state.signedIn = person;
          return json(200, { user: person, token: "session" });
        }
      },
    };
    stubApi(state);
    renderAt(`${path}?${query}`);
    vi.stubGlobal("location", { ...window.location, assign, replace: assign });
    await userEvent.type(await screen.findByLabelText("Email"), person.email);
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
  },
);

it.each(["/auth/login", "/portal/login"])(
  "emails a magic link back to %s with the unmodified query",
  async (path) => {
    const bodies: unknown[] = [];
    stubApi({
      extra: (call) => {
        if (call.url.pathname === "/api/v1/auth/magic-link") {
          bodies.push(call.body);
          return json(202, { message: "Sent" });
        }
      },
    });
    renderAt(`${path}?${query}`);
    await userEvent.click(await screen.findByRole("button", { name: "Email me a sign-in link" }));
    await userEvent.type(screen.getByLabelText("Email"), person.email);
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(bodies).toEqual([
      {
        email: person.email,
        group: path === "/portal/login" ? "business" : "legal",
        callbackURL: `${path}?${query}`,
      },
    ]);
  },
);

it.each(["/auth/login", "/portal/login"])("carries %s and its query through SSO", async (path) => {
  const bodies: unknown[] = [];
  const assign = vi.fn();
  stubApi({
    methods: {
      mode: "oidc",
      ssoProviderId: "acme-idp",
      magicLinkEnabled: true,
      policy: {
        legal: { password: true, magicLink: true, sso: true, requireTwoFactor: false },
        business: { password: true, magicLink: true, sso: true, requireTwoFactor: false },
      },
    },
    extra: (call) => {
      if (call.url.pathname === "/api/auth/sign-in/sso") {
        bodies.push(call.body);
        return json(200, { url: "https://idp.example/sign-in", redirect: false });
      }
    },
  });
  renderAt(`${path}?${query}`);
  vi.stubGlobal("location", { ...window.location, assign, replace: assign });
  await userEvent.click(
    await screen.findByRole("button", { name: "Continue with single sign-on" }),
  );
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://idp.example/sign-in"));
  expect(bodies).toEqual([
    {
      providerId: "acme-idp",
      callbackURL: `${path}?${query}`,
      errorCallbackURL: `${path}?${query}&error=sso`,
    },
  ]);
});

it("keeps the query when a password sign-in needs a second factor", async () => {
  const assign = vi.fn();
  stubApi({
    extra: (call) => {
      if (call.url.pathname === "/api/auth/sign-in/email")
        return json(200, { twoFactorRedirect: true });
      if (call.url.pathname === "/api/auth/two-factor/verify-totp")
        return json(200, { user: person, token: "session" });
    },
  });
  renderAt(`/portal/login?${query}`);
  vi.stubGlobal("location", { ...window.location, assign, replace: assign });
  await userEvent.type(await screen.findByLabelText("Email"), person.email);
  await userEvent.type(screen.getByLabelText("Password"), "correct-password");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "Verify" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
});

it.each(["twoFactorSetupRequired", "twoFactorVerificationRequired"])(
  "keeps the signed return when the login session has %s",
  async (requirement) => {
    stubApi({ signedIn: { ...person, [requirement]: true } });
    const url = new URL(`http://localhost/auth/login?${query}`);
    let result: unknown;
    try {
      result = await loginLoader({
        request: new Request(url),
        url,
        pattern: "/auth/login",
        params: {},
        context: new RouterContextProvider(),
      });
    } catch (redirect) {
      result = redirect;
    }
    expect(result).toBeInstanceOf(Response);
    const destination = new URL((result as Response).headers.get("Location")!, url.origin);
    expect(destination.pathname).toBe(
      requirement === "twoFactorSetupRequired" ? "/auth/two-factor/enroll" : "/auth/two-factor",
    );
    expect(destination.searchParams.get("oauth_query")).toBe(query);
  },
);

it("lets a Business User move from the plugin's login URL to Portal sign-in without losing the query", async () => {
  stubApi({});
  const { router } = renderAt(`/auth/login?${query}`);
  await userEvent.click(await screen.findByRole("link", { name: "Business Portal sign-in" }));
  expect(await screen.findByRole("heading", { name: "Business Portal sign-in" })).toBeVisible();
  expect(router.state.location.pathname + router.state.location.search).toBe(
    `/portal/login?${query}`,
  );
});

it("returns to authorize after required second-factor enrollment", async () => {
  const account = {
    ...person,
    twoFactorRequired: true,
    twoFactorSetupRequired: true,
    twoFactorEnabled: false,
  };
  const assign = vi.fn();
  stubApi({
    signedIn: account,
    extra: (call) => {
      if (call.url.pathname === "/api/auth/two-factor/enable")
        return json(200, {
          method: "totp",
          totpURI: "otpauth://totp/OpenLaw?secret=JBSWY3DPEHPK3PXP",
          backupCodes: ["test-backup"],
        });
      if (call.url.pathname === "/api/auth/two-factor/verify-totp") {
        account.twoFactorSetupRequired = false;
        account.twoFactorEnabled = true;
        return json(200, { status: true });
      }
    },
  });
  renderAt(`/auth/login?${query}`);
  vi.stubGlobal("location", { ...window.location, assign, replace: assign });
  await userEvent.type(await screen.findByLabelText("Password"), "correct-password");
  await userEvent.click(screen.getByRole("button", { name: "Turn on two-factor" }));
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await userEvent.click(await screen.findByRole("link", { name: "Done" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith(authorize));
});
