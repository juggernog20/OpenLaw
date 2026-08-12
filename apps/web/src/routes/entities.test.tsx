// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /entities destination (ENT-001/ENT-004, #98/#99), through the
 * real route table with the standard fetch stub: Member+ lands on the
 * registry (nav item drawn, list rendered in the API's order, each row
 * linking to its record page), the empty registry explains itself and
 * offers the register action, the register dialog posts the identity
 * card and the new row joins the list, the show-archived toggle
 * re-reads the list with archived rows and offers a row-level restore
 * (#99), and Contributors and Business Users are bounced home with no
 * Entities nav item at all.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
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

const TYPE_OPTIONS = [
  { id: "t-corp", slug: "corporation", displayName: "Corporation" },
  { id: "t-llc", slug: "llc", displayName: "LLC" },
  { id: "t-other", slug: "other", displayName: "Other" },
];

function entityRow(overrides: Partial<Record<string, unknown>> & { id: string }) {
  return {
    legalName: "Aldgate Holdings Ltd",
    entityTypeId: "t-corp",
    entityTypeName: "Corporation",
    jurisdiction: null,
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The two reads the registry loader makes, over the standard stub. */
function registryApi(entities: unknown[], onCreate?: (call: StubCall) => Response | undefined) {
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities });
    }
    if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
      return json(200, { entityTypes: TYPE_OPTIONS });
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "POST") {
      return onCreate?.(call);
    }
    return undefined;
  };
}

describe("the /entities destination", () => {
  it("shows a Legal Team Member the registry in the API's order, with the nav item", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: registryApi([
        entityRow({
          id: "e1",
          legalName: "Aldgate GmbH",
          entityTypeName: "LLC",
          status: "active",
          jurisdiction: "Germany",
        }),
        entityRow({
          id: "e2",
          legalName: "Aldgate Holdings Ltd",
          jurisdiction: "England & Wales",
          status: "dormant",
        }),
        entityRow({ id: "e3", legalName: "Gresham Analytics Ltd", status: "divested" }),
      ]),
    });
    renderAt("/entities");

    expect(await screen.findByRole("heading", { level: 1, name: "Entities" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Entities" })).toBeInTheDocument();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1); // minus the header row
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Aldgate GmbH",
      "Aldgate Holdings Ltd",
      "Gresham Analytics Ltd",
    ]);
    // Name, type, jurisdiction, and status all render; absent
    // jurisdiction renders as a dash, statuses as their labels.
    expect(within(rows[0]!).getByText("LLC")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Germany")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Dormant")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Divested")).toBeInTheDocument();
  });

  it("explains the empty registry and registers the first entity through the dialog", async () => {
    let posted: unknown;
    stubApi({
      signedIn: ADMIN,
      extra: registryApi([], (call) => {
        posted = call.body;
        return json(201, {
          entity: entityRow({
            id: "e-new",
            legalName: "Aldgate UK Ltd",
            jurisdiction: "England & Wales",
          }),
        });
      }),
    });
    renderAt("/entities");

    // The empty state says what the registry is and offers the action.
    expect(await screen.findByRole("heading", { name: "No entities yet" })).toBeInTheDocument();
    expect(screen.getByText(/your own corporate entities/)).toBeInTheDocument();

    // The action is offered twice on an empty registry — the sub-bar
    // and the empty state itself; the demo path goes through the latter.
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Register entity" }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Legal name"), "Aldgate UK Ltd");
    await user.selectOptions(within(dialog).getByLabelText("Entity type"), "t-corp");
    await user.type(within(dialog).getByLabelText("Formation jurisdiction"), "England & Wales");
    await user.click(within(dialog).getByRole("button", { name: "Register" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted).toMatchObject({
      legalName: "Aldgate UK Ltd",
      entityTypeId: "t-corp",
      jurisdiction: "England & Wales",
      status: "active",
    });
    // The new row replaces the empty state.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Aldgate UK Ltd")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No entities yet" })).not.toBeInTheDocument();
  });

  it("refuses to register without the required legal name and type", async () => {
    stubApi({ signedIn: ADMIN, extra: registryApi([]) });
    renderAt("/entities");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No entities yet" });
    await user.click(screen.getAllByRole("button", { name: "Register entity" })[0]!);
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Register" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Name the entity — its registered legal name.",
    );

    await user.type(within(dialog).getByLabelText("Legal name"), "Aldgate UK Ltd");
    await user.click(within(dialog).getByRole("button", { name: "Register" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Pick an entity type.");
  });

  it("links each row to its record page", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: registryApi([entityRow({ id: "e1", legalName: "Aldgate GmbH" })]),
    });
    renderAt("/entities");

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "Aldgate GmbH" })).toHaveAttribute(
      "href",
      "/entities/e1",
    );
  });

  it("reveals archived entities behind the show-archived toggle and restores one from its row", async () => {
    const live = entityRow({ id: "e1", legalName: "Aldgate GmbH" });
    const archived = entityRow({
      id: "e2",
      legalName: "Mistake Ltd",
      archivedAt: "2026-08-10T00:00:00.000Z",
    });
    let restored = false;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          const all = call.url.searchParams.get("includeArchived") === "true";
          const current = restored ? { ...archived, archivedAt: null } : archived;
          return json(200, { entities: all || restored ? [live, current] : [live] }); // restored rows rejoin the working list
        }
        if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
          return json(200, { entityTypes: TYPE_OPTIONS });
        }
        if (call.url.pathname === "/api/v1/entities/e2/restore" && call.method === "POST") {
          restored = true;
          return json(200, { entity: { ...archived, archivedAt: null } });
        }
        return undefined;
      },
    });
    renderAt("/entities");
    const user = userEvent.setup();

    // The working list hides the archived entity.
    const table = await screen.findByRole("table");
    expect(within(table).queryByText("Mistake Ltd")).not.toBeInTheDocument();

    // The toggle reveals it, marked as archived, with restore on offer.
    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    expect(await screen.findByText("Mistake Ltd")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore Mistake Ltd" }));
    // Restored: the pill and the row action leave; the row stays listed.
    await waitFor(() => expect(screen.queryByText("Archived")).not.toBeInTheDocument());
    expect(screen.getByText("Mistake Ltd")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore Mistake Ltd" })).not.toBeInTheDocument();

    // Toggling back off keeps the restored entity in the working list.
    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    await waitFor(() =>
      expect(screen.getAllByRole("row").length).toBe(3), // header + two live rows
    );
    expect(screen.getByText("Mistake Ltd")).toBeInTheDocument();
  });

  it("bounces a Contributor home and draws them no Entities nav item", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    renderAt("/entities");
    // The home page renders instead of the registry.
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Entities" })).not.toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/entities");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
