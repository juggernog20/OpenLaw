// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entities · Types (#97) at the route seam: the shared TaxonomyTypesPane
 * on the entity mount — the five ENT-001 seeds at their own URL with
 * the Entities vocabulary, in-place rename against the entity routes,
 * the inline add row, the locked `other` row, and the archive-guard
 * modal and the per-row link into the shared Fields attachment editor.
 * The machinery itself is covered by the Contracts reference
 * suite and at the HTTP seam in apps/api — these tests pin the wiring:
 * the entity URL, the entity endpoints, and the entity copy.
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
  ["t1", "corporation", "Corporation"],
  ["t2", "llc", "LLC"],
  ["t3", "partnership", "Partnership"],
  ["t4", "branch", "Branch"],
  ["t5", "other", "Other"],
] as const;

function seededTypes() {
  return SEEDS.map(([id, slug, displayName], index) => ({
    id,
    slug,
    displayName,
    displayOrder: index + 1,
    isSystemDefault: true,
    archivedAt: null,
    inUseCount: 0,
  }));
}

interface TypesCalls {
  creates: unknown[];
  renames: { id: string; body: unknown }[];
  archives: { id: string; body: unknown }[];
}

function newCalls(): TypesCalls {
  return { creates: [], renames: [], archives: [] };
}

/** Serves the seeded list and captures the pane's writes — the pane
 * holds its own row state, so the stub never needs to mutate. */
function typesApi(calls: TypesCalls, rows = seededTypes()) {
  const byId = (id: string) => rows.find((row) => row.id === id)!;
  return (call: StubCall): Response | undefined => {
    const path = call.url.pathname;
    if (path === "/api/v1/entity-types" && call.method === "GET") {
      return json(200, { entityTypes: rows });
    }
    if (path === "/api/v1/entity-types" && call.method === "POST") {
      calls.creates.push(call.body);
      const body = call.body as { displayName: string };
      return json(201, {
        entityType: {
          id: "t-new",
          slug: "holding_company",
          displayName: body.displayName,
          displayOrder: rows.length + 1,
          isSystemDefault: false,
          archivedAt: null,
          inUseCount: 0,
        },
      });
    }
    const rename = /^\/api\/v1\/entity-types\/([^/]+)$/.exec(path);
    if (rename && call.method === "PATCH") {
      calls.renames.push({ id: rename[1]!, body: call.body });
      const body = call.body as { displayName: string };
      return json(200, { entityType: { ...byId(rename[1]!), displayName: body.displayName } });
    }
    const archive = /^\/api\/v1\/entity-types\/([^/]+)\/archive$/.exec(path);
    if (archive && call.method === "POST") {
      calls.archives.push({ id: archive[1]!, body: call.body });
      return json(200, {
        entityType: { ...byId(archive[1]!), archivedAt: "2026-08-12T09:00:00.000Z" },
      });
    }
    return undefined;
  };
}

const typeList = () => screen.getByRole("list");

describe("the SET-002 gate on the pane", () => {
  it("hides the Entities rail entry from a Legal Team Member and bounces the URL", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/entities/types");
    // The refusal lands on the member's own settings home…
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    // …and the rail never teases the section.
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Entities")).not.toBeInTheDocument();
  });

  it("gives an Administrator the rail entry, marked current on the pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/entities/types");
    await screen.findByText("Corporation");
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Entities" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("the seeded list (ENT-001)", () => {
  it("renders the five types in display order with entity usage counts", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/entities/types");
    await screen.findByText("Corporation");
    const items = within(typeList()).getAllByRole("listitem");
    expect(
      items.map((item) => within(item).getByRole("button", { name: /^Rename/ }).textContent),
    ).toEqual(["Corporation", "LLC", "Partnership", "Branch", "Other"]);
    // The Entities vocabulary, not the Matters one.
    expect(within(items[0]!).getByText("0 entities")).toBeInTheDocument();
    expect(screen.getByText("5 types")).toBeInTheDocument();
  });

  it("locks the Other row: no archive action, a labelled lock instead", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    renderAt("/settings/entities/types");
    await screen.findByText("Other");
    const rows = within(typeList()).getAllByRole("listitem");
    const otherRow = rows.at(-1)!;
    expect(within(otherRow).queryByRole("button", { name: /^Archive/ })).not.toBeInTheDocument();
    expect(
      within(otherRow).getByRole("img", {
        name: "Other is system-protected and can't be archived",
      }),
    ).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole("button", { name: "Archive Corporation" }),
    ).toBeInTheDocument();
  });

  it("opens the shared per-type Fields editor", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/entities/types");
    await screen.findByText("Corporation");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Corporation" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/entities/types/t1"));
  });
});

