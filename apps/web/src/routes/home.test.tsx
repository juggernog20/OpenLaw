// SPDX-License-Identifier: AGPL-3.0-only

/** The M29 Home surface through the real route table and standard fetch stub. */
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { json, problem, renderAt, stubApi, stubEventSource } from "../testing/helpers";
import { formatDeadline } from "../lib/format";

function finishTaskAnimation(row: HTMLElement) {
  // Without AnimationEvent, React selects jsdom's WebKit event name.
  const type = "AnimationEvent" in window ? "animationend" : "webkitAnimationEnd";
  fireEvent(row, new Event(type, { bubbles: true }));
}

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

const approvalSection = {
  type: "approvals",
  total: 5,
  rows: [
    {
      id: "approval-1",
      contract: {
        id: "contract-1",
        number: 42,
        title: "Meridian Bio supply agreement",
        isConfidential: true,
      },
      requestedBy: { id: "u7", displayName: "Priya Nair" },
      requestedAt: "2026-08-28T09:00:00.000Z",
    },
  ],
} as const;

const tasksSection = {
  type: "tasks",
  total: 4,
  rows: [
    {
      id: "contract-task-1",
      title: "Prepare financing signature pages",
      dueDate: "2000-01-01",
      isOverdue: true,
      record: {
        kind: "contract",
        id: "contract-1",
        number: 42,
        title: "Confidential financing",
        isConfidential: true,
      },
    },
    {
      id: "matter-task-1",
      title: "Review response exhibits",
      dueDate: "2099-01-01",
      isOverdue: false,
      record: {
        kind: "matter",
        id: "matter-1",
        number: 12,
        title: "Regulatory response",
        isConfidential: false,
      },
    },
    {
      id: "matter-task-2",
      title: "Confirm interview list",
      dueDate: null,
      isOverdue: false,
      record: {
        kind: "matter",
        id: "matter-2",
        number: 13,
        title: "Employment investigation",
        isConfidential: false,
      },
    },
  ],
} as const;

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const noticeDate = inDays(7);
const matterDate = inDays(10);

const datesSection = {
  type: "dates",
  total: 6,
  rows: [
    {
      source: "notice_deadline",
      keyDateId: null,
      date: noticeDate,
      label: null,
      noticePeriodDays: 30,
      unverified: true,
      record: {
        kind: "contract",
        id: "contract-1",
        number: 42,
        title: "Confidential supplier renewal",
        isConfidential: true,
      },
    },
    {
      source: "key_date",
      keyDateId: "matter-date-1",
      date: matterDate,
      label: "Response filing deadline",
      noticePeriodDays: null,
      unverified: false,
      record: {
        kind: "matter",
        id: "matter-1",
        number: 12,
        title: "Regulatory response",
        isConfidential: false,
      },
    },
    {
      source: "expiry",
      keyDateId: null,
      date: inDays(12),
      label: null,
      noticePeriodDays: null,
      unverified: false,
      record: {
        kind: "contract",
        id: "contract-2",
        number: 43,
        title: "Nimbus pilot agreement",
        isConfidential: false,
      },
    },
  ],
} as const;

const obligationsSection = {
  type: "obligations",
  total: 6,
  rows: [
    {
      id: "obligation-1",
      label: "Delaware annual report",
      dueDate: "2000-01-01",
      isOverdue: true,
      isUnassigned: false,
      entity: { id: "entity-1", legalName: "Alderidge Holdings Ltd" },
    },
    {
      id: "obligation-2",
      label: "Trade licence renewal",
      dueDate: "2099-09-30",
      isOverdue: false,
      isUnassigned: true,
      entity: { id: "entity-2", legalName: "Alderidge MENA Ltd" },
    },
  ],
} as const;

const inboxSection = {
  type: "inbox",
  total: 5,
  rows: [
    {
      id: "request-1",
      number: 1042,
      summary: "Data processing addendum review",
      urgency: "high",
      requestType: { id: "type-1", displayName: "Sales" },
      requester: { id: "user-1", displayName: "Priya Nair" },
      createdAt: "2026-08-28T09:00:00.000Z",
    },
  ],
} as const;

