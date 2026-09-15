// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The dead-link page (#376): a stale or already-used magic link lands
 * here, and the fresh-link path out of it works. The redemption failure
 * itself is the API's business — this suite starts where the browser is
 * put, at "/" with the verify endpoint's ?error= query.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi } from "../testing/helpers";

const EXPIRED = "Sign-in link expired";

describe("the dead-link page", () => {
  it("sends a fresh link from a dead one", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: null,
      extra: (call) =>
        call.url.pathname === "/api/v1/auth/magic-link" && call.method === "POST"
          ? json(202, { message: "If the address is eligible, a sign-in link is on its way." })
          : undefined,
    });
    renderAt("/?error=INVALID_TOKEN");

    expect(await screen.findByRole("heading", { name: EXPIRED })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "tom.iwu@acme.com");
    await user.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
  });

  it("falls back to sign-in when the magic-link toggle is off", async () => {
    stubApi({
      signedIn: null,
      methods: { mode: "oidc", magicLinkEnabled: false, ssoProviderId: "acme-idp" },
    });
    renderAt("/?error=INVALID_TOKEN");

    expect(await screen.findByRole("heading", { name: EXPIRED })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign-in" })).toBeInTheDocument();
  });
});

it.each(["legal", "business"] as const)(
  "recovers a spent %s sign-in link through that group's methods",
  async (group) => {
    const calls: unknown[] = [];
    stubApi({
      signedIn: null,
      methods: {
        mode: "built_in",
        magicLinkEnabled: true,
        ssoProviderId: null,
        policy: {
          legal: {
            password: true,
            magicLink: group === "legal",
            sso: false,
            requireTwoFactor: false,
          },
          business: {
            password: true,
            magicLink: group === "business",
            sso: false,
            requireTwoFactor: false,
          },
        },
      },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/auth/magic-link" && call.method === "POST") {
          calls.push(call.body);
          return json(202, { message: "Check your email." });
        }
        return undefined;
      },
    });
    const { router } = renderAt(
      `${group === "business" ? "/portal/login" : "/auth/login"}?error=INVALID_TOKEN`,
    );
    expect(await screen.findByRole("heading", { name: EXPIRED })).toBeVisible();
    expect(router.state.location.pathname).toBe("/auth/link-expired");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "reader@example.com");
    await user.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeVisible();
    expect(calls).toEqual([{ email: "reader@example.com", group }]);
  },
);
