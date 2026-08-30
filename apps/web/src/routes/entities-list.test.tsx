// SPDX-License-Identifier: AGPL-3.0-only

/** M27/9's routed Entity managed-list destination. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

const TYPES = [
  { id: "t-corp", slug: "corporation", displayName: "Corporation" },
  { id: "t-llc", slug: "llc", displayName: "LLC" },
];

function entity(id = "entity-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    legalName: "Aldgate Holdings Ltd",
    entityTypeId: "t-corp",
    entityTypeName: "Corporation",
    jurisdiction: "England & Wales",
    formedOn: null,
    registrationNumber: "09400001",
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    sharesAuthorized: null,
    sharesIssued: null,
    parValue: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    nextObligation: { label: "Annual return", dueOn: "2026-09-15" },
    ...overrides,
  };
}

function savedView() {
  return {
    id: "view-1",
    surface: "entities",
    name: "Owned dormant companies",
    isDefault: true,
    config: {
      columns: [
        { key: "legalName", width: 280 },
        { key: "nextObligation", width: 220 },
      ],
      flexKey: "legalName",
      sort: { key: "nextObligation", dir: "asc" },
      filters: {
        type: "t-corp",
        status: "dormant",
        jurisdiction: "England & Wales",
        majorityOwner: "owner-1",
        includeArchived: true,
      },
    },
  };
}

function surface({
  rows = [entity()],
  views = [],
  emptyWhenFiltered = false,
  nextPage = false,
}: {
  rows?: Record<string, unknown>[];
  views?: Record<string, unknown>[];
  emptyWhenFiltered?: boolean;
  nextPage?: boolean;
} = {}) {
  const queries: URLSearchParams[] = [];
  const writes: unknown[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      const query = new URLSearchParams(call.url.search);
      queries.push(query);
      if (query.get("cursor")) {
        return json(200, {
          entities: [entity("entity-2", { legalName: "Bayswater Ltd" })],
          nextCursor: null,
        });
      }
      const filtered = ["type", "status", "jurisdiction", "majorityOwner"].some((key) =>
        query.has(key),
      );
      return json(200, {
        entities: emptyWhenFiltered && filtered ? [] : rows,
        nextCursor: nextPage ? "entity-1" : null,
      });
    }
    if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
      return json(200, { entityTypes: TYPES });
    }
    if (call.url.pathname === "/api/v1/entities/list-options" && call.method === "GET") {
      return json(200, {
        jurisdictions: ["Dubai", "England & Wales"],
        majorityOwners: [{ id: "owner-1", legalName: "Aldgate Parent plc" }],
      });
    }
    if (call.url.pathname === "/api/v1/list-views" && call.method === "GET") {
      return json(200, { views });
    }
    if (call.url.pathname === "/api/v1/list-views" && call.method === "POST") {
      writes.push(call.body);
      return json(201, { views });
    }
    if (call.url.pathname === "/api/v1/entities/calendar" && call.method === "GET") {
      return json(200, { obligations: [] });
    }
    if (call.url.pathname === "/api/v1/entities/obligation-options" && call.method === "GET") {
      return json(200, { users: [], matters: [] });
    }
    if (call.url.pathname === "/api/v1/entities/chart" && call.method === "GET") {
      return json(200, { nodes: [], edges: [] });
    }
    return undefined;
  };
  return { handler, queries, writes };
}

const lastQuery = (queries: URLSearchParams[]) => queries[queries.length - 1]!;

async function expectQuery(queries: URLSearchParams[], key: string, value: string | null) {
  await waitFor(() => expect(lastQuery(queries).get(key)).toBe(value));
}

describe("the Entity registry managed list", () => {
  it("switches Calendar, List, and Chart in the sub-bar and remembers the view in the URL", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/entities");

    const switcher = await screen.findByRole(
      "navigation",
      { name: "Registry view" },
      { timeout: 10_000 },
    );
    expect(within(switcher).getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(router.state.location.search).toBe("");

    await user.click(within(switcher).getByRole("link", { name: "List" }));
    await screen.findByRole("table", undefined, { timeout: 10_000 });
    expect(router.state.location.search).toBe("?view=list");

    await user.click(screen.getByRole("link", { name: "Chart" }));
    await waitFor(() => expect(router.state.location.search).toBe("?view=chart"), {
      timeout: 10_000,
    });
    await waitFor(
      () =>
        expect(screen.getByRole("link", { name: "Chart" })).toHaveAttribute("aria-current", "page"),
      { timeout: 10_000 },
    );
  });

  it("draws the managed catalogue and writes every filter and sorting to the query and URL", async () => {
    const user = userEvent.setup();
    const api = surface();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/entities?view=list");
    const table = await screen.findByRole("table");

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((heading) => heading.textContent?.trim()),
    ).toEqual([
      "Legal name",
      "Type",
      "Jurisdiction",
      "Registration no.",
      "Status",
      "Next obligation",
    ]);
    expect(within(table).getByText("Annual return")).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "t-llc");
    await expectQuery(api.queries, "type", "t-llc");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "dormant");
    await expectQuery(api.queries, "status", "dormant");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Jurisdiction" }),
      "England & Wales",
    );
    await expectQuery(api.queries, "jurisdiction", "England & Wales");
    await user.selectOptions(screen.getByRole("combobox", { name: "Majority owner" }), "owner-1");
    await expectQuery(api.queries, "majorityOwner", "owner-1");
    expect(router.state.location.search).toContain("view=list");
    expect(router.state.location.search).toContain("majorityOwner=owner-1");
    expect(screen.getByRole("button", { name: "Remove Majority owner filter" })).toBeVisible();

    await user.click(within(table).getByRole("button", { name: "Legal name" }));
    await expectQuery(api.queries, "sort", "name");
    expect(lastQuery(api.queries).get("dir")).toBe("asc");
    expect(router.state.location.search).toContain("sort=name");
  });

  it("opens on a saved Entity view with its filters and sort intact", async () => {
    const api = surface({ views: [savedView()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/entities?view=list");

    expect(await screen.findByRole("button", { name: /Owned dormant companies/ })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("t-corp");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("dormant");
    expect(screen.getByRole("combobox", { name: "Jurisdiction" })).toHaveValue("England & Wales");
    expect(screen.getByRole("combobox", { name: "Majority owner" })).toHaveValue("owner-1");
    expect(screen.getByRole("switch", { name: "Show archived" })).toBeChecked();
    await expectQuery(api.queries, "sort", "nextObligation");
    await waitFor(() => expect(router.state.location.search).toContain("status=dormant"));
  });

  it("distinguishes a fresh registry from an empty filtered result and clears filters", async () => {
    const user = userEvent.setup();
    const api = surface({ rows: [], emptyWhenFiltered: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities?view=list");
    expect(await screen.findByRole("heading", { name: "No entities yet" })).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "t-corp");
    expect(
      await screen.findByRole("heading", { name: "No Entities match these filters." }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("heading", { name: "No entities yet" })).toBeVisible();
  });

  it("appends the next keyset page from the Show more foot", async () => {
    const user = userEvent.setup();
    const api = surface({ nextPage: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities?view=list");

    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("link", { name: "Bayswater Ltd" })).toBeVisible();
    expect(lastQuery(api.queries).get("cursor")).toBe("entity-1");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });
});
