// SPDX-License-Identifier: AGPL-3.0-only

/** M26/3's URL-backed fixed filters through the real Documents route. */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pickDate } from "../testing/dates";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

function documentRow() {
  return {
    id: "document-1",
    title: "Master services agreement",
    description: "Signed services terms",
    isConfidential: false,
    archivedAt: null,
    owner: { kind: "contract", number: 42, title: "Meridian services" },
    folder: { id: "folder-1", name: "Executed" },
    currentVersion: {
      id: "version-4",
      versionNumber: 4,
      kind: "executed",
      originalFilename: "msa-signed.pdf",
      mimeType: "application/pdf",
      byteSize: 1_400_000,
      uploadedBy: {
        id: "u2",
        displayName: "Nadia Counsel",
        image: null,
        archived: false,
      },
      createdAt: "2026-08-29T08:00:00.000Z",
    },
    versionCount: 4,
  };
}

function storedView() {
  return {
    id: "view-1",
    surface: "documents",
    name: "Executed copies",
    isDefault: true,
    config: {
      columns: [
        { key: "title", width: 320 },
        { key: "uploaded", width: 136 },
      ],
      flexKey: "title",
      sort: { key: "uploaded", dir: "desc" },
      filters: { kind: "executed", counterparty: "counterparty-1", uploader: "u2" },
    },
  };
}

