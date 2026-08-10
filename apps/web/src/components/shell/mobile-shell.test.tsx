// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mobile shell (DES-012, #46) at the route seam: the header hamburger
 * opens the nav drawer, the drawer renders the destination registry,
 * a destination click navigates and closes the drawer, and Esc closes
 * it with focus restored to the hamburger. Which chrome is visible at
 * which viewport is CSS — asserted in the e2e suite where real layout
 * exists, not here.
 */

import { describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { destinations } from "./destinations";
import { renderAt, stubApi } from "../../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

/** Mounts the shell at home and returns the header landmark. */
async function renderShell() {
  stubApi({ signedIn: MEMBER });
  renderAt("/");
  return await screen.findByRole("banner");
}

describe("mobile shell (#46)", () => {
  it("opens the nav drawer from the header hamburger", async () => {
    const user = userEvent.setup();
    const header = await renderShell();

    await user.click(within(header).getByRole("button", { name: "Open navigation" }));

    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    // The drawer renders from the destination registry and nothing else.
    const links = within(drawer).getAllByRole("link");
    expect(links).toHaveLength(destinations.length);
    expect(links[0]).toHaveAccessibleName("Home");
    expect(links[0]).toHaveAttribute("aria-current", "page");
  });

  it("navigates and closes the drawer on a destination click", async () => {
    const user = userEvent.setup();
    const header = await renderShell();

    await user.click(within(header).getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });

    await user.click(within(drawer).getByRole("link", { name: "Home" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("closes the drawer on Esc and restores focus to the hamburger", async () => {
    const user = userEvent.setup();
    const header = await renderShell();

    const hamburger = within(header).getByRole("button", { name: "Open navigation" });
    await user.click(hamburger);
    await screen.findByRole("dialog", { name: "Navigation" });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hamburger).toHaveFocus();
  });

  it("closes an open drawer when the viewport crosses up into md", async () => {
    // A fake matchMedia that hands back the change listeners, so the
    // test can fire the md crossing itself — jsdom has no layout.
    type ChangeListener = (event: { matches: boolean }) => void;
    const listeners = new Set<ChangeListener>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_type: string, listener: ChangeListener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: ChangeListener) => listeners.delete(listener),
    }));
    const user = userEvent.setup();
    const header = await renderShell();

    await user.click(within(header).getByRole("button", { name: "Open navigation" }));
    await screen.findByRole("dialog", { name: "Navigation" });

    act(() => {
      for (const listener of listeners) listener({ matches: true });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
