// SPDX-License-Identifier: AGPL-3.0-only

/** The Entity record's Obligations tab, Add obligation, and Mark complete dialogs. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { formatFullDate } from "../lib/format";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

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
  beforeEach(() => localStorage.clear());
  it("lists obligations by due date with every optional link and opens Add obligation", async () => {
    stubApi({ signedIn: MEMBER, extra: entityRecordApi });
    renderAt("/entities/e1/obligations");

    expect(await screen.findByRole("heading", { name: "Obligations" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Annual return/ });
    expect(within(row).getByText("England & Wales · CH-77821")).toBeInTheDocument();
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

  it("sends nothing from Add obligation until both label and due date are filled", async () => {
    let posted = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/obligations" && call.method === "POST") {
          posted += 1;
          return json(201, { obligation });
        }
        return entityRecordApi(call);
      },
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add obligation" }));
    const dialog = await screen.findByRole("dialog", { name: "Add obligation" });
    await user.click(within(dialog).getByRole("button", { name: "Add obligation" }));
    await user.type(within(dialog).getByLabelText("Label"), "Tax return");
    await user.click(within(dialog).getByRole("button", { name: "Add obligation" }));
    expect(posted).toBe(0);
    expect(screen.getByRole("dialog", { name: "Add obligation" })).toBeInTheDocument();
  });

  it("keeps the Add obligation dialog open with its typing when the API refuses", async () => {
    const detail = "The due date must be today or later.";
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/entities/e1/obligations" && call.method === "POST"
          ? problem(400, detail)
          : entityRecordApi(call),
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add obligation" }));
    const dialog = await screen.findByRole("dialog", { name: "Add obligation" });
    await user.type(within(dialog).getByLabelText("Label"), "Tax return");
    await user.type(within(dialog).getByLabelText("Due date"), "2020-01-01");
    await user.click(within(dialog).getByRole("button", { name: "Add obligation" }));
    expect(await within(dialog).findByText(detail)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add obligation" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Label")).toHaveValue("Tax return");
  });

  it("keeps the saved due date when Mark complete is refused", async () => {
    const detail = "This obligation was already filed for this cycle.";
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/entities/e1/obligations/o1/file"
          ? problem(409, detail)
          : entityRecordApi(call),
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark complete" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark complete" });
    await user.click(within(dialog).getByRole("button", { name: "Mark complete" }));
    expect(await within(dialog).findByText(detail)).toBeInTheDocument();
    expect(screen.getByText(formatFullDate("2026-09-30"))).toBeInTheDocument();
  });

  it("opens Mark complete with the cycle date and replaces the recurring row after confirmation", async () => {
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
    await user.click(await screen.findByRole("button", { name: "Mark complete" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark complete" });
    expect(within(dialog).getByLabelText("Completed on")).toBeInTheDocument();
    expect(within(dialog).getByText(/forward by 12 months/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Completed on"));
    await user.type(within(dialog).getByLabelText("Completed on"), "2026-09-20");
    await user.click(within(dialog).getByRole("button", { name: "Mark complete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(filed).toEqual({ filedOn: "2026-09-20" });
    expect(screen.getByText(formatFullDate("2027-09-30"))).toBeInTheDocument();
  });

  it("shows read-only values, resizes columns, and saves edits only on confirmation", async () => {
    const patches: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.method === "PATCH" && call.url.pathname === "/api/v1/entities/e1/obligations/o1") {
          patches.push(call.body);
          return json(200, {
            obligation: { ...obligation, label: "Updated return", note: "Updated note" },
          });
        }
        return entityRecordApi(call);
      },
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    const actions = await screen.findByRole("button", { name: "Actions for Annual return" });
    const row = screen.getByRole("row", { name: /Annual return/ });
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
    const resize = screen.getByRole("separator", { name: "Width of the Due date column" });
    const width = Number(resize.getAttribute("aria-valuenow"));
    resize.focus();
    await user.keyboard("{ArrowRight}");
    expect(Number(resize.getAttribute("aria-valuenow"))).toBeGreaterThan(width);
    await user.click(actions);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit obligation" });
    await user.clear(within(dialog).getByLabelText("Label"));
    await user.type(within(dialog).getByLabelText("Label"), "Updated return");
    await user.clear(within(dialog).getByLabelText("Note"));
    await user.type(within(dialog).getByLabelText("Note"), "Updated note");
    expect(patches).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches).toEqual([
      {
        label: "Updated return",
        note: "Updated note",
        nextDueOn: obligation.nextDueOn,
        recurrenceMonths: 12,
      },
    ]);
    expect(screen.getByText("Updated return")).toBeInTheDocument();
  });

  it("restores resized columns after remounting without sharing them with another user", async () => {
    stubApi({ signedIn: MEMBER, extra: entityRecordApi });
    const first = renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    const handle = await screen.findByRole("separator", { name: "Width of the Due date column" });
    const initial = Number(handle.getAttribute("aria-valuenow"));
    handle.focus();
    await user.keyboard("{ArrowRight}");
    const resized = Number(handle.getAttribute("aria-valuenow"));
    expect(resized).toBeGreaterThan(initial);
    first.view.unmount();
    first.router.dispose();

    const second = renderAt("/entities/e1/obligations");
    expect(
      await screen.findByRole("separator", { name: "Width of the Due date column" }),
    ).toHaveAttribute("aria-valuenow", String(resized));
    second.view.unmount();
    second.router.dispose();

    stubApi({ signedIn: { ...MEMBER, id: "another-user" }, extra: entityRecordApi });
    renderAt("/entities/e1/obligations");
    expect(
      await screen.findByRole("separator", { name: "Width of the Due date column" }),
    ).toHaveAttribute("aria-valuenow", String(initial));
  });

  it("preserves a restricted matter while editing and keeps failed edits available to retry or cancel", async () => {
    const patches: Record<string, unknown>[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/entities/e1/obligations" && call.method === "GET")
          return json(200, {
            obligations: [{ ...obligation, matter: { id: "private-matter", restricted: true } }],
          });
        if (call.method === "PATCH" && call.url.pathname === "/api/v1/entities/e1/obligations/o1") {
          patches.push(call.body as Record<string, unknown>);
          return problem(409, "The obligation could not be updated.");
        }
        return entityRecordApi(call);
      },
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Annual return" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit obligation" });
    expect(within(dialog).getByLabelText("Matter")).toHaveValue("private-matter");
    await user.clear(within(dialog).getByLabelText("Label"));
    await user.type(within(dialog).getByLabelText("Label"), "Draft change");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The obligation could not be updated.",
    );
    expect(patches[0]).not.toHaveProperty("matterId");
    expect(within(dialog).getByLabelText("Label")).toHaveValue("Draft change");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Annual return")).toBeInTheDocument();
    expect(screen.queryByText("Draft change")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions for Annual return" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(await screen.findByLabelText("Label")).toHaveValue("Annual return");
  });

  it("deletes through the row menu", async () => {
    let deleted = false;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (
          call.method === "DELETE" &&
          call.url.pathname === "/api/v1/entities/e1/obligations/o1"
        ) {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        return entityRecordApi(call);
      },
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Actions for Annual return" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("No obligations for this Entity.")).toBeInTheDocument();
    expect(deleted).toBe(true);
  });

  it("locks a completed one-off obligation", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/entities/e1/obligations/o1/file"
          ? json(200, {
              obligation: { ...obligation, recurrenceMonths: null, completedOn: "2026-09-20" },
            })
          : entityRecordApi(call),
    });
    renderAt("/entities/e1/obligations");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark complete" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark complete" });
    await user.click(within(dialog).getByRole("button", { name: "Mark complete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(`Completed ${formatFullDate("2026-09-20")}`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Actions for Annual return" }),
    ).not.toBeInTheDocument();
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
