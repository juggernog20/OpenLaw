// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-015's Matter relationship states through the real record route. */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getByLabelText("Search by matter number or title")).toBeVisible();
  });

  it("navigates reachable parent, child, and related projections without leaking a restricted Matter", async () => {
    mountApi(CONTRIBUTOR, {
      parent: reachable(3, "Programme parent"),
      children: [reachable(13, "Local proceeding"), { restricted: true }],
      related: [reachable(22, "Regulatory response"), { restricted: true }],
    });
    renderAt("/matters/12");

    expect(await screen.findAllByRole("link", { name: "M-3 Programme parent" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "M-3" })).toHaveAttribute("href", "/matters/3");
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
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), "Child");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), "type-general");
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
    await user.type(screen.getByLabelText("Search by matter number or title"), "New parent");
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
    await user.type(screen.getByLabelText("Search by matter number or title"), "Descendant");
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
    await user.type(screen.getByLabelText("Search by matter number or title"), "Existing relation");
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

describe("the Matter record's linked Contracts (M23/6)", () => {
  const linkedContract = {
    restricted: false as const,
    number: 42,
    title: "Programme services agreement",
    statusName: "Draft",
    stage: "draft" as const,
    isConfidential: false,
    archived: false,
  };

  it("draws reachable and restricted Contracts without leaking the restricted reference", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    mountApi(CONTRIBUTOR, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/contracts" && call.method === "GET") {
        return json(200, { contracts: [linkedContract, { restricted: true }] });
      }
      return undefined;
    });
    renderAt("/matters/12");

    expect(
      await screen.findByRole("link", { name: "C-42 Programme services agreement" }),
    ).toHaveAttribute("href", "/contracts/42");
    expect(screen.getByText("Restricted contract")).toBeVisible();
    expect(screen.queryByText(/C-99|Secret acquisition/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link Contract" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New contract" })).not.toBeInTheDocument();
  });

  it("creates a Contract with this Matter preselected and refreshes the linked list", async () => {
    let created = false;
    const writes: unknown[] = [];
    mountApi(MEMBER, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/contracts/options")
        return json(200, {
          contractTypes: [{ id: "ct-nda", slug: "nda", displayName: "NDA", fields: [] }],
          users: [],
          contractStatuses: [],
          approverGroups: [],
        });
      if (call.url.pathname === "/api/v1/matters/12/contracts")
        return json(200, { contracts: created ? [linkedContract] : [] });
      if (call.url.pathname === "/api/v1/contracts" && call.method === "POST") {
        writes.push(call.body);
        created = true;
        return json(201, { contract: { ...linkedContract, id: "contract-42" } });
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New contract" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Matter")).toHaveValue("M-12 Regulatory programme");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "New contract" }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), linkedContract.title);
    await user.selectOptions(within(dialog).getByLabelText(/^Contract type\*?$/), "ct-nda");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      await screen.findByRole("link", { name: "C-42 Programme services agreement" }),
    ).toBeVisible();
    expect(writes).toEqual([
      {
        title: linkedContract.title,
        contractTypeId: "ct-nda",
        customFields: {},
        isConfidential: false,
        matterNumber: 12,
      },
    ]);
  });

  it("links an eligible standalone Contract from the Matter and refreshes the canonical list", async () => {
    let isLinked = false;
    let body: unknown;
    mountApi(MEMBER, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/contracts" && call.method === "GET") {
        return json(200, { contracts: isLinked ? [linkedContract] : [] });
      }
      if (call.url.pathname === "/api/v1/matters/12/contract-candidates" && call.method === "GET") {
        return json(200, { candidates: [linkedContract] });
      }
      if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "POST") {
        body = call.body;
        isLinked = true;
        return json(200, {
          matter: {
            restricted: false,
            number: 12,
            title: MATTER.title,
            statusName: MATTER.statusName,
            statusCategory: MATTER.statusCategory,
            isConfidential: MATTER.isConfidential,
            archived: false,
          },
          confidentialityMismatch: false,
        });
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Link Contract" }));
    await user.type(screen.getByLabelText("Search by contract number or title"), "Programme");
    await user.click(await screen.findByRole("button", { name: /Programme services agreement/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => expect(body).toEqual({ matterNumber: 12 }));
    expect(
      await screen.findByRole("link", { name: "C-42 Programme services agreement" }),
    ).toBeVisible();
  });

  it("unlinks a Contract from the Matter and redraws the empty state", async () => {
    let isLinked = true;
    mountApi(MEMBER, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/contracts" && call.method === "GET") {
        return json(200, { contracts: isLinked ? [linkedContract] : [] });
      }
      if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "DELETE") {
        isLinked = false;
        return json(200, { matter: null });
      }
      return undefined;
    });
    renderAt("/matters/12");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Unlink" }));
    expect(await screen.findByText("No Contracts are linked to this Matter.")).toBeVisible();
  });
});

