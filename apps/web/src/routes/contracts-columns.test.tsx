// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contracts list's managed columns and saved views (DES-046, DD-019),
 * through the real route table with the standard fetch stub.
 *
 * Four things are worth a test here rather than an eye:
 *
 * - **Where the card's spare width goes** (DES-046 clause 1). One column
 *   may stretch, dragging it pins it, and "Fill the width" hands the
 *   stretch back. jsdom has no layout, so the one test that depends on a
 *   measured width stubs the cell's rect — the arithmetic under test is
 *   "start from what it renders at", and a rect of zero would test the
 *   floor instead.
 * - **A width is a real width.** The assertions read the `<col>` elements,
 *   because that is where a width becomes one.
 * - **Sorting reaches the API**, in three states, the third being the
 *   list's natural order with no sort at all in the query.
 * - **A view is the whole list state**, and saving is an act: the layout
 *   moves without the server hearing anything until Save.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

const OPTIONS = {
  contractTypes: [{ id: "t-nda", slug: "nda", displayName: "NDA", fields: [] }],
  contractStatuses: [{ id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" }],
  users: [
    {
      id: "u2",
      displayName: "Nadia Counsel",
      image: null,
      archived: false,
      role: "legal_team_member",
    },
  ],
};

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-nda",
    contractTypeName: "NDA",
    statusId: "s-draft",
    statusName: "Draft",
    stage: "draft",
    manager: null,
    entity: null,
    primaryCounterparty: null,
    priority: "medium",
    risk: null,
    value: null,
    // The term fields every row carries, empty (CTR-006). The catalogue
    // can draw all seventeen columns, so a row here has to answer all of
    // them — a missing key is not the same as a null one.
    termType: null,
    effectiveDate: null,
    expiryDate: null,
    renewalPeriodMonths: null,
    noticePeriodDays: null,
    noticeDeadline: null,
    daysRemaining: null,
    renewalPendingConfirmation: false,
    proposedRenewalExpiry: null,
    description: null,
    customFields: {},
    isConfidential: false,
    endedAt: null,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** One stored view, in the shape the seam answers. */
function storedView(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    surface: "contracts",
    name: "My deals",
    isDefault: true,
    config: {
      columns: [
        { key: "title", width: 280 },
        { key: "status", width: 140 },
      ],
      flexKey: "title",
      sort: null,
      filters: {},
    },
    ...overrides,
  };
}

/**
 * The list surface: the two loader reads, the views collection, and every
 * write against it. The views list is stateful, because the menu redraws
 * from what a write answers.
 */
function api(seed: { views?: Record<string, unknown>[]; rows?: Record<string, unknown>[] } = {}) {
  const views = [...(seed.views ?? [])];
  const rows = seed.rows ?? [contractRow()];
  const queries: URLSearchParams[] = [];
  const writes: { method: string; id: string | null; body: unknown }[] = [];

  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/contracts/options") return json(200, OPTIONS);
    if (call.url.pathname === "/api/v1/entities") return json(200, { entities: [] });
    if (call.url.pathname === "/api/v1/contracts" && call.method === "GET") {
      queries.push(new URLSearchParams(call.url.search));
      return json(200, { contracts: rows, nextCursor: null });
    }
    if (call.url.pathname === "/api/v1/list-views" && call.method === "GET") {
      return json(200, { views });
    }
    if (call.url.pathname === "/api/v1/list-views" && call.method === "POST") {
      writes.push({ method: "POST", id: null, body: call.body });
      const body = call.body as { name: string; config: unknown; isDefault?: boolean };
      views.push({
        id: `v-new-${String(views.length + 1)}`,
        surface: "contracts",
        name: body.name,
        isDefault: body.isDefault ?? false,
        config: body.config,
      });
      return json(201, { views });
    }
    const one = /^\/api\/v1\/list-views\/([^/]+)$/.exec(call.url.pathname);
    if (one && call.method === "PATCH") {
      writes.push({ method: "PATCH", id: one[1]!, body: call.body });
      const view = views.find((candidate) => candidate.id === one[1]);
      if (view) Object.assign(view, call.body as object);
      return json(200, { views });
    }
    if (one && call.method === "DELETE") {
      writes.push({ method: "DELETE", id: one[1]!, body: null });
      const at = views.findIndex((candidate) => candidate.id === one[1]);
      if (at !== -1) views.splice(at, 1);
      return json(200, { views });
    }
    return undefined;
  };
  return { handler, queries, writes, views };
}