function surface({
  views = [],
  emptyWhenFiltered = false,
}: {
  views?: Record<string, unknown>[];
  emptyWhenFiltered?: boolean;
} = {}) {
  const queries: URLSearchParams[] = [];
  let optionReads = 0;
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/documents" && call.method === "GET") {
      const query = new URLSearchParams(call.url.search);
      queries.push(query);
      return json(200, {
        documents: emptyWhenFiltered && query.size > 0 ? [] : [documentRow()],
        nextCursor: null,
      });
    }
    if (call.url.pathname === "/api/v1/list-views" && call.method === "GET") {
      return json(200, { views });
    }
    if (call.url.pathname === "/api/v1/documents/options" && call.method === "GET") {
      optionReads += 1;
      return json(200, {
        counterparties: [{ id: "counterparty-1", name: "Northwind" }],
        uploaders: [
          { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
          { id: "u3", displayName: "Blair Uploader", image: null, archived: false },
        ],
        records: [
          {
            reference: "C-42",
            kind: "contract",
            number: 42,
            title: "Meridian services",
          },
        ],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/folders" && call.method === "GET") {
      return json(200, {
        folders: [{ id: "folder-1", name: "Executed", parentId: null }],
      });
    }
    return undefined;
  };
  return { handler, queries, optionReads: () => optionReads };
}

const lastQuery = (queries: URLSearchParams[]) => queries[queries.length - 1]!;

async function expectQuery(queries: URLSearchParams[], key: string, value: string | null) {
  await waitFor(() => {
    expect(lastQuery(queries).get(key)).toBe(value);
  });
}

describe("the Documents fixed filter strip", () => {
  it("writes every control and sort to both the server query and the URL", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/documents");

    await user.click(await screen.findByRole("button", { name: "Contracts" }));
    await expectQuery(api.queries, "owner", "contract");
    expect(router.state.location.search).toContain("owner=contract");

    const record = screen.getByRole("combobox", { name: "Record" });
    await user.type(record, "Meridian");
    await user.click(await screen.findByRole("option", { name: /C-42.*Meridian services/ }));
    await expectQuery(api.queries, "record", "C-42");
    expect(router.state.location.search).toContain("record=C-42");

    const folder = await screen.findByRole("combobox", { name: "Folder" });
    await waitFor(() =>
      expect(within(folder).getByRole("option", { name: "Executed" })).toBeVisible(),
    );
    await user.selectOptions(folder, "folder-1");
    await expectQuery(api.queries, "folder", "folder-1");
    expect(router.state.location.search).toContain("folder=folder-1");

    await user.selectOptions(screen.getByRole("combobox", { name: "Format" }), "pdf");
    await expectQuery(api.queries, "format", "pdf");
    expect(router.state.location.search).toContain("format=pdf");

    await user.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "executed");
    await expectQuery(api.queries, "kind", "executed");
    expect(router.state.location.search).toContain("kind=executed");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Counterparty" }),
      "counterparty-1",
    );
    await expectQuery(api.queries, "counterparty", "counterparty-1");
    expect(router.state.location.search).toContain("counterparty=counterparty-1");
    expect(screen.getByRole("button", { name: "Remove Counterparty filter" })).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox", { name: "Uploader" }), "u3");
    await expectQuery(api.queries, "uploader", "u3");
    expect(router.state.location.search).toContain("uploader=u3");
    expect(screen.getByRole("button", { name: "Remove Uploader filter" })).toBeVisible();

    await pickDate(user, "Uploaded from", "2026-06-01");
    await expectQuery(api.queries, "uploadedFrom", "2026-06-01");
    expect(router.state.location.search).toContain("uploadedFrom=2026-06-01");

    await pickDate(user, "Uploaded to", "2026-06-30");
    await expectQuery(api.queries, "uploadedTo", "2026-06-30");
    expect(router.state.location.search).toContain("uploadedTo=2026-06-30");

    await user.click(screen.getByRole("button", { name: "Title" }));
    await expectQuery(api.queries, "sort", "title");
    expect(lastQuery(api.queries).get("dir")).toBe("asc");
    expect(router.state.location.search).toContain("sort=title");
    expect(router.state.location.search).toContain("dir=asc");
  });

  it("restores URL filters on reload and removes chips one at a time or all together", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt(
      "/documents?owner=contract&format=pdf&kind=executed&counterparty=counterparty-1&uploader=u2&uploadedFrom=2026-06-01",
    );

    await expectQuery(api.queries, "owner", "contract");
    expect(await screen.findByRole("button", { name: "Contracts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Format" })).toHaveValue("pdf");
    expect(screen.getByRole("combobox", { name: "Kind" })).toHaveValue("executed");
    expect(screen.getByRole("combobox", { name: "Counterparty" })).toHaveValue("counterparty-1");
    expect(screen.getByRole("combobox", { name: "Uploader" })).toHaveValue("u2");
    expect(screen.getByLabelText("Uploaded from")).toHaveTextContent("Jun 1, 2026");

    await user.click(screen.getByRole("button", { name: "Remove Format filter" }));
    await expectQuery(api.queries, "format", null);
    expect(router.state.location.search).not.toContain("format=");
    expect(screen.queryByRole("button", { name: "Remove Format filter" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("combobox", { name: "Record" }), "Al");
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(screen.getByRole("combobox", { name: "Record" })).toHaveValue("");
    await waitFor(() => {
      expect(lastQuery(api.queries).get("owner")).toBeNull();
      expect(lastQuery(api.queries).get("kind")).toBeNull();
      expect(lastQuery(api.queries).get("counterparty")).toBeNull();
      expect(lastQuery(api.queries).get("uploader")).toBeNull();
      expect(lastQuery(api.queries).get("uploadedFrom")).toBeNull();
    });
    expect(router.state.location.search).toBe("");
  });

  it("draws the filtered empty answer and clears back to the repository", async () => {
    const user = userEvent.setup();
    const api = surface({ emptyWhenFiltered: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents?format=pdf");

    expect(await screen.findByText("No documents match these filters.")).toBeVisible();
    expect(screen.getByText("Clear filters to return to the whole list.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(await screen.findByRole("link", { name: "Master services agreement" })).toBeVisible();
  });

  it("clears a filter set on the page when the active Documents destination clears the URL", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/documents");

    await user.selectOptions(await screen.findByRole("combobox", { name: "Format" }), "pdf");
    await expectQuery(api.queries, "format", "pdf");
    await waitFor(() => expect(router.state.location.search).toContain("format=pdf"));

    await user.click(screen.getByRole("link", { name: "Documents" }));
    await expectQuery(api.queries, "format", null);
    await waitFor(() => {
      expect(router.state.location.search).toBe("");
      expect(screen.getByRole("combobox", { name: "Format" })).toHaveValue("");
    });
  });

  it("clears live filters when the active Documents destination clears the URL", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/documents?format=pdf");

    expect(await screen.findByRole("combobox", { name: "Format" })).toHaveValue("pdf");
    await user.click(screen.getByRole("link", { name: "Documents" }));
    await expectQuery(api.queries, "format", null);
    await waitFor(() => {
      expect(router.state.location.search).toBe("");
      expect(screen.getByRole("combobox", { name: "Format" })).toHaveValue("");
    });
  });
});

describe("Documents saved-view query state", () => {
  it("opens filtered and sorted, marks a filter change Modified, and keeps columns local", async () => {
    const user = userEvent.setup();
    const api = surface({ views: [storedView()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/documents");

    expect(await screen.findByRole("button", { name: /Executed copies/ })).toBeVisible();
    expect(lastQuery(api.queries).get("kind")).toBe("executed");
    expect(lastQuery(api.queries).get("counterparty")).toBe("counterparty-1");
    expect(lastQuery(api.queries).get("uploader")).toBe("u2");
    expect(lastQuery(api.queries).get("sort")).toBe("uploaded");
    await waitFor(() => expect(router.state.location.search).toContain("kind=executed"));

    await user.selectOptions(screen.getByRole("combobox", { name: "Format" }), "pdf");
    await expectQuery(api.queries, "format", "pdf");
    expect(await screen.findByRole("button", { name: /Executed copies.*Modified/s })).toBeVisible();

    const reads = api.queries.length;
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: /^Size/ }),
    );
    expect(api.queries).toHaveLength(reads);
  });

  it("picks a record from the keyboard on the candidate-picker pattern", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/documents");

    const record = await screen.findByRole("combobox", { name: "Record" });
    await user.type(record, "Meridian");
    const option = await screen.findByRole("option", { name: /C-42.*Meridian services/ });
    expect(record).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    expect(record).toHaveAttribute("aria-activedescendant", option.id);
    expect(option).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    await expectQuery(api.queries, "record", "C-42");
    expect(router.state.location.search).toContain("record=C-42");
    expect(api.optionReads()).toBe(1);
    expect(record).toHaveValue("C-42");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.type(record, "x");
    await expectQuery(api.queries, "record", null);
  });
});