const contractDate = inDays(14);
const contractsSection = {
  type: "contracts",
  total: 7,
  rows: [
    {
      id: "contract-portfolio-1",
      number: 501,
      title: "Confidential acquisition agreement",
      isConfidential: true,
      stage: "draft",
      nextDate: contractDate,
      renewalPendingConfirmation: false,
    },
    {
      id: "contract-portfolio-2",
      number: 502,
      title: "Supplier renewal",
      isConfidential: false,
      stage: "active",
      nextDate: null,
      renewalPendingConfirmation: true,
    },
  ],
} as const;

const matterDeadline = inDays(16);
const mattersSection = {
  type: "matters",
  total: 4,
  rows: [
    {
      id: "matter-portfolio-1",
      number: 91,
      title: "Confidential employment investigation",
      isConfidential: true,
      status: { id: "matter-status-open", displayName: "Open" },
      nextDeadline: { date: matterDeadline, label: "Response filing deadline" },
    },
    {
      id: "matter-portfolio-2",
      number: 92,
      title: "Board governance review",
      isConfidential: false,
      status: { id: "matter-status-progress", displayName: "In Progress" },
      nextDeadline: null,
    },
  ],
} as const;

describe("Home", () => {
  it("lands on the error boundary when the home read fails", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? problem(500, "Home could not be read.")
          : undefined,
    });
    renderAt("/");

    expect(
      await screen.findByRole("heading", { name: "Something went wrong." }),
    ).toBeInTheDocument();
  });

  it("renders the loader's Approvals card and links each row to the Contract section", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [approvalSection] })
          : undefined,
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Approvals waiting on you" });
    expect(within(card).getByText("5")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Meridian Bio supply agreement" }),
    ).toHaveAttribute("href", "/contracts/42/approvals");
    expect(within(card).getByText(/Requested by Priya Nair/)).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View all 5" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(screen.queryByText("Welcome to OpenLaw")).not.toBeInTheDocument();
  });

  it("omits an empty section and shows the all-empty welcome", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [] })
          : undefined,
    });
    renderAt("/");

    const welcomeHeading = await screen.findByRole("heading", { name: "Welcome to OpenLaw" });
    const welcome = welcomeHeading.closest("section");
    expect(welcome).not.toBeNull();
    expect(within(welcome!).getByText(/contracts, matters/)).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Approvals waiting on you" }),
    ).not.toBeInTheDocument();
    expect(within(welcome!).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(within(welcome!).getByRole("link", { name: "Matters" })).toHaveAttribute(
      "href",
      "/matters",
    );
  });

  it("renders the merged Tasks card with record links, due dates, severe, and CONFI markers", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [tasksSection] })
          : undefined,
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Tasks assigned to you" });
    expect(within(card).getByText("4")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View all 4" })).toHaveAttribute(
      "href",
      "/home/tasks",
    );

    const contractTask = within(card).getByText("Prepare financing signature pages");
    expect(contractTask.closest("a")).toHaveAttribute("href", "/contracts/42/tasks");
    expect(within(card).getByText(/Confidential financing · Contract C-42/)).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    expect(within(card).getByText("Overdue")).toBeInTheDocument();
    expect(within(card).getByText("Jan 1, 2000")).toHaveClass(
      "bg-status-severe-bg",
      "text-status-severe-fg",
    );

    const matterTask = within(card).getByText("Review response exhibits");
    expect(matterTask.closest("a")).toHaveAttribute("href", "/matters/12/tasks");
    expect(within(card).getByText(/Regulatory response · Matter M-12/)).toBeInTheDocument();
    expect(within(card).getByText("Jan 1, 2099")).toBeInTheDocument();
    expect(within(card).getByText("No due date")).toBeInTheDocument();
    expect(screen.queryByText("Welcome to OpenLaw")).not.toBeInTheDocument();
  });

  it("opens all assigned Tasks from Home, including the fourth Task, and returns Home", async () => {
    const user = userEvent.setup();
    const fourth = {
      ...tasksSection.rows[2],
      id: "fourth",
      title: "Follow up with external counsel",
    };
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/home") return json(200, { sections: [tasksSection] });
        if (call.url.pathname === "/api/v1/home/tasks")
          return json(200, {
            total: 4,
            rows: [...tasksSection.rows, fourth],
            nextCursor: null,
          });
        return undefined;
      },
    });
    renderAt("/");
    await user.click(await screen.findByRole("link", { name: "View all 4" }));
    await screen.findByRole("heading", { level: 1, name: "Your Tasks" });
    const card = await screen.findByRole("region", { name: "Tasks assigned to you" });
    expect(within(card).getAllByRole("listitem")).toHaveLength(4);
    expect(
      within(card).getByRole("link", { name: /Follow up with external counsel/ }),
    ).toHaveAttribute("href", "/matters/13/tasks");
    expect(screen.queryByRole("link", { name: "View all 4" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back to Home" }));
    expect(await screen.findByRole("link", { name: "View all 4" })).toBeInTheDocument();
  });

  it.each([
    ["Contract", tasksSection.rows[0], "/api/v1/tasks/contract-task-1/toggle"],
    ["Matter", tasksSection.rows[1], "/api/v1/matter-tasks/matter-task-1/toggle"],
  ] as const)(
    "completes a %s Task in place and updates the Home count",
    async (_kind, task, endpoint) => {
      const user = userEvent.setup();
      let done = false;
      let save: ((response: Response) => void) | undefined;
      const remaining = tasksSection.rows.filter((row) => row.id !== task.id);
      stubApi({
        signedIn: MEMBER,
        extra: (call) => {
          if (call.url.pathname === "/api/v1/home/tasks")
            return json(200, { total: 3, rows: tasksSection.rows, nextCursor: null });
          if (call.url.pathname === "/api/v1/home")
            return json(200, {
              sections: [
                {
                  ...tasksSection,
                  total: done ? 2 : 3,
                  rows: done ? remaining : tasksSection.rows,
                },
              ],
            });
          if (call.url.pathname === endpoint && call.method === "POST")
            return new Promise<Response>((resolve) => {
              save = resolve;
            });
          return undefined;
        },
      });
      const { router } = renderAt("/home/tasks");
      const checkbox = await screen.findByRole("checkbox", {
        name: `Complete Task: ${task.title}`,
      });
      await user.click(checkbox);
      expect(checkbox).toBeDisabled();
      expect(checkbox).toBeChecked();
      expect(screen.getByText(task.title)).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/home/tasks");
      done = true;
      await act(async () => {
        save!(json(200, { tasks: [{ id: task.id, isDone: true }], doneCount: 1, totalCount: 1 }));
      });
      expect(checkbox).toBeChecked();
      expect(checkbox.closest("li")).toHaveClass("home-task-exit");
      expect(screen.getByRole("checkbox", { name: `Complete Task: ${task.title}` })).toBe(checkbox);
      finishTaskAnimation(checkbox.closest("li")!);
      await waitFor(() =>
        expect(
          screen.queryByRole("checkbox", { name: `Complete Task: ${task.title}` }),
        ).not.toBeInTheDocument(),
      );
      const card = screen.getByRole("region", { name: "Tasks assigned to you" });
      expect(within(card).getAllByRole("listitem")).toHaveLength(2);
      expect(within(card).getByText("2")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(`Completed: ${task.title}`);
      await user.click(screen.getByRole("link", { name: "Back to Home" }));
      expect(await screen.findByRole("link", { name: "View all 2" })).toBeInTheDocument();
    },
  );

  it.each([
    ["Contract", tasksSection.rows[0], "/api/v1/tasks/contract-task-1/toggle"],
    ["Matter", tasksSection.rows[1], "/api/v1/matter-tasks/matter-task-1/toggle"],
  ] as const)(
    "undoes a %s completion after fading, restoring order and count",
    async (_kind, task, endpoint) => {
      const user = userEvent.setup();
      let writes = 0;
      stubApi({
        signedIn: MEMBER,
        extra: (call) => {
          if (call.url.pathname === "/api/v1/home/tasks")
            return json(200, { total: 3, rows: tasksSection.rows, nextCursor: null });
          if (call.url.pathname === endpoint && call.method === "POST") {
            writes += 1;
            return json(200, {
              tasks: [{ id: task.id, isDone: writes === 1 }],
              doneCount: writes === 1 ? 1 : 0,
              totalCount: 1,
            });
          }
          return undefined;
        },
      });
      renderAt("/home/tasks");
      const name = `Complete Task: ${task.title}`;
      await user.click(await screen.findByRole("checkbox", { name }));
      await screen.findByRole("button", { name: "Undo" });
      finishTaskAnimation(screen.getByRole("checkbox", { name }).closest("li")!);
      await waitFor(() => expect(screen.queryByRole("checkbox", { name })).not.toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(await screen.findByRole("checkbox", { name })).not.toBeChecked();
      const card = screen.getByRole("region", { name: "Tasks assigned to you" });
      expect(
        within(card)
          .getAllByRole("checkbox")
          .map((box) => box.getAttribute("aria-label")),
      ).toEqual(tasksSection.rows.map((row) => `Complete Task: ${row.title}`));
      expect(within(card).getByText("3")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(`Reopened: ${task.title}`);
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(writes).toBe(2);
    },
  );

  it("allows Undo during the checkmark hold without removing the restored row later", async () => {
    const user = userEvent.setup();
    const task = tasksSection.rows[0];
    let writes = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/home/tasks")
          return json(200, { total: 1, rows: [task], nextCursor: null });
        if (call.url.pathname === `/api/v1/tasks/${task.id}/toggle` && call.method === "POST") {
          writes += 1;
          return json(200, {
            tasks: [{ id: task.id, isDone: writes === 1 }],
            doneCount: writes === 1 ? 1 : 0,
            totalCount: 1,
          });
        }
        return undefined;
      },
    });
    renderAt("/home/tasks");
    const checkbox = await screen.findByRole("checkbox", { name: `Complete Task: ${task.title}` });
    await user.click(checkbox);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(checkbox).not.toBeChecked());
    finishTaskAnimation(checkbox.closest("li")!);
    expect(checkbox).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Tasks assigned to you" })).getByText("1"),
    ).toBeInTheDocument();
  });

  it("keeps Undo available after a failed reopen and retries without changing the count", async () => {
    const user = userEvent.setup();
    const task = tasksSection.rows[0];
    let writes = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/home/tasks")
          return json(200, { total: 1, rows: [task], nextCursor: null });
        if (call.url.pathname === `/api/v1/tasks/${task.id}/toggle` && call.method === "POST") {
          writes += 1;
          if (writes === 2) return problem(503, "Unavailable");
          return json(200, {
            tasks: [{ id: task.id, isDone: writes === 1 }],
            doneCount: writes === 1 ? 1 : 0,
            totalCount: 1,
          });
        }
        return undefined;
      },
    });
    renderAt("/home/tasks");
    const name = `Complete Task: ${task.title}`;
    await user.click(await screen.findByRole("checkbox", { name }));
    await screen.findByRole("button", { name: "Undo" });
    finishTaskAnimation(screen.getByRole("checkbox", { name }).closest("li")!);
    await screen.findByText("No open Tasks assigned to you.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The Task could not be reopened");
    expect(screen.queryByRole("checkbox", { name })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("checkbox", { name })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a failed completion available for retry and shows the empty state after success", async () => {
    const user = userEvent.setup();
    const task = tasksSection.rows[0];
    let fail = true;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/home/tasks")
          return json(200, { total: 1, rows: [task], nextCursor: null });
        if (call.url.pathname === `/api/v1/tasks/${task.id}/toggle` && call.method === "POST")
          return fail
            ? problem(409, "Task unavailable")
            : json(200, { tasks: [{ id: task.id, isDone: true }], doneCount: 1, totalCount: 1 });
        return undefined;
      },
    });
    renderAt("/home/tasks");
    const checkbox = await screen.findByRole("checkbox", { name: `Complete Task: ${task.title}` });
    await user.click(checkbox);
    expect(await screen.findByRole("alert")).toHaveTextContent("The Task could not be marked done");
    expect(checkbox).toBeEnabled();
    expect(checkbox).not.toBeChecked();
    fail = false;
    await user.click(checkbox);
    await screen.findByRole("button", { name: "Undo" });
    finishTaskAnimation(checkbox.closest("li")!);
    expect(await screen.findByText("No open Tasks assigned to you.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps assigned Task links read-only for a Contributor", async () => {
    stubApi({
      signedIn: { ...MEMBER, role: "contributor" },
      extra: (call) =>
        call.url.pathname === "/api/v1/home/tasks"
          ? json(200, { total: 3, rows: tasksSection.rows, nextCursor: null })
          : undefined,
    });
    renderAt("/home/tasks");
    expect(
      await screen.findByRole("link", { name: /Prepare financing signature pages/ }),
    ).toHaveAttribute("href", "/contracts/42/tasks");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("retains loaded Tasks on a paging failure and allows retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/home/tasks") return undefined;
        if (!call.url.searchParams.has("cursor"))
          return json(200, {
            total: 3,
            rows: tasksSection.rows.slice(0, 2),
            nextCursor: "page-two",
          });
        expect(call.url.searchParams.get("cursor")).toBe("page-two");
        if (fail) return problem(500, "Unavailable");
        return json(200, { total: 3, rows: tasksSection.rows.slice(2), nextCursor: null });
      },
    });
    renderAt("/home/tasks");
    await user.click(await screen.findByRole("button", { name: "Load more Tasks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("More Tasks could not be loaded");
    expect(screen.getByText("Prepare financing signature pages")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Load more Tasks" }));
    expect(await screen.findByText("Confirm interview list")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more Tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an empty personal Tasks page for a Contributor with no open Tasks", async () => {
    stubApi({
      signedIn: { ...MEMBER, role: "contributor" },
      extra: (call) =>
        call.url.pathname === "/api/v1/home/tasks"
          ? json(200, { total: 0, rows: [], nextCursor: null })
          : undefined,
    });
    renderAt("/home/tasks");
    expect(await screen.findByText("No open Tasks assigned to you.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/");
  });

  it("renders Dates with DES-042 names, DES-014 dates, record links, and CONFI", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [datesSection] })
          : undefined,
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Dates approaching" });
    expect(within(card).getByText("6")).toBeInTheDocument();

    const notice = within(card).getByText("Renewal notice deadline — 30 days before expiry");
    expect(notice.closest("a")).toHaveAttribute("href", "/contracts/42/key-dates");
    expect(within(card).getByText(/Confidential supplier renewal/)).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    expect(within(notice.closest("a")!).getByText("Derived")).toBeInTheDocument();
    expect(within(notice.closest("a")!).getByText("Unverified")).toBeInTheDocument();
    expect(within(notice.closest("a")!).getByText(formatDeadline(noticeDate))).toBeInTheDocument();

    const matter = within(card).getByText("Response filing deadline");
    expect(matter.closest("a")).toHaveAttribute("href", "/matters/12/key-dates");
    expect(within(matter.closest("a")!).getByText("Key date")).toBeInTheDocument();
    expect(within(matter.closest("a")!).queryByText("Unverified")).not.toBeInTheDocument();
    expect(within(matter.closest("a")!).getByText(/Regulatory response/)).toBeInTheDocument();

    const expiry = within(card).getByText("Current term expires");
    expect(expiry.closest("a")).toHaveAttribute("href", "/contracts/43/key-dates");
    expect(within(expiry.closest("a")!).queryByText("Unverified")).not.toBeInTheDocument();
  });

  it("renders Entity obligations with the severe and unassigned markers", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [obligationsSection] })
          : undefined,
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Entity obligations" });
    expect(within(card).getByText("6")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Delaware annual report/ })).toHaveAttribute(
      "href",
      "/entities/entity-1/obligations",
    );
    expect(within(card).getByText("Jan 1, 2000")).toHaveClass(
      "bg-status-severe-bg",
      "text-status-severe-fg",
    );
    expect(within(card).getByText("Unassigned")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View all 6" })).toHaveAttribute(
      "href",
      "/entities",
    );
  });

  it("renders Inbox pressure with Request rows and routes triage through the Inbox", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [inboxSection] })
          : undefined,
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Inbox" });
    expect(within(card).getByText("5")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /Data processing addendum review/ }),
    ).toHaveAttribute("href", "/inbox/1042");
    expect(within(card).getByText(/R-1042 · Sales · Priya Nair/)).toBeInTheDocument();
    expect(within(card).getByText("High urgency")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View all 5" })).toHaveAttribute(
      "href",
      "/inbox",
    );
  });

  it("patches a drawn Inbox count from its live frame without re-reading Home", async () => {
    const sources = stubEventSource();
    let homeReads = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/home" || call.method !== "GET") return undefined;
        homeReads += 1;
        return json(200, { sections: [inboxSection] });
      },
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Inbox" });
    expect(homeReads).toBe(1);
    expect(within(card).getByRole("link", { name: "View all 5" })).toBeInTheDocument();

    act(() => sources[0]!.emit({ kind: "inbox", total: 6 }));

    expect(await within(card).findByRole("link", { name: "View all 6" })).toBeInTheDocument();
    expect(within(card).getByText("6")).toBeInTheDocument();
    expect(within(card).getByText("Data processing addendum review")).toBeInTheDocument();
    expect(homeReads).toBe(1);
  });

  it("ignores an Inbox frame while the card is absent", async () => {
    const sources = stubEventSource();
    let sections: readonly object[] = [];
    let homeReads = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/home" || call.method !== "GET") return undefined;
        homeReads += 1;
        return json(200, { sections });
      },
    });
    const { router } = renderAt("/");

    expect(await screen.findByRole("heading", { name: "Welcome to OpenLaw" })).toBeInTheDocument();
    act(() => sources[0]!.emit({ kind: "inbox", total: 1 }));

    expect(screen.queryByRole("region", { name: "Inbox" })).not.toBeInTheDocument();
    expect(homeReads).toBe(1);

    sections = [{ ...inboxSection, total: 1 }];
    await act(() => router.navigate("/?after=inbox-frame"));
    const card = await screen.findByRole("region", { name: "Inbox" });
    expect(within(card).getByText("1")).toBeInTheDocument();
    expect(homeReads).toBe(2);
  });

  it("re-asks Home on reconnect and adopts the recovered Inbox section", async () => {
    const sources = stubEventSource();
    let sections: readonly object[] = [];
    let homeReads = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/home" || call.method !== "GET") return undefined;
        homeReads += 1;
        return json(200, { sections });
      },
    });
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Welcome to OpenLaw" })).toBeInTheDocument();
    expect(homeReads).toBe(1);
    act(() => sources[0]!.open());
    await waitFor(() => expect(homeReads).toBe(2));

    sections = [{ ...inboxSection, total: 1 }];
    act(() => sources[0]!.open());

    await waitFor(() => expect(homeReads).toBe(3));
    const card = await screen.findByRole("region", { name: "Inbox" });
    expect(within(card).getByText("1")).toBeInTheDocument();
  });

  it("keeps an Inbox frame that lands while reconnect recovery is reading", async () => {
    const sources = stubEventSource();
    let homeReads = 0;
    let finishRecovery!: () => void;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/home" || call.method !== "GET") return undefined;
        homeReads += 1;
        if (homeReads === 1) return json(200, { sections: [inboxSection] });
        return new Promise<Response>((resolve) => {
          finishRecovery = () => resolve(json(200, { sections: [inboxSection] }));
        });
      },
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Inbox" });
    expect(within(card).getByText("5")).toBeInTheDocument();
    act(() => sources[0]!.open());
    await waitFor(() => expect(homeReads).toBe(2));

    act(() => sources[0]!.emit({ kind: "inbox", total: 6 }));
    expect(await within(card).findByText("6")).toBeInTheDocument();
    await act(async () => finishRecovery());

    expect(within(card).getByText("6")).toBeInTheDocument();
    expect(homeReads).toBe(2);
  });

  it("keeps the last live Inbox total while a reconnect read is in flight, then adopts its answer", async () => {
    const sources = stubEventSource();
    let homeReads = 0;
    let finishRecovery!: () => void;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/home" || call.method !== "GET") return undefined;
        homeReads += 1;
        if (homeReads === 1) return json(200, { sections: [inboxSection] });
        return new Promise<Response>((resolve) => {
          finishRecovery = () => resolve(json(200, { sections: [{ ...inboxSection, total: 9 }] }));
        });
      },
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Inbox" });
    act(() => sources[0]!.emit({ kind: "inbox", total: 8 }));
    expect(await within(card).findByText("8")).toBeInTheDocument();

    act(() => sources[0]!.open());
    await waitFor(() => expect(homeReads).toBe(2));
    // The stale loader total must not show while the read is pending.
    expect(within(card).getByText("8")).toBeInTheDocument();
    expect(within(card).queryByText("5")).not.toBeInTheDocument();

    await act(async () => finishRecovery());
    expect(await within(card).findByText("9")).toBeInTheDocument();
    expect(within(card).queryByText("8")).not.toBeInTheDocument();
  });

  it("renders the Manager's Contract and Matter portfolios with lifecycle, next dates, and markers", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [contractsSection, mattersSection] })
          : undefined,
    });
    renderAt("/");

    const contracts = await screen.findByRole("region", { name: "Your contracts" });
    expect(within(contracts).getByText("7")).toBeInTheDocument();
    expect(
      within(contracts).getByRole("link", { name: /Confidential acquisition agreement/ }),
    ).toHaveAttribute("href", "/contracts/501");
    expect(within(contracts).getByText("Contract C-501 · Draft")).toBeInTheDocument();
    expect(within(contracts).getByText(formatDeadline(contractDate))).toBeInTheDocument();
    expect(within(contracts).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    expect(
      within(contracts).getByRole("img", { name: "Renewal pending confirmation" }),
    ).toBeInTheDocument();
    expect(within(contracts).getByText("No upcoming date")).toBeInTheDocument();
    expect(within(contracts).getByRole("link", { name: "View all 7" })).toHaveAttribute(
      "href",
      "/contracts?owner=me",
    );

    const matters = screen.getByRole("region", { name: "Your matters" });
    expect(within(matters).getByText("4")).toBeInTheDocument();
    expect(
      within(matters).getByRole("link", { name: /Confidential employment investigation/ }),
    ).toHaveAttribute("href", "/matters/91");
    expect(within(matters).getByText("Matter M-91 · Open")).toBeInTheDocument();
    expect(within(matters).getByText("Response filing deadline")).toBeInTheDocument();
    expect(within(matters).getByText(formatDeadline(matterDeadline))).toBeInTheDocument();
    expect(within(matters).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    expect(within(matters).getByText("Matter M-92 · In Progress")).toBeInTheDocument();
    expect(within(matters).getByText("No upcoming deadline")).toBeInTheDocument();
    expect(within(matters).getByRole("link", { name: "View all 4" })).toHaveAttribute(
      "href",
      "/matters?manager=me",
    );
  });
});
