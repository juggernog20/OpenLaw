// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Tasks through the real record route (MTR-005, #492). */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

afterEach(cleanup);

const MEMBER = {
  id: "member",
  email: "member@example.com",
  displayName: "Mina Member",
  role: "legal_team_member",
  timezone: "UTC",
};
const CONTRIBUTOR = {
  id: "contributor",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
  timezone: "UTC",
};
const TEAMMATE = {
  id: "teammate",
  displayName: "Taylor Teammate",
  image: null,
  archived: false,
  role: "member",
};

function matter(overrides: Record<string, unknown> = {}) {
  return {
    id: "matter-12",
    number: 12,
    title: "Regulatory response",
    description: null,
    matterTypeId: "type-general",
    matterTypeName: "General",
    statusId: "status-open",
    statusName: "Open",
    statusCategory: "open",
    manager: { ...MEMBER, image: null, archived: false },
    priority: "medium",
    risk: null,
    customFields: {},
    openedAt: "2026-08-20T08:00:00.000Z",
    closedAt: null,
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-20T08:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.000Z",
    nextDeadline: null,
    ...overrides,
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Draft response",
    isDone: false,
    assigneeId: null,
    assigneeName: null,
    dueDate: null,
    displayOrder: 0,
    ...overrides,
  };
}

function recordApi(
  initial: Record<string, unknown>[] = [],
  row: Record<string, unknown> = matter(),
) {
  let tasks = initial;
  const writes: { method: string; path: string; body: unknown }[] = [];
  const envelope = (status = 200) =>
    json(status, {
      tasks,
      doneCount: tasks.filter((entry) => entry.isDone).length,
      totalCount: tasks.length,
    });
  return {
    writes,
    handler(call: StubCall) {
      if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET") {
        return json(200, {
          matter: row,
          fields: [],
          customFieldRefs: { users: [], entities: [] },
          team: [TEAMMATE],
        });
      }
      if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET") {
        return json(200, {
          matterTypes: [
            { id: "type-general", slug: "general", displayName: "General", fields: [] },
          ],
          matterStatuses: [
            { id: "status-open", slug: "open", displayName: "Open", category: "open" },
          ],
          users: [
            {
              id: "outsider",
              displayName: "Olivia Outsider",
              image: null,
              archived: false,
              role: "legal_team_member",
            },
            { ...MEMBER, image: null, archived: false },
            { ...TEAMMATE, role: "legal_team_member" },
          ],
        });
      }
      if (call.url.pathname === "/api/v1/matters/12/tasks" && call.method === "GET") {
        return envelope();
      }
      if (call.url.pathname === "/api/v1/matters/12/tasks" && call.method === "POST") {
        const body = call.body as Record<string, unknown>;
        writes.push({ method: call.method, path: call.url.pathname, body });
        tasks = [
          ...tasks,
          task({
            id: `task-${tasks.length + 1}`,
            ...body,
            assigneeName: body.assigneeId === TEAMMATE.id ? TEAMMATE.displayName : null,
            displayOrder: tasks.length,
          }),
        ];
        return envelope(201);
      }
      if (call.url.pathname === "/api/v1/matters/12/tasks/reorder" && call.method === "PUT") {
        const body = call.body as { taskIds: string[] };
        writes.push({ method: call.method, path: call.url.pathname, body });
        tasks = body.taskIds.map((id, displayOrder) => ({
          ...tasks.find((entry) => entry.id === id)!,
          displayOrder,
        }));
        return envelope();
      }
      const one = /^\/api\/v1\/matter-tasks\/([^/]+)$/.exec(call.url.pathname);
      if (one && call.method === "PATCH") {
        const body = call.body as Record<string, unknown>;
        writes.push({ method: call.method, path: call.url.pathname, body });
        tasks = tasks.map((entry) => (entry.id === one[1] ? { ...entry, ...body } : entry));
        return envelope();
      }
      if (one && call.method === "DELETE") {
        writes.push({ method: call.method, path: call.url.pathname, body: null });
        tasks = tasks.filter((entry) => entry.id !== one[1]);
        return envelope();
      }
      const toggle = /^\/api\/v1\/matter-tasks\/([^/]+)\/toggle$/.exec(call.url.pathname);
      if (toggle && call.method === "POST") {
        writes.push({ method: call.method, path: call.url.pathname, body: null });
        tasks = tasks.map((entry) =>
          entry.id === toggle[1] ? { ...entry, isDone: !entry.isDone } : entry,
        );
        return envelope();
      }
      return undefined;
    },
  };
}

const section = async () => within(await screen.findByRole("region", { name: "Tasks" }));

