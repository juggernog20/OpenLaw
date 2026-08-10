// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Keyboard contract (DES-010, #45) at the route seam: `/` focuses the
 * search input, `?` opens the cheat-sheet (suppressed while typing),
 * `Esc` closes the topmost overlay and restores focus, and the
 * cheat-sheet lists exactly what KEY_MAP declares.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KEY_MAP } from "../../lib/keyboard";
import { renderAt, stubApi } from "../../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

/** Mounts the shell at home and waits for the header to arrive. */
async function renderShell() {
  stubApi({ signedIn: MEMBER });
  renderAt("/");
  return await screen.findByRole("banner");
}

describe("keyboard contract (#45)", () => {
  it("focuses the search input on / without typing the slash", async () => {
    const user = userEvent.setup();
    await renderShell();

    await user.keyboard("/");

    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
  });

  it("opens the cheat-sheet on ? and renders every KEY_MAP binding", async () => {
    const user = userEvent.setup();
    await renderShell();

    await user.keyboard("?");

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    // Drift guard: the modal is a pure rendering of KEY_MAP.
    for (const section of KEY_MAP) {
      expect(within(dialog).getByText(section.title.defaultMessage)).toBeInTheDocument();
      for (const binding of section.bindings) {
        expect(within(dialog).getByText(binding.description.defaultMessage)).toBeInTheDocument();
      }
    }
  });

  it("suppresses / and ? while focus is in an input", async () => {
    const user = userEvent.setup();
    await renderShell();

    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.click(search);
    await user.keyboard("?/");

    // The keystrokes typed literally instead of triggering shortcuts.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(search).toHaveValue("?/");
  });

  it("closes the cheat-sheet on Esc", async () => {
    const user = userEvent.setup();
    await renderShell();

    await user.keyboard("?");
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the user menu on Esc and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    const header = await renderShell();

    const trigger = within(header).getByRole("button", { name: MEMBER.displayName });
    await user.click(trigger);
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
