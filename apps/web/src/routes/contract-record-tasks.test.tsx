// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record's Tasks section (M17/1, CTR-017) at `/contracts/42/tasks`,
 * through the real route table with the standard fetch stub.
 *
 * What the section draws: the checklist — rows with a toggle, done
 * count, and empty state. What it offers: "Add task", the row's own
 * edit and remove, and the checkbox toggle. What it must not offer on a
 * read-only or archived record is asserted just as hard.
 */

import { describe, expect, it } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

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

const PEOPLE = [
  {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    archived: false,
    role: "legal_team_member",
  },
  {
    id: "outsider",
    displayName: "Olivia Outsider",
    image: null,
    archived: false,
    role: "legal_team_member",
  },
];

const OPTIONS = {
  contractTypes: [{ id: "t-msa", slug: "msa", displayName: "MSA", fields: [] }],
  contractStatuses: [{ id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" }],
  users: PEOPLE,
  approverGroups: [],
};

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-draft",
    statusName: "Draft",
    stage: "draft",
    manager: null,
    entity: null,
    primaryCounterparty: null,
    priority: "medium",
    risk: null,
    value: null,
    termType: "auto_renew",
    effectiveDate: "2026-01-01",
    expiryDate: "2026-12-31",
    renewalPeriodMonths: 12,
    noticePeriodDays: 90,
    noticeDeadline: "2026-10-02",
    daysRemaining: 120,
    renewalPendingConfirmation: false,
    proposedRenewalExpiry: null,
    description: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    title: "Draft the NDA",
    isDone: false,
    assigneeId: null,
    dueDate: null,
    displayOrder: 0,
    ...overrides,
  };
}

const CHECKLIST = [
  task(),
  task({ id: "t-2", title: "Review redline", isDone: true, displayOrder: 1 }),
  task({ id: "t-3", title: "Sign the NDA", dueDate: "2027-06-01", displayOrder: 2 }),
];

