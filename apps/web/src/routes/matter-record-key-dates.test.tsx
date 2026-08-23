// SPDX-License-Identifier: AGPL-3.0-only

/** Matter Key dates through the real record route (MTR-004, #491). */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u-member",
  email: "member@example.com",
  displayName: "Mina Member",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u-contributor",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
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
    manager: null,
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

function deadline(overrides: Record<string, unknown> = {}) {
  return {
    keyDateId: "date-today",
    date: "2026-08-23",
    label: "Response due",
    note: null,
    daysAway: 0,
    overdue: false,
    isNext: true,
    ...overrides,
  };
}

const DATES = [
  deadline({
    keyDateId: "date-past",
    date: "2026-08-22",
    label: "Evidence preserved",
    daysAway: -1,
    overdue: true,
    isNext: false,
  }),
  deadline(),
  deadline({
    keyDateId: "date-future",
    date: "2026-08-24",
    label: "Hearing",
    note: "Bring the filing receipt.",
    daysAway: 1,
    isNext: false,
  }),
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refused = () =>
  json(409, {
    type: "about:blank",
    title: "The Key date change was refused.",
    status: 409,
    detail: "The Key date change was refused.",
  });

function recordApi(
  initial: Record<string, unknown>[] = DATES,
  row: Record<string, unknown> = matter(),
  failures: ReadonlySet<string> = new Set(),
) {
  let deadlines = initial;
  const writes: { method: string; path: string; body: unknown }[] = [];
  return {
    writes,
    handler(call: StubCall) {
      if (call.url.pathname === "/api/v1/matters/12" && call.method === "GET") {
        return json(200, {
          matter: row,
          fields: [],
          customFieldRefs: { users: [], entities: [] },
          team: [],
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
          users: [],
        });
      }
      if (call.url.pathname === "/api/v1/matters/12/documents" && call.method === "GET") {
        return json(200, { documents: [], nextCursor: null });
      }
      if (call.url.pathname === "/api/v1/matters/12/folders" && call.method === "GET") {
        return json(200, { folders: [] });
      }
      if (call.url.pathname === "/api/v1/matters/12/key-dates" && call.method === "GET") {
        return json(200, { deadlines });
      }
      if (call.url.pathname === "/api/v1/matters/12/key-dates" && call.method === "POST") {
        if (!isRecord(call.body)) return json(400, {});
        writes.push({ method: call.method, path: call.url.pathname, body: call.body });
        if (failures.has(call.method)) return refused();
        deadlines = [...deadlines, deadline({ keyDateId: "date-added", ...call.body })];
        return json(201, { deadlines });
      }
      const keyDate = /^\/api\/v1\/matter-key-dates\/([^/]+)$/.exec(call.url.pathname);
      if (keyDate && call.method === "PATCH") {
        if (!isRecord(call.body)) return json(400, {});
        const body = call.body;
        writes.push({ method: call.method, path: call.url.pathname, body });
        if (failures.has(call.method)) return refused();
        deadlines = deadlines.map((row) =>
          row.keyDateId === keyDate[1] ? { ...row, ...body } : row,
        );
        return json(200, { deadlines });
      }
      if (keyDate && call.method === "DELETE") {
        writes.push({ method: call.method, path: call.url.pathname, body: null });
        if (failures.has(call.method)) return refused();
        deadlines = deadlines.filter((row) => row.keyDateId !== keyDate[1]);
        return json(200, { deadlines });
      }
      return undefined;
    },
  };
}

const section = async () => within(await screen.findByRole("region", { name: "Key dates" }));

describe("the Matter record's Key dates section", () => {
  it("draws empty, overdue, today, and upcoming states in the seam's chronological order", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/matters/12/key-dates");

    const card = await section();
    const rows = card.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Evidence preserved"),
      expect.stringContaining("Response due"),
      expect.stringContaining("Hearing"),
    ]);
    expect(rows[0]).toHaveTextContent("Overdue");
    expect(rows[1]).toHaveTextContent("Next");
    expect(rows[1]).toHaveTextContent("today");
    expect(rows[2]).toHaveTextContent("Upcoming");
    expect(rows[2]).toHaveTextContent("Bring the filing receipt.");
    expect(card.getByText("2 upcoming · 1 overdue")).toBeInTheDocument();
  });

  it("adds, edits, and removes Key dates from the routed section", async () => {
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/matters/12/key-dates");
    const user = userEvent.setup();
    const card = await section();
    expect(card.getByText("No Key dates on this Matter yet.")).toBeInTheDocument();

    await user.click(card.getByRole("button", { name: "Add date" }));
    await user.type(screen.getByLabelText("Date"), "2026-08-24");
    await user.type(screen.getByLabelText("Event"), "Initial hearing");
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));
    expect(await screen.findByText("Initial hearing")).toBeInTheDocument();

    await user.click(
      (await section()).getByRole("button", { name: "Actions for Initial hearing" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit date" }));
    await user.clear(screen.getByLabelText("Event"));
    await user.type(screen.getByLabelText("Event"), "Final hearing");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Final hearing")).toBeInTheDocument();

    await user.click((await section()).getByRole("button", { name: "Actions for Final hearing" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove date" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove date" }),
    );
    await waitFor(() => expect(screen.queryByText("Final hearing")).not.toBeInTheDocument());
    expect(api.writes.map((write) => write.method)).toEqual(["POST", "PATCH", "DELETE"]);
  });

  it("validates writes and keeps the routed list unchanged when the server refuses them", async () => {
    const user = userEvent.setup();
    const postApi = recordApi([], matter(), new Set(["POST"]));
    stubApi({ signedIn: MEMBER, extra: postApi.handler });
    renderAt("/matters/12/key-dates");
    let card = await section();
    await user.click(card.getByRole("button", { name: "Add date" }));
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a date.");
    expect(postApi.writes).toEqual([]);
    await user.type(screen.getByLabelText("Date"), "2026-08-25");
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name what the date is.");
    expect(postApi.writes).toEqual([]);
    await user.type(screen.getByLabelText("Event"), "Rejected filing");
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The Key date change was refused.");
    expect((await section()).getByText("No Key dates on this Matter yet.")).toBeInTheDocument();
    cleanup();

    const patchApi = recordApi(DATES, matter(), new Set(["PATCH"]));
    stubApi({ signedIn: MEMBER, extra: patchApi.handler });
    renderAt("/matters/12/key-dates");
    card = await section();
    await user.click(card.getByRole("button", { name: "Actions for Response due" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit date" }));
    await user.clear(screen.getByLabelText("Event"));
    await user.type(screen.getByLabelText("Event"), "Rejected response");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The Key date change was refused.");
    expect((await section()).getByText("Response due")).toBeInTheDocument();
    cleanup();

    const deleteApi = recordApi(DATES, matter(), new Set(["DELETE"]));
    stubApi({ signedIn: MEMBER, extra: deleteApi.handler });
    renderAt("/matters/12/key-dates");
    card = await section();
    await user.click(card.getByRole("button", { name: "Actions for Response due" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove date" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove date" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The Key date change was refused.");
    expect((await section()).getByText("Response due")).toBeInTheDocument();
  });

  it("keeps a closed Matter writable and makes a Contributor or archive read-only", async () => {
    const cases = [
      {
        user: MEMBER,
        row: matter({
          statusId: "status-closed",
          statusName: "Closed",
          statusCategory: "closed",
          closedAt: "2026-08-23T10:00:00.000Z",
        }),
        writable: true,
      },
      { user: CONTRIBUTOR, row: matter(), writable: false },
      { user: MEMBER, row: matter({ archivedAt: "2026-08-23T10:00:00.000Z" }), writable: false },
    ];
    for (const fixture of cases) {
      stubApi({
        signedIn: fixture.user,
        extra: recordApi([deadline({ isNext: false })], fixture.row).handler,
      });
      renderAt("/matters/12/key-dates");
      const card = await section();
      expect(Boolean(card.queryByRole("button", { name: "Add date" }))).toBe(fixture.writable);
      expect(Boolean(card.queryByRole("button", { name: /^Actions for/ }))).toBe(fixture.writable);
      cleanup();
    }
  });
});
