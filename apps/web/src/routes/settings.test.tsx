// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (#62) at the route seam: /settings is
 * guarded and lands on the Appearance pane, the rail carries the
 * Personal group only, theme changes apply instantly and persist
 * through the preference endpoint, and the avatar menu links here
 * instead of switching the theme itself.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "warm",
};

/** Captures theme PATCHes the way the real preference endpoint answers. */
function capturePreferencePatches(patches: unknown[]) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/me/preferences" && call.method === "PATCH") {
      patches.push(call.body);
      return json(200, { user: { ...MEMBER, theme: (call.body as { theme: string }).theme } });
    }
    return undefined;
  };
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("the settings destination (#62)", () => {
  it("bounces a signed-out visitor to login", async () => {
    stubApi({ signedIn: null });
    renderAt("/settings");

    await screen.findByRole("heading", { name: "Sign in" });
  });

  it("lands on Appearance with a Personal-only rail", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings");

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByText("Personal")).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "Profile" })).toBeVisible();
    // The index route forwards to Appearance: its rail entry is current.
    expect(within(rail).getByRole("link", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // No Organization group yet: entries for unshipped panes are
    // omitted, not disabled (SET-001).
    expect(within(rail).queryByText("Organization")).not.toBeInTheDocument();

    // The pane presents the three themes as radios; the stored theme
    // reads as checked.
    expect(screen.getByRole("radio", { name: "Warm" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("applies a theme choice instantly and persists it via PATCH", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    stubApi({ signedIn: MEMBER, extra: capturePreferencePatches(patches) });
    renderAt("/settings/appearance");

    await user.click(await screen.findByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("openlaw.theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    await waitFor(() => expect(patches).toEqual([{ theme: "dark" }]));
  });

  it("is reached from the avatar menu, which no longer switches the theme", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER });
    renderAt("/");

    const header = await screen.findByRole("banner");
    await user.click(within(header).getByRole("button", { name: MEMBER.displayName }));

    const menu = await screen.findByRole("menu");
    // The theme's home moved to /settings: no radio rows in the menu.
    expect(within(menu).queryAllByRole("menuitemradio")).toHaveLength(0);

    await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Warm" })).toBeChecked();
  });

  it("stubs the Profile pane behind its rail entry", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/profile");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Profile settings arrive with their own build.")).toBeVisible();
  });
});