function recordApi(
  initial: Record<string, unknown>[] = [],
  row: Record<string, unknown> = contractRow(),
) {
  let tasks = initial;
  const writes: { method: string; path: string; body: unknown }[] = [];
  let refuse: { status: number; detail: string } | null = null;

  const envelope = () =>
    json(200, {
      tasks,
      doneCount: tasks.filter((t: Record<string, unknown>) => t.isDone).length,
      totalCount: tasks.length,
    });

  const handler = (call: StubCall) => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, {
        contract: row,
        fields: [],
        customFieldRefs: { users: [], entities: [] },
        team: [{ ...PEOPLE[0], role: "creator" }],
        counterparties: [],
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/key-dates" && call.method === "GET") {
      return json(200, { deadlines: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42/tasks" && call.method === "GET") {
      return envelope();
    }
    if (call.url.pathname === "/api/v1/contracts/42/tasks" && call.method === "POST") {
      writes.push({ method: "POST", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      const body = call.body as {
        title: string;
        assigneeId?: string | null;
        dueDate?: string | null;
      };
      tasks = [
        ...tasks,
        task({ id: `t-new-${tasks.length}`, ...body, displayOrder: tasks.length }),
      ];
      return json(201, {
        tasks,
        doneCount: tasks.filter((t: Record<string, unknown>) => t.isDone).length,
        totalCount: tasks.length,
      });
    }
    const one = /^\/api\/v1\/tasks\/([^/]+)$/.exec(call.url.pathname);
    if (one && call.method === "PATCH") {
      writes.push({ method: "PATCH", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      const body = call.body as Record<string, unknown>;
      tasks = tasks.map((entry) =>
        (entry as Record<string, unknown>).id === one[1] ? { ...entry, ...body } : entry,
      );
      return envelope();
    }
    if (one && call.method === "DELETE") {
      writes.push({ method: "DELETE", path: call.url.pathname, body: null });
      if (refuse) return problem(refuse.status, refuse.detail);
      tasks = tasks.filter((entry) => (entry as Record<string, unknown>).id !== one[1]);
      return envelope();
    }
    const toggle = /^\/api\/v1\/tasks\/([^/]+)\/toggle$/.exec(call.url.pathname);
    if (toggle && call.method === "POST") {
      writes.push({ method: "POST", path: call.url.pathname, body: null });
      if (refuse) return problem(refuse.status, refuse.detail);
      tasks = tasks.map((entry) => {
        const e = entry as Record<string, unknown>;
        return e.id === toggle[1] ? { ...entry, isDone: !e.isDone } : entry;
      });
      return envelope();
    }
    return undefined;
  };
  return {
    handler,
    writes,
    refuseNext: (status: number, detail: string) => {
      refuse = { status, detail };
    },
  };
}

const section = async () => within(await screen.findByRole("region", { name: "Tasks" }));

describe("the record's Tasks section (CTR-017)", () => {
  it("assigns and unassigns directly on the row, persisting only the task's assignee", async () => {
    const api = recordApi([task()]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42/tasks");
    const user = userEvent.setup();
    const card = await section();
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Unassigned" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Search people" }), "Nadia");
    await user.click(
      within(screen.getByRole("dialog", { name: "Assign task" })).getByRole("button", {
        name: MEMBER.displayName,
      }),
    );
    expect(
      await card.findByRole("button", { name: "Change assignee for Draft the NDA: Nadia Counsel" }),
    ).toBeInTheDocument();
    expect(api.writes.at(-1)).toEqual({
      method: "PATCH",
      path: "/api/v1/tasks/t-1",
      body: { assigneeId: MEMBER.id },
    });
    await act(() => router.revalidate());
    expect(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Nadia Counsel" }),
    ).toBeInTheDocument();
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Nadia Counsel" }),
    );
    await user.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(
      await card.findByRole("button", { name: "Change assignee for Draft the NDA: Unassigned" }),
    ).toBeInTheDocument();
    expect(api.writes.at(-1)?.body).toEqual({ assigneeId: null });
  });

  it("keeps the existing assignee and the picker open when saving fails", async () => {
    const api = recordApi([task({ assigneeId: MEMBER.id })]);
    api.refuseNext(503, "Assignment could not be saved.");
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");
    const user = userEvent.setup();
    const card = await section();
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Nadia Counsel" }),
    );
    await user.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Assignment could not be saved.");
    expect(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Nadia Counsel" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Assign task" })).toBeInTheDocument();
  });

  it("collects an assignee when adding a task", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");
    const user = userEvent.setup();
    await user.click((await section()).getByRole("button", { name: "Add task" }));
    const form = within(screen.getByRole("dialog", { name: "Add a task" }));
    await user.type(form.getByLabelText("Title"), "Draft strategy");
    await user.click(form.getByLabelText("Assignee"));
    await user.click(
      within(screen.getByRole("dialog", { name: "Assign task" })).getByRole("button", {
        name: MEMBER.displayName,
      }),
    );
    await user.click(form.getByRole("button", { name: "Add task" }));
    expect(
      await (
        await section()
      ).findByRole("button", { name: "Change assignee for Draft strategy: Nadia Counsel" }),
    ).toBeInTheDocument();
    expect(api.writes[0]?.body).toMatchObject({ title: "Draft strategy", assigneeId: MEMBER.id });
  });

  it("draws the checklist with done count", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(CHECKLIST).handler });
    renderAt("/contracts/42/tasks");

    const card = await section();
    const items = card.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Draft the NDA");
    expect(items[1]).toHaveTextContent("Review redline");
    expect(items[2]).toHaveTextContent("Sign the NDA");

    expect(card.getByRole("img", { name: "3 tasks" })).toBeInTheDocument();
    expect(card.getByText("1 of 3 done")).toBeInTheDocument();

    // The tab chip counts open work, not the whole checklist.
    const strip = within(screen.getByRole("navigation", { name: "Contract sections" }));
    expect(strip.getByRole("img", { name: "2 open tasks" })).toBeInTheDocument();
  });

  it("shows the due date on a task that has one", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(CHECKLIST).handler });
    renderAt("/contracts/42/tasks");

    const card = await section();
    const items = card.getAllByRole("listitem");
    // The third task has a due date.
    expect(items[2]).toHaveTextContent("Due");
  });

  it("draws the section's own empty line when the record has no tasks", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi([]).handler });
    renderAt("/contracts/42/tasks");

    const card = await section();
    expect(card.getByText("No tasks on this contract yet.")).toBeInTheDocument();
    expect(card.queryByRole("list")).not.toBeInTheDocument();
    expect(card.getByRole("img", { name: "0 tasks" })).toBeInTheDocument();
  });

  it("adds a task and redraws the checklist the write answers with", async () => {
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add task" }));

    await user.type(screen.getByLabelText("Title"), "Draft the brief");
    await user.click(screen.getByRole("button", { name: "Add task", hidden: false }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "POST",
      body: { title: "Draft the brief" },
    });
    const card = await section();
    expect(card.getByText("Draft the brief")).toBeInTheDocument();
  });

  it("refuses to send a task with no title, and says so in the dialog", async () => {
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.click(screen.getByRole("button", { name: "Add task", hidden: false }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Name what needs doing.");
    expect(api.writes).toHaveLength(0);
    const title = screen.getByLabelText("Title");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAttribute("aria-describedby", alert.id);
  });

  it("prints the seam's refusal in the dialog and keeps it open", async () => {
    const api = recordApi([]);
    api.refuseNext(409, "This contract is archived. Restore it before changing its tasks.");
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add task" }));
    await user.type(screen.getByLabelText("Title"), "Draft the brief");
    await user.click(screen.getByRole("button", { name: "Add task", hidden: false }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This contract is archived. Restore it before changing its tasks.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits a task from its own row, seeded with what the record holds", async () => {
    const api = recordApi(CHECKLIST);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");

    const user = userEvent.setup();
    const card = await section();
    await user.click(card.getByRole("button", { name: "Actions for Draft the NDA" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit task" }));

    expect(screen.getByLabelText("Title")).toHaveValue("Draft the NDA");

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Draft the brief");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "PATCH",
      path: "/api/v1/tasks/t-1",
      body: { title: "Draft the brief" },
    });
  });

  it("toggles a task from the checkbox", async () => {
    const api = recordApi(CHECKLIST);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");

    const user = userEvent.setup();
    const card = await section();
    const checkbox = card.getByRole("checkbox", { name: /Complete task: Draft the NDA/ });
    await user.click(checkbox);

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/tasks/t-1/toggle",
    });
  });

  it("removes a task in one press, with no confirmation to read", async () => {
    const api = recordApi(CHECKLIST);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");

    const user = userEvent.setup();
    const card = await section();
    await user.click(card.getByRole("button", { name: "Actions for Draft the NDA" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove task" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ method: "DELETE", path: "/api/v1/tasks/t-1" });
    await waitFor(() => expect(screen.queryByText("Draft the NDA")).not.toBeInTheDocument());
  });

  it("gives a read-only viewer the checklist and no control on it", async () => {
    stubApi({ signedIn: CONTRIBUTOR, extra: recordApi(CHECKLIST).handler });
    renderAt("/contracts/42/tasks");

    const card = await section();
    expect(card.getByText("Draft the NDA")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it("freezes every control on an archived record", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(CHECKLIST, contractRow({ archivedAt: "2026-08-02T00:00:00.000Z" })).handler,
    });
    renderAt("/contracts/42/tasks");

    const card = await section();
    expect(card.getByText("Draft the NDA")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });
});

describe("team-first task picker", () => {
  it("requires confirmation before adding someone, then includes them in the team choices", async () => {
    const api = recordApi([task()]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/tasks");
    const user = userEvent.setup();
    const card = within(await screen.findByRole("region", { name: "Tasks" }));
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Unassigned" }),
    );
    let picker = within(screen.getByRole("dialog", { name: "Assign task" }));
    expect(picker.queryByRole("button", { name: "Olivia Outsider" })).not.toBeInTheDocument();
    await user.click(picker.getByRole("button", { name: "Add someone to the team…" }));
    await user.type(picker.getByRole("textbox", { name: "Search people" }), "Olivia");
    await user.click(picker.getByRole("button", { name: "Olivia Outsider" }));
    expect(api.writes).toHaveLength(0);
    expect(picker.getByText(/gain access to this record/)).toBeInTheDocument();
    await user.click(picker.getByRole("button", { name: "Back" }));
    expect(api.writes).toHaveLength(0);
    await user.click(picker.getByRole("button", { name: "Olivia Outsider" }));
    await user.click(picker.getByRole("button", { name: "Add to team and assign" }));
    await user.click(
      await card.findByRole("button", {
        name: "Change assignee for Draft the NDA: Olivia Outsider",
      }),
    );
    expect(api.writes).toEqual([
      {
        method: "PATCH",
        path: "/api/v1/tasks/t-1",
        body: { assigneeId: "outsider", addToTeam: true },
      },
    ]);
    picker = within(screen.getByRole("dialog", { name: "Assign task" }));
    expect(picker.getByRole("button", { name: "Olivia Outsider" })).toBeInTheDocument();
  });

  it("does not offer team expansion to someone who cannot manage the confidential audience", async () => {
    const api = recordApi([task()], contractRow({ isConfidential: true, manager: null }));
    stubApi({ signedIn: { ...MEMBER, id: "ordinary-member" }, extra: api.handler });
    renderAt("/contracts/42/tasks");
    const user = userEvent.setup();
    const card = within(await screen.findByRole("region", { name: "Tasks" }));
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft the NDA: Unassigned" }),
    );
    const picker = within(screen.getByRole("dialog", { name: "Assign task" }));
    expect(
      picker.queryByRole("button", { name: "Add someone to the team…" }),
    ).not.toBeInTheDocument();
  });
});

it("stages new team membership until Save and discards it on Cancel", async () => {
  const api = recordApi();
  stubApi({ signedIn: MEMBER, extra: api.handler });
  renderAt("/contracts/42/tasks");
  const user = userEvent.setup();
  const card = await section();
  await user.click(card.getByRole("button", { name: "Add task" }));
  const form = within(screen.getByRole("dialog", { name: "Add a task" }));
  await user.type(form.getByLabelText("Title"), "Draft strategy");
  await user.click(form.getByLabelText("Assignee"));
  const picker = within(screen.getByRole("dialog", { name: "Assign task" }));
  await user.click(picker.getByRole("button", { name: "Add someone to the team…" }));
  await user.click(picker.getByRole("button", { name: "Olivia Outsider" }));
  await user.click(picker.getByRole("button", { name: "Use this person" }));
  expect(api.writes).toHaveLength(0);
  expect(form.getByText(/saved when you save the task/)).toBeInTheDocument();
  await user.click(form.getByRole("button", { name: "Cancel" }));
  expect(api.writes).toHaveLength(0);
  await user.click(card.getByRole("button", { name: "Add task" }));
  expect(screen.getByLabelText("Assignee")).toHaveTextContent("Unassigned");
});
