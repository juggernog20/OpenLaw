// SPDX-License-Identifier: AGPL-3.0-only

/** The default cross-Entity compliance calendar, in due-date list and month forms. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u1",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const entities = [
  {
    id: "e1",
    legalName: "Aldgate UK Ltd",
    entityTypeId: "t1",
    entityTypeName: "Corporation",
    jurisdiction: "England & Wales",
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    sharesAuthorized: null,
    sharesIssued: null,
    parValue: null,
    customFields: {},
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];
const obligations = [
  {
    id: "o1",
    entityId: "e1",
    entity: { id: "e1", legalName: "Aldgate UK Ltd" },
    label: "Overdue annual return",
    registration: null,
    recurrenceMonths: 12,
    nextDueOn: "2026-08-15",
    assignee: { id: "u2", displayName: "Yusuf Haddad", image: null },
    note: null,
    matter: null,
    completedOn: null,
    overdue: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "o2",
    entityId: "e1",
    entity: { id: "e1", legalName: "Aldgate UK Ltd" },
    label: "Licence renewal",
    registration: null,
    recurrenceMonths: null,
    nextDueOn: "2026-09-20",
    assignee: null,
    note: null,
    matter: null,
    completedOn: null,
    overdue: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

/** The query strings the calendar read was asked for, in order. */
function calendarApi(rows: unknown[] = obligations, queries: URLSearchParams[] = []) {
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/entities/calendar") {
      queries.push(call.url.searchParams);
      return json(200, { obligations: rows });
    }
    if (call.url.pathname === "/api/v1/entities") return json(200, { entities });
    if (call.url.pathname === "/api/v1/entities/types") {
      return json(200, {
        entityTypes: [{ id: "t1", slug: "corporation", displayName: "Corporation" }],
      });
    }
    if (call.url.pathname === "/api/v1/entities/obligation-options") {
      return json(200, {
        users: [{ id: "u2", displayName: "Yusuf Haddad", image: null }],
        matters: [],
      });
    }
    return undefined;
  };
}

describe("the Entities compliance calendar", () => {
  it("opens on the due-date list with filters and the severe overdue treatment", async () => {
    stubApi({ signedIn: MEMBER, extra: calendarApi() });
    renderAt("/entities");

    expect(await screen.findByRole("heading", { name: "Compliance calendar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Entity")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include completed" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Overdue annual return")).toHaveClass(
      "text-status-severe-fg",
    );
    expect(within(rows[0]!).getByText("Aug 15, 2026")).toHaveClass("text-status-severe-fg");
    expect(within(rows[1]!).getByText("Licence renewal")).toBeInTheDocument();
  });

  it("carries every filter to the calendar read and the URL", async () => {
    const queries: URLSearchParams[] = [];
    stubApi({ signedIn: MEMBER, extra: calendarApi(obligations, queries) });
    const { router } = renderAt("/entities");
    await screen.findByRole("heading", { name: "Compliance calendar" });
    // The first read carries no filter at all.
    expect(queries[0]?.get("includeCompleted")).toBeNull();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Entity"), "e1");
    await user.selectOptions(screen.getByLabelText("Assignee"), "u2");
    await user.type(screen.getByLabelText("From"), "2026-09-01");
    await user.type(screen.getByLabelText("To"), "2026-09-30");
    await user.click(screen.getByLabelText("Include completed"));
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(queries.at(-1)?.get("includeCompleted")).toBe("true"));
    const last = queries.at(-1)!;
    expect(last.get("entity")).toBe("e1");
    expect(last.get("assignee")).toBe("u2");
    expect(last.get("from")).toBe("2026-09-01");
    expect(last.get("to")).toBe("2026-09-30");
    const search = new URLSearchParams(router.state.location.search);
    expect(search.get("entity")).toBe("e1");
    expect(search.get("assignee")).toBe("u2");
    expect(search.get("from")).toBe("2026-09-01");
    expect(search.get("to")).toBe("2026-09-30");
    expect(search.get("includeCompleted")).toBe("true");
  });

  it("draws the month as a CSS grid and steps months with a Today control", async () => {
    stubApi({ signedIn: MEMBER, extra: calendarApi() });
    renderAt("/entities?calendar=month&month=2026-09");

    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "September 2026" });
    // Six week rows under one header row; every direct child is a row.
    const gridRows = within(grid).getAllByRole("row");
    expect(gridRows).toHaveLength(7);
    expect(gridRows[0]).toHaveClass("grid");
    expect(within(gridRows[0]!).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(gridRows[1]!).getAllByRole("gridcell")).toHaveLength(7);
    expect(within(grid).getByText("Licence renewal")).toBeInTheDocument();
    expect(within(grid).getByText("Licence renewal")).toHaveClass("text-link");
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
  });

  it("distinguishes a blank calendar from filters that match nothing", async () => {
    stubApi({ signedIn: MEMBER, extra: calendarApi([]) });
    const first = renderAt("/entities");
    expect(await screen.findByRole("heading", { name: "No obligations yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add obligation" })).toHaveAttribute(
      "href",
      "/entities/e1/obligations",
    );
    first.view.unmount();

    renderAt("/entities?entity=e1");
    expect(
      await screen.findByRole("heading", { name: "No obligations match" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear all" })).toHaveAttribute("href", "/entities");
    // Switching display keeps the filters; only Clear all drops them.
    expect(screen.getByRole("link", { name: "Month" })).toHaveAttribute(
      "href",
      "/entities?entity=e1&calendar=month",
    );
  });
});
