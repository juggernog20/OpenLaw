// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Record-page activity bar and applet panel (DES-016, #47) at the
 * component seam — no page mounts them until the contract record lands
 * at M8/M9, so these tests render the component directly.
 *
 * Docking is a container query, which jsdom does not evaluate, so the
 * overlay test asserts the class contract that drives it. Real geometry
 * at both sides of the threshold belongs in the e2e suite once a page
 * mounts the region.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider, defineMessage } from "react-intl";
import { History, MessageSquare, Settings } from "lucide-react";
import type { Applet } from "./applets";
import { RecordApplets } from "./record-applets";

const CHAT: Applet = {
  id: "chat",
  icon: MessageSquare,
  label: defineMessage({ id: "test.applet.chat", defaultMessage: "Chat" }),
  badge: 3,
  render: () => <p>Chat panel</p>,
};

const HISTORY: Applet = {
  id: "history",
  icon: History,
  label: defineMessage({ id: "test.applet.history", defaultMessage: "History" }),
  render: () => <p>History panel</p>,
};

const SETTINGS: Applet = {
  id: "settings",
  icon: Settings,
  label: defineMessage({ id: "test.applet.settings", defaultMessage: "Settings" }),
  group: "below-divider",
  href: "/settings/contracts",
};

function renderApplets(applets: readonly Applet[] = [CHAT, HISTORY, SETTINGS]) {
  return render(
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <RecordApplets applets={applets}>
        <p>Record content</p>
      </RecordApplets>
    </IntlProvider>,
  );
}

describe("record applets (#47)", () => {
  it("renders one slot per page-scoped applet and nothing else", () => {
    renderApplets([CHAT, HISTORY]);

    const bar = screen.getByRole("toolbar", { name: "Applets" });
    expect(within(bar).getByRole("button", { name: "Chat (3)" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(within(bar).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("renders the settings deep-link as a link below the divider", () => {
    renderApplets();

    const bar = screen.getByRole("toolbar", { name: "Applets" });
    expect(within(bar).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/contracts",
    );
    expect(within(bar).getByRole("separator")).toBeInTheDocument();
  });

  it("starts collapsed: the bar is there, the panel is not", () => {
    renderApplets();

    expect(screen.getByRole("toolbar", { name: "Applets" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByText("Record content")).toBeInTheDocument();
  });

  it("expands the panel with the clicked applet and points the icon at it", async () => {
    const user = userEvent.setup();
    renderApplets();

    const chat = screen.getByRole("button", { name: "Chat (3)" });
    await user.click(chat);

    const panel = screen.getByRole("complementary", { name: "Chat" });
    expect(within(panel).getByText("Chat panel")).toBeInTheDocument();
    expect(chat).toHaveAttribute("aria-expanded", "true");
    expect(chat).toHaveAttribute("aria-controls", panel.id);
  });

  it("shows one applet at a time: a second icon swaps the panel body", async () => {
    const user = userEvent.setup();
    renderApplets();

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    await user.click(screen.getByRole("button", { name: "History" }));

    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(screen.getByRole("complementary", { name: "History" })).toBeInTheDocument();
    expect(screen.queryByText("Chat panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat (3)" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("titles the panel header with the applet label and closes from its X", async () => {
    const user = userEvent.setup();
    renderApplets();

    await user.click(screen.getByRole("button", { name: "History" }));

    const panel = screen.getByRole("complementary", { name: "History" });
    expect(within(panel).getByRole("heading", { name: "History" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    const icon = screen.getByRole("button", { name: "History" });
    expect(icon).toHaveAttribute("aria-expanded", "false");
    // The X was focused and is gone — focus returns to the applet's
    // icon per DES-010's restore-to-trigger rule.
    expect(icon).toHaveFocus();
  });

  it("closes on Escape from inside the panel and refocuses the icon", async () => {
    const user = userEvent.setup();
    renderApplets();

    const chat = screen.getByRole("button", { name: "Chat (3)" });
    await user.click(chat);
    const panel = screen.getByRole("complementary", { name: "Chat" });

    // Move focus into the panel — its close control is the tab stop
    // before the toolbar — then dismiss with the DES-010 global key.
    await user.tab({ shift: true });
    expect(within(panel).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(chat).toHaveFocus();
    expect(chat).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses the panel when the expanded icon is clicked again", async () => {
    const user = userEvent.setup();
    renderApplets();

    const chat = screen.getByRole("button", { name: "Chat (3)" });
    await user.click(chat);
    await user.click(chat);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(chat).toHaveAttribute("aria-expanded", "false");
    expect(chat).not.toHaveAttribute("aria-controls");
  });

  it("collapses when the page stops offering the expanded applet", async () => {
    const user = userEvent.setup();
    const { rerender } = renderApplets();

    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("complementary", { name: "History" })).toBeInTheDocument();

    rerender(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <RecordApplets applets={[CHAT]}>
          <p>Record content</p>
        </RecordApplets>
      </IntlProvider>,
    );

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
  });

  it("docks the panel above the container threshold and overlays below it", async () => {
    const user = userEvent.setup();
    renderApplets();

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    const panel = screen.getByRole("complementary", { name: "Chat" });

    // Overlay is the base state — pinned to the inner edge of the bar,
    // above the content. The container query lifts it into the flow at
    // the threshold; the bar is outside the query and never moves.
    expect(panel).toHaveClass("absolute", "end-(--width-activitybar)", "z-10");
    expect(panel).toHaveClass("@min-[1100px]/record:static");
    expect(panel).toHaveClass("w-(--width-panel)");
    expect(screen.getByRole("toolbar", { name: "Applets" })).toHaveClass("w-(--width-activitybar)");
  });
});
