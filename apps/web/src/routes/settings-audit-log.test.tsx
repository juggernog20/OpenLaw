// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Security · Audit log (#133, DD-017) at the route seam.
 *
 * Five things carry this suite.
 *
 * **The pane is absent for a non-Administrator, and its route refuses
 * them** (SET-002). Absent is the load-bearing half: the rail never
 * advertises a pane it will not open.
 *
 * **Entries read as sentences**, through the same narration the record
 * feed uses — including the `admin_only` families no record feed
 * carries, which only this surface renders.
 *
 * **The filters compose**, and what the pane sends is what the reader
 * narrowed by: one request carrying every active filter, not one
 * request per filter.
 *
 * **The export link carries the filters on screen**, so what downloads
 * is what is being looked at.
 *
 * **The log pages**, and "Show older" appends rather than replaces.
 *
 * The API behaviors themselves are covered at the HTTP seam in apps/api
 * — these stubs only shape what this UI must react to.
 */

import { describe, expect, it } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
  theme: "light",
};

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "light",
};

const PEOPLE = [
  {
    id: "u1",
    email: "blair@example.com",
    displayName: "Blair Wentworth",
    role: "administrator",
    status: "active",
    lastActiveAt: null,
  },
  {
    id: "u2",
    email: "casey@example.com",
    displayName: "Casey Counsel",
    role: "legal_team_member",
    status: "active",
    lastActiveAt: null,
  },
];

const ACTIONS = ["contract.created", "org_settings.updated", "user.role_changed"];

const BLAIR = {
  id: "u1",
  displayName: "Blair Wentworth",
  image: null,
  archived: false,
};

/** One entry of each family the pane has to render: the record's own,
 * the settings entry no record feed carries, and the role change an
 * Administrator opens this pane to find. */
const ENTRIES = [
  {
    id: "a1",
    action: "user.role_changed",
    entityType: "user",
    entityId: "u2",
    visibility: "admin_only",
    actor: BLAIR,
    createdAt: "2026-08-12T09:00:00.000Z",
    payload: { email: "casey@example.com", from: "contributor", to: "legal_team_member" },
  },
  {
    id: "a2",
    action: "org_settings.updated",
    entityType: "system",
    entityId: null,
    visibility: "admin_only",
    actor: BLAIR,
    createdAt: "2026-08-12T08:00:00.000Z",
    payload: { field: "name", old: "Acme", new: "Acme Legal" },
  },
  {
    id: "a3",
    action: "contract.created",
    entityType: "contract",
    entityId: "c1",
    visibility: "working_team",
    actor: BLAIR,
    createdAt: "2026-08-12T07:00:00.000Z",
    payload: {},
  },
  // A decline the provider's own feed reported (#247, CTR-013). It
  // carries no actor, because nobody here declined anything: the entry
  // is the integration speaking, and its sentence says so by naming no
  // person at all.
  {
    id: "a4",
    action: "envelope.declined",
    entityType: "contract",
    entityId: "c1",
    visibility: "working_team",
    actor: null,
    createdAt: "2026-08-12T06:00:00.000Z",
    payload: {
      envelopeId: "e1",
      provider: "docusign",
      providerEnvelopeId: "fake-envelope-0001",
      status: "declined",
      reason: "The indemnity cap is wrong.",
    },
  },
  // A void a person took on the record (#248, CTR-013). It carries the
  // voider as its actor, and its sentence names them: the void is the
  // one envelope ending a person here can take, and the sentence
  // selects on whether one did.
  {
    id: "a5",
    action: "envelope.voided",
    entityType: "contract",
    entityId: "c1",
    visibility: "working_team",
    actor: BLAIR,
    createdAt: "2026-08-12T05:00:00.000Z",
    payload: {
      envelopeId: "e2",
      provider: "docusign",
      providerEnvelopeId: "fake-envelope-0002",
      status: "voided",
      reason: "We sent the wrong redline.",
    },
  },
  // The same verb from the provider's own console. No actor, so the
  // sentence reads passively, exactly as a decline's always does.
  {
    id: "a6",
    action: "envelope.voided",
    entityType: "contract",
    entityId: "c1",
    visibility: "working_team",
    actor: null,
    createdAt: "2026-08-12T04:00:00.000Z",
    payload: {
      envelopeId: "e3",
      provider: "docusign",
      providerEnvelopeId: "fake-envelope-0003",
      status: "voided",
      reason: "Voided at the provider.",
    },
  },
];

interface LogCalls {
  /** Every audit-log read, as the query the pane sent. */
  reads: URLSearchParams[];
}

/**
 * Answers the pane's three endpoints. The log answers whatever the
 * filters name, so a test asserts on what came back rather than on the
 * request alone.
 */
