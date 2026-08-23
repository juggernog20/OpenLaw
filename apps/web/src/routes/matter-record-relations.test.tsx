// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-015's Matter relationship states through the real record route. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  MATTER_PARENT_CYCLE_PROBLEM_TYPE,
  MATTER_RELATION_EXISTS_PROBLEM_TYPE,
} from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u-member",
  email: "member@example.com",
  displayName: "Mina Member",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u-contributor",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
};
const MATTER = {
  id: "matter-12",
  number: 12,
  title: "Regulatory programme",
  description: null,
  matterTypeId: "type-general",
  matterTypeName: "General",
  statusId: "status-open",
  statusName: "Open",
  statusCategory: "open",
  manager: null,
  priority: "medium",
  risk: null,
  customFields: {},
  openedAt: "2026-08-24T08:00:00.000Z",
  closedAt: null,
  isConfidential: false,
  archivedAt: null,
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T08:00:00.000Z",
  nextDeadline: null,
};
const OPTIONS = {
  matterTypes: [{ id: "type-general", slug: "general", displayName: "General", fields: [] }],
  matterStatuses: [{ id: "status-open", slug: "open", displayName: "Open", category: "open" }],
  users: [],
};

const reachable = (number: number, title: string) => ({
  restricted: false as const,
  number,
  title,
  statusName: "Open",
  statusCategory: "open" as const,
});

function mountApi(
  signedIn: typeof MEMBER | typeof CONTRIBUTOR,
  relations: Record<string, unknown>,
  extra?: (call: StubCall) => Response | undefined,
) {
  return stubApi({
    signedIn,
    extra: (call) => {
      const custom = extra?.(call);
      if (custom) return custom;
      if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET") {
        return json(200, {
          matter: MATTER,
          fields: [],
          customFieldRefs: { users: [], entities: [] },
          team:
            signedIn.role === "contributor"
              ? [{ ...CONTRIBUTOR, image: null, archived: false, role: "contributor" }]
              : [],
        });
      }
      if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET") {
        return json(200, OPTIONS);
      }
      if (call.url.pathname === "/api/v1/matters/12/relations" && call.method === "GET") {
        return json(200, relations);
      }
      if (call.url.pathname === "/api/v1/matters/12/documents" && call.method === "GET") {
        return json(200, { documents: [], nextCursor: null });
      }
      if (call.url.pathname === "/api/v1/matters/12/folders" && call.method === "GET") {
        return json(200, { folders: [] });
      }
      return undefined;
    },
  });
}

