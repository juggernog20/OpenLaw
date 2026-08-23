// SPDX-License-Identifier: AGPL-3.0-only

/** The M22 matter destination, creation dialog, and read-only hero through the real router. */
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
const BUSINESS = {
  id: "u-business",
  email: "business@example.com",
  displayName: "Bao Business",
  role: "business_user",
};

const REQUIRED_FIELD = {
  fieldId: "f-unit",
  slug: "business-unit",
  displayName: "Business unit",
  description: "Who owns the work.",
  fieldType: "text",
  fieldTag: "business",
  options: null,
  displayOrder: 1,
  isRequired: true,
} as const;
const TYPE = {
  id: "type-employment",
  slug: "employment",
  displayName: "Employment",
  fields: [REQUIRED_FIELD],
};

function matter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "matter-7",
    number: 7,
    title: "Employment advice",
    description: "Advice on a transfer.",
    matterTypeId: TYPE.id,
    matterTypeName: TYPE.displayName,
    statusId: "status-open",
    statusName: "Open",
    statusCategory: "open",
    manager: null,
    priority: "medium",
    risk: null,
    customFields: { "business-unit": "People" },
    openedAt: "2026-08-23T08:00:00.000Z",
    closedAt: null,
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-23T08:00:00.000Z",
    updatedAt: "2026-08-23T08:00:00.000Z",
    ...overrides,
  };
}

function matterApi(onPost?: (call: StubCall) => Response) {
  return (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/matters" && call.method === "GET")
      return json(200, { matters: [], nextCursor: null, counts: { open: 0, onHold: 0 } });
    if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET")
      return json(200, {
        matterTypes: [TYPE],
        matterStatuses: [
          { id: "status-open", slug: "open", displayName: "Open", category: "open" },
        ],
        users: [
          {
            id: MEMBER.id,
            displayName: MEMBER.displayName,
            image: null,
            archived: false,
            role: MEMBER.role,
          },
        ],
      });
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET")
      return json(200, { entities: [] });
    if (call.url.pathname === "/api/v1/matters" && call.method === "POST") return onPost?.(call);
    if (call.url.pathname === "/api/v1/matters/8" && call.method === "GET")
      return json(200, {
        matter: matter({
          id: "matter-8",
          number: 8,
          title: "New advice",
          customFields: { "business-unit": "Operations" },
        }),
        fields: [REQUIRED_FIELD],
        customFieldRefs: { users: [], entities: [] },
      });
    return undefined;
  };
}

