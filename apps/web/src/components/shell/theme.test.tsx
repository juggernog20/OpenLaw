// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Theme switching (#44) at the route seam: the shell applies the
 * signed-in user's stored theme to the document root, the user-menu
 * switcher changes it instantly and persists it through the preference
 * endpoint, and pre-login screens render Light unconditionally.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../../testing/helpers";

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

describe("theme switching (#44)", () => {
  it("applies the signed-in user's theme to the root and mirrors it locally", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    await screen.findByRole("banner");
    expect(document.documentElement.dataset.theme).toBe("warm");
    // The local mirror is what the pre-paint boot script reads next load.
    expect(localStorage.getItem("openlaw.theme")).toBe("warm");
  });

  it("switches from the user menu: instant root attribute, persisted via PATCH", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/me/preferences" && call.method === "PATCH") {
          patches.push(call.body);
          return json(200, { user: { ...MEMBER, theme: (call.body as { theme: string }).theme } });
        }
        return undefined;
      },
    });
    renderAt("/");

    const header = await screen.findByRole("banner");
    await user.click(within(header).getByRole("button", { name: MEMBER.displayName }));

    const menu = await screen.findByRole("menu");
    // The switcher is a radio group: the stored theme reads as checked.
    expect(within(menu).getByRole("menuitemradio", { name: "Warm" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(menu).getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("openlaw.theme")).toBe("dark");
    await waitFor(() => expect(patches).toEqual([{ theme: "dark" }]));
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
