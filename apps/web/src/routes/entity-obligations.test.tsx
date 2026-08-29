// SPDX-License-Identifier: AGPL-3.0-only

/** The Entity record's Obligations tab, Add obligation, and Mark filed dialogs. */
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
const entity = {
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
};
const registration = {
  id: "r1",
  entityId: "e1",
  jurisdiction: "England & Wales",
  registrationNumber: "CH-77821",
  registeredAgent: null,
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};
const obligation = {
  id: "o1",
  entityId: "e1",
  label: "Annual return",
  registration: {
    id: "r1",
    jurisdiction: "England & Wales",
    registrationNumber: "CH-77821",
  },
  recurrenceMonths: 12,
  nextDueOn: "2026-09-30",
  assignee: { id: "u2", displayName: "Yusuf Haddad", image: null },
  note: "File online",
  matter: { id: "m1", number: 42, title: "Annual filing support" },
  completedOn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function entityRecordApi(call: StubCall): Response | undefined {
  if (call.url.pathname === "/api/v1/entities/e1" && call.method === "GET") {
    return json(200, { entity, fields: [], customFieldRefs: { users: [], entities: [] } });
  }
  if (call.url.pathname === "/api/v1/entities/types") {
    return json(200, {
      entityTypes: [{ id: "t1", slug: "corporation", displayName: "Corporation" }],
    });
  }
  if (call.url.pathname === "/api/v1/entities/officer-roles") {
    return json(200, {
      officerRoles: [],
      users: [
        { id: "u1", displayName: "Nadia Counsel", image: null, role: "legal_team_member" },
        { id: "u2", displayName: "Yusuf Haddad", image: null, role: "legal_team_member" },
      ],
    });
  }
  if (call.url.pathname === "/api/v1/entities/e1/registrations" && call.method === "GET") {
    return json(200, { registrations: [registration] });
  }
  if (call.url.pathname === "/api/v1/entities/e1/obligations" && call.method === "GET") {
    return json(200, { obligations: [obligation] });
  }
  if (call.url.pathname === "/api/v1/entities/obligation-options") {
    return json(200, {
      users: [
        { id: "u1", displayName: "Nadia Counsel", image: null },
        { id: "u2", displayName: "Yusuf Haddad", image: null },
      ],
      matters: [{ id: "m1", number: 42, title: "Annual filing support" }],
    });
  }
  if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
    return json(200, { entities: [entity] });
  }
  if (call.url.pathname === "/api/v1/entities/e1/holdings") {
    return json(200, { owners: [], owned: [], warnings: [] });
  }
  return undefined;
}

describe("the Entity Obligations tab", () => {
  it("lists obligations by due date with every optional link and opens Add obligation", async () => {
    stubApi({ signedIn: MEMBER, extra: entityRecordApi });
    renderAt("/entities/e1/obligations");

    expect(await screen.findByRole("heading", { name: "Obligations" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Annual return/ });
    expect(within(row).getByText("England & Wales")).toBeInTheDocument();
    expect(within(row).getByText("Yusuf Haddad")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "M-42 · Annual filing support" })).toHaveAttribute(
      "href",
      "/matters/42",
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add obligation" }));
    const dialog = await screen.findByRole("dialog", { name: "Add obligation" });
    expect(within(dialog).getByLabelText("Label")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Due date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Repeat every (months)")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Registration")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Assignee")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Matter")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Note")).toBeInTheDocument();
  });

  it("posts the Add obligation dialog and adds the returned row", async () => {
    let posted: unknown;
    const created = { ...obligation, id: "o2", label: "Tax return", registration: null };
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/obligations" && call.method === "POST") {
          posted = call.body;
          return json(201, { obligation: created });
        }
        return entityRecordApi(call);
      },
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add obligation" }));
    const dialog = await screen.findByRole("dialog", { name: "Add obligation" });
    await user.type(within(dialog).getByLabelText("Label"), "Tax return");
    await user.type(within(dialog).getByLabelText("Due date"), "2026-10-31");
    await user.selectOptions(within(dialog).getByLabelText("Assignee"), "u2");
    await user.click(within(dialog).getByRole("button", { name: "Add obligation" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posted).toMatchObject({
      label: "Tax return",
      nextDueOn: "2026-10-31",
      assigneeId: "u2",
    });
    expect(screen.getByText("Tax return")).toBeInTheDocument();
  });

  it("opens Mark filed with the cycle date and replaces the recurring row after confirmation", async () => {
    const rolled = { ...obligation, nextDueOn: "2027-09-30" };
    let filed: unknown;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/obligations/o1/file") {
          filed = call.body;
          return json(200, { obligation: rolled });
        }
        return entityRecordApi(call);
      },
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark Annual return filed" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark filed" });
    expect(within(dialog).getByLabelText("Filed on")).toBeInTheDocument();
    expect(within(dialog).getByText(/moves forward 12 months/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Filed on"));
    await user.type(within(dialog).getByLabelText("Filed on"), "2026-09-20");
    await user.click(within(dialog).getByRole("button", { name: "Mark filed" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(filed).toEqual({ filedOn: "2026-09-20" });
    expect(screen.getByDisplayValue("2027-09-30")).toBeInTheDocument();
  });

  it("shows linked obligations beneath their registration on Overview", async () => {
    stubApi({ signedIn: MEMBER, extra: entityRecordApi });
    renderAt("/entities/e1");
    const registrations = await screen.findByRole("heading", { name: "Registrations" });
    const card = registrations.closest("section")!;
    expect(within(card).getByText("Annual return")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Annual return" })).toHaveAttribute(
      "href",
      "/entities/e1/obligations",
    );
  });
});
