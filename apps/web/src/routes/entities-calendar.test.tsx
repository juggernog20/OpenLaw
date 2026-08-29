// SPDX-License-Identifier: AGPL-3.0-only

/** The default cross-Entity compliance calendar, in due-date list and month forms. */
import { screen, within } from "@testing-library/react";
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

function calendarApi(rows: unknown[] = obligations) {
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/entities/calendar") return json(200, { obligations: rows });
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
      "text-status-danger-fg",
    );
    expect(within(rows[1]!).getByText("Licence renewal")).toBeInTheDocument();
  });

  it("draws the month as a CSS grid and steps months with a Today control", async () => {
    stubApi({ signedIn: MEMBER, extra: calendarApi() });
    renderAt("/entities?calendar=month&month=2026-09");

    expect(await screen.findByRole("heading", { name: "September 2026" })).toBeInTheDocument();
    const grid = screen.getByRole("grid", { name: "September 2026" });
    expect(grid).toHaveClass("grid");
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(grid).getByText("Licence renewal")).toBeInTheDocument();
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
  });
});