/** The headings the reader can actually read. The filler column is
 * `aria-hidden`, so it is absent here by construction — it is space, not a
 * column of blank values. */
const headings = () =>
  screen.getAllByRole("columnheader").map((cell) => cell.textContent?.trim() ?? "");

/** Where a width becomes a width: the `<col>` elements, in table order,
 * with `null` for the one taking whatever is left over. */
const colWidths = () =>
  [...document.querySelectorAll("colgroup col")].map((col) =>
    (col as HTMLElement).style.width === "" ? null : (col as HTMLElement).style.width,
  );

const lastQuery = (queries: URLSearchParams[]) => queries[queries.length - 1]!;

async function openColumnMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Columns" }));
  return screen.getByRole("menu");
}

async function openViewsMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Default view|My deals/ }));
  return screen.getByRole("menu");
}

/** Radix leaves the body inert while a menu is open, so a test that goes
 * on to touch the table has to shut the menu first. */
async function closeMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Escape}");
  await waitFor(() => {
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
}

describe("the contracts list's columns", () => {
  it("draws the seven default columns and offers the rest of the catalogue", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");

    expect(await screen.findByRole("heading", { level: 1, name: "Contracts" })).toBeInTheDocument();
    expect(headings()).toEqual([
      "Reference",
      "Title",
      "Counterparty",
      "Type",
      "Status",
      "Value",
      "Owner",
    ]);

    // Every column carries a real width except the one absorbing the
    // card's spare width, and the filler behind them all is pinned to
    // nothing while that is true (DES-046 clause 1).
    expect(colWidths()).toEqual([
      "128px",
      null,
      "150px",
      "112px",
      "140px",
      "130px",
      "160px",
      "0px",
    ]);

    const menu = await openColumnMenu(user);
    expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(17);
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Expires/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("hides a column the reader turns off, and will not let the Title go", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");
    const menu = await openColumnMenu(user);

    // Required columns show checked and disabled: a contracts list with no
    // Title is not a shorter list, it is a broken one.
    const title = within(menu).getByRole("menuitemcheckbox", { name: /^Title/ });
    expect(title).toHaveAttribute("aria-checked", "true");
    expect(title).toHaveAttribute("aria-disabled", "true");

    // The menu stays open through a toggle, so hiding four columns is one
    // visit. Radix hides the page behind an open menu, which is why the
    // table is read after it closes rather than during.
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /^Value/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Expires/ }));
    await closeMenu(user);

    await waitFor(() => {
      expect(headings()).not.toContain("Value");
    });
    // A column joins at the end, the only position nobody had to be asked
    // about.
    expect(headings()[headings().length - 1]).toBe("Expires");
  });

  it("moves a column one place at a time", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");
    const menu = await openColumnMenu(user);

    await user.click(within(menu).getByRole("button", { name: "Move Counterparty earlier" }));
    // The first row's "earlier" is nothing to move to.
    expect(within(menu).getByRole("button", { name: "Move Reference earlier" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await closeMenu(user);

    await waitFor(() => {
      expect(headings().slice(0, 3)).toEqual(["Reference", "Counterparty", "Title"]);
    });
  });

  it("resets the columns without losing the sort", async () => {
    const user = userEvent.setup();
    const surface = api();
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    await user.click(await screen.findByRole("button", { name: "Reference" }));
    await waitFor(() => {
      expect(lastQuery(surface.queries).get("sort")).toBe("number");
    });

    const menu = await openColumnMenu(user);
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /^Value/ }));
    await closeMenu(user);
    await user.click(await screen.findByRole("button", { name: "Columns" }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Reset columns" }),
    );

    await waitFor(() => {
      expect(headings()).toContain("Value");
    });
    // "Reset columns" says columns. A reader who arranged a sort and wants
    // their columns back has not asked to lose the sort as well.
    expect(lastQuery(surface.queries).get("sort")).toBe("number");
  });
});