describe("the Matters destination", () => {
  it("opens a matters saved view while reading past a removed column", async () => {
    let surface: string | null = null;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/list-views" && call.method === "GET") {
          surface = call.url.searchParams.get("surface");
          return json(200, {
            views: [
              {
                id: "view-matters",
                surface: "matters",
                name: "Matter triage",
                isDefault: true,
                config: {
                  columns: [
                    { key: "removed-column", width: 100 },
                    { key: "status", width: 128 },
                  ],
                  flexKey: "removed-column",
                  sort: { key: "removed-sort", dir: "asc" },
                  filters: {},
                },
              },
            ],
          });
        }
        if (call.url.pathname === "/api/v1/matters" && call.method === "GET")
          return json(200, {
            matters: [matter()],
            nextCursor: null,
            counts: { open: 1, onHold: 0 },
          });
        return matterApi()(call);
      },
    });
    renderAt("/matters");
    expect(await screen.findByRole("button", { name: /Matter triage/ })).toBeInTheDocument();
    expect(surface).toBe("matters");
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.getAttribute("aria-label")),
    ).toEqual(["Status", "Title"]);
  });

  it("renders every list column, active counts, toggles, and the Manager: me chip", async () => {
    const calls: URL[] = [];
    const open = matter({
      manager: { id: MEMBER.id, displayName: MEMBER.displayName, image: null, archived: false },
    });
    const closed = matter({
      id: "matter-8",
      number: 8,
      title: "Closed advice",
      statusId: "status-closed",
      statusName: "Closed",
      statusCategory: "closed",
      closedAt: "2026-08-23T09:00:00.000Z",
    });
    const archived = matter({
      id: "matter-9",
      number: 9,
      title: "Archived advice",
      archivedAt: "2026-08-23T10:00:00.000Z",
    });
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET")
          return json(200, {
            matterTypes: [TYPE],
            matterStatuses: [
              { id: "status-open", slug: "open", displayName: "Open", category: "open" },
              { id: "status-closed", slug: "closed", displayName: "Closed", category: "closed" },
            ],
            users: [
              {
                id: MEMBER.id,
                displayName: MEMBER.displayName,
                image: null,
                archived: false,
                role: MEMBER.role,
              },
            ],
          });
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET")
          return json(200, { entities: [] });
        if (call.url.pathname === "/api/v1/matters" && call.method === "GET") {
          calls.push(call.url);
          const rows = [open];
          if (call.url.searchParams.get("includeClosed") === "true") rows.push(closed);
          if (call.url.searchParams.get("includeArchived") === "true") rows.push(archived);
          return json(200, { matters: rows, nextCursor: null, counts: { open: 4, onHold: 2 } });
        }
        return undefined;
      },
    });
    renderAt("/matters");
    expect(await screen.findByText("4 open · 2 on hold")).toBeInTheDocument();
    const table = screen.getByRole("table");
    for (const heading of [
      "Matter",
      "Title",
      "Type",
      "Status",
      "Priority",
      "Risk",
      "Matter Manager",
      "Opened",
    ])
      expect(
        within(table).getByRole("columnheader", { name: new RegExp(`^${heading}$`) }),
      ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Manager"), "me");
    expect(await screen.findByText("Manager: me")).toBeInTheDocument();
    await waitFor(() => expect(calls.at(-1)?.searchParams.get("manager")).toBe("me"));

    await user.click(screen.getByRole("switch", { name: "Show closed" }));
    expect(await screen.findByText("Closed advice")).toBeInTheDocument();
    expect(calls.at(-1)?.searchParams.get("includeClosed")).toBe("true");
    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    expect(await screen.findByText("Archived advice")).toBeInTheDocument();
    expect(calls.at(-1)?.searchParams.get("includeArchived")).toBe("true");
  });

  it("draws no table menus on the empty state and names a filter that matches nothing", async () => {
    stubApi({ signedIn: MEMBER, extra: matterApi() });
    renderAt("/matters");
    expect(await screen.findByRole("heading", { name: "No matters yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Default view/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Priority"), "critical");
    expect(
      await screen.findByRole("heading", { name: "No matters match these filters" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New matter" })).toHaveLength(1);
  });

  it("is visible to a Legal Team Member and a Contributor, but absent for a Business User", async () => {
    for (const signedIn of [MEMBER, CONTRIBUTOR]) {
      stubApi({ signedIn, extra: matterApi() });
      renderAt("/matters");
      expect(await screen.findByRole("heading", { level: 1, name: "Matters" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
          name: "Matters",
        }),
      ).toBeInTheDocument();
      if (signedIn.role === "contributor")
        expect(screen.queryByRole("button", { name: "New matter" })).not.toBeInTheDocument();
      cleanup();
    }
    stubApi({ signedIn: BUSINESS });
    renderAt("/matters");
    expect(
      await screen.findByRole("heading", { level: 1, name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("draws every M8 field without a Template row and names all current gaps in one refusal", async () => {
    stubApi({ signedIn: MEMBER, extra: matterApi() });
    renderAt("/matters");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No matters yet" });
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    const dialog = await screen.findByRole("dialog");
    for (const label of [
      "Title",
      "Matter type",
      "Matter Manager",
      "Priority",
      "Risk",
      "Description",
      "Confidential — restrict to the matter team",
    ]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(dialog).queryByLabelText("Template")).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Matter type"), TYPE.id);
    expect(within(dialog).getByLabelText(/Business unit/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    const refusal = await within(dialog).findByRole("alert");
    expect(refusal).toHaveTextContent("Title");
    expect(refusal).toHaveTextContent("Business unit");
  });

  it("posts the complete draft and lands on the newborn M-number", async () => {
    let posted: unknown;
    stubApi({
      signedIn: MEMBER,
      extra: matterApi((call) => {
        posted = call.body;
        return json(201, {
          matter: matter({
            id: "matter-8",
            number: 8,
            title: "New advice",
            customFields: { "business-unit": "Operations" },
          }),
        });
      }),
    });
    renderAt("/matters");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No matters yet" });
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "New advice");
    await user.selectOptions(within(dialog).getByLabelText("Matter type"), TYPE.id);
    await user.selectOptions(within(dialog).getByLabelText("Matter Manager"), MEMBER.id);
    await user.selectOptions(within(dialog).getByLabelText("Priority"), "high");
    await user.selectOptions(within(dialog).getByLabelText("Risk"), "low");
    await user.type(within(dialog).getByLabelText(/Business unit/), "Operations");
    await user.type(within(dialog).getByLabelText("Description"), "Review the transfer.");
    await user.click(within(dialog).getByLabelText("Confidential — restrict to the matter team"));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect((await screen.findAllByText("M-8")).length).toBeGreaterThan(0);
    expect(posted).toMatchObject({
      title: "New advice",
      matterTypeId: TYPE.id,
      managerId: MEMBER.id,
      priority: "high",
      risk: "low",
      description: "Review the transfer.",
      customFields: { "business-unit": "Operations" },
      isConfidential: true,
    });
  });

  it("keeps the dialog actionable and explains a failed create", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: matterApi(() =>
        json(500, {
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: "Matter creation is temporarily unavailable.",
        }),
      ),
    });
    renderAt("/matters");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No matters yet" });
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "New advice");
    await user.selectOptions(within(dialog).getByLabelText("Matter type"), TYPE.id);
    await user.type(within(dialog).getByLabelText(/Business unit/), "Operations");
    const create = within(dialog).getByRole("button", { name: "Create" });
    await user.click(create);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Matter creation is temporarily unavailable.",
    );
    expect(create).toBeEnabled();
  });
});

describe("the matter hero", () => {
  it("leaves business inputs editable and omits legal Fields for a Contributor", async () => {
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call) =>
        call.url.pathname === "/api/v1/matters/7"
          ? json(200, {
              matter: matter({ customFields: { "business-unit": "People" } }),
              fields: [REQUIRED_FIELD],
              customFieldRefs: { users: [], entities: [] },
              team: [
                {
                  id: CONTRIBUTOR.id,
                  displayName: CONTRIBUTOR.displayName,
                  image: null,
                  archived: false,
                  role: "contributor",
                },
              ],
            })
          : undefined,
    });
    renderAt("/matters/7");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Employment advice" }),
    ).toBeInTheDocument();
    for (const text of ["M-7", "Open", "Employment", "Unassigned", "Medium", "Not assessed"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText("Description")).toBeEnabled();
    expect(screen.getByLabelText(/Business unit/)).toBeEnabled();
    expect(screen.queryByText("Sponsor")).not.toBeInTheDocument();
    expect(screen.queryByText("Sam Sponsor")).not.toBeInTheDocument();
  });
});
