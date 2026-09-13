// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001–004 through the destination, record, and form editor routes. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { destinationsFor } from "../components/shell/destinations";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const member = {
  id: "member",
  email: "legal@example.com",
  displayName: "Legal",
  role: "legal_team_member",
};
const autoDoc = {
  id: "nda",
  name: "Supplier NDA",
  description: "For suppliers",
  state: "draft",
  templateDocumentId: "template",
  createdAt: "2026-09-13T00:00:00Z",
  updatedAt: "2026-09-13T00:00:00Z",
};
const initialFields = [
  {
    slug: "counterparty_name",
    label: "Counterparty name",
    help: null,
    fieldType: "text",
    options: null,
    required: false,
    displayOrder: 0,
    placeholder: true,
  },
  {
    slug: "signing_date",
    label: "Signing date",
    help: null,
    fieldType: "text",
    options: null,
    required: false,
    displayOrder: 1,
    placeholder: true,
  },
];
function record() {
  const formVersion = {
    id: "form1",
    versionNumber: 1,
    definition: { fields: initialFields },
    createdBy: member.id,
    createdAt: autoDoc.createdAt,
  };
  return {
    autoDoc,
    template: {
      id: "template",
      title: "NDA.docx",
      versions: [
        {
          id: "v1",
          versionNumber: 1,
          originalFilename: "NDA.docx",
          byteSize: 100,
          createdAt: autoDoc.createdAt,
        },
      ],
    },
    detection: { placeholders: ["counterparty_name"], blocks: [] },
    formVersion,
    formVersions: [formVersion],
    orphanedFields: ["signing_date"],
  };
}

it("lists Auto-Docs and creates a draft from name and description", async () => {
  const user = userEvent.setup();
  const creates: unknown[] = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs") {
        if (call.method === "POST") {
          creates.push(call.body);
          return json(201, { autoDoc });
        }
        return json(200, { autoDocs: [autoDoc] });
      }
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, record());
      return undefined;
    },
  });
  renderAt("/auto-docs");
  expect(await screen.findByRole("link", { name: "Supplier NDA" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Create Auto-Doc" }));
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Supplier NDA");
  await user.type(screen.getByRole("textbox", { name: "Description" }), "For suppliers");
  await user.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("heading", { name: "Supplier NDA" });
  expect(creates).toEqual([{ name: "Supplier NDA", description: "For suppliers" }]);
});

it("edits fields, preserves the orphan cue, and shows saved form versions and upload refusals", async () => {
  const user = userEvent.setup();
  const saves: Array<{ fields: typeof initialFields }> = [];
  let current = record();
  let invalidReply = false;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/form-versions")) {
        const body = call.body as { fields: typeof initialFields };
        saves.push(body);
        const next = { ...current.formVersion, id: "form2", versionNumber: 2, definition: body };
        current = { ...current, formVersion: next, formVersions: [next, ...current.formVersions] };
        return json(201, current);
      }
      if (call.url.pathname.endsWith("/template"))
        return invalidReply
          ? json(201, {})
          : problem(400, 'Unclosed Block: "{{#block arbitration}}"');
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Supplier NDA" });
  expect(screen.getByText("1 orphaned field")).toBeVisible();
  expect(screen.getByText("This field no longer has a Placeholder in the template.")).toBeVisible();
  const date = screen.getByRole("group", { name: "signing_date" });
  await user.selectOptions(within(date).getByLabelText("Type"), "date");
  await user.clear(within(date).getByLabelText("Label"));
  await user.type(within(date).getByLabelText("Label"), "Date agreed");
  await user.type(within(date).getByLabelText("Help text"), "Confirm with Legal");
  await user.click(within(date).getByLabelText("Required"));
  await user.click(within(date).getByRole("button", { name: "Move up" }));
  await user.click(screen.getByRole("button", { name: "Add field" }));
  const added = screen.getByRole("group", { name: "field_1" });
  await user.clear(within(added).getByLabelText("Slug"));
  await user.type(within(added).getByLabelText("Slug"), "review_path");
  await user.selectOptions(within(added).getByLabelText("Type"), "single_select");
  await user.type(within(added).getByLabelText("Options, one per line"), "Standard{enter}Legal");
  expect(within(added).queryByRole("option", { name: "User" })).not.toBeInTheDocument();
  await user.click(
    within(screen.getByRole("group", { name: "counterparty_name" })).getByRole("button", {
      name: "Remove field",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Save form" }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]?.fields.map((f) => f.slug)).toEqual(["signing_date", "review_path"]);
  expect(saves[0]?.fields[0]).toMatchObject({
    fieldType: "date",
    label: "Date agreed",
    help: "Confirm with Legal",
    required: true,
  });
  expect(saves[0]?.fields[1]?.options).toEqual(["Standard", "Legal"]);
  expect(await screen.findByText("Form version 2")).toBeVisible();
  expect(screen.getByText("Form version 1")).toBeVisible();
  await user.upload(
    screen.getByLabelText("Word template"),
    new File(["word"], "broken.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Upload template" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    'Unclosed Block: "{{#block arbitration}}"',
  );
  invalidReply = true;
  await user.click(screen.getByRole("button", { name: "Upload template" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The upload response could not be read.",
  );
  expect(screen.getByText("Form version 2")).toBeVisible();
});

it("reserves the destination and app routes for Member+", async () => {
  expect(destinationsFor("legal_team_member").map((d) => d.id)).toContain("auto-docs");
  expect(destinationsFor("business_user").map((d) => d.id)).not.toContain("auto-docs");
  const calls: string[] = [];
  stubApi({
    signedIn: { ...member, role: "business_user" },
    extra: (call) => {
      calls.push(call.url.pathname);
      return undefined;
    },
  });
  const { router } = renderAt("/auto-docs/nda");
  await waitFor(() => expect(router.state.location.pathname).not.toBe("/auto-docs/nda"));
  expect(calls).not.toContain("/api/v1/auto-docs/nda");
});
