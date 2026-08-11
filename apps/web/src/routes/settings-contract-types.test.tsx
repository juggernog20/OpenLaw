// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Types (#81) at the route seam: the DES-020 list-editor —
 * the seeded list in order, in-place rename, the inline add row,
 * arrow-key reorder, the locked `other` row, the SET-003 archive-guard
 * modal, and the Show-archived filter with restore. The API behaviors
 * themselves are covered at the HTTP seam in apps/api — these stubs
 * only shape what this UI must react to.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = { ...ADMIN, id: "u2", email: "casey@example.com", role: "legal_team_member" };

const SEEDS = [
  ["t1", "nda", "NDA"],
  ["t2", "msa", "MSA"],
  ["t3", "sow", "SOW"],
  ["t4", "sales", "Sales"],
  ["t5", "vendor", "Vendor"],
  ["t6", "employment", "Employment"],
  ["t7", "license", "License"],
  ["t8", "other", "Other"],
] as const;

function seededTypes(archivedSlugs: string[] = []) {
  return SEEDS.map(([id, slug, displayName], index) => ({
    id,
    slug,
    displayName,
    displayOrder: index + 1,
    isSystemDefault: true,
    archivedAt: archivedSlugs.includes(slug) ? "2026-08-10T12:00:00.000Z" : null,
    inUseCount: 0,
  }));
}

interface TypesCalls {
  creates: unknown[];
  renames: { id: string; body: unknown }[];
  orders: unknown[];
  archives: { id: string; body: unknown }[];
  restores: string[];
}

function newCalls(): TypesCalls {
  return { creates: [], renames: [], orders: [], archives: [], restores: [] };
}

/** Serves the seeded list and captures the pane's writes — the pane
 * holds its own row state, so the stub never needs to mutate. */
function typesApi(calls: TypesCalls, rows = seededTypes()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/contract-types" && call.method === "GET") {
      return json(200, { contractTypes: rows });
    }
    if (path === "/api/v1/contract-types" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { displayName: string };
      return json(201, {
        contractType: {
          id: "t-new",
          slug: "real_estate",
          displayName: body.displayName,
          displayOrder: rows.length + 1,
          isSystemDefault: false,
          archivedAt: null,
          inUseCount: 0,
        },
      });
    }
    const rename = /^\/api\/v1\/contract-types\/([^/]+)$/.exec(path);
    if (rename && call.method === "PATCH") {
      calls.renames.push({ id: rename[1]!, body: call.body });
      const body = call.body as { displayName: string };
      return json(200, { contractType: { ...byId(rename[1]!), displayName: body.displayName } });
    }
    if (path === "/api/v1/contract-types/order" && call.method === "PUT") {
      calls.orders.push(call.body);
      const { ids } = call.body as { ids: string[] };
      return json(200, {
        contractTypes: ids.map((id, index) => ({ ...byId(id), displayOrder: index + 1 })),
      });
    }
    const archive = /^\/api\/v1\/contract-types\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push({ id: archive[1]!, body: call.body });
      return json(200, {
        contractType: { ...byId(archive[1]!), archivedAt: "2026-08-11T09:00:00.000Z" },
      });
    }
    const restore = /^\/api\/v1\/contract-types\/([^/]+)\/restore$/.exec(path);
    if (restore && call.method === "POST") {
      calls.restores.push(restore[1]!);
      return json(200, {
        contractType: { ...byId(restore[1]!), archivedAt: null, displayOrder: rows.length + 1 },
      });
    }
    return undefined;
  };
}

const typeList = () => screen.getByRole("list");

describe("the SET-002 gate on the pane", () => {
  it("hides the Contracts rail entry from a Legal Team Member and bounces the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/contracts/types");
    // The refusal lands on the member's own settings home…
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    // …and the rail never teases the section.
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Contracts")).not.toBeInTheDocument();
  });

  it("gives an Administrator the rail entry, marked current on the pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/contracts/types");
    await screen.findByText("NDA");
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("the seeded list (CTR-002)", () => {
  it("renders the eight types in display order with usage counts and the count caption", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/contracts/types");
    await screen.findByText("NDA");
    const items = within(typeList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["NDA", "MSA", "SOW", "Sales", "Vendor", "Employment", "License", "Other"]);
    expect(within(items[0]!).getByText("0 contracts")).toBeInTheDocument();
    expect(screen.getByText("8 types")).toBeInTheDocument();
  });

  it("locks the Other row: no archive action, a labelled lock instead", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/contracts/types");
    await screen.findByText("Other");
    const rows = within(typeList()).getAllByRole("listitem");
    const otherRow = rows.at(-1)!;
    expect(within(otherRow).queryByRole("button", { name: /^Archive/ })).not.toBeInTheDocument();
    expect(
      within(otherRow).getByRole("img", {
        name: "Other is system-protected and can't be archived",
      }),
    ).toBeInTheDocument();
    // Every other live row keeps its archive action.
    expect(within(rows[0]!).getByRole("button", { name: "Archive NDA" })).toBeInTheDocument();
  });
});