describe("the entity endpoints behind the shared machinery", () => {
  it("renames through PATCH /entity-types/:id", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/entities/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename Corporation" }));
    const input = screen.getByRole("textbox", { name: "Rename Corporation" });
    await user.clear(input);
    await user.type(input, "C corporation{Enter}");
    await waitFor(() =>
      expect(calls.renames).toEqual([{ id: "t1", body: { displayName: "C corporation" } }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("creates through POST /entity-types and appends the new row", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/entities/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add type" }));
    await user.type(
      screen.getByRole("textbox", { name: "New type name" }),
      "Holding Company{Enter}",
    );
    await waitFor(() => expect(calls.creates).toEqual([{ displayName: "Holding Company" }]));
    expect(
      await screen.findByRole("button", { name: "Rename Holding Company" }),
    ).toBeInTheDocument();
    expect(screen.getByText("6 types")).toBeInTheDocument();
  });

  it("archives through the guard modal with the Entities copy", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls) });
    renderAt("/settings/entities/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Branch" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Branch" });
    expect(
      within(dialog).getByText(
        "Branch is not used by any entities — it can be archived without reassignment.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /^Reassign entities to$/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() => expect(calls.archives).toEqual([{ id: "t4", body: {} }]));
  });
});

describe("the SET-003 guard with live counts (#100)", () => {
  /** Branch carries a real registry count — the guard is armed. */
  function typesInUse() {
    return seededTypes().map((row) => (row.slug === "branch" ? { ...row, inUseCount: 3 } : row));
  }

  it("shows the live usage count on the row", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls(), typesInUse()) });
    renderAt("/settings/entities/types");
    await screen.findByText("Branch");
    const rows = within(typeList()).getAllByRole("listitem");
    const branchRow = rows.find((row) => within(row).queryByText("Branch"))!;
    expect(within(branchRow).getByText("3 entities")).toBeInTheDocument();
  });

  it("requires a reassignment target for an in-use type and sends the pick", async () => {
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: typesApi(calls, typesInUse()) });
    renderAt("/settings/entities/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Branch" }));

    const dialog = await screen.findByRole("dialog", { name: "Archive Branch" });
    expect(
      within(dialog).getByText(
        "Branch is used by 3 entities. Pick a replacement type — those entities " +
          "move to it when the type is archived.",
      ),
    ).toBeInTheDocument();
    const select = within(dialog).getByRole("combobox", { name: "Reassign 3 entities to" });
    expect(select).toBeEnabled();
    expect(select).toBeRequired();
    // Every live type but the target is a candidate.
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No reassignment", "Corporation", "LLC", "Partnership", "Other"]);

    await user.selectOptions(select, "Corporation");
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    await waitFor(() =>
      expect(calls.archives).toEqual([{ id: "t4", body: { reassignToId: "t1" } }]),
    );
  });

  it("surfaces the API's refusal detail in the dialog", async () => {
    const calls = newCalls();
    const detail =
      "This entity type is used by 3 entities. Pick a reassignment target to archive it.";
    stubApi({
      signedIn: ADMIN,
      extra: (call: StubCall) =>
        call.method === "POST" && call.url.pathname.endsWith("/archive")
          ? problem(409, detail)
          : typesApi(calls, typesInUse())(call),
    });
    renderAt("/settings/entities/types");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Branch" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive Branch" });
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Reassign 3 entities to" }),
      "Corporation",
    );
    await user.click(within(dialog).getByRole("button", { name: "Archive type" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(detail);
  });
});

describe("the section URL", () => {
  it("forwards /settings/entities to the Types pane", async () => {
    stubApi({ signedIn: ADMIN, extra: typesApi(newCalls()) });
    const { router } = renderAt("/settings/entities");
    await screen.findByText("Corporation");
    expect(router.state.location.pathname).toBe("/settings/entities/types");
  });
});