function auditApi(
  calls: LogCalls,
  options: { pages?: (typeof ENTRIES)[] } = {},
): (call: StubCall) => Response | undefined {
  return (call) => {
    const path = call.url.pathname;
    if (path === "/api/v1/audit-log/actions" && call.method === "GET") {
      return json(200, { actions: ACTIONS });
    }
    if (path === "/api/v1/users" && call.method === "GET") {
      return json(200, { users: PEOPLE });
    }
    if (path === "/api/v1/audit-log" && call.method === "GET") {
      const query = call.url.searchParams;
      calls.reads.push(query);
      if (options.pages) {
        const cursor = query.get("cursor");
        const index = cursor === null ? 0 : Number(cursor);
        const page = options.pages[index] ?? [];
        const more = index + 1 < options.pages.length;
        return json(200, { entries: page, nextCursor: more ? String(index + 1) : null });
      }
      // The stub filters the way the API does, so "the filter narrowed
      // the list" is a fact about what the pane rendered.
      const entries = ENTRIES.filter((entry) => {
        const action = query.get("action");
        const entityType = query.get("entityType");
        const actorId = query.get("actorId");
        const term = query.get("q");
        if (action && entry.action !== action) return false;
        if (entityType && entry.entityType !== entityType) return false;
        // An entry with no actor matches no actor filter: an integration
        // event is nobody's, so narrowing to a person leaves it out.
        if (actorId && entry.actor?.id !== actorId) return false;
        if (term && !JSON.stringify(entry).toLowerCase().includes(term.toLowerCase())) return false;
        return true;
      });
      return json(200, { entries, nextCursor: null });
    }
    return undefined;
  };
}

/** The query of the most recent read the pane made. */
async function lastRead(calls: LogCalls): Promise<URLSearchParams> {
  await waitFor(() => expect(calls.reads.length).toBeGreaterThan(0));
  return calls.reads.at(-1)!;
}

function newCalls(): LogCalls {
  return { reads: [] };
}

/** The filter bar. Scoped, because the app shell carries a search box
 * of its own and "Search" would otherwise name two controls. */
function filterBar() {
  return within(screen.getByRole("search", { name: "Narrow the audit log" }));
}

describe("who reaches the audit log", () => {
  it("puts it in the Security group for an Administrator", async () => {
    stubApi({ signedIn: ADMIN, extra: auditApi(newCalls()) });
    renderAt("/settings/audit-log");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Audit log" })).toBeVisible();
    // Beside Authentication, inside the Security group it opened for.
    expect(within(rail).getByRole("link", { name: "Authentication" })).toBeVisible();
  });

  it("is absent from the rail for a non-Administrator, and its route refuses them", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/audit-log");

    // Landed on Profile, the settings home for everyone (#67).
    expect(await screen.findByLabelText("Full name")).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByRole("link", { name: "Audit log" })).not.toBeInTheDocument();
    // Absent, not shown-and-refused: the whole group is gone (SET-002).
    expect(within(rail).queryByText("Security")).not.toBeInTheDocument();
  });
});

describe("what the pane shows", () => {
  it("narrates every family, including the admin-only ones no record feed carries", async () => {
    stubApi({ signedIn: ADMIN, extra: auditApi(newCalls()) });
    renderAt("/settings/audit-log");

    // The role change, as a sentence naming who did it and to whom,
    // with both sides of the change in the Users pane's own words.
    const roleRow = (
      await screen.findByText("Blair Wentworth changed the role of casey@example.com")
    ).closest("tr")!;
    expect(within(roleRow).getByText("Role: Contributor → Legal team member")).toBeVisible();
    expect(within(roleRow).getByText("Administrators")).toBeVisible();
    expect(within(roleRow).getByText("User")).toBeVisible();
    expect(within(roleRow).getByText("u2")).toBeVisible();

    // The settings entry, whose changed field is named on its own line.
    const settingsRow = screen
      .getByText("Blair Wentworth changed the organization settings")
      .closest("tr")!;
    expect(within(settingsRow).getByText("Name: Acme → Acme Legal")).toBeVisible();

    // And the record's own, which the history applet narrates the same
    // way — one answer for both surfaces.
    expect(screen.getByText("Blair Wentworth created this contract")).toBeVisible();

    // The envelope's ending, with the words it ended on and no person
    // named: the signers sign on the provider's own ceremony, and the
    // status arrives from its feed.
    expect(
      screen.getByText("This contract's envelope was declined — The indemnity cap is wrong."),
    ).toBeVisible();

    // The void, both ways round (#248). Taken on the record it names
    // the voider; taken in the provider's own console it reads
    // passively, because nobody here is behind it.
    expect(
      screen.getByText(
        "Blair Wentworth voided this contract's envelope — We sent the wrong redline.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("This contract's envelope was voided — Voided at the provider."),
    ).toBeVisible();
  });

  it("says so when nothing matches the filters", async () => {
    stubApi({ signedIn: ADMIN, extra: auditApi(newCalls(), { pages: [[]] }) });
    renderAt("/settings/audit-log");

    expect(await screen.findByText("No entry matches these filters.")).toBeVisible();
  });

  it("reports a failed read rather than leaving the table blank", async () => {
    stubApi({
      signedIn: ADMIN,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/audit-log") return problem(500, "Nope.");
        return auditApi(newCalls())(call);
      },
    });
    renderAt("/settings/audit-log");

    expect(await screen.findByRole("alert")).toHaveTextContent("The audit log could not be read.");
  });
});