describe("in-place rename (DES-017)", () => {
  it("commits on Enter and shows Saved; the slug stays with the server", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Sales" }));
    const input = screen.getByRole("textbox", { name: "Rename Sales" });
    await user.clear(input);
    await user.type(input, "Sales agreements{Enter}");
    await waitFor(() =>
      expect(calls.renames).toEqual([{ id: "t4", body: { displayName: "Sales agreements" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Sales agreements" })).toBeInTheDocument();
  });

  it("reverts on Escape without a request", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Sales" }));
    await user.type(screen.getByRole("textbox", { name: "Rename Sales" }), "X{Escape}");
    expect(screen.getByRole("button", { name: "Rename Sales" })).toBeInTheDocument();
    expect(calls.renames).toEqual([]);
  });
});

describe("add (the inline draft row)", () => {
  it("creates on Enter and appends the new row", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add type" }));
    await user.type(screen.getByRole("textbox", { name: "New type name" }), "Real Estate{Enter}");
    await waitFor(() => expect(calls.creates).toEqual([{ displayName: "Real Estate" }]));
    expect(await screen.findByRole("button", { name: "Rename Real Estate" })).toBeInTheDocument();
    expect(screen.getByText("9 types")).toBeInTheDocument();
  });

  it("discards on Escape without a request", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add type" }));
    await user.type(screen.getByRole("textbox", { name: "New type name" }), "Nope{Escape}");
    expect(screen.queryByRole("textbox", { name: "New type name" })).not.toBeInTheDocument();
    expect(calls.creates).toEqual([]);
  });

  it("keeps the draft row open on a refusal, showing the server's sentence", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contract-types" && call.method === "POST") {
          return problem(409, "A type with this name already exists.");
        }
        return typesApi(calls)(call);
      },
    });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add type" }));
    await user.type(screen.getByRole("textbox", { name: "New type name" }), "NDA{Enter}");
    // The name is not lost to the refusal, and the refusal itself shows.
    expect(await screen.findByText("A type with this name already exists.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New type name" })).toHaveValue("NDA");
  });
});

describe("the section URL", () => {
  it("forwards /settings/contracts to the Types pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/contracts");
    await screen.findByText("NDA");
    expect(router.state.location.pathname).toBe("/settings/contracts/types");
  });
});

describe("reorder (DES-020's keyboard path)", () => {
  it("moves a row one position per arrow press and commits the permutation", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    const grip = await screen.findByRole("button", { name: /^Reorder NDA, position 1 of 8/ });
    grip.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(calls.orders).toEqual([{ ids: ["t2", "t1", "t3", "t4", "t5", "t6", "t7", "t8"] }]),
    );
    // The list re-renders in the committed order.
    const items = within(typeList()).getAllByRole("listitem");
    expect(within(items[0]!).getByText("MSA")).toBeInTheDocument();
    expect(within(items[1]!).getByText("NDA")).toBeInTheDocument();
  });

  it("keeps the order and shows the refusal when the server rejects a move", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contract-types/order" && call.method === "PUT") {
          return problem(400, "The order must list every live contract type exactly once.");
        }
        return typesApi(calls)(call);
      },
    });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    const grip = await screen.findByRole("button", { name: /^Reorder NDA, position 1 of 8/ });
    grip.focus();
    await user.keyboard("{ArrowDown}");
    expect(
      await screen.findByText("The order must list every live contract type exactly once."),
    ).toBeInTheDocument();
    const items = within(typeList()).getAllByRole("listitem");
    expect(within(items[0]!).getByText("NDA")).toBeInTheDocument();
  });
});

describe("the archive guard (SET-003, frame ST8)", () => {
  it("archives through the modal: zero-usage count, disabled reassignment, audit caption", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Vendor" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Vendor" });
    expect(
      within(dialog).getByText(
        "Vendor is not used by any contracts — it can be archived without reassignment.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: /^Reassign contracts to$/ }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("The change applies immediately and is recorded in the audit log."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() => expect(calls.archives).toEqual([{ id: "t5", body: {} }]));
    // The archived row leaves the default view…
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Rename Vendor" })).not.toBeInTheDocument(),
    );
    // …and waits behind the Show-archived filter.
    expect(screen.getByRole("switch", { name: "Show archived" })).toBeInTheDocument();
    expect(screen.getByText("7 types")).toBeInTheDocument();
  });

  it("shows the server's own refusal sentence in the modal", async () => {
    const calls = newCalls();
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (/\/archive$/.exec(call.url.pathname) && call.method === "POST") {
          return problem(409, "This contract type is already archived.");
        }
        return typesApi(calls)(call);
      },
    });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Vendor" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Vendor" });
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This contract type is already archived.",
    );
  });

  it("reveals archived rows greyed with a pill and restores them", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls, seededTypes(["vendor"])) });
    renderAt("/settings/contracts/types");
    const user = userEvent.setup();
    await screen.findByText("NDA");
    // Archived rows are out of the default view.
    expect(screen.queryByText("Vendor")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    const row = screen.getByText("Vendor").closest("li")!;
    expect(within(row).getByText("Archived")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Restore Vendor" }));
    await waitFor(() => expect(calls.restores).toEqual(["t5"]));
    // Restored to the end of the live order (DES-020).
    await waitFor(() => {
      const items = within(typeList()).getAllByRole("listitem");
      expect(within(items.at(-1)!).getByText("Vendor")).toBeInTheDocument();
    });
  });
});
