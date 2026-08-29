// SPDX-License-Identifier: AGPL-3.0-only

/** Entities · Officer roles at the shared taxonomy route seam. */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
const MEMBER = { ...ADMIN, role: "legal_team_member" };

const ROLES = [
  ["r1", "director", "Director", 2],
  ["r2", "ceo", "CEO", 0],
  ["r3", "cfo", "CFO", 0],
  ["r4", "secretary", "Secretary", 0],
  ["r5", "other", "Other", 0],
].map(([id, slug, displayName, inUseCount], index) => ({
  id,
  slug,
  displayName,
  description: null,
  displayOrder: index + 1,
  isSystemDefault: true,
  archivedAt: null,
  inUseCount,
}));

function rolesApi(call: StubCall): Response | undefined {
  if (call.url.pathname === "/api/v1/officer-roles" && call.method === "GET") {
    return json(200, { officerRoles: ROLES });
  }
  return undefined;
}

describe("the Entities Officer roles pane", () => {
  it("renders the five seeds, protects Other, and exposes the full officer usage count", async () => {
    stubApi({ signedIn: ADMIN, extra: rolesApi });
    renderAt("/settings/entities/officer-roles");
    expect(await screen.findByText("Director")).toBeInTheDocument();
    expect(screen.getByText("2 officers")).toBeInTheDocument();
    expect(screen.getByText("5 roles")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Other is system-protected and can't be archived" }),
    ).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Entities panes" });
    expect(within(tabs).getByRole("link", { name: "Officer roles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("uses the shared reassignment guard copy for every referenced officer", async () => {
    stubApi({ signedIn: ADMIN, extra: rolesApi });
    renderAt("/settings/entities/officer-roles");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Director" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Director" });
    expect(
      within(dialog).getByText(
        "Director is used by 2 officers. Pick a replacement role — those officers move to it when the role is archived.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Reassign 2 officers to" })).toBeRequired();
  });

  it("redirects a non-Administrator to Profile", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/entities/officer-roles");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });
});