describe("resizing a contracts column", () => {
  it("keeps the last column's handle inside the table", async () => {
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");

    await screen.findByRole("heading", { level: 1, name: "Contracts" });
    const handles = screen.getAllByRole("separator");
    // Every handle straddles its boundary, so the grab area covers both
    // sides of the line — except the last, whose boundary is the table's
    // own trailing edge. A straddling strip there hangs 4px past the table
    // and the card grows a sideways scrollbar for a table that fits.
    for (const handle of handles.slice(0, -1)) {
      expect(handle).toHaveClass("-end-1", "justify-center");
    }
    expect(handles[handles.length - 1]).toHaveClass("end-0", "justify-end");
  });

  it("nudges a pinned column by a step, and holds its floor", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");

    const handle = await screen.findByRole("separator", { name: "Width of the Reference column" });
    handle.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(colWidths()[0]).toBe("144px");
    });
    expect(handle).toHaveAttribute("aria-valuenow", "144");

    // Four steps at once, then past the floor, which holds at 96.
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() => {
      expect(colWidths()[0]).toBe("96px");
    });
    await user.keyboard("{ArrowLeft}");
    expect(colWidths()[0]).toBe("96px");

    // Home is the way back to the catalogue's own number.
    await user.keyboard("{Home}");
    await waitFor(() => {
      expect(colWidths()[0]).toBe("128px");
    });
  });

  it("pins the stretching column when it is adjusted, and hands the stretch back", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");

    const handle = await screen.findByRole("separator", { name: "Width of the Title column" });
    // A stretching column has no width of its own to report until an
    // adjustment pins it.
    expect(handle).toHaveAttribute("aria-valuetext", "Fills the remaining width");
    expect(colWidths()[1]).toBeNull();

    // jsdom lays nothing out, so the rect the nudge starts from is stubbed:
    // what is under test is that it starts from what the column renders at
    // rather than from the number it has not been using.
    const cell = handle.parentElement!;
    cell.getBoundingClientRect = () => ({
      width: 345,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    });

    handle.focus();
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => {
      expect(colWidths()[1]).toBe("329px");
    });
    // Pinned, so the filler is what absorbs the spare width now.
    expect(colWidths()[colWidths().length - 1]).toBeNull();
    expect(
      screen.getByRole("separator", { name: "Width of the Title column" }),
    ).not.toHaveAttribute("aria-valuetext");

    const menu = await openColumnMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Fill the width" }));
    await waitFor(() => {
      expect(colWidths()[1]).toBeNull();
    });
    expect(colWidths()[colWidths().length - 1]).toBe("0px");
  });

  it("offers no way to fill the width while a column already does", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");

    const menu = await openColumnMenu(user);
    expect(
      within(menu).queryByRole("menuitem", { name: "Fill the width" }),
    ).not.toBeInTheDocument();
  });
});

