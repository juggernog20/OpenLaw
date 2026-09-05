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

  it.each(["legal_team_member", "contributor"])(
    "bounces a %s off /settings/general to their settings home",
    async (role) => {
      const reads: string[] = [];
      stubApi({
        signedIn: { ...MEMBER, role },
        extra: (call) => {
          reads.push(call.url.pathname);
          return undefined;
        },
      });
      renderAt("/settings/general");

      // Landed on Profile — and the rail never teases the group (SET-002).
      expect(await screen.findByLabelText("Full name")).toBeVisible();
      const rail = screen.getByRole("navigation", { name: "Settings sections" });
      expect(within(rail).queryByText("Organization")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Setup checklist" })).not.toBeInTheDocument();
      expect(reads).not.toContain("/api/v1/onboarding");
    },
  );

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

    // The API's own refusal sentence beats the generic line.
    expect(await screen.findByText("The database is unavailable.")).toBeVisible();
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

describe("the setup checklist (#701)", () => {
  it("lists outstanding steps above Organization using their Settings addresses", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: {
        completed: true,
        steps: {
          organization: false,
          portal: false,
          email: false,
          invites: false,
          "e-signature": false,
          "ai-analysis": false,
          review: false,
        },
      },
      extra: captureGeneralPatches([]),
    });
    renderAt("/settings/general");

    await screen.findByRole("heading", { name: "Setup checklist" });
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .filter((heading) => !rail.contains(heading));
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Setup checklist",
      "Organization",
    ]);
    const list = screen.getByRole("list", { name: "Outstanding setup steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    for (const [name, path] of [
      ["Organization", "/settings/general"],
      ["Business-user portal", "/settings/authentication"],
      ["Invite your team", "/settings/users"],
      ["E-signature", "/settings/integrations/e-signature"],
      ["AI analysis", "/settings/ai-analysis"],
    ]) {
      expect(within(list).getByRole("link", { name })).toHaveAttribute("href", path);
    }
    expect(within(list).getAllByRole("link")).toHaveLength(5);
    for (const name of ["Email", "Review seeded types"]) {
      expect(within(list).getByText(name)).toBeVisible();
      expect(within(list).queryByRole("link", { name })).not.toBeInTheDocument();
    }
    // Review alone carries its own action: no pane finishes it.
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(within(list).getByRole("button", { name: "Mark as reviewed" })).toBeVisible();
    expect(within(list).queryByText("Authentication")).not.toBeInTheDocument();
    expect(within(list).queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("omits configured steps, including email configured by the environment", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: true, steps: { "ai-analysis": false, email: true } },
      extra: captureGeneralPatches([]),
    });
    renderAt("/settings/general");

    const list = await screen.findByRole("list", { name: "Outstanding setup steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByRole("link", { name: "AI analysis" })).toBeVisible();
    expect(within(list).queryByText("Email")).not.toBeInTheDocument();
  });

  it("renders no card when every step is done", async () => {
    stubApi({ signedIn: ADMIN, extra: captureGeneralPatches([]) });
    renderAt("/settings/general");

    await screen.findByLabelText("Organization name");
    expect(screen.queryByRole("heading", { name: "Setup checklist" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Outstanding setup steps" })).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .filter(
          (heading) =>
            !screen.getByRole("navigation", { name: "Settings sections" }).contains(heading),
        )
        .map((heading) => heading.textContent),
    ).toEqual(["Organization"]);
  });

  it("drops Organization immediately after its name is saved in General", async () => {
    const user = userEvent.setup();
    const onboarding = { completed: true, steps: { organization: false, "ai-analysis": false } };
    const general = { ...GENERAL, name: "" };
    stubApi({
      signedIn: ADMIN,
      onboarding,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/org/general") return undefined;
        if (call.method === "PATCH") {
          Object.assign(general, call.body);
          onboarding.steps.organization = true;
        }
        return json(200, { general });
      },
    });
    renderAt("/settings/general");

    const list = await screen.findByRole("list", { name: "Outstanding setup steps" });
    expect(within(list).getByRole("link", { name: "Organization" })).toBeVisible();
    await user.type(screen.getByLabelText("Organization name"), "Acme Holdings");
    await user.tab();

    await waitFor(() =>
      expect(within(list).queryByRole("link", { name: "Organization" })).not.toBeInTheDocument(),
    );
    expect(within(list).getByRole("link", { name: "AI analysis" })).toBeVisible();
    expect(screen.getByLabelText("Organization name")).toHaveValue("Acme Holdings");
  });

  it("removes the whole card after the last outstanding step is saved", async () => {
    const user = userEvent.setup();
    const onboarding = { completed: true, steps: { organization: false } };
    const general = { ...GENERAL, name: "" };
    stubApi({
      signedIn: ADMIN,
      onboarding,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/org/general") return undefined;
        if (call.method === "PATCH") {
          Object.assign(general, call.body);
          onboarding.steps.organization = true;
        }
        return json(200, { general });
      },
    });
    renderAt("/settings/general");

    await screen.findByRole("heading", { name: "Setup checklist" });
    await user.type(screen.getByLabelText("Organization name"), "Acme Holdings");
    await user.tab();

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Setup checklist" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("list", { name: "Outstanding setup steps" })).not.toBeInTheDocument();
  });

  it("drops Review once it is marked reviewed from the card", async () => {
    const user = userEvent.setup();
    const onboarding = { completed: true, steps: { review: false, "ai-analysis": false } };
    const writes: string[] = [];
    stubApi({
      signedIn: ADMIN,
      onboarding,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/onboarding/reviewed" && call.method === "POST") {
          writes.push(call.url.pathname);
          onboarding.steps.review = true;
          return json(200, { completed: true, steps: {} });
        }
        return captureGeneralPatches([])(call);
      },
    });
    renderAt("/settings/general");

    const list = await screen.findByRole("list", { name: "Outstanding setup steps" });
    expect(within(list).getByText("Review seeded types")).toBeVisible();
    await user.click(within(list).getByRole("button", { name: "Mark as reviewed" }));

    await waitFor(() =>
      expect(within(list).queryByText("Review seeded types")).not.toBeInTheDocument(),
    );
    expect(writes).toEqual(["/api/v1/onboarding/reviewed"]);
    expect(within(list).getByRole("link", { name: "AI analysis" })).toBeVisible();
  });

  it("keeps Review on the card and shows the refusal when the mark fails", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: true, steps: { review: false } },
      extra: (call) => {
        if (call.url.pathname === "/api/v1/onboarding/reviewed" && call.method === "POST") {
          return problem(503, "Review could not be saved. Try again.");
        }
        return captureGeneralPatches([])(call);
      },
    });
    renderAt("/settings/general");

    const list = await screen.findByRole("list", { name: "Outstanding setup steps" });
    await user.click(within(list).getByRole("button", { name: "Mark as reviewed" }));

    expect(await within(list).findByText("Review could not be saved. Try again.")).toBeVisible();
    expect(within(list).getByText("Review seeded types")).toBeVisible();
    expect(within(list).getByRole("button", { name: "Mark as reviewed" })).toBeEnabled();
  });
});
