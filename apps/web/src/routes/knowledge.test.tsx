// SPDX-License-Identifier: AGPL-3.0-only

/** M28's Knowledge destination and record through the real route table. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "member-1",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const ADMIN = { ...MEMBER, id: "admin-1", role: "administrator" };
const CONTRIBUTOR = { ...MEMBER, id: "contributor-1", role: "contributor" };
const TYPES = [
  { id: "type-playbook", slug: "playbook", displayName: "Playbook" },
  { id: "type-article", slug: "article", displayName: "Article" },
];
const FOLDERS = [
  {
    id: "commercial",
    name: "Commercial",
    parentId: null,
    displayOrder: 0,
    itemCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "contracts",
    name: "Contracts",
    parentId: "commercial",
    displayOrder: 0,
    itemCount: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "knowledge-1",
    title: "Contract review playbook",
    knowledgeTypeId: "type-playbook",
    knowledgeTypeName: "Playbook",
    body:
      "# Review\n\nRead the **term** and [source](https://example.com).\n\n" +
      "<img src=x onerror=alert(1)> [bad](javascript:alert(1))",
    folderId: "contracts",
    folderName: "Contracts",
    state: "draft",
    audience: "legal_only",
    replacedBy: null,
    createdBy: { id: MEMBER.id, displayName: MEMBER.displayName, image: null, archived: false },
    updatedBy: { id: MEMBER.id, displayName: MEMBER.displayName, image: null, archived: false },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

function libraryApi(rows = [item()]) {
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/knowledge" && call.method === "GET") {
      const folder = call.url.searchParams.get("folder");
      const type = call.url.searchParams.get("type");
      return json(200, {
        knowledgeItems: rows.filter(
          (row) => (!folder || row.folderId === folder) && (!type || row.knowledgeTypeId === type),
        ),
        nextCursor: null,
      });
    }
    if (call.url.pathname === "/api/v1/knowledge/folders" && call.method === "GET")
      return json(200, { folders: FOLDERS });
    if (call.url.pathname === "/api/v1/knowledge/type-options" && call.method === "GET")
      return json(200, { knowledgeTypes: TYPES });
    if (call.url.pathname === "/api/v1/knowledge/options" && call.method === "GET")
      return json(200, { authors: [item().createdBy] });
    return undefined;
  };
}

function recordApi(patches: unknown[]) {
  let current: Record<string, unknown> = item();
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/knowledge/knowledge-1" && call.method === "GET")
      return json(200, { knowledgeItem: current });
    if (call.url.pathname === "/api/v1/knowledge/knowledge-1" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as Record<string, unknown>;
      current = {
        ...current,
        ...body,
        ...(body.knowledgeTypeId
          ? { knowledgeTypeName: TYPES.find((row) => row.id === body.knowledgeTypeId)?.displayName }
          : {}),
        ...(Object.hasOwn(body, "folderId")
          ? {
              folderName: body.folderId
                ? FOLDERS.find((row) => row.id === body.folderId)?.name
                : null,
            }
          : {}),
      };
      return json(200, { knowledgeItem: current });
    }
    if (call.url.pathname === "/api/v1/knowledge/folders" && call.method === "GET")
      return json(200, { folders: FOLDERS });
    if (call.url.pathname === "/api/v1/knowledge/type-options" && call.method === "GET")
      return json(200, { knowledgeTypes: TYPES });
    if (call.url.pathname === "/api/v1/activity" && call.method === "GET")
      return json(200, { entries: [], nextCursor: null });
    return undefined;
  };
}

describe("the Knowledge library", () => {
  it("puts the Member+ destination after Entities and shows folders, columns, and draft markers", async () => {
    stubApi({ signedIn: MEMBER, extra: libraryApi() });
    renderAt("/knowledge");
    expect(await screen.findByRole("heading", { level: 1, name: "Knowledge" })).toBeInTheDocument();
    const navLinks = within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole(
      "link",
    );
    expect(
      navLinks.indexOf(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
          name: "Knowledge",
        }),
      ),
    ).toBe(
      navLinks.indexOf(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
          name: "Entities",
        }),
      ) + 1,
    );
    expect(screen.getByRole("button", { name: /Contracts/ })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Contract review playbook" })).toHaveAttribute(
      "href",
      "/knowledge/knowledge-1",
    );
    expect(within(table).getAllByText("Draft")).toHaveLength(2);
  });

  it("scopes the list from the nested folder tree and distinguishes a filtered zero", async () => {
    stubApi({ signedIn: MEMBER, extra: libraryApi() });
    renderAt("/knowledge");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Commercial/ }));
    expect(
      await screen.findByRole("heading", { name: "No Knowledge items match these filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Clear filters or choose another folder.")).toBeInTheDocument();
  });

  it("creates an item with its required title, type, and selected nested folder", async () => {
    let posted: unknown;
    const base = libraryApi([]);
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/knowledge" && call.method === "POST") {
          posted = call.body;
          return json(201, {
            knowledgeItem: item({
              id: "knowledge-new",
              ...(call.body as Record<string, unknown>),
            }),
          });
        }
        if (call.url.pathname === "/api/v1/knowledge/knowledge-new" && call.method === "GET") {
          return json(200, { knowledgeItem: item({ id: "knowledge-new" }) });
        }
        return base(call);
      },
    });
    renderAt("/knowledge");
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "New item" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "New Knowledge item" });
    await user.type(within(dialog).getByLabelText("Title"), "Review guide");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "type-article");
    await user.selectOptions(within(dialog).getByLabelText("Folder"), "contracts");
    await user.click(within(dialog).getByRole("button", { name: "Create item" }));
    await waitFor(() =>
      expect(posted).toEqual({
        title: "Review guide",
        knowledgeTypeId: "type-article",
        folderId: "contracts",
      }),
    );
  });

  it("shows the blank-library state and keeps Contributors out of the destination", async () => {
    stubApi({ signedIn: MEMBER, extra: libraryApi([]) });
    const blank = renderAt("/knowledge");
    expect(
      await screen.findByRole("heading", { name: "Build your Knowledge library" }),
    ).toBeInTheDocument();
    blank.view.unmount();

    stubApi({ signedIn: CONTRIBUTOR });
    const { router } = renderAt("/knowledge");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(
      within(await screen.findByRole("navigation", { name: "Primary" })).queryByRole("link", {
        name: "Knowledge",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("a Knowledge record", () => {
  it("commits identity fields inline and offers the type settings deep link only to an Administrator", async () => {
    const patches: unknown[] = [];
    stubApi({ signedIn: ADMIN, extra: recordApi(patches) });
    renderAt("/knowledge/knowledge-1");
    const user = userEvent.setup();
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Updated playbook");
    await user.tab();
    await user.selectOptions(screen.getByLabelText("Type"), "type-article");
    await user.selectOptions(screen.getByLabelText("Folder"), "");
    await waitFor(() =>
      expect(patches).toEqual([
        { title: "Updated playbook" },
        { knowledgeTypeId: "type-article" },
        { folderId: null },
      ]),
    );
    expect(screen.getByRole("link", { name: "Manage types…" })).toHaveAttribute(
      "href",
      "/settings/knowledge/types",
    );
  });

  it("previews Markdown as allowlisted React elements and exposes History", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi([]) });
    renderAt("/knowledge/knowledge-1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("term").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "source" })).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(
      await screen.findByText(
        "Nothing has happened to this record yet. Every change to it shows up here.",
      ),
    ).toBeInTheDocument();
  });
});