describe("sorting the contracts list", () => {
  it("cycles a column through ascending, descending, and the natural order", async () => {
    const user = userEvent.setup();
    const surface = api();
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    const header = await screen.findByRole("button", { name: "Title" });
    const cell = () => screen.getByRole("columnheader", { name: /Title/ });
    expect(cell()).not.toHaveAttribute("aria-sort");

    await user.click(header);
    await waitFor(() => {
      expect(lastQuery(surface.queries).get("dir")).toBe("asc");
    });
    expect(lastQuery(surface.queries).get("sort")).toBe("title");
    expect(cell()).toHaveAttribute("aria-sort", "ascending");

    await user.click(header);
    await waitFor(() => {
      expect(lastQuery(surface.queries).get("dir")).toBe("desc");
    });
    expect(cell()).toHaveAttribute("aria-sort", "descending");

    // Off is a state, not the absence of one: on contracts it is newest
    // reference first (CTR-024), so it has to be reachable.
    await user.click(header);
    await waitFor(() => {
      expect(lastQuery(surface.queries).has("sort")).toBe(false);
    });
    expect(lastQuery(surface.queries).has("dir")).toBe(false);
    expect(cell()).not.toHaveAttribute("aria-sort");
  });

  it("leaves a column the list cannot order by as plain text", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: api().handler });
    renderAt("/contracts");
    const menu = await openColumnMenu(user);
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Term left/ }));
    await closeMenu(user);
    await waitFor(() => {
      expect(headings()).toContain("Term left");
    });

    // Derived at read, so no index can serve it (CTR-006).
    const cell = screen.getByRole("columnheader", { name: "Term left" });
    expect(within(cell).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the contracts list's saved views", () => {
  it("opens on the view the person made their default", async () => {
    const surface = api({
      views: [
        storedView({
          config: {
            columns: [
              { key: "title", width: 280 },
              { key: "status", width: 140 },
            ],
            flexKey: "title",
            sort: { key: "status", dir: "desc" },
            filters: { includeEnded: true },
          },
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    expect(await screen.findByRole("button", { name: /My deals/ })).toBeInTheDocument();
    expect(headings()).toEqual(["Title", "Status"]);
    // A view is the whole list state (DD-019 clause 2): its sort and its
    // filters ride to the API with it.
    expect(lastQuery(surface.queries).get("sort")).toBe("status");
    expect(lastQuery(surface.queries).get("dir")).toBe("desc");
    expect(lastQuery(surface.queries).get("includeEnded")).toBe("true");
  });

  it("marks the layout modified and writes it back only when told to", async () => {
    const user = userEvent.setup();
    const surface = api({ views: [storedView()] });
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    await screen.findByRole("button", { name: /My deals/ });
    const menu = await openColumnMenu(user);
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: /Expires/ }));
    await closeMenu(user);

    // Saving is an act (DD-019 clause 5): the drag moved the list and the
    // server has heard nothing.
    expect(await screen.findByRole("button", { name: /My deals.*Modified/s })).toBeInTheDocument();
    expect(surface.writes).toHaveLength(0);

    await user.click(within(await openViewsMenu(user)).getByRole("menuitem", { name: "Save" }));
    await waitFor(() => {
      expect(surface.writes).toHaveLength(1);
    });
    const write = surface.writes[0]!;
    expect(write.method).toBe("PATCH");
    expect(write.id).toBe("v1");
    const config = (write.body as { config: { columns: { key: string }[]; flexKey: string } })
      .config;
    expect(config.columns.map((column) => column.key)).toEqual(["title", "status", "expiryDate"]);
    expect(config.flexKey).toBe("title");
  });

  it("saves the layout as a new view under a name", async () => {
    const user = userEvent.setup();
    const surface = api();
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    await user.click(within(await openViewsMenu(user)).getByRole("menuitem", { name: "Save as…" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Renewals watch");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(surface.writes).toHaveLength(1);
    });
    expect(surface.writes[0]!.method).toBe("POST");
    expect((surface.writes[0]!.body as { name: string }).name).toBe("Renewals watch");
    expect(await screen.findByRole("button", { name: /Renewals watch/ })).toBeInTheDocument();
  });

  it("falls back to the built-in layout when the active view is deleted", async () => {
    const user = userEvent.setup();
    const surface = api({ views: [storedView()] });
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    await screen.findByRole("button", { name: /My deals/ });
    expect(headings()).toEqual(["Title", "Status"]);

    await user.click(within(await openViewsMenu(user)).getByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(headings()).toContain("Reference");
    });
    expect(surface.writes[0]!.method).toBe("DELETE");
    expect(screen.getByRole("button", { name: /Default view/ })).toBeInTheDocument();
  });

  it("reads past a stored column this build no longer has", async () => {
    const surface = api({
      views: [
        storedView({
          config: {
            columns: [
              { key: "matter", width: 200 },
              { key: "status", width: 140 },
            ],
            flexKey: "matter",
            sort: { key: "matter", dir: "asc" },
            filters: {},
          },
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: surface.handler });
    renderAt("/contracts");

    await screen.findByRole("button", { name: /My deals/ });
    // The unknown column is dropped, the required Title is put back, the
    // sort nothing offers is cleared, and the stretch it named goes with it
    // (DD-019 clause 7).
    expect(headings()).toEqual(["Status", "Title"]);
    expect(lastQuery(surface.queries).has("sort")).toBe(false);
    expect(colWidths()).toEqual(["140px", "280px", null]);
  });
});