describe("the filters", () => {
  it("keeps / on the page-level search instead of the header box", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: auditApi(newCalls()) });
    const { router } = renderAt("/settings/audit-log");
    await screen.findByText("Blair Wentworth created this contract");

    await user.keyboard("/");

    expect(filterBar().getByLabelText("Search")).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Search" })).not.toHaveFocus();

    await act(async () => router.navigate("/"));
    await screen.findByRole("heading", { name: "Home" });
    await user.keyboard("/");

    expect(screen.getByRole("combobox", { name: "Search" })).toHaveFocus();
  });

  it("narrows by each one, and composes them into a single read", async () => {
    const calls = newCalls();
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: auditApi(calls) });
    renderAt("/settings/audit-log");

    await screen.findByText("Blair Wentworth created this contract");

    // One filter narrows.
    await user.selectOptions(filterBar().getByLabelText("Record"), "user");
    await waitFor(() =>
      expect(screen.queryByText("Blair Wentworth created this contract")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Blair Wentworth changed the role of casey@example.com")).toBeVisible();

    // A second one composes with the first rather than replacing it:
    // both ride the same request.
    await user.selectOptions(filterBar().getByLabelText("Action"), "org_settings.updated");
    await waitFor(() => {
      const query = calls.reads.at(-1)!;
      expect(query.get("entityType")).toBe("user");
      expect(query.get("action")).toBe("org_settings.updated");
    });
    // And the pair narrows to nothing, because nothing satisfies both.
    expect(await screen.findByText("No entry matches these filters.")).toBeVisible();
  });

  it("carries the person and the dates the reader picked", async () => {
    const calls = newCalls();
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: auditApi(calls) });
    renderAt("/settings/audit-log");
    await screen.findByText("Blair Wentworth created this contract");

    await user.selectOptions(filterBar().getByLabelText("Person"), "u1");
    await user.type(filterBar().getByLabelText("From"), "2026-08-01");
    await user.type(filterBar().getByLabelText("To"), "2026-08-31");

    await waitFor(() => {
      const query = calls.reads.at(-1)!;
      expect(query.get("actorId")).toBe("u1");
      // Civil dates become instants, and they are the reader's own:
      // the first and last moments of those days where the reader is,
      // not where the server keeps them (DES-014).
      const from = new Date(query.get("from")!);
      expect([from.getFullYear(), from.getMonth() + 1, from.getDate(), from.getHours()]).toEqual([
        2026, 8, 1, 0,
      ]);
      const to = new Date(query.get("to")!);
      expect([to.getFullYear(), to.getMonth() + 1, to.getDate(), to.getHours()]).toEqual([
        2026, 8, 31, 23,
      ]);
    });
  });

  it("searches, and clearing puts every filter back", async () => {
    const calls = newCalls();
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: auditApi(calls) });
    renderAt("/settings/audit-log");
    await screen.findByText("Blair Wentworth created this contract");

    await user.type(filterBar().getByLabelText("Search"), "casey");
    await waitFor(() =>
      expect(screen.queryByText("Blair Wentworth created this contract")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Blair Wentworth changed the role of casey@example.com")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Blair Wentworth created this contract")).toBeVisible();
    const query = await lastRead(calls);
    expect([...query.keys()]).toEqual([]);
  });
});

describe("the export", () => {
  it("links to the filtered set, not to the whole table", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: auditApi(newCalls()) });
    renderAt("/settings/audit-log");
    await screen.findByText("Blair Wentworth created this contract");

    const link = () => screen.getByRole("link", { name: "Export CSV" });
    expect(link()).toHaveAttribute("href", "/api/v1/audit-log/export?");

    await user.selectOptions(filterBar().getByLabelText("Record"), "user");
    await waitFor(() =>
      expect(link()).toHaveAttribute("href", "/api/v1/audit-log/export?entityType=user"),
    );
  });
});

describe("paging", () => {
  it("appends the next page rather than replacing the one on screen", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      extra: auditApi(newCalls(), { pages: [[ENTRIES[0]!], [ENTRIES[2]!]] }),
    });
    renderAt("/settings/audit-log");

    await screen.findByText("Blair Wentworth changed the role of casey@example.com");
    expect(screen.queryByText("Blair Wentworth created this contract")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show older" }));

    expect(await screen.findByText("Blair Wentworth created this contract")).toBeVisible();
    // The first page is still there — "show older" adds to the account,
    // it does not replace it.
    expect(screen.getByText("Blair Wentworth changed the role of casey@example.com")).toBeVisible();
    // And the foot goes once there is nothing older.
    expect(screen.queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();
  });
});
