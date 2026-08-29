// SPDX-License-Identifier: AGPL-3.0-only

/** The M26 Documents destination through the real router and fetch stub. */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ari Admin",
  role: "administrator",
};
const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
};
const BUSINESS = {
  id: "u9",
  email: "business@example.com",
  displayName: "Bao Business",
  role: "business_user",
};

function documentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "document-1",
    title: "Master services agreement",
    description: "Signed services terms",
    isConfidential: true,
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
    ...overrides,
  };
}

function repositoryApi(pages: Record<string, unknown>[][]) {
  let reads = 0;
  let recentReads = 0;
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname !== "/api/v1/documents" || call.method !== "GET") return undefined;
    if (call.url.searchParams.get("limit") === "5") {
      recentReads += 1;
      return json(200, { documents: (pages[0] ?? []).slice(0, 5), nextCursor: null });
    }
    const page = pages[Math.min(reads, pages.length - 1)] ?? [];
    reads += 1;
    return json(200, {
      documents: page,
      nextCursor: reads < pages.length ? String(page.at(-1)?.id ?? "cursor") : null,
    });
  };
  return { handler, reads: () => reads, recentReads: () => recentReads };
}

describe("the /documents destination", () => {
  it("registers Documents between Contracts and Entities for every Document reader", async () => {
    for (const signedIn of [ADMIN, MEMBER, CONTRIBUTOR]) {
      stubApi({ signedIn });
      const { view } = renderAt("/");
      const nav = await screen.findByRole("navigation");
      const names = within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent);
      expect(names.indexOf("Documents")).toBe(names.indexOf("Contracts") + 1);
      if (signedIn.role !== "contributor") {
        expect(names.indexOf("Entities")).toBe(names.indexOf("Documents") + 1);
      }
      view.unmount();
    }
  });

  it("bounces a Business User through home to the portal and gives them no nav entry", async () => {
    stubApi({ signedIn: BUSINESS });
    const { router } = renderAt("/documents");
    await waitFor(() => expect(router.state.location.pathname).toBe("/portal"));
    expect(screen.queryByRole("link", { name: "Documents" })).not.toBeInTheDocument();
  });

  it("renders the managed rows, controls, count, and Confidential marker", async () => {
    const api = repositoryApi([[documentRow()]]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents");

    const subbar = await screen.findByRole("region", { name: "Documents" });
    expect(within(subbar).getByText("1 document shown")).toBeVisible();
    expect(within(subbar).getByRole("button", { name: "Default view" })).toBeVisible();
    expect(within(subbar).getByRole("button", { name: "Columns" })).toBeVisible();
    const row = screen.getByRole("row", { name: /Master services agreement/ });
    expect(within(row).getByText("C-42 · Meridian services")).toBeVisible();
    expect(within(row).getByText("Executed")).toBeVisible();
    expect(within(row).getByText("PDF")).toBeVisible();
    expect(within(row).getByText("1.4 MB")).toBeVisible();
    expect(within(row).getByText("4")).toBeVisible();
    expect(within(row).getByLabelText("Confidential")).toBeVisible();
  });

  it("renders the five-row Recent strip from the default limit=5 read", async () => {
    const recent = Array.from({ length: 5 }, (_, index) =>
      documentRow({
        id: `recent-${String(index + 1)}`,
        title: `Recent document ${String(index + 1)}`,
        currentVersion: {
          ...documentRow().currentVersion,
          id: `recent-version-${String(index + 1)}`,
        },
      }),
    );
    const api = repositoryApi([recent]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents");

    const strip = await screen.findByRole("region", { name: "Recent documents" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(5);
    expect(
      within(strip).getByRole("link", { name: "Open recent Document Recent document 1" }),
    ).toHaveAttribute("href", "/contracts/42/documents?doc=recent-1&version=recent-version-1");
    expect(api.recentReads()).toBe(1);
  });

  it("hides Recent and skips its read while any filter is active", async () => {
    const api = repositoryApi([[documentRow()]]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents?format=pdf");

    expect(await screen.findByRole("link", { name: "Master services agreement" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Recent documents" })).not.toBeInTheDocument();
    expect(api.recentReads()).toBe(0);
  });

  it("lets a Member show archived Documents and restore a row in place", async () => {
    const archived = documentRow({
      id: "archived-document",
      title: "Wrong upload",
      archivedAt: "2026-08-29T09:00:00.000Z",
    });
    const calls: StubCall[] = [];
    const handler = (call: StubCall): Response | undefined => {
      calls.push(call);
      if (call.url.pathname === "/api/v1/documents" && call.method === "GET") {
        if (call.url.searchParams.get("limit") === "5") {
          return json(200, { documents: [documentRow()], nextCursor: null });
        }
        return json(200, {
          documents: call.url.searchParams.get("includeArchived") === "true" ? [archived] : [],
          nextCursor: null,
        });
      }
      if (
        call.url.pathname === "/api/v1/documents/archived-document/restore" &&
        call.method === "POST"
      ) {
        return json(200, { document: archived });
      }
      return undefined;
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/documents");
    const user = userEvent.setup();

    const toggle = await screen.findByRole("switch", { name: "Show archived" });
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(
      calls.some(
        (call) =>
          call.url.pathname === "/api/v1/documents" &&
          call.url.searchParams.get("includeArchived") === "true",
      ),
    ).toBe(true);
    expect(await screen.findByText("Archived")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Restore Wrong upload" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Restore Wrong upload" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Archived")).not.toBeInTheDocument();
    });
    expect(
      calls.some(
        (call) =>
          call.url.pathname === "/api/v1/documents/archived-document/restore" &&
          call.method === "POST",
      ),
    ).toBe(true);
  });

  it("shows Recent but no archived switch or Restore to a Contributor", async () => {
    const archived = documentRow({
      id: "archived-document",
      title: "Wrong upload",
      archivedAt: "2026-08-29T09:00:00.000Z",
    });
    const api = repositoryApi([[archived]]);
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/documents");

    expect(await screen.findByRole("region", { name: "Recent documents" })).toBeVisible();
    expect(screen.queryByRole("switch", { name: "Show archived" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore Wrong upload" })).not.toBeInTheDocument();
  });

  it("lands Contract and Matter rows on the owning Documents tab with the current Version", async () => {
    const rows = [
      documentRow(),
      documentRow({
        id: "document-2",
        title: "Delivery timeline",
        isConfidential: false,
        owner: { kind: "matter", number: 12, title: "Delivery dispute" },
        currentVersion: {
          ...documentRow().currentVersion,
          id: "version-1",
          versionNumber: 1,
        },
      }),
    ];
    stubApi({ signedIn: MEMBER, extra: repositoryApi([rows]).handler });
    const { router } = renderAt("/documents");

    const contract = await screen.findByRole("link", { name: "Master services agreement" });
    expect(contract).toHaveAttribute(
      "href",
      "/contracts/42/documents?doc=document-1&version=version-4",
    );
    const matter = screen.getByRole("link", { name: "Delivery timeline" });
    expect(matter).toHaveAttribute(
      "href",
      "/matters/12/documents?doc=document-2&version=version-1",
    );

    await userEvent.setup().click(screen.getByRole("row", { name: /Master services agreement/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/contracts/42/documents");
      expect(router.state.location.search).toBe("?doc=document-1&version=version-4");
    });
  });

  it("appends the next page at Show more and updates the shown count", async () => {
    const second = documentRow({
      id: "document-2",
      title: "Delivery timeline",
      isConfidential: false,
      owner: { kind: "matter", number: 12, title: "Delivery dispute" },
      currentVersion: {
        ...documentRow().currentVersion,
        id: "version-1",
        versionNumber: 1,
      },
    });
    const api = repositoryApi([[documentRow()], [second]]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/documents");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("link", { name: "Delivery timeline" })).toBeVisible();
    expect(screen.getByText("2 documents shown")).toBeVisible();
    expect(api.reads()).toBe(2);
  });

  it("names the module in the fresh-install empty state", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/documents");
    expect(await screen.findByText("Paper lives on Contracts and Matters.")).toBeVisible();
    expect(screen.getByText("Upload to a record and it appears here.")).toBeVisible();
  });
});
