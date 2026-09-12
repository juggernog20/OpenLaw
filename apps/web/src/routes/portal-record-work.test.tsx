// SPDX-License-Identifier: AGPL-3.0-only

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi, stubEventSource } from "../testing/helpers";

beforeEach(() => window.history.replaceState({}, "", "/"));

const USER = {
  id: "business",
  displayName: "Business colleague",
  email: "business@example.com",
  role: "business_user",
};
const FIELD = {
  fieldId: "field",
  slug: "cost_center",
  displayName: "Cost center",
  description: null,
  fieldType: "text",
  fieldTag: "business",
  options: null,
  isRequired: false,
  displayOrder: 0,
};
const WORK = {
  id: "record",
  description: "Current context",
  fields: [FIELD],
  customFields: { cost_center: "Sales" },
  references: { people: [], entities: [] },
  originalRequests: [
    {
      number: 8,
      title: "Please review",
      requester: "Original requester",
      urgency: "medium",
      documents: [],
      submittedAt: "2026-09-01T12:00:00Z",
      description: "Original context",
      fields: [FIELD],
      customFields: { cost_center: "Original value" },
      references: { people: [], entities: [] },
    },
  ],
};
const CONTRACT = {
  number: 12,
  title: "Supply agreement",
  stage: "active",
  counterparty: "Supplier",
  legalOwner: null,
  businessOwner: null,
  termType: "fixed",
  effectiveDate: null,
  expiryDate: null,
  renewalPeriodMonths: null,
  noticePeriodDays: null,
  noticeDeadline: null,
  renewalPendingConfirmation: false,
  value: null,
  unverifiedFields: [],
  primaryDocument: null,
};
const MATTER = {
  number: 12,
  title: "Commercial advice",
  type: "Advice",
  status: "Open",
  category: "open",
  manager: null,
  businessOwner: null,
};

it("edits built-in Contract classification in Overview without adding configurable Fields", async () => {
  const edits: unknown[] = [];
  let fail = true;
  stubApi({
    signedIn: USER,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/portal/contracts/12")
        return json(200, { contract: CONTRACT });
      if (call.url.pathname === "/api/v1/portal/contracts/12/work") {
        if (call.method === "GET")
          return json(200, { work: { ...WORK, owningDepartment: "Sales", region: "EMEA" } });
        edits.push(call.body);
        if (fail) {
          fail = false;
          return problem(503, "Please retry the department.");
        }
        return json(200, {
          description: WORK.description,
          customFields: WORK.customFields,
          owningDepartment: "Finance",
          region: "EMEA",
        });
      }
      return undefined;
    },
  });
  renderAt("/portal/contracts/12");
  const user = userEvent.setup();
  const overview = within(await screen.findByRole("region", { name: "Overview" }));
  const department = overview.getByRole("textbox", { name: "Owning department" });
  expect(department).toHaveValue("Sales");
  expect(overview.getByRole("textbox", { name: "Region" })).toHaveValue("EMEA");
  const fields = within(screen.getByRole("region", { name: "Fields" }));
  expect(fields.queryByRole("textbox", { name: "Owning department" })).not.toBeInTheDocument();
  expect(fields.queryByRole("textbox", { name: "Region" })).not.toBeInTheDocument();
  expect(fields.getByRole("textbox", { name: "Cost center" })).toBeInTheDocument();
  await user.clear(department);
  await user.type(department, "Finance");
  await user.tab();
  expect(await overview.findByRole("alert")).toHaveTextContent("Please retry the department.");
  expect(department).toHaveValue("Finance");
  await user.click(overview.getByRole("button", { name: "Retry save" }));
  await waitFor(() =>
    expect(edits).toEqual([{ owningDepartment: "Finance" }, { owningDepartment: "Finance" }]),
  );
});