describe("Matter relationship projections", () => {
  it("draws the empty state and keeps all actions usable at a narrow viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    mountApi(MEMBER, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/relation-candidates") {
        return json(200, { candidates: [] });
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Related Matters" });
    expect(within(card).getByText("No related Matters.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "New sub-Matter" })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Set parent" })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Add related Matter" })).toBeVisible();

    await user.click(within(card).getByRole("button", { name: "Set parent" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("Search by M-number or title")).toBeVisible();
  });

  it("navigates reachable parent, child, and related projections without leaking a restricted Matter", async () => {
    mountApi(CONTRIBUTOR, {
      parent: reachable(3, "Programme parent"),
      children: [reachable(13, "Local proceeding"), { restricted: true }],
      related: [reachable(22, "Regulatory response"), { restricted: true }],
    });
    renderAt("/matters/12");

    expect(await screen.findAllByRole("link", { name: "M-3 Programme parent" })).toHaveLength(2);
    const card = screen.getByRole("region", { name: "Related Matters" });
    expect(within(card).getByRole("link", { name: "M-13 Local proceeding" })).toHaveAttribute(
      "href",
      "/matters/13",
    );
    expect(within(card).getByRole("link", { name: "M-22 Regulatory response" })).toHaveAttribute(
      "href",
      "/matters/22",
    );
    expect(within(card).getAllByText("Restricted Matter")).toHaveLength(2);
    expect(card.textContent).not.toMatch(/secret|M-99/i);
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("creates a sub-Matter with the current parent preselected", async () => {
    let createBody: unknown;
    mountApi(MEMBER, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters" && call.method === "POST") {
        createBody = call.body;
        return json(201, { matter: { ...MATTER, id: "matter-13", number: 13, title: "Child" } });
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Related Matters" });
    await user.click(within(card).getByRole("button", { name: "New sub-Matter" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Parent: M-12 Regulatory programme")).toBeVisible();
    await user.type(within(dialog).getByLabelText("Title"), "Child");
    await user.selectOptions(within(dialog).getByLabelText("Matter type"), "type-general");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createBody).toMatchObject({
        title: "Child",
        matterTypeId: "type-general",
        parentMatterNumber: 12,
      }),
    );
  });

  it("re-parents through the searchable picker and redraws the returned projection", async () => {
    let putBody: unknown;
    const current = reachable(3, "Old parent");
    const replacement = reachable(4, "New parent");
    const fetch = mountApi(MEMBER, { parent: current, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/relation-candidates") {
        return json(200, { candidates: [{ ...replacement, isConfidential: false }] });
      }
      if (call.url.pathname === "/api/v1/matters/12/parent" && call.method === "PUT") {
        putBody = call.body;
        return json(200, { parent: replacement, children: [], related: [] });
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Related Matters" });
    await user.click(within(card).getByRole("button", { name: "Change parent" }));
    await user.type(screen.getByLabelText("Search by M-number or title"), "New parent");
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([request]) => {
          const value = request as RequestInfo | URL;
          const href =
            typeof value === "string" || value instanceof URL ? String(value) : value.url;
          return href.includes("relation-candidates");
        }),
      ).toBe(true),
    );
    await user.click(await screen.findByRole("button", { name: /New parent/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Set parent" }),
    );

    await waitFor(() => expect(putBody).toEqual({ parentMatterNumber: 4 }));
    expect(await within(card).findByRole("link", { name: "M-4 New parent" })).toBeVisible();
  });

  it("keeps the prior parent visible when a re-parent would create a cycle", async () => {
    const current = reachable(3, "Current parent");
    const candidate = reachable(4, "Descendant");
    mountApi(MEMBER, { parent: current, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/relation-candidates") {
        return json(200, { candidates: [{ ...candidate, isConfidential: false }] });
      }
      if (call.url.pathname === "/api/v1/matters/12/parent" && call.method === "PUT") {
        return problem(409, "That parent would create a cycle.", MATTER_PARENT_CYCLE_PROBLEM_TYPE);
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Related Matters" });

    await user.click(within(card).getByRole("button", { name: "Change parent" }));
    await user.type(screen.getByLabelText("Search by M-number or title"), "Descendant");
    await user.click(await screen.findByRole("button", { name: /Descendant/ }));
    await user.click(screen.getByRole("button", { name: "Set parent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That parent would close a loop in the Matter hierarchy.",
    );
    expect(
      within(card).getByRole("link", { name: "M-3 Current parent", hidden: true }),
    ).toBeInTheDocument();
  });

  it("keeps the related projection visible when a duplicate link is refused", async () => {
    const related = reachable(22, "Existing relation");
    mountApi(MEMBER, { parent: null, children: [], related: [related] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/relation-candidates") {
        return json(200, { candidates: [{ ...related, isConfidential: false }] });
      }
      if (call.url.pathname === "/api/v1/matters/12/relations" && call.method === "POST") {
        return problem(
          409,
          "These Matters are already related.",
          MATTER_RELATION_EXISTS_PROBLEM_TYPE,
        );
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    const card = await screen.findByRole("region", { name: "Related Matters" });

    await user.click(within(card).getByRole("button", { name: "Add related Matter" }));
    await user.type(screen.getByLabelText("Search by M-number or title"), "Existing relation");
    await user.click(await screen.findByRole("button", { name: /Existing relation/ }));
    await user.click(screen.getByRole("button", { name: "Add relation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "These Matters are already related.",
    );
    expect(
      within(card).getByRole("link", { name: "M-22 Existing relation", hidden: true }),
    ).toBeInTheDocument();
  });
});
