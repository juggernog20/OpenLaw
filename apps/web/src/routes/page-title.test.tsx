// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-011 commitment 7 (#48): every screen sets a unique document title
 * as "{screen} · OpenLaw". React 19 hoists the <title> element each
 * page mounts via <PageTitle> into <head>; these tests read the result
 * off document.title after the route settles.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { json, renderAt, stubApi } from "../testing/helpers";

const signedIn = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
};

describe("per-screen document titles", () => {
  it("login titles itself 'Sign in · OpenLaw'", async () => {
    stubApi({ methods: { mode: "built_in", magicLinkEnabled: false, ssoProviderId: null } });
    renderAt("/auth/login");
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Sign in · OpenLaw"));
  });

  it("home titles itself 'Home · OpenLaw'", async () => {
    stubApi({ signedIn });
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Home · OpenLaw"));
  });

  it("the two-factor challenge titles itself 'Two-factor authentication · OpenLaw'", async () => {
    stubApi({});
    renderAt("/auth/two-factor");
    expect(await screen.findByLabelText("Code")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Two-factor authentication · OpenLaw"));
  });

  it("enrollment titles itself distinctly from the challenge", async () => {
    // The enroll loader asks better-auth for the session directly.
    stubApi({
      signedIn,
      extra: (call) =>
        call.url.pathname === "/api/auth/get-session"
          ? json(200, {
              user: { id: signedIn.id, email: signedIn.email, twoFactorEnabled: false },
              session: { id: "sess-1" },
            })
          : undefined,
    });
    renderAt("/auth/two-factor/enroll");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Two-factor enrollment · OpenLaw"));
  });
});
