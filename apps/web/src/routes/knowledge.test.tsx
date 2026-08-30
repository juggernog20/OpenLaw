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
    publishedAt: null,
    archivedAt: null,
    deflectionLinkCount: 0,
    replacedBy: null,
    primaryDocument: {
      id: "document-1",
      title: "Contract review playbook.pdf",
      currentVersion: {
        id: "version-1",
        originalFilename: "Contract review playbook.pdf",
        mimeType: "application/pdf",
        renderFamily: "pdf",
      },
    },
    documentCount: 1,
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

function recordApi(patches: unknown[], initial: Record<string, unknown> = {}) {
  let current: Record<string, unknown> = item(initial);
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/knowledge/knowledge-1" && call.method === "GET")
      return json(200, { knowledgeItem: current });
    if (call.url.pathname === "/api/v1/knowledge" && call.method === "GET") {
      // Two pages, so the replaced-by picker is seen to walk the cursor.
      if (call.url.searchParams.get("cursor") === "knowledge-2")
        return json(200, {
          knowledgeItems: [item({ id: "knowledge-3", title: "Second-page playbook" })],
          nextCursor: null,
        });
      return json(200, {
        knowledgeItems: [item({ id: "knowledge-2", title: "Current contract review playbook" })],
        nextCursor: "knowledge-2",
      });
    }
    if (call.url.pathname === "/api/v1/knowledge/knowledge-1/documents" && call.method === "GET")
      return json(200, {
        documents: [
          document(),
          document({ id: "document-2", title: "alternate.docx", isPrimary: false }),
        ],
        nextCursor: null,
      });
    if (call.url.pathname === "/api/v1/documents/document-2/primary" && call.method === "POST")
      return json(200, {
        documents: [
          document({ isPrimary: false }),
          document({ id: "document-2", title: "alternate.docx", isPrimary: true }),
        ],
        nextCursor: null,
      });
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
    const lifecycle = call.url.pathname.match(
      /^\/api\/v1\/knowledge\/knowledge-1\/(publish|unpublish|archive|restore)$/,
    )?.[1];
    if (lifecycle && call.method === "POST") {
      if (lifecycle === "publish")
        current = { ...current, state: "published", publishedAt: "2026-08-30T12:00:00.000Z" };
      if (lifecycle === "unpublish") current = { ...current, state: "draft", publishedAt: null };
      if (lifecycle === "archive") {
        const replacedById = (call.body as { replacedById?: string }).replacedById;
        current = {
          ...current,
          archivedAt: "2026-08-30T12:00:00.000Z",
          replacedBy: replacedById
            ? { id: replacedById, title: "Current contract review playbook" }
            : null,
        };
      }
      if (lifecycle === "restore") current = { ...current, archivedAt: null };
      patches.push({ action: lifecycle, body: call.body });
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

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: "document-1",
    title: "Contract review playbook.pdf",
    description: null,
    isPrimary: true,
    archivedAt: null,
    isConfidential: false,
    folderId: null,
    createdBy: { id: MEMBER.id, displayName: MEMBER.displayName, image: null, archived: false },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    versions: [
      {
        id: "version-1",
        versionNumber: 1,
        kind: "draft_ours",
        note: null,
        originalFilename: "Contract review playbook.pdf",
        mimeType: "application/pdf",
        renderFamily: "pdf",
        byteSize: 120,
        checksumSha256: "abc",
        uploadedBy: {
          id: MEMBER.id,
          displayName: MEMBER.displayName,
          image: null,
          archived: false,
        },
        createdAt: "2026-08-01T00:00:00.000Z",
        isCurrent: true,
        isExecuted: false,
      },
    ],
    ...overrides,
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
    expect(within(table).getByText("PDF")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(
      within(table).getByRole("button", { name: "Actions for Contract review playbook" }),
    );
    expect(await screen.findByRole("menuitem", { name: "Open preview" })).toHaveAttribute(
      "href",
      "/knowledge/knowledge-1?doc=document-1&version=version-1",
    );
  });

  it("offers both New paths and sends every selected file in one from-files request", async () => {
    let form: FormData | undefined;
    const base = libraryApi([]);
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/knowledge/from-files" && call.method === "POST") {
          form = call.body as FormData;
          return json(201, { knowledgeItems: [] });
        }
        return base(call);
      },
    });
    renderAt("/knowledge");
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "New" }))[0]!);
    expect(screen.getByRole("menuitem", { name: "New knowledge item" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "New from files" }));
    const dialog = await screen.findByRole("dialog", { name: "New from files" });
    await user.upload(within(dialog).getByLabelText("Choose Knowledge files"), [
      new File(["one"], "one.docx"),
      new File(["two"], "two.pdf"),
    ]);
    await user.selectOptions(within(dialog).getByLabelText("Type"), "type-article");
    await user.selectOptions(within(dialog).getByLabelText("Folder"), "contracts");
    await user.click(within(dialog).getByRole("button", { name: "Create drafts" }));
    await waitFor(() => expect(form).toBeDefined());
    expect(form!.get("knowledgeTypeId")).toBe("type-article");
    expect(form!.get("folderId")).toBe("contracts");
    expect(form!.getAll("file")).toHaveLength(2);
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
    await user.click((await screen.findAllByRole("button", { name: "New" }))[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "New knowledge item" }));
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

  it("files a new item in the folder the tree has selected", async () => {
    let posted: unknown;
    const base = libraryApi([]);
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/knowledge" && call.method === "POST") {
          posted = call.body;
          return json(201, { knowledgeItem: item({ id: "knowledge-new" }) });
        }
        if (call.url.pathname === "/api/v1/knowledge/knowledge-new" && call.method === "GET") {
          return json(200, { knowledgeItem: item({ id: "knowledge-new" }) });
        }
        return base(call);
      },
    });
    renderAt("/knowledge");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Contracts/ }));
    await user.click((await screen.findAllByRole("button", { name: "New" }))[0]!);
    await user.click(await screen.findByRole("menuitem", { name: "New knowledge item" }));
    const dialog = await screen.findByRole("dialog", { name: "New Knowledge item" });
    expect(within(dialog).getByLabelText("Folder")).toHaveValue("contracts");
    await user.type(within(dialog).getByLabelText("Title"), "Filed guide");
    await user.click(within(dialog).getByRole("button", { name: "Create item" }));
    await waitFor(() =>
      expect(posted).toEqual({
        title: "Filed guide",
        knowledgeTypeId: "type-playbook",
        folderId: "contracts",
      }),
    );
  });

  it("confirms a folder delete in a dialog and reports the server's refusal", async () => {
    let deleted = 0;
    const base = libraryApi([]);
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (
          call.url.pathname === "/api/v1/knowledge/folders/contracts" &&
          call.method === "DELETE"
        ) {
          deleted += 1;
          return json(409, {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: "A folder with that name already exists here.",
          });
        }
        return base(call);
      },
    });
    renderAt("/knowledge");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Contracts/ }));
    await user.click(screen.getByRole("button", { name: "Delete selected folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete the Contracts folder?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deleted).toBe(0);
    await user.click(screen.getByRole("button", { name: "Delete selected folder" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Delete the Contracts folder?" })).getByRole(
        "button",
        { name: "Delete folder" },
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A folder with that name already exists here.",
    );
    expect(deleted).toBe(1);
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
  it("opens the primary row in the doc panel and reuses the Documents card primary action without folders", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi([]) });
    renderAt("/knowledge/knowledge-1");
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open preview" }));
    expect(
      await screen.findByRole("complementary", {
        name: "Contract review playbook.pdf, version 1",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close the document" }));
    await user.click(screen.getByRole("button", { name: "Actions for alternate.docx" }));
    await user.click(await screen.findByRole("menuitem", { name: "Set as primary" }));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

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

  it("publishes from the overflow and warns with the deflection-link count before unpublishing", async () => {
    const writes: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(writes, { deflectionLinkCount: 2 }),
    });
    renderAt("/knowledge/knowledge-1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Knowledge Item actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Publish" }));
    await waitFor(() => expect(writes).toContainEqual({ action: "publish", body: {} }));
    await user.click(screen.getByRole("button", { name: "Knowledge Item actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Unpublish" }));
    const warning = await screen.findByRole("dialog", { name: "Remove this from the portal?" });
    expect(within(warning).getByText(/2 deflection links point/)).toBeInTheDocument();
    await user.click(within(warning).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(writes).toContainEqual({ action: "unpublish", body: {} }));
  });

  it("archives with an optional replacement and restores from the overflow", async () => {
    const writes: unknown[] = [];
    stubApi({ signedIn: MEMBER, extra: recordApi(writes) });
    renderAt("/knowledge/knowledge-1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Knowledge Item actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    const archive = await screen.findByRole("dialog", { name: "Archive Knowledge Item" });
    expect(
      within(archive).getByRole("option", { name: "Second-page playbook" }),
    ).toBeInTheDocument();
    await user.selectOptions(within(archive).getByLabelText("Replaced by"), "knowledge-2");
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(writes).toContainEqual({
        action: "archive",
        body: { replacedById: "knowledge-2" },
      }),
    );
    expect(screen.getByText("Archived")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Knowledge Item actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Restore" }));
    await waitFor(() => expect(writes).toContainEqual({ action: "restore", body: {} }));
  });

  it("marks an Everyone audience on the portal and confirms before making linked guidance Legal Only", async () => {
    const writes: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(writes, {
        state: "published",
        audience: "everyone",
        publishedAt: "2026-08-30T12:00:00.000Z",
        deflectionLinkCount: 1,
      }),
    });
    renderAt("/knowledge/knowledge-1");
    const user = userEvent.setup();

    expect(await screen.findByText("On the portal")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Audience"), "legal_only");
    const warning = await screen.findByRole("dialog", { name: "Remove this from the portal?" });
    expect(within(warning).getByText(/1 deflection link points/)).toBeInTheDocument();
    await user.click(within(warning).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(writes).toContainEqual({ audience: "legal_only" }));
  });
});
