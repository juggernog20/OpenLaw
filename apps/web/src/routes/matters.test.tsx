// SPDX-License-Identifier: AGPL-3.0-only

/** The M22 matter destination, creation dialog, and read-only hero through the real router. */
import { cleanup, screen, within } from "@testing-library/react";
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
  options: null,
  displayOrder: 1,
  isRequired: true,
} as const;
const SPONSOR_FIELD = {
  fieldId: "f-sponsor",
  slug: "sponsor",
  displayName: "Sponsor",
  description: null,
  fieldType: "user",
  options: null,
  displayOrder: 2,
  isRequired: false,
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
      return json(200, { matters: [] });
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
  it("renders the M-number, status, type, Unassigned manager, severity, opened date, description, and custom fields read-only", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/matters/7"
          ? json(200, {
              matter: matter({ customFields: { "business-unit": "People", sponsor: "u-sponsor" } }),
              fields: [REQUIRED_FIELD, SPONSOR_FIELD],
              customFieldRefs: {
                users: [{ id: "u-sponsor", displayName: "Sam Sponsor", archived: false }],
                entities: [],
              },
            })
          : undefined,
    });
    renderAt("/matters/7");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Employment advice" }),
    ).toBeInTheDocument();
    for (const text of [
      "M-7",
      "Open",
      "Employment",
      "Unassigned",
      "Medium",
      "Not assessed",
      "Advice on a transfer.",
      "Business unit",
      "People",
      // A `user` field stores an id; the hero draws the person's name.
      "Sponsor",
      "Sam Sponsor",
    ])
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