describe.each(["contract", "matter"] as const)("Portal %s work", (module) => {
  it("saves business inputs on the record, retains failed drafts, and keeps the original ask read-only", async () => {
    const edits: unknown[] = [];
    let fail = true;
    stubApi({
      signedIn: USER,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/portal/${module}s/12`)
          return json(200, module === "contract" ? { contract: CONTRACT } : { matter: MATTER });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/work`) {
          if (call.method === "GET") return json(200, { work: WORK });
          edits.push(call.body);
          if (fail) {
            fail = false;
            return problem(503, "Please try again.");
          }
          return json(200, {
            description: WORK.description,
            customFields: { cost_center: "Finance" },
          });
        }
        if (call.url.pathname === "/api/v1/comments")
          return json(200, { comments: [], nextCursor: null });
        return undefined;
      },
    });
    renderAt(`/portal/${module}s/12`);
    const user = userEvent.setup();
    const field = await screen.findByRole("textbox", { name: "Cost center" });
    await user.clear(field);
    await user.type(field, "Finance");
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again.");
    expect(field).toHaveValue("Finance");
    await user.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() =>
      expect(edits).toEqual([
        { customFields: { cost_center: "Finance" } },
        { customFields: { cost_center: "Finance" } },
      ]),
    );
    expect(screen.getByText("Original context")).toBeInTheDocument();
    expect(screen.getByText("Original value")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Original request" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });

  it("keeps drafts across applets, reads the roster on open, and clears history after access is refused", async () => {
    const sources = stubEventSource();
    let teamReads = 0;
    let historyReads = 0;
    let denied = false;
    const person = { id: "owner", displayName: "Legal colleague", image: null, archived: false };
    const businessOwner = { ...person, id: USER.id, displayName: USER.displayName };
    stubApi({
      signedIn: USER,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/portal/${module}s/12`)
          return json(200, module === "contract" ? { contract: CONTRACT } : { matter: MATTER });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/work`)
          return json(200, { work: WORK });
        if (call.url.pathname === "/api/v1/comments")
          return json(200, { comments: [], nextCursor: null });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/team`) {
          teamReads++;
          return json(200, {
            team: [person, businessOwner],
            manager: person,
            businessOwner,
            creator: person,
          });
        }
        if (call.url.pathname === "/api/v1/portal/activity") {
          historyReads++;
          expect(call.url.searchParams.get("entityType")).toBe(module);
          expect(call.url.searchParams.get("entityId")).toBe(WORK.id);
          if (denied) return problem(404, "No record exists with this reference.");
          return json(200, {
            entries: [
              {
                id: "shared-change",
                action: `${module}.updated`,
                actor: person,
                createdAt: "2026-09-12T12:00:00Z",
                visibility: "full_thread",
                payload: {
                  changed: { description: { from: "Earlier context", to: "Shared update" } },
                },
              },
            ],
            nextCursor: null,
          });
        }
        return undefined;
      },
    });
    renderAt(`/portal/${module}s/12`);
    const user = userEvent.setup();
    const chat = await screen.findByRole("button", { name: "Comments" });
    expect(screen.queryByRole("complementary", { name: "Comments" })).not.toBeInTheDocument();
    expect(teamReads).toBe(0);
    expect(historyReads).toBe(0);
    await user.click(chat);
    await user.type(screen.getByRole("textbox", { name: "New comment" }), "Keep this reply");
    await user.click(
      screen.getByRole("button", { name: module === "contract" ? "Contract team" : "Matter team" }),
    );
    const roster = await screen.findByRole("complementary", {
      name: module === "contract" ? "Contract team" : "Matter team",
    });
    expect(await within(roster).findByText(USER.displayName)).toBeInTheDocument();
    const rows = within(roster).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(person.displayName)).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText(module === "contract" ? "Legal Owner" : "Matter Manager"),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Creator")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Business Owner")).toBeInTheDocument();
    expect(within(roster).queryByRole("button", { name: /Add|Remove/ })).not.toBeInTheDocument();
    expect(teamReads).toBe(1);
    await user.click(chat);
    expect(screen.getByRole("textbox", { name: "New comment" })).toHaveValue("Keep this reply");
    await user.keyboard("{Escape}");
    expect(chat).toHaveFocus();
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Comments" })).not.toBeInTheDocument(),
    );
    await user.click(chat);
    expect(screen.getByRole("textbox", { name: "New comment" })).toHaveValue("Keep this reply");
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Shared update/)).toBeInTheDocument();
    denied = true;
    sources[0]!.open();
    expect(await screen.findByRole("alert")).toHaveTextContent("The history could not be read");
    expect(screen.queryByText(/Shared update/)).not.toBeInTheDocument();
  });

  it("uses the shared unread badge, mentions, and own-comment actions", async () => {
    let unread = 2;
    let sent: unknown;
    let comment: Record<string, unknown> | null = null;
    const candidate = {
      id: "legal",
      displayName: "Legal colleague",
      image: null,
      tiers: ["full_thread"],
    };
    stubApi({
      signedIn: USER,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/portal/${module}s/12`)
          return json(200, module === "contract" ? { contract: CONTRACT } : { matter: MATTER });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/work`)
          return json(200, { work: WORK });
        if (call.url.pathname === "/api/v1/comments/unread") return json(200, { unread });
        if (call.url.pathname === "/api/v1/comments/read") {
          unread = 0;
          return json(200, { unread });
        }
        if (call.url.pathname === "/api/v1/comments/mention-candidates")
          return json(200, { candidates: [candidate] });
        if (call.url.pathname === "/api/v1/comments") {
          if (call.method === "GET")
            return json(200, { comments: comment ? [comment] : [], nextCursor: null });
          sent = call.body;
          comment = {
            id: "mine",
            entityType: module,
            entityId: WORK.id,
            ...(call.body as object),
            author: { id: USER.id, displayName: USER.displayName, image: null, archived: false },
            mentions: [{ id: candidate.id, displayName: candidate.displayName }],
            attachments: [],
            createdAt: "2026-09-12T12:00:00Z",
            editedAt: null,
            deletedAt: null,
            redactedAt: null,
          };
          return json(201, { comment });
        }
        if (call.url.pathname === "/api/v1/comments/mine") {
          comment = {
            ...comment,
            ...(call.body as object),
            ...(call.method === "DELETE"
              ? { deletedAt: "2026-09-12T12:01:00Z" }
              : { editedAt: "2026-09-12T12:01:00Z" }),
          };
          return json(200, { comment });
        }
        return undefined;
      },
    });
    renderAt(`/portal/${module}s/12`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Comments.*2/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Comments" })).toBeInTheDocument(),
    );
    const box = screen.getByRole("textbox", { name: "New comment" });
    await user.type(box, "@Legal");
    await user.click(await screen.findByRole("option", { name: /Legal colleague/ }));
    await user.type(box, "please check");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(sent).toEqual(
        expect.objectContaining({ visibility: "full_thread", mentions: ["legal"] }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: "Comment actions" }));
    expect(screen.queryByRole("menuitem", { name: "Redact" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const edit = screen.getByRole("textbox", { name: "Edit comment" });
    await user.clear(edit);
    await user.type(edit, "Corrected reply");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Corrected reply")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Comment actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Comment deleted by its author.")).toBeInTheDocument();
  });

  it("posts a Full Thread reply using the record identity", async () => {
    const writes: unknown[] = [];
    stubApi({
      signedIn: USER,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/portal/${module}s/12`)
          return json(200, module === "contract" ? { contract: CONTRACT } : { matter: MATTER });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/work`)
          return json(200, { work: WORK });
        if (call.url.pathname === "/api/v1/comments") {
          if (call.method === "GET") return json(200, { comments: [], nextCursor: null });
          writes.push(call.body);
          return json(201, {
            comment: {
              id: "reply",
              entityType: module,
              entityId: WORK.id,
              author: { id: USER.id, displayName: USER.displayName, image: null, archived: false },
              body: "The business approves.",
              visibility: "full_thread",
              mentions: [],
              attachments: [],
              createdAt: "2026-09-11T12:00:00Z",
              editedAt: null,
              deletedAt: null,
              redactedAt: null,
            },
          });
        }
        return undefined;
      },
    });
    renderAt(`/portal/${module}s/12`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Comments" }));
    const conversation = await screen.findByRole("complementary", { name: "Comments" });
    await user.type(within(conversation).getByRole("textbox"), "The business approves.");
    await user.click(within(conversation).getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(writes).toEqual([
        expect.objectContaining({
          entityType: module,
          entityId: WORK.id,
          body: "The business approves.",
          visibility: "full_thread",
        }),
      ]),
    );
    expect(await within(conversation).findByText("The business approves.")).toBeInTheDocument();
    expect(
      within(conversation).queryByRole("radio", { name: "Working Team" }),
    ).not.toBeInTheDocument();
  });
});

it("redirects a converted Request to its Matter before loading a Request conversation", async () => {
  const oldThreadReads: string[] = [];
  stubApi({
    signedIn: USER,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/portal/requests/8")
        return json(200, {
          redirectTo: { module: "matter", number: 12 },
          recordArchived: false,
          request: { id: "old-request" },
        });
      if (call.url.pathname === "/api/v1/portal/matters/12") return json(200, { matter: MATTER });
      if (call.url.pathname === "/api/v1/comments") {
        if (call.url.searchParams.get("entityType") === "request")
          oldThreadReads.push(call.url.href);
        return json(200, { comments: [], nextCursor: null });
      }
      return undefined;
    },
  });
  const { router } = renderAt("/portal/requests/8");
  expect(await screen.findByRole("heading", { name: MATTER.title })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/portal/matters/12");
  expect(oldThreadReads).toEqual([]);
});

it.each([
  "/contracts",
  "/contracts/12",
  "/contracts/12/approvals",
  "/contracts/12/documents",
  "/contracts/12/tasks",
  "/matters",
  "/matters/12",
  "/matters/12/tasks",
  "/documents",
  "/entities",
  "/entities/e1",
  "/knowledge",
  "/inbox",
  "/home/tasks",
  "/settings/profile",
])("keeps a Business User out of the staff page %s", async (path) => {
  const staffReads: string[] = [];
  stubApi({
    signedIn: USER,
    extra: (call) => {
      if (
        /^\/api\/v1\/(contracts|matters|documents|entities|knowledge|inbox|home)(\/|$)/.test(
          call.url.pathname,
        )
      )
        staffReads.push(call.url.pathname);
      return undefined;
    },
  });
  const { router } = renderAt(path);
  await waitFor(() => expect(router.state.location.pathname).toBe("/portal"));
  expect(staffReads).toEqual([]);
});

it.each(["contract", "matter"] as const)(
  "uploads and appends supporting paper from the Portal %s",
  async (module) => {
    const uploads: string[] = [];
    let version = 0;
    stubApi({
      signedIn: USER,
      extra: (call) => {
        if (call.url.pathname === `/api/v1/portal/${module}s/12`)
          return json(200, module === "contract" ? { contract: CONTRACT } : { matter: MATTER });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/work`)
          return json(200, { work: WORK });
        if (call.url.pathname === `/api/v1/portal/${module}s/12/documents`)
          return json(200, {
            documents: version
              ? [
                  {
                    id: "paper",
                    title: "Supporting file",
                    isPrimary: false,
                    versions: [
                      {
                        isCurrent: true,
                        isExecuted: false,
                        createdAt: "2026-09-12T12:00:00Z",
                        uploadedBy: { id: USER.id, displayName: USER.displayName, image: null },
                        note: null,
                        id: `version-${version}`,
                        versionNumber: version,
                        originalFilename: "support.txt",
                        mimeType: "text/plain",
                        byteSize: 7,
                        renderFamily: "other",
                        kind: "general",
                      },
                    ],
                  },
                ]
              : [],
            nextCursor: null,
          });
        if (
          call.method === "POST" &&
          (call.url.pathname === `/api/v1/${module}s/12/documents` ||
            call.url.pathname === "/api/v1/documents/paper/versions")
        ) {
          uploads.push(call.url.pathname);
          version++;
          return json(201, { document: { id: "paper" } });
        }
        if (call.url.pathname === "/api/v1/comments")
          return json(200, { comments: [], nextCursor: null });
        return undefined;
      },
    });
    renderAt(`/portal/${module}s/12`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Upload documents" }));
    await user.upload(
      screen.getByLabelText("Files to upload"),
      new File(["support"], "support.txt", { type: "text/plain" }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Supporting file")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add version" }));
    await user.upload(
      screen.getByLabelText("Files to upload"),
      new File(["revised"], "support.txt", { type: "text/plain" }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Upload" }));
    await waitFor(() =>
      expect(uploads).toEqual([
        `/api/v1/${module}s/12/documents`,
        "/api/v1/documents/paper/versions",
      ]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Download Supporting file, version 2" }),
      ).toHaveAttribute("href", "/api/v1/documents/paper/versions/version-2/download"),
    );
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
  },
);
