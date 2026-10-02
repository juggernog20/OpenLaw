// SPDX-License-Identifier: AGPL-3.0-only

/** A Business User's own Tasks in the Portal (MTR-005 addendum, 2026-10-02). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const BUSINESS = {
  id: "b1",
  email: "felix@example.com",
  displayName: "Felix Brandt",
  role: "business_user",
  timezone: "UTC",
};

function portalTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Send the delivery notes",
    dueDate: "2026-09-26",
    isDone: false,
    isOverdue: true,
    record: {
      kind: "contract",
      id: "contract-1",
      number: 42,
      title: "Supplier dispute",
      isConfidential: false,
    },
    ...overrides,
  };
}
const MATTER_TASK = portalTask({
  id: "task-2",
  title: "Find the photos",
  dueDate: null,
  isOverdue: false,
  record: { kind: "matter", id: "matter-1", number: 12, title: "Warehouse claim" },
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Portal Tasks", () => {
  it("lists the viewer's Tasks with record links and completes and reopens one", async () => {
    let done = false;
    const reads: URLSearchParams[] = [];
    const writes: { path: string; body: unknown }[] = [];
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/tasks") {
          reads.push(call.url.searchParams);
          const first = { ...portalTask(), isDone: done, isOverdue: !done };
          const rows =
            done && call.url.searchParams.get("includeCompleted") !== "true"
              ? [MATTER_TASK]
              : [first, MATTER_TASK];
          return json(200, { total: rows.length, rows, nextCursor: null });
        }
        if (call.url.pathname === "/api/v1/portal/tasks/task-1/toggle") {
          writes.push({ path: call.url.pathname, body: call.body });
          done = !done;
          return json(200, { task: { ...portalTask(), isDone: done, isOverdue: !done } });
        }
        return undefined;
      },
    });
    renderAt("/portal/tasks");
    await screen.findByRole("heading", { level: 1, name: "Your Tasks" });
    expect(
      within(screen.getByRole("navigation", { name: "Portal" })).getByRole("link", {
        current: "page",
      }),
    ).toHaveAccessibleName("Tasks");
    const card = within(screen.getByRole("region", { name: "Tasks assigned to you" }));
    expect(card.getByRole("img", { name: "2 Tasks" })).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Supplier dispute · Contract C-42" })).toHaveAttribute(
      "href",
      "/portal/contracts/42",
    );
    expect(card.getByRole("link", { name: "Warehouse claim · Matter M-12" })).toHaveAttribute(
      "href",
      "/portal/matters/12",
    );
    expect(card.getByText("Sep 26 (3 days overdue)")).toHaveClass("bg-status-severe-bg");
    expect(reads[0]?.get("includeCompleted")).toBe("false");

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(
      card.getByRole("checkbox", { name: "Complete Task: Send the delivery notes" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Completed: Send the delivery notes",
    );
    expect(card.queryByText("Send the delivery notes")).not.toBeInTheDocument();
    expect(card.getByRole("img", { name: "1 Task" })).toBeInTheDocument();
    expect(writes).toEqual([
      { path: "/api/v1/portal/tasks/task-1/toggle", body: { kind: "contract" } },
    ]);

    await user.click(card.getByRole("switch", { name: "Show completed" }));
    const reopen = await card.findByRole("checkbox", {
      name: "Reopen Task: Send the delivery notes",
    });
    expect(reads.at(-1)?.get("includeCompleted")).toBe("true");
    expect(card.getByText("Send the delivery notes")).toHaveClass("line-through");
    await user.click(reopen);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Reopened: Send the delivery notes",
    );
    expect(
      card.getByRole("checkbox", { name: "Complete Task: Send the delivery notes" }),
    ).not.toBeChecked();
    expect(card.queryByRole("button", { name: /Edit|Remove/ })).not.toBeInTheDocument();
  });

  it("keeps the Task and says so when the write is refused", async () => {
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/tasks")
          return json(200, { total: 1, rows: [portalTask()], nextCursor: null });
        if (call.url.pathname === "/api/v1/portal/tasks/task-1/toggle")
          return problem(404, "No Task assigned to you exists with this id.");
        return undefined;
      },
    });
    renderAt("/portal/tasks");
    const card = within(await screen.findByRole("region", { name: "Tasks assigned to you" }));
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(card.getByRole("checkbox", { name: "Complete Task: Send the delivery notes" }));
    expect(await card.findByRole("alert")).toHaveTextContent(
      "The Task could not be saved. Try again.",
    );
    expect(card.getByText("Send the delivery notes")).toBeInTheDocument();
  });

  it("shows the viewer's Tasks on a Portal Matter, and no card where they have none", async () => {
    const reads: URLSearchParams[] = [];
    let rows = [MATTER_TASK];
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/matters/12")
          return json(200, {
            matter: {
              number: 12,
              title: "Warehouse claim",
              type: "Claim",
              status: "Open",
              category: "open",
              manager: null,
              businessOwner: null,
            },
          });
        if (call.url.pathname === "/api/v1/portal/matters/12/work")
          return json(200, {
            work: {
              id: "matter-1",
              description: null,
              fields: [],
              customFields: {},
              references: { people: [], entities: [] },
              originalRequests: [],
            },
          });
        if (call.url.pathname === "/api/v1/portal/tasks") {
          reads.push(call.url.searchParams);
          return json(200, { total: rows.length, rows, nextCursor: null });
        }
        return undefined;
      },
    });
    const { router } = renderAt("/portal/matters/12");
    const card = within(await screen.findByRole("region", { name: "Tasks assigned to you" }));
    expect(card.getByText("Find the photos")).toBeInTheDocument();
    expect(card.queryByRole("link", { name: /Warehouse claim/ })).not.toBeInTheDocument();
    expect(reads[0]?.get("kind")).toBe("matter");
    expect(reads[0]?.get("number")).toBe("12");

    rows = [];
    await router.revalidate();
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Tasks assigned to you" }),
      ).not.toBeInTheDocument(),
    );
  });
});
