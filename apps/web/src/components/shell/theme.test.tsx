// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Theme application (#44) at the route seam: the shell applies the
 * signed-in user's stored theme to the document root, and pre-login
 * screens render Light unconditionally. The switcher itself lives on
 * the Appearance pane since #62 — see routes/settings.test.tsx.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderAt, stubApi } from "../../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "warm",
};

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("theme application (#44)", () => {
  it("applies the signed-in user's theme to the root and mirrors it locally", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    await screen.findByRole("banner");
    expect(document.documentElement.dataset.theme).toBe("warm");
    // The local mirror is what the pre-paint boot script reads next load.
    expect(localStorage.getItem("openlaw.theme")).toBe("warm");
  });

  it("renders pre-login screens Light, leaving the mirror untouched", async () => {
    // A signed-out arrival whose previous session mirrored Dark: the
    // login screen must not present it.
    document.documentElement.dataset.theme = "dark";
    localStorage.setItem("openlaw.theme", "dark");
    stubApi({ signedIn: null });
    renderAt("/auth/login");

    await screen.findByRole("heading", { name: "Sign in" });
    expect(document.documentElement.dataset.theme).toBe("light");
    // Presentation only: the person's stored preference survives.
    expect(localStorage.getItem("openlaw.theme")).toBe("dark");
  });
});
