// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Record-page activity bar and applet panel (DES-016, #47) at the
 * component seam — no page mounts them until the contract record lands
 * at M8/M9, so these tests render the component directly.
 *
 * The panel is a flex sibling of the record content (DES-016 2026-08-17
 * clarification): opening it shrinks the main column rather than
 * covering it. The clip interpolates width over 200ms; jsdom does not
 * fire transitionend, so close tests dispatch it on the clip.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

/** An applet that puts its own content in the panel header — the M3
 * count pill's slot (DES-016's implementation clarification, point 5). */
const CHAT_WITH_COUNT: Applet = {
  ...CHAT,
  accessory: () => <span>4</span>,
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

function finishSlide(panel: HTMLElement) {
  const clip = panel.parentElement;
  expect(clip).not.toBeNull();
  fireEvent.transitionEnd(clip!, { propertyName: "width" });
}

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
  afterEach(() => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    // One test stops the clock. Put it back whatever happened to that
    // test, so a failure there cannot hang every test after it.
    vi.useRealTimers();
  });

  it("lets the open applet put its own content in the panel header", async () => {
    const user = userEvent.setup();
    renderApplets([CHAT_WITH_COUNT]);

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    const panel = screen.getByRole("complementary", { name: "Chat" });
    // The header is chrome; what sits beside its title is the applet's.
    expect(within(panel).getByText("4")).toBeInTheDocument();
  });

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
    // DES-016 / DES-010: the container takes focus, not Close.
    expect(panel).toHaveFocus();
    expect(within(panel).getByRole("button", { name: "Close" })).not.toHaveFocus();
  });

  it("shows one applet at a time: a second icon swaps the panel body", async () => {
    const user = userEvent.setup();
    renderApplets();

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    await user.click(screen.getByRole("button", { name: "History" }));

    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    const history = screen.getByRole("complementary", { name: "History" });
    expect(history).toBeInTheDocument();
    expect(history).toHaveFocus();
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
    finishSlide(panel);
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

    // Open already put focus on the panel container, so Esc is live
    // without an extra Tab — DES-010's overlay rule.
    expect(panel).toHaveFocus();
    await user.keyboard("{Escape}");
    finishSlide(panel);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(chat).toHaveFocus();
    expect(chat).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses the panel when the expanded icon is clicked again", async () => {
    const user = userEvent.setup();
    renderApplets();

    const chat = screen.getByRole("button", { name: "Chat (3)" });
    await user.click(chat);
    const panel = screen.getByRole("complementary", { name: "Chat" });
    await user.click(chat);
    finishSlide(panel);

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

  it("docks the panel in the flex row so the record content shrinks", async () => {
    const user = userEvent.setup();
    renderApplets();

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    const panel = screen.getByRole("complementary", { name: "Chat" });

    // In the flow, not over the content: a 320px column beside the
    // record. The clip interpolates width so the record flexes with it.
    expect(panel).not.toHaveClass("absolute");
    expect(panel).toHaveClass("w-(--width-panel)", "shrink-0");
    expect(panel.parentElement).toHaveClass(
      "transition-[width]",
      "duration-200",
      "w-(--width-panel)",
    );
    expect(screen.getByRole("toolbar", { name: "Applets" })).toHaveClass("w-(--width-activitybar)");
  });

  it("opens a hashed applet from a fragment link and gives the panel that id", async () => {
    const user = userEvent.setup();
    const hashed: Applet = {
      id: "team",
      icon: MessageSquare,
      label: defineMessage({ id: "test.applet.team", defaultMessage: "Team" }),
      hash: "contract-team",
      render: () => <p>Team panel</p>,
    };
    render(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <>
          <a href="#contract-team">Manage team</a>
          <RecordApplets applets={[hashed, HISTORY]}>
            <p>Record content</p>
          </RecordApplets>
        </>
      </IntlProvider>,
    );

    await user.click(screen.getByRole("link", { name: "Manage team" }));
    const panel = screen.getByRole("complementary", { name: "Team" });
    expect(within(panel).getByText("Team panel")).toBeInTheDocument();
    expect(panel).toHaveAttribute("id", "contract-team");
    expect(panel).toHaveFocus();
    expect(screen.getByRole("button", { name: "Team" })).toHaveAttribute(
      "aria-controls",
      "contract-team",
    );
  });

  it("keeps a sibling layer in the flex row when the panel opens", async () => {
    const user = userEvent.setup();
    render(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <RecordApplets applets={[CHAT]} layer={<aside aria-label="Document">Doc</aside>}>
          <p>Record content</p>
        </RecordApplets>
      </IntlProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    const applet = screen.getByRole("complementary", { name: "Chat" });
    const doc = screen.getByRole("complementary", { name: "Document" });
    // The row itself, not the layer's own classes: the layer is handed
    // in by the caller and carries whatever classes the caller gave it,
    // so asserting on those tests the fixture rather than this
    // component. What this component decides is where the two go.
    const row = doc.parentElement!.parentElement!;
    expect(row).toContainElement(applet);
    expect(row).toContainElement(doc);
  });

  it("drops a closing panel on its own deadline when the slide never ends", async () => {
    // The retention exists for the 200ms slide, and `transitionend` is
    // not guaranteed to arrive: a reader who asked for less motion has
    // the transition stripped, and a clip hidden mid-slide never
    // finishes one. Without the deadline the closed applet would stay
    // mounted for the rest of the session.
    // `fireEvent` rather than `userEvent` here: user-event waits on
    // real timers between its own steps, and this test has the clock
    // stopped. The presses are plain clicks, so nothing user-event adds
    // is needed.
    vi.useFakeTimers();
    try {
      renderApplets([CHAT]);
      const icon = screen.getByRole("button", { name: "Chat (3)" });

      fireEvent.click(icon);
      expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();

      fireEvent.click(icon);
      // Retained on purpose, with no transitionend dispatched.
      expect(screen.getByRole("complementary", { name: "Chat" })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.queryByRole("complementary", { name: "Chat" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the record content out of reach while a layer covers it", () => {
    // DES-010's overlay rule. Below the docking threshold the doc panel
    // covers the section being read, and a keyboard must not tab into
    // controls sitting behind an opaque surface.
    const { rerender } = render(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <RecordApplets applets={[CHAT]} layer={<aside aria-label="Document">Doc</aside>}>
          <p>Record content</p>
        </RecordApplets>
      </IntlProvider>,
    );

    const content = screen.getByText("Record content").parentElement!;
    expect(content).not.toHaveAttribute("inert");

    rerender(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <RecordApplets
          applets={[CHAT]}
          layer={<aside aria-label="Document">Doc</aside>}
          contentCovered
        >
          <p>Record content</p>
        </RecordApplets>
      </IntlProvider>,
    );

    expect(content).toHaveAttribute("inert");
    // The layer itself is never covered by its own overlay.
    expect(screen.getByRole("complementary", { name: "Document" })).not.toHaveAttribute("inert");
  });

  it("puts the layer in a region the applet panel and the bar are outside of", async () => {
    // A layer that overlays is positioned against its own containing
    // block, so what that block holds decides what the layer can cover.
    // The record content is inside it and the applet panel and the
    // activity bar are not — that is what keeps an open applet on
    // screen beside a document rather than behind it (DES-016).
    const user = userEvent.setup();
    render(
      <IntlProvider locale="en-US" defaultLocale="en-US">
        <RecordApplets applets={[CHAT]} layer={<aside aria-label="Document">Doc</aside>}>
          <p>Record content</p>
        </RecordApplets>
      </IntlProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Chat (3)" }));
    const region = screen.getByRole("complementary", { name: "Document" }).parentElement!;

    expect(region).toContainElement(screen.getByText("Record content"));
    expect(region).not.toContainElement(screen.getByRole("complementary", { name: "Chat" }));
    expect(region).not.toContainElement(screen.getByRole("toolbar", { name: "Applets" }));
  });
});
