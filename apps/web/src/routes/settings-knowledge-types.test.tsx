// SPDX-License-Identifier: AGPL-3.0-only

/** Knowledge · Types at the Settings route seam. */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Administrator",
  role: "administrator",
  theme: "light",
};
const MEMBER = { ...ADMIN, id: "u2", email: "member@example.com", role: "legal_team_member" };

const ROWS = [
  ["k1", "template", "Template"],
  ["k2", "precedent", "Precedent"],
  ["k3", "playbook", "Playbook"],
  ["k4", "article", "Article"],
] as const;

function knowledgeTypes(inUse = 0) {
  return ROWS.map(([id, slug, displayName], index) => ({
    id,
    slug,
    displayName,
    description: null,
    displayOrder: index + 1,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: slug === "template" ? inUse : 0,
  }));
}

function knowledgeApi(calls: unknown[], inUse = 0) {
  const rows = knowledgeTypes(inUse);
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/knowledge/types" && call.method === "GET") {
      return json(200, { knowledgeTypes: rows });
    }
    const archive = /^\/api\/v1\/knowledge\/types\/([^/]+)\/archive$/.exec(call.url.pathname);
    if (archive && call.method === "POST") {
      calls.push({ id: archive[1], body: call.body });
      return json(200, {
        knowledgeType: {
          ...rows.find((row) => row.id === archive[1])!,
          archivedAt: "2026-08-30T12:00:00.000Z",
        },
      });
    }
    return undefined;
  };
}

describe("Knowledge in Settings", () => {
  it("is absent for a Member and refuses the deep link", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/knowledge/types");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Knowledge")).not.toBeInTheDocument();
  });

  it("joins the Administrator rail immediately after Entities and shows four editable seeds", async () => {
    stubApi({ signedIn: ADMIN, extra: knowledgeApi([]) });
    renderAt("/settings/knowledge/types");
    await screen.findByText("Template");

    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    const links = within(rail)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(links.indexOf("Knowledge")).toBe(links.indexOf("Entities") + 1);
    expect(within(rail).getByRole("link", { name: "Knowledge" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["Template", "Precedent", "Playbook", "Article"]);
    for (const name of ["Template", "Precedent", "Playbook", "Article"]) {
      expect(screen.getByRole("button", { name: `Archive ${name}` })).toBeInTheDocument();
    }
  });

  it("requires and sends reassignment when the live usage count is nonzero", async () => {
    const calls: unknown[] = [];
    stubApi({ signedIn: ADMIN, extra: knowledgeApi(calls, 2) });
    renderAt("/settings/knowledge/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Template" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Template" });
    expect(within(dialog).getByText(/used by 2 knowledge items/)).toBeInTheDocument();
    const replacement = within(dialog).getByRole("combobox", {
      name: "Reassign 2 knowledge items to",
    });
    expect(replacement).toBeRequired();
    await user.selectOptions(replacement, "Precedent");
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() => expect(calls).toEqual([{ id: "k1", body: { reassignToId: "k2" } }]));
  });
});
