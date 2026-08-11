// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The settings destination (#62, #63) at the route seam: /settings is
 * guarded and lands on the Profile pane (#67), theme changes apply
 * instantly and persist through the preference endpoint, and the avatar
 * menu links here instead of switching the theme itself. The
 * Organization group renders for Administrators only (SET-002), and its
 * General pane commits each field individually (DES-017).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "warm",
};

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const GENERAL = {
  name: "Acme Inc",
  logo: null,
  defaultLocale: "en-US",
  defaultTimezone: "UTC",
};

/** Answers the General pane's endpoints and captures its PATCHes. */
function captureGeneralPatches(patches: unknown[]) {
  let general = { ...GENERAL };
  return (call: StubCall) => {
    if (call.url.pathname !== "/api/v1/org/general") return undefined;
    if (call.method === "PATCH") {
      patches.push(call.body);
      general = { ...general, ...(call.body as Partial<typeof GENERAL>) };
    }
    return json(200, { general });
  };
}

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

  it("lands on Profile with a Personal-only rail", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings");

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByText("Personal")).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "Appearance" })).toBeVisible();
    // The index route forwards to Profile: its rail entry is current.
    expect(within(rail).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // No Organization group yet: entries for unshipped panes are
    // omitted, not disabled (SET-001).
    expect(within(rail).queryByText("Organization")).not.toBeInTheDocument();

    // The pane renders the person's own account surfaces.
    expect(await screen.findByLabelText("Full name")).toHaveValue(MEMBER.displayName);
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
    expect(await screen.findByLabelText("Full name")).toHaveValue(MEMBER.displayName);
  });

  it("shows the Organization group to an Administrator and renders General (#63)", async () => {
    stubApi({ signedIn: ADMIN, extra: captureGeneralPatches([]) });
    renderAt("/settings/general");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByText("Organization")).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Users sits between General and the Security group (#65).
    expect(within(rail).getByRole("link", { name: "Users" })).toBeVisible();

    // The card header, as distinct from the rail's group label.
    const cardHeaders = screen
      .getAllByRole("heading", { name: "Organization" })
      .filter((heading) => !rail.contains(heading));
    expect(cardHeaders).toHaveLength(1);
    expect(screen.getByLabelText("Organization name")).toHaveValue("Acme Inc");
    expect(screen.getByLabelText("Default timezone")).toHaveValue("UTC");
  });

  it("collapses the Security group until it is opened by hand (#64)", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: captureGeneralPatches([]) });
    renderAt("/settings/general");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    const disclosure = within(rail).getByRole("button", { name: "Security" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(within(rail).queryByRole("link", { name: "Authentication" })).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(within(rail).getByRole("link", { name: "Authentication" })).toBeVisible();
  });

  it("bounces a non-Administrator off /settings/general to their settings home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/general");

    // Landed on Profile — and the rail never teases the group (SET-002).
    expect(await screen.findByLabelText("Full name")).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Organization")).not.toBeInTheDocument();
  });

  it("commits the organization name per field on blur (DES-017)", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    stubApi({ signedIn: ADMIN, extra: captureGeneralPatches(patches) });
    renderAt("/settings/general");

    const name = await screen.findByLabelText("Organization name");
    await user.clear(name);
    await user.type(name, "Acme Holdings");
    await user.tab();

    await waitFor(() => expect(patches).toEqual([{ name: "Acme Holdings" }]));
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("reverts an in-progress name edit on Escape without saving", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    stubApi({ signedIn: ADMIN, extra: captureGeneralPatches(patches) });
    renderAt("/settings/general");

    const name = await screen.findByLabelText("Organization name");
    await user.clear(name);
    await user.type(name, "Mistake Inc");
    await user.keyboard("{Escape}");

    expect(name).toHaveValue("Acme Inc");
    await user.tab();
    expect(patches).toEqual([]);
  });

  it("shows the error micro-state when a field commit fails (DES-017)", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/org/general") return undefined;
        if (call.method === "PATCH") return problem(500, "The database is unavailable.");
        return json(200, { general: GENERAL });
      },
    });
    renderAt("/settings/general");

    const name = await screen.findByLabelText("Organization name");
    await user.clear(name);
    await user.type(name, "Acme Holdings");
    await user.tab();

    expect(await screen.findByText("The change could not be saved. Try again.")).toBeVisible();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("commits a timezone pick the moment an option is chosen", async () => {
    const user = userEvent.setup();
    const patches: unknown[] = [];
    stubApi({ signedIn: ADMIN, extra: captureGeneralPatches(patches) });
    renderAt("/settings/general");

    // The DES-014 picker is a search-narrowed combobox: typing filters
    // the IANA list, choosing an option commits.
    const timezone = await screen.findByLabelText("Default timezone");
    await user.click(timezone);
    await user.keyboard("Europe/Berlin");
    await user.click(await screen.findByRole("option", { name: /Europe\/Berlin/ }));

    await waitFor(() => expect(patches).toEqual([{ defaultTimezone: "Europe/Berlin" }]));
  });
});
