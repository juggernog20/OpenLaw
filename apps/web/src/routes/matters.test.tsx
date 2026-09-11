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
const TEMPLATE = {
  id: "template-employment",
  name: "Employment standard",
  description: "The usual opening playbook.",
  defaultPriority: "high" as const,
  defaultRisk: "low" as const,
  defaultCustomFields: { "business-unit": "Finance" },
  titlePrefix: "EMP —",
  taskCount: 4,
  keyDateCount: 2,
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
    nextDeadline: null,
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
      nextDeadline: { date: "2026-08-23", label: "Response due" },
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
          return json(200, {
            matters: rows,
            nextCursor: null,
            total: 6,
            counts: { open: 4, onHold: 2 },
          });
        }
        return undefined;
      },
    });
    renderAt("/matters");
    expect(await screen.findByText("1 of 6 matters")).toBeInTheDocument();
    const table = screen.getByRole("table");
    for (const heading of [
      "Matter",
      "Title",
      "Type",
      "Status",
      "Next deadline",
      "Priority",
      "Risk",
      "Matter Manager",
      "Opened",
    ])
      expect(
        within(table).getByRole("columnheader", { name: new RegExp(`^${heading}$`) }),
      ).toBeInTheDocument();

    expect(within(table).getByText("Response due")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: /Response due/ })).toHaveAttribute(
      "href",
      "/matters/7/key-dates",
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
        name: "Manager",
      }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Me" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("button", { name: /Manager: Me/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.at(-1)?.searchParams.get("manager")).toBe("me"));

    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
        name: "Show closed",
      }),
    );
    expect(await screen.findByText("Closed advice")).toBeInTheDocument();
    expect(calls.at(-1)?.searchParams.get("includeClosed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
        name: "Show archived",
      }),
    );
    expect(await screen.findByText("Archived advice")).toBeInTheDocument();
    expect(calls.at(-1)?.searchParams.get("includeArchived")).toBe("true");
    // MTR-014: the Incomplete flag is how rows missing a later-required
    // field are found, so the shared filter bar has to keep offering it.
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
        name: "Incomplete",
      }),
    );
    await waitFor(() => expect(calls.at(-1)?.searchParams.get("incomplete")).toBe("true"));
    expect(screen.getByRole("button", { name: "Remove Incomplete filter" })).toBeInTheDocument();
  });

  it("keeps saved views available on the empty state and names a filter that matches nothing", async () => {
    stubApi({ signedIn: MEMBER, extra: matterApi() });
    renderAt("/matters");
    expect(await screen.findByRole("heading", { name: "No matters yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Default view/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
        name: "Priority",
      }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Critical" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(
      await screen.findByRole("heading", { name: "No matters match these filters" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New matter" })).toHaveLength(1);
  });

  it("shows the staff Matters destination to Legal and sends Business Users to the Portal", async () => {
    for (const signedIn of [MEMBER]) {
      stubApi({ signedIn, extra: matterApi() });
      renderAt("/matters");
      expect(await screen.findByRole("heading", { level: 1, name: "Matters" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
          name: "Matters",
        }),
      ).toBeInTheDocument();
      if (signedIn.role === "business_user")
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
      expect(within(dialog).getByLabelText(new RegExp(`^${label}\\*?$`))).toBeInTheDocument();
    }
    expect(within(dialog).queryByLabelText("Template")).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), TYPE.id);
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
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), "New advice");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), TYPE.id);
    // The Matter Manager is seeded with the person creating it (MTR-003
    // focus-group addendum, 2026-09-09): nobody selects themselves.
    expect(within(dialog).getByLabelText("Matter Manager")).toHaveValue(MEMBER.id);
    await user.selectOptions(within(dialog).getByLabelText(/^Priority\*?$/), "high");
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

  it("lets the creator clear the seeded Matter Manager, and posts null for Unassigned", async () => {
    let posted: unknown;
    stubApi({
      signedIn: MEMBER,
      extra: matterApi((call) => {
        posted = call.body;
        return json(201, {
          matter: matter({
            id: "matter-8",
            number: 8,
            title: "Nobody's yet",
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
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), "Nobody's yet");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), TYPE.id);
    await user.selectOptions(within(dialog).getByLabelText("Matter Manager"), "");
    await user.type(within(dialog).getByLabelText(/Business unit/), "Operations");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect((await screen.findAllByText("M-8")).length).toBeGreaterThan(0);
    // Unassigned stays a real state: null on the wire, not a missing key.
    expect(posted).toMatchObject({ managerId: null });
  });

  it("stages documents without writes, removes a selection, and discards them on cancel", async () => {
    let writes = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.method === "POST") writes++;
        return matterApi()(call);
      },
    });
    renderAt("/matters");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No matters yet" });
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Attach documents"), [
      new File(["advice"], "advice.txt", { type: "text/plain" }),
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Remove notes.txt" }));
    expect(within(dialog).queryByText("notes.txt")).not.toBeInTheDocument();
    expect(within(dialog).getByText("advice.txt")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(writes).toBe(0);
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    expect(screen.queryByText("advice.txt")).not.toBeInTheDocument();
  });

  it("uploads after creation and retries only failed files without creating another Matter", async () => {
    let creates = 0;
    const uploads: string[] = [];
    let release: ((response: Response) => void) | undefined;
    const base = matterApi(() => {
      creates++;
      return json(201, { matter: matter({ number: 8 }) });
    });
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/8/documents" && call.method === "POST") {
          expect(creates).toBe(1);
          const form = call.body as FormData;
          expect(form.get("kind")).toBe("general");
          const name = (form.get("file") as File).name;
          uploads.push(name);
          if (uploads.length === 1)
            return new Promise<Response>((resolve) => {
              release = resolve;
            });
          if (uploads.length === 2) return json(500, { detail: "Upload temporarily unavailable." });
          return json(201, { document: { id: name } });
        }
        return base(call);
      },
    });
    renderAt("/matters");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No matters yet" });
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), "New advice");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), TYPE.id);
    await user.type(within(dialog).getByLabelText(/Business unit/), "People");
    await user.upload(within(dialog).getByLabelText("Attach documents"), [
      new File(["advice"], "advice.txt", { type: "text/plain" }),
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    ]);
    expect(within(dialog).queryByLabelText("Document kind")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await screen.findByText("Record created. Uploading documents…");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    release!(json(201, { document: { id: "advice" } }));
    await screen.findByText("Upload temporarily unavailable.");
    await user.click(screen.getByRole("button", { name: "Retry failed uploads" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(creates).toBe(1);
    expect(uploads).toEqual(["advice.txt", "notes.txt", "notes.txt"]);
  });

  it("defaults type changes to no template and applies template values only when selected", async () => {
    let posted: unknown;
    const templatedType = { ...TYPE, templates: [TEMPLATE] };
    const otherType = {
      ...TYPE,
      id: "type-litigation",
      slug: "litigation",
      displayName: "Litigation",
      templates: [{ ...TEMPLATE, id: "template-litigation", name: "Claim standard" }],
    };
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET") {
          return json(200, {
            matterTypes: [templatedType, otherType],
            matterStatuses: [
              { id: "status-open", slug: "open", displayName: "Open", category: "open" },
            ],
            users: [],
          });
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: [] });
        }
        if (call.url.pathname === "/api/v1/matters" && call.method === "GET") {
          return json(200, { matters: [], nextCursor: null, counts: { open: 0, onHold: 0 } });
        }
        if (call.url.pathname === "/api/v1/matters" && call.method === "POST") {
          posted = call.body;
          return json(201, {
            matter: matter({
              id: "matter-8",
              number: 8,
              title: "EMP — Transfer",
              customFields: { "business-unit": "People" },
            }),
          });
        }
        return undefined;
      },
    });
    renderAt("/matters");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "No matters yet" });
    await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), templatedType.id);

    const picker = within(dialog).getByLabelText("Matter template");
    expect(picker).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Title\*?$/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Priority\*?$/)).toHaveValue("medium");
    expect(within(dialog).getByLabelText(/Business unit/)).toHaveValue("");
    await user.selectOptions(picker, TEMPLATE.id);
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), otherType.id);
    expect(picker).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Title\*?$/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Priority\*?$/)).toHaveValue("medium");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), templatedType.id);
    expect(picker).toHaveValue("");
    await user.selectOptions(picker, TEMPLATE.id);
    expect(picker).toHaveValue(TEMPLATE.id);
    expect(within(picker).getByRole("option", { name: TEMPLATE.name })).toBeInTheDocument();
    expect(
      within(picker).queryByRole("option", { name: "Claim standard" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Title\*?$/)).toHaveValue("EMP —");
    expect(within(dialog).getByLabelText(/^Priority\*?$/)).toHaveValue("high");
    expect(within(dialog).getByLabelText("Risk")).toHaveValue("low");
    expect(within(dialog).getByLabelText(/Business unit/)).toHaveValue("Finance");
    expect(within(dialog).getByText("Template adds 4 tasks and 2 key dates.")).toBeInTheDocument();

    await user.selectOptions(picker, "");
    expect(within(dialog).getByLabelText(/^Title\*?$/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/^Priority\*?$/)).toHaveValue("medium");
    expect(within(dialog).getByLabelText("Risk")).toHaveValue("");
    expect(within(dialog).getByLabelText(/Business unit/)).toHaveValue("");

    await user.selectOptions(picker, TEMPLATE.id);
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), " Transfer");
    await user.selectOptions(picker, "");
    expect(within(dialog).getByLabelText(/^Title\*?$/)).toHaveValue("EMP — Transfer");
    await user.selectOptions(picker, TEMPLATE.id);
    expect(within(dialog).getByLabelText(/^Title\*?$/)).toHaveValue("EMP — Transfer");
    expect(within(dialog).getByLabelText(/^Priority\*?$/)).toHaveValue("high");
    await user.selectOptions(within(dialog).getByLabelText(/^Priority\*?$/), "critical");
    await user.selectOptions(within(dialog).getByLabelText("Risk"), "critical");
    const unit = within(dialog).getByLabelText(/Business unit/);
    await user.clear(unit);
    await user.type(unit, "People");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(posted).toMatchObject({
        title: "EMP — Transfer",
        matterTypeId: templatedType.id,
        templateId: TEMPLATE.id,
        priority: "critical",
        risk: "critical",
        customFields: { "business-unit": "People" },
      }),
    );
  });

  it.each([
    { action: "clear", required: false, expected: null },
    { action: "leave untouched", required: false, expected: "Finance" },
    { action: "override", required: false, expected: "People" },
    { action: "clear", required: true, expected: undefined },
  ])(
    "preserves template Field intent: $action, required=$required",
    async ({ action, required, expected }) => {
      let posted: unknown;
      const field = { ...REQUIRED_FIELD, isRequired: required };
      stubApi({
        signedIn: MEMBER,
        extra: (call) => {
          if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET") {
            return json(200, {
              matterTypes: [{ ...TYPE, fields: [field], templates: [TEMPLATE] }],
              matterStatuses: [],
              users: [],
            });
          }
          return matterApi((request) => {
            posted = request.body;
            return json(201, { matter: matter({ id: "matter-8", number: 8 }) });
          })(call);
        },
      });
      renderAt("/matters");
      const user = userEvent.setup();
      await screen.findByRole("heading", { name: "No matters yet" });
      await user.click(screen.getAllByRole("button", { name: "New matter" })[0]!);
      const dialog = await screen.findByRole("dialog");
      await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), TYPE.id);
      await user.selectOptions(within(dialog).getByLabelText("Matter template"), TEMPLATE.id);
      const control = within(dialog).getByLabelText(/Business unit/);
      expect(control).toHaveValue("Finance");
      if (action !== "leave untouched") await user.clear(control);
      if (action === "override") await user.type(control, "People");
      await user.click(within(dialog).getByRole("button", { name: "Create" }));

      if (required) {
        expect(await within(dialog).findByRole("alert")).toHaveTextContent("Fill Business unit.");
        expect(posted).toBeUndefined();
      } else {
        await waitFor(() =>
          expect(posted).toMatchObject({
            templateId: TEMPLATE.id,
            customFields: { "business-unit": expected },
          }),
        );
      }
    },
  );

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
    await user.type(within(dialog).getByLabelText(/^Title\*?$/), "New advice");
    await user.selectOptions(within(dialog).getByLabelText(/^Matter type\*?$/), TYPE.id);
    await user.type(within(dialog).getByLabelText(/Business unit/), "Operations");
    const create = within(dialog).getByRole("button", { name: "Create" });
    await user.click(create);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Matter creation is temporarily unavailable.",
    );
    expect(create).toBeEnabled();
  });
});

it.each(["task", "key_date"] as const)(
  "opens a Matter Next deadline in its %s source tab",
  async (source) => {
    const fallback = matterApi();
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/matters" && call.method === "GET")
          return json(200, {
            matters: [
              matter({ nextDeadline: { date: "2026-09-30", label: "Business response", source } }),
            ],
            nextCursor: null,
            counts: { open: 1, onHold: 0 },
          });
        return fallback(call);
      },
    });
    renderAt("/matters");
    const link = await screen.findByRole("link", { name: /Business response/ });
    expect(link).toHaveAttribute("href", `/matters/7/${source === "task" ? "tasks" : "key-dates"}`);
  },
);
