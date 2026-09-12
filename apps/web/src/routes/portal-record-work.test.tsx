// SPDX-License-Identifier: AGPL-3.0-only

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

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
      summary: "Please review",
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
    const conversation = await screen.findByRole("region", { name: "Conversation" });
    await user.type(within(conversation).getByRole("textbox"), "The business approves.");
    await user.click(within(conversation).getByRole("button", { name: "Send" }));
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
        if (call.url.pathname.endsWith("/supporting-documents"))
          return json(200, {
            documents: version
              ? [
                  {
                    id: "paper",
                    title: "Supporting file",
                    version: {
                      id: `version-${version}`,
                      versionNumber: version,
                      originalFilename: "support.txt",
                      mimeType: "text/plain",
                      byteSize: 7,
                      renderFamily: "text",
                      kind: "general",
                    },
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
    const input = await screen.findByLabelText("Upload Document");
    await user.click(screen.getByRole("button", { name: "Upload Document" }));
    await user.upload(input, new File(["support"], "support.txt", { type: "text/plain" }));
    expect(await screen.findByText("Supporting file")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add version" }));
    await user.upload(input, new File(["revised"], "support.txt", { type: "text/plain" }));
    await waitFor(() =>
      expect(uploads).toEqual([
        `/api/v1/${module}s/12/documents`,
        "/api/v1/documents/paper/versions",
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
        "href",
        "/api/v1/documents/paper/versions/version-2/download",
      ),
    );
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
  },
);
