// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The login screen offers exactly what GET /api/v1/auth/methods allows
 * (TECH-008 mode semantics), and drives the three flows off the same
 * card: password (with the 2FA challenge redirect), SSO, and the
 * magic-link request with its sent state. The magic-link affordance
 * needs both the toggle and a deployment that can send email.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi } from "../testing/helpers";

describe("login offers what the auth mode allows", () => {
  it("leads with the password form in built_in mode, magic link alongside", async () => {
    stubApi({ methods: { mode: "built_in", magicLinkEnabled: true, ssoProviderId: null } });
    renderAt("/auth/login");
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with single sign-on" }),
    ).not.toBeInTheDocument();
  });

  it("hides the magic-link option when the toggle is off", async () => {
    stubApi({ methods: { mode: "built_in", magicLinkEnabled: false, ssoProviderId: null } });
    renderAt("/auth/login");
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Email me a sign-in link" }),
    ).not.toBeInTheDocument();
  });

  it("hides the magic-link option when the deployment cannot send email", async () => {
    stubApi({
      methods: {
        mode: "built_in",
        magicLinkEnabled: true,
        emailConfigured: false,
        ssoProviderId: null,
      },
    });
    renderAt("/auth/login");
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Email me a sign-in link" }),
    ).not.toBeInTheDocument();
  });

  it("hides the magic-link option in oidc mode when email is unconfigured", async () => {
    stubApi({
      methods: {
        mode: "oidc",
        magicLinkEnabled: true,
        emailConfigured: false,
        ssoProviderId: "acme-idp",
      },
    });
    renderAt("/auth/login");
    expect(
      await screen.findByRole("button", { name: "Continue with single sign-on" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Email me a sign-in link" }),
    ).not.toBeInTheDocument();
  });

  it("leads with the SSO button in oidc mode and keeps break-glass reachable", async () => {
    stubApi({ methods: { mode: "oidc", magicLinkEnabled: true, ssoProviderId: "acme-idp" } });
    renderAt("/auth/login");
    expect(
      await screen.findByRole("button", { name: "Continue with single sign-on" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    // Break-glass: password sign-in stays one click away for Administrators.
    await userEvent.click(screen.getByRole("button", { name: "Administrator sign-in" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("says so when oidc mode has no registered provider", async () => {
    stubApi({ methods: { mode: "oidc", magicLinkEnabled: false, ssoProviderId: null } });
    renderAt("/auth/login");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Single sign-on is not configured yet.",
    );
    expect(
      screen.queryByRole("button", { name: "Continue with single sign-on" }),
    ).not.toBeInTheDocument();
  });

  it("requests a magic link and shows the sent state", async () => {
    const fetchStub = stubApi({
      methods: { mode: "built_in", magicLinkEnabled: true, ssoProviderId: null },
      extra: (call) =>
        call.url.pathname === "/api/v1/auth/magic-link" && call.method === "POST"
          ? json(202, { message: "If the address is eligible, a sign-in link is on its way." })
          : undefined,
    });
    renderAt("/auth/login");

    await userEvent.click(await screen.findByRole("button", { name: "Email me a sign-in link" }));
    await userEvent.type(await screen.findByLabelText("Email"), "requester@acme.example");
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    const issued = fetchStub.mock.calls
      .map(([input, init]) => ({ input, init }))
      .filter(({ input }) =>
        String(input instanceof Request ? input.url : input).includes("magic-link"),
      );
    expect(issued).toHaveLength(1);
  });

  it("routes a two-factor challenge to the challenge screen", async () => {
    stubApi({
      methods: { mode: "built_in", magicLinkEnabled: false, ssoProviderId: null },
      extra: (call) =>
        call.url.pathname === "/api/auth/sign-in/email" && call.method === "POST"
          ? json(200, { twoFactorRedirect: true, twoFactorMethods: ["totp"] })
          : undefined,
    });
    renderAt("/auth/login");

    await userEvent.type(await screen.findByLabelText("Email"), "iris@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Two-factor authentication" }),
    ).toBeInTheDocument();
  });

  it("answers wrong credentials without revealing whether the account exists", async () => {
    stubApi({
      methods: { mode: "built_in", magicLinkEnabled: false, ssoProviderId: null },
      extra: (call) =>
        call.url.pathname === "/api/auth/sign-in/email" && call.method === "POST"
          ? json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" })
          : undefined,
    });
    renderAt("/auth/login");

    await userEvent.type(await screen.findByLabelText("Email"), "nobody@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Check your email and password.");
  });
});