describe("Matter document reader navigation", () => {
  class MeasuringObserver implements ResizeObserver {
    static instances: MeasuringObserver[] = [];
    target: Element | null = null;
    constructor(readonly callback: ResizeObserverCallback) {
      MeasuringObserver.instances.push(this);
    }
    observe(target: Element) {
      this.target = target;
    }
    unobserve() {}
    disconnect() {}
  }

  async function openReader(width: number) {
    MeasuringObserver.instances = [];
    vi.stubGlobal("ResizeObserver", MeasuringObserver);
    const document = {
      id: "matter-document",
      title: "Advice note.png",
      description: null,
      folderId: null,
      isPrimary: false,
      isConfidential: false,
      archivedAt: null,
      createdBy: { id: MEMBER.id, displayName: MEMBER.displayName, image: null, archived: false },
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
      versions: [
        {
          id: "matter-version",
          versionNumber: 1,
          kind: "general",
          source: "uploaded",
          comparedFromVersionNumber: null,
          comparedToVersionNumber: null,
          note: null,
          originalFilename: "Advice note.png",
          mimeType: "image/png",
          renderFamily: "image",
          byteSize: 100,
          checksumSha256: "a".repeat(64),
          isCurrent: true,
          isExecuted: false,
          createdAt: "2026-09-01T09:00:00.000Z",
          uploadedBy: {
            id: MEMBER.id,
            displayName: MEMBER.displayName,
            image: null,
            archived: false,
          },
        },
      ],
    };
    mountApi(MEMBER, { parent: null, children: [], related: [] }, (call) => {
      if (call.url.pathname === "/api/v1/matters/12/documents")
        return json(200, { documents: [document], nextCursor: null });
      return undefined;
    });
    const { router } = renderAt("/matters/12/documents");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Advice note.png" }));
    const panel = await screen.findByRole("complementary", { name: "Advice note.png, version 1" });
    const observer = MeasuringObserver.instances.find(
      (item) => item.target === panel.parentElement,
    )!;
    expect(observer).toBeDefined();
    act(() => observer.callback([{ contentRect: { width } }] as ResizeObserverEntry[], observer));
    return { user, router, observer, panel };
  }

  it("closes an overlay reader when switching tabs and does not reopen it on return", async () => {
    const { user, router, panel } = await openReader(900);
    expect(panel.parentElement?.querySelector("[inert]")).not.toBeNull();
    await user.click(screen.getByRole("link", { name: "Key dates" }));
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/matters/12/key-dates");
    await user.click(
      screen
        .getAllByRole("link", { name: "Documents" })
        .find((link) => link.getAttribute("href") === "/matters/12/documents")!,
    );
    expect(
      screen.queryByRole("complementary", { name: "Advice note.png, version 1" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Advice note.png" })).toBeVisible();
  });

  it("keeps a docked reader alongside other tabs and closes it only on navigation after narrowing", async () => {
    const { user, router, observer, panel } = await openReader(1600);
    await user.click(screen.getByRole("link", { name: "Key dates" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/matters/12/key-dates"));
    await screen.findByRole("button", { name: "Add date" });
    expect(panel).toBeInTheDocument();
    act(() =>
      observer.callback([{ contentRect: { width: 900 } }] as ResizeObserverEntry[], observer),
    );
    expect(panel).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Tasks" }));
    await waitFor(() => expect(panel).not.toBeInTheDocument());
  });
});
