// SPDX-License-Identifier: AGPL-3.0-only

/** Matters · Statuses at the route seam (MTR-002). */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};

const ROWS = [
  ["s1", "open", "Open", "open", 0],
  ["s2", "in_progress", "In progress", "open", 3],
  ["s3", "on_hold", "On hold", "open", 0],
  ["s4", "closed", "Closed", "closed", 0],
] as const;

function statuses() {
  return ROWS.map(([id, slug, displayName, category, inUseCount], index) => ({
    id,
    slug,
    displayName,
    category,
    displayOrder: index + 1,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount,
  }));
}

function statusApi(calls: { creates: unknown[]; archives: unknown[] }) {
  const rows = statuses();
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/matter-statuses" && call.method === "GET") {
      return json(200, { matterStatuses: rows });
    }
    if (call.url.pathname === "/api/v1/matter-statuses" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { displayName: string; category: string };
      return json(201, {
        matterStatus: {
          id: "s5",
          slug: "awaiting_input",
          displayName: body.displayName,
          category: body.category,
          displayOrder: 5,
          isSystemDefault: false,
          archivedAt: null,
          inUseCount: 0,
        },
      });
    }
    if (call.url.pathname === "/api/v1/matter-statuses/s2/archive" && call.method === "POST") {
      calls.archives.push(call.body);
      return json(200, {
        matterStatus: { ...rows[1], archivedAt: "2026-08-23T00:00:00.000Z", inUseCount: 0 },
      });
    }
    return undefined;
  };
}

const fullText = (text: string) => (_: string, element: Element | null) =>
  element?.textContent === text &&
  ![...element.children].some((child) => child.textContent === text);

describe("the Matters Statuses pane", () => {
  it("shows fixed category badges and locks the protected Open and Closed seeds", async () => {
    stubApi({ signedIn: ADMIN, extra: statusApi({ creates: [], archives: [] }) });
    renderAt("/settings/matters/statuses");
    await screen.findByRole("button", { name: "Rename In progress" });

    const tabs = screen.getByRole("navigation", { name: "Matters panes" });
    expect(within(tabs).getByRole("link", { name: "Statuses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const openRow = screen.getByRole("button", { name: "Rename Open" }).closest("li")!;
    const closedRow = screen.getByRole("button", { name: "Rename Closed" }).closest("li")!;
    expect(within(openRow).getByText(fullText("Category: Open"))).toBeInTheDocument();
    expect(within(closedRow).getByText(fullText("Category: Closed"))).toBeInTheDocument();
    expect(
      within(openRow).getByRole("img", {
        name: "Open is system-protected and can't be archived",
      }),
    ).toBeInTheDocument();
    expect(
      within(closedRow).getByRole("img", {
        name: "Closed is system-protected and can't be archived",
      }),
    ).toBeInTheDocument();
  });

  it("requires the category picker and sends it only at creation", async () => {
    const calls = { creates: [] as unknown[], archives: [] as unknown[] };
    stubApi({ signedIn: ADMIN, extra: statusApi(calls) });
    renderAt("/settings/matters/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add status" }));
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "Awaiting input");
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "{Enter}");
    expect(await screen.findByText("Pick a category for the new status.")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "New status category" }), "open");
    expect(screen.queryByText("Pick a category for the new status.")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "New status name" }), "{Enter}");
    await waitFor(() =>
      expect(calls.creates).toEqual([{ displayName: "Awaiting input", category: "open" }]),
    );
  });

  it("shows the live guard count and posts the chosen same-category replacement", async () => {
    const calls = { creates: [] as unknown[], archives: [] as unknown[] };
    stubApi({ signedIn: ADMIN, extra: statusApi(calls) });
    renderAt("/settings/matters/statuses");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive In progress" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive In progress" });
    expect(
      within(dialog).getByText(
        "In progress is the status of 3 matters. Pick their replacement below.",
      ),
    ).toBeInTheDocument();
    const replacement = within(dialog).getByRole("combobox", { name: "Reassign 3 matters to" });
    expect(within(replacement).getByRole("option", { name: "On hold" })).toBeInTheDocument();
    expect(within(replacement).queryByRole("option", { name: "Closed" })).not.toBeInTheDocument();
    await user.selectOptions(replacement, "s3");
    await user.click(within(dialog).getByRole("button", { name: "Archive status" }));
    await waitFor(() => expect(calls.archives).toEqual([{ reassignToId: "s3" }]));
  });
});
