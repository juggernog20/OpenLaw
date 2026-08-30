// SPDX-License-Identifier: AGPL-3.0-only

/** Entities · Fields at the shared catalog route seam. */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Admin",
  role: "administrator",
  theme: "light",
};
const MEMBER = { ...ADMIN, role: "legal_team_member" };
const base = {
  description: null,
  fieldType: "text",
  options: null,
  fieldTag: "business",
  aiPrompt: null,
  archivedAt: null,
  inUseCount: 0,
};

describe("the Entities Fields pane", () => {
  it("shows Entity and global Fields while excluding other module scopes", async () => {
    const fields = [
      { ...base, id: "f1", slug: "lei", displayName: "LEI", moduleScope: "entity" },
      { ...base, id: "f2", slug: "region", displayName: "Region", moduleScope: "global" },
      { ...base, id: "f3", slug: "term", displayName: "Term", moduleScope: "contract" },
    ];
    const api = (call: StubCall): Response | undefined =>
      call.url.pathname === "/api/v1/fields" && call.method === "GET"
        ? json(200, { fields })
        : undefined;
    stubApi({ signedIn: ADMIN, extra: api });
    renderAt("/settings/entities/fields");

    expect(await screen.findByRole("button", { name: "Rename LEI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Region" })).toBeInTheDocument();
    expect(screen.queryByText("Term")).not.toBeInTheDocument();
    expect(screen.getByText("Entity and global fields")).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Entities panes" });
    expect(within(tabs).getByRole("link", { name: "Fields" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("bounces a Legal Team Member to Profile and hides the rail entry", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/entities/fields");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Entities")).not.toBeInTheDocument();
  });
});