describe("the Matter record's Tasks section", () => {
  it("draws the empty checklist and its completed/total count", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/matters/12/tasks");
    const card = await section();
    expect(card.getByText("No Tasks on this Matter yet.")).toBeInTheDocument();
    expect(card.getByRole("img", { name: "0 Tasks" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Add Task" })).toBeInTheDocument();
  });

  it("adds and renders an assigned, date-only Task", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/matters/12/tasks");
    const user = userEvent.setup();
    await user.click((await section()).getByRole("button", { name: "Add Task" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Title"), "Prepare exhibits");
    await user.click(dialog.getByLabelText("Assignee"));
    await user.click(
      within(screen.getByRole("dialog", { name: "Assign task" })).getByRole("button", {
        name: TEAMMATE.displayName,
      }),
    );
    await user.type(dialog.getByLabelText("Due date (optional)"), "2030-01-02");
    await user.click(dialog.getByRole("button", { name: "Add Task" }));
    const row = (await section()).getByRole("listitem");
    expect(row).toHaveTextContent("Prepare exhibits");
    expect(row).toHaveTextContent("Taylor Teammate");
    expect(row).toHaveTextContent("Due");
    expect(api.writes[0]).toMatchObject({
      method: "POST",
      body: { title: "Prepare exhibits", assigneeId: TEAMMATE.id, dueDate: "2030-01-02" },
    });
  });

  it("completes, reorders, edits, and removes Tasks through their routed controls", async () => {
    const api = recordApi([
      task(),
      task({ id: "task-2", title: "File response", displayOrder: 1 }),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/matters/12/tasks");
    const user = userEvent.setup();
    const card = await section();
    await user.click(card.getByRole("checkbox", { name: "Complete Task: Draft response" }));
    expect(await card.findByText("1 of 2 done")).toBeInTheDocument();

    await user.click(card.getByRole("button", { name: "Actions for Draft response" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move down" }));
    await waitFor(() => {
      expect(card.getAllByRole("listitem")[0] as HTMLElement).toHaveTextContent("File response");
    });

    await user.click(card.getByRole("button", { name: "Actions for Draft response" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit Task" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.clear(dialog.getByLabelText("Title"));
    await user.type(dialog.getByLabelText("Title"), "Draft final response");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(await card.findByText("Draft final response")).toBeInTheDocument();

    await user.click(card.getByRole("button", { name: "Actions for File response" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove Task" }));
    await waitFor(() => expect(card.queryByText("File response")).not.toBeInTheDocument());
    expect(api.writes.map((write) => write.method)).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
  });

  it("changes and clears a task assignee without changing the Matter Manager", async () => {
    const api = recordApi([task({ assigneeId: MEMBER.id })]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/matters/12/tasks");
    const user = userEvent.setup();
    const card = await section();
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft response: Mina Member" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Search people" }), "Taylor");
    await user.click(screen.getByRole("button", { name: TEAMMATE.displayName }));
    expect(
      await card.findByRole("button", {
        name: "Change assignee for Draft response: Taylor Teammate",
      }),
    ).toBeInTheDocument();
    expect(api.writes.at(-1)).toMatchObject({
      method: "PATCH",
      path: "/api/v1/matter-tasks/task-1",
      body: { assigneeId: TEAMMATE.id },
    });
    expect(api.writes.at(-1)?.body).toEqual({ assigneeId: TEAMMATE.id });
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft response: Taylor Teammate" }),
    );
    await user.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(
      await card.findByRole("button", { name: "Change assignee for Draft response: Unassigned" }),
    ).toBeInTheDocument();
    expect(api.writes.at(-1)?.body).toEqual({ assigneeId: null });
  });

  it("gives a Contributor the assigned checklist and no mutation controls", async () => {
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: recordApi([task({ assigneeId: TEAMMATE.id, assigneeName: TEAMMATE.displayName })])
        .handler,
    });
    renderAt("/matters/12/tasks");
    const card = await section();
    expect(card.getByText("Draft response")).toBeInTheDocument();
    expect(card.getByText("Taylor Teammate")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Add Task" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(card.getByRole("checkbox")).toBeDisabled();
  });
});

describe("team-first task picker", () => {
  it("requires confirmation before adding someone, then includes them in the team choices", async () => {
    const api = recordApi([task()]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/matters/12/tasks");
    const user = userEvent.setup();
    const card = within(await screen.findByRole("region", { name: "Tasks" }));
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft response: Unassigned" }),
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
        name: "Change assignee for Draft response: Olivia Outsider",
      }),
    );
    expect(api.writes).toEqual([
      {
        method: "PATCH",
        path: "/api/v1/matter-tasks/task-1",
        body: { assigneeId: "outsider", addToTeam: true },
      },
    ]);
    picker = within(screen.getByRole("dialog", { name: "Assign task" }));
    expect(picker.getByRole("button", { name: "Olivia Outsider" })).toBeInTheDocument();
  });

  it("does not offer team expansion to someone who cannot manage the confidential audience", async () => {
    const api = recordApi([task()], matter({ isConfidential: true, manager: null }));
    stubApi({ signedIn: { ...MEMBER, id: "ordinary-member" }, extra: api.handler });
    renderAt("/matters/12/tasks");
    const user = userEvent.setup();
    const card = within(await screen.findByRole("region", { name: "Tasks" }));
    await user.click(
      card.getByRole("button", { name: "Change assignee for Draft response: Unassigned" }),
    );
    const picker = within(screen.getByRole("dialog", { name: "Assign task" }));
    expect(
      picker.queryByRole("button", { name: "Add someone to the team…" }),
    ).not.toBeInTheDocument();
  });
});
