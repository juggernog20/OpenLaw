// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001–004 through the destination, record, and form editor routes. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { AutoDocAnswer } from "../lib/auto-docs";
type Definition = NonNullable<AutoDocAnswer["formVersion"]>["definition"];
import { destinationsFor } from "../components/shell/destinations";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const member = {
  id: "member",
  email: "legal@example.com",
  displayName: "Legal",
  role: "legal_team_member",
};
const autoDoc: AutoDocAnswer["autoDoc"] = {
  id: "nda",
  name: "Supplier NDA",
  description: "For suppliers",
  state: "draft",
  templateDocumentId: "template",
  audience: "legal_only",
  acknowledgementText: null,
  acknowledgementFrequency: "once_per_auto_doc",
  targetContractTypeId: null,
  titlePattern: null,
  fixedEntityId: null,
  defaultLegalOwnerId: null,
  formats: "both",
  coverNote: null,
  publishedDocumentVersionId: null,
  publishedFormVersionId: null,
  publishedAt: null,
  archivedAt: null,
  createdAt: "2026-09-13T00:00:00Z",
  updatedAt: "2026-09-13T00:00:00Z",
};
const initialFields: Definition["fields"] = [
  {
    slug: "counterparty_name",
    label: "Counterparty name",
    help: null,
    fieldType: "text",
    options: null,
    required: false,
    displayOrder: 0,
    placeholder: true,
    catalogFieldId: null,
    contractAttribute: null,
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
    catalogFieldId: null,
    contractAttribute: null,
  },
];
function record(): AutoDocAnswer & { formVersion: NonNullable<AutoDocAnswer["formVersion"]> } {
  const formVersion = {
    id: "form1",
    versionNumber: 1,
    definition: { fields: initialFields, clauseRules: [] },
    createdBy: member.id,
    createdAt: autoDoc.createdAt,
  };
  return {
    autoDoc,
    audienceUserIds: [],
    audienceDepartmentIds: [],
    defaultAcknowledgementText: "Do not edit.",
    portalWarnings: [],
    assignmentRules: [],
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
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, { catalogFields: [], contractTypes: [], entities: [], legalOwners: [] });
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

it("applies chip filters, preserves search, and restores filters through browser history", async () => {
  const user = userEvent.setup();
  const queries: URLSearchParams[] = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, {
          catalogFields: [],
          contractTypes: [{ id: "nda-type", displayName: "NDA" }],
          entities: [],
          legalOwners: [],
        });
      if (call.url.pathname === "/api/v1/auto-docs") {
        queries.push(call.url.searchParams);
        return json(200, { autoDocs: [autoDoc] });
      }
      return undefined;
    },
  });
  const { router } = renderAt("/auto-docs?q=Supplier&state=published");
  expect(await screen.findByRole("button", { name: "State: Published" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^Filter/ }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
      name: "Audience",
    }),
  );
  await user.click(screen.getByRole("radio", { name: "Everyone" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("button", { name: "Audience: Everyone" })).toBeVisible();
  expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({
    q: "Supplier",
    state: "published",
    audience: "everyone",
  });

  await user.click(screen.getByRole("button", { name: /^Filter/ }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
      name: "Target Contract Type",
    }),
  );
  await user.click(screen.getByRole("radio", { name: "NDA" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByRole("button", { name: "Target Contract Type: NDA" })).toBeVisible();
  await user.clear(screen.getByRole("searchbox", { name: "Search Auto-Docs" }));
  await user.type(screen.getByRole("searchbox", { name: "Search Auto-Docs" }), "Agreement{enter}");
  await waitFor(() =>
    expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({
      q: "Agreement",
      state: "published",
      audience: "everyone",
      targetContractTypeId: "nda-type",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Remove State filter" }));
  await waitFor(() => expect(queries.at(-1)!.has("state")).toBe(false));
  expect(screen.getByRole("button", { name: "Audience: Everyone" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  await waitFor(() => expect(Object.fromEntries(queries.at(-1)!)).toEqual({ q: "Agreement" }));
  expect(screen.queryByRole("button", { name: "Audience: Everyone" })).not.toBeInTheDocument();
  await router.navigate(-1);
  expect(await screen.findByRole("button", { name: "Audience: Everyone" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Target Contract Type: NDA" })).toBeVisible();
  expect(screen.getByRole("searchbox", { name: "Search Auto-Docs" })).toHaveValue("Agreement");
});

it("shows Auto-Doc metadata in a sortable table with optional columns", async () => {
  const user = userEvent.setup();
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, {
          catalogFields: [],
          contractTypes: [{ id: "type", displayName: "Supplier agreement" }],
          entities: [{ id: "entity", name: "OpenLaw Ltd" }],
          legalOwners: [{ id: "owner", displayName: "Alex Legal" }],
        });
      if (call.url.pathname === "/api/v1/auto-docs")
        return json(200, {
          autoDocs: [
            {
              ...autoDoc,
              id: "a",
              name: "Alpha agreement",
              targetContractTypeId: "type",
              defaultLegalOwnerId: "owner",
              fixedEntityId: "entity",
              publishedAt: "2026-09-12T00:00:00Z",
              state: "published",
            },
            {
              ...autoDoc,
              id: "z",
              name: "Zulu agreement",
              formats: "pdf",
              updatedAt: "2026-09-14T00:00:00Z",
            },
          ],
        });
      return undefined;
    },
  });
  renderAt("/auto-docs");
  const table = await screen.findByRole("table");
  expect(within(table).getByText("Supplier agreement")).toBeVisible();
  expect(within(table).getByText("Word + PDF")).toBeVisible();
  expect(within(table).getByText("PDF", { exact: true })).toBeVisible();
  expect(within(table).getByText("Published")).toBeVisible();
  expect(within(table).getAllByText("Legal only")).toHaveLength(2);
  await user.click(within(table).getByRole("button", { name: "Name" }));
  await user.click(within(table).getByRole("button", { name: "Name" }));
  expect(
    within(table)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Zulu agreement", "Alpha agreement"]);
  await user.click(within(table).getByRole("button", { name: "Name" }));
  expect(
    within(table)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Alpha agreement", "Zulu agreement"]);
  await user.click(screen.getByRole("button", { name: "Columns" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Default Legal Owner" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Fixed Entity" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "Published" }));
  await user.keyboard("{Escape}");
  expect(within(table).getByText("Alex Legal")).toBeVisible();
  expect(within(table).getByText("OpenLaw Ltd")).toBeVisible();
  expect(table.querySelector('time[datetime="2026-09-12T00:00:00Z"]')).toBeInTheDocument();
  await user.click(within(table).getByRole("button", { name: "Published" }));
  await user.click(within(table).getByRole("button", { name: "Published" }));
  expect(
    within(table)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Alpha agreement", "Zulu agreement"]);
});

it("explains an empty filtered result", async () => {
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, { contractTypes: [], legalOwners: [], entities: [], catalogFields: [] });
      if (call.url.pathname === "/api/v1/auto-docs") return json(200, { autoDocs: [] });
      return undefined;
    },
  });
  renderAt("/auto-docs?q=missing");
  expect(await screen.findByText("No Auto-Docs match your search and filters")).toBeVisible();
  expect(
    screen.queryByText("Create an Auto-Doc to start with a Word template."),
  ).not.toBeInTheDocument();
});

const reading = {
  versionId: "v1",
  versionNumber: 1,
  parts: [
    {
      name: "word/document.xml",
      kind: "body",
      paragraphs: [
        [
          { kind: "text", text: "Between Helix and " },
          {
            kind: "placeholder",
            text: "{{counterparty_name}}",
            name: "counterparty_name",
            directive: null,
            hasField: true,
          },
        ],
      ],
    },
  ],
};

it("edits a field from its card, keeps the orphan cue, and reports or refuses an upload in the dialog", async () => {
  const user = userEvent.setup();
  const saves: Array<Definition> = [];
  let current = record();
  let invalidReply = false;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, { catalogFields: [], contractTypes: [], entities: [], legalOwners: [] });
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/reading")) return json(200, reading);
      if (call.url.pathname.endsWith("/form-versions")) {
        const body = call.body as Definition;
        saves.push(body);
        const next = {
          ...current.formVersion,
          id: `form${saves.length + 1}`,
          versionNumber: saves.length + 1,
          definition: {
            fields: body.fields.map((field, displayOrder) => ({
              ...field,
              displayOrder,
              placeholder: current.formVersion.definition.fields.some(
                (known) => known.slug === field.slug && known.placeholder,
              ),
            })),
            clauseRules: body.clauseRules,
          },
        };
        current = {
          ...current,
          formVersion: next,
          formVersions: [next, ...current.formVersions],
          orphanedFields: next.definition.fields
            .filter(
              (field) => field.placeholder && !current.detection.placeholders.includes(field.slug),
            )
            .map((field) => field.slug),
        };
        return json(201, current);
      }
      if (call.url.pathname.endsWith("/template"))
        return invalidReply
          ? json(201, {})
          : problem(400, 'Unclosed Block: "{{#block arbitration}}"');
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/form");
  await screen.findByRole("heading", { name: "Supplier NDA" });
  const fields = screen.getByRole("region", { name: "Fields" });
  expect(within(fields).getByText("1 orphaned")).toBeVisible();
  expect(within(fields).getByText("No Placeholder in file version 1")).toBeVisible();
  expect(screen.getByRole("button", { name: "Placeholder counterparty_name" })).toBeVisible();
  await user.click(within(fields).getByRole("button", { name: "Edit Signing date" }));
  const card = screen.getByRole("region", { name: "Signing date" });
  await user.selectOptions(within(card).getByLabelText("Type"), "date");
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]?.fields[1]).toMatchObject({ slug: "signing_date", fieldType: "date" });
  await user.clear(within(card).getByLabelText("Label"));
  await user.type(within(card).getByLabelText("Label"), "Date agreed{enter}");
  await waitFor(() => expect(saves.at(-1)?.fields[1]).toMatchObject({ label: "Date agreed" }));
  await user.type(within(card).getByLabelText("Help text"), "Confirm with Legal");
  await user.tab();
  await waitFor(() =>
    expect(saves.at(-1)?.fields[1]).toMatchObject({ help: "Confirm with Legal" }),
  );
  await user.click(within(card).getByLabelText("Required"));
  await waitFor(() => expect(saves.at(-1)?.fields[1]).toMatchObject({ required: true }));
  // The orphan cue survives every commit: the Placeholder is still gone.
  expect(within(fields).getByText("No Placeholder in file version 1")).toBeVisible();
  within(fields).getByRole("button", { name: "Reorder Date agreed, 2 of 2" }).focus();
  await user.keyboard("{ArrowUp}");
  await waitFor(() =>
    expect(saves.at(-1)?.fields.map((field) => field.slug)).toEqual([
      "signing_date",
      "counterparty_name",
    ]),
  );
  await user.click(within(fields).getByRole("button", { name: "Add field" }));
  await waitFor(() => expect(saves.at(-1)?.fields.map((field) => field.slug)).toContain("field_1"));
  const added = await screen.findByRole("region", { name: "New field" });
  await user.selectOptions(within(added).getByLabelText("Type"), "single_select");
  expect(within(added).queryByRole("option", { name: "User" })).not.toBeInTheDocument();
  await waitFor(() => expect(saves.at(-1)?.fields.at(-1)?.options).toEqual(["Option 1"]));
  const optionsBox = within(added).getByLabelText("Options");
  await user.clear(optionsBox);
  await user.type(optionsBox, "Standard{enter}Legal");
  await user.tab();
  await waitFor(() => expect(saves.at(-1)?.fields.at(-1)?.options).toEqual(["Standard", "Legal"]));
  // A field whose Placeholder is still in the file runs the guard.
  await user.click(within(fields).getByRole("button", { name: "Remove Counterparty name" }));
  const guard = screen.getByRole("dialog");
  expect(guard).toHaveTextContent("{{counterparty_name}}");
  await user.click(within(guard).getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(saves.at(-1)?.fields.map((field) => field.slug)).toEqual(["signing_date", "field_1"]),
  );
  expect(screen.queryByRole("button", { name: "Save form" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Upload version" }));
  const upload = screen.getByRole("dialog");
  await user.upload(
    within(upload).getByLabelText("Word template"),
    new File(["word"], "broken.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  await user.click(within(upload).getByRole("button", { name: "Upload" }));
  expect(await within(upload).findByRole("alert")).toHaveTextContent(
    'Unclosed Block: "{{#block arbitration}}"',
  );
  invalidReply = true;
  await user.click(within(upload).getByRole("button", { name: "Upload" }));
  await waitFor(() =>
    expect(within(upload).getByRole("alert")).toHaveTextContent(
      "The upload response could not be read.",
    ),
  );
});

it("refuses a duplicate slug and empty options beside the control, before anything is sent", async () => {
  const user = userEvent.setup();
  const saves: Array<Definition> = [];
  let current = record();
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, { catalogFields: [], contractTypes: [], entities: [], legalOwners: [] });
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/reading")) return json(200, reading);
      if (call.url.pathname.endsWith("/form-versions")) {
        const body = call.body as Definition;
        saves.push(body);
        const next = { ...current.formVersion, id: "form2", versionNumber: 2, definition: body };
        current = { ...current, formVersion: next, formVersions: [next, ...current.formVersions] };
        return json(201, current);
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/form");
  await screen.findByRole("heading", { name: "Supplier NDA" });
  await user.click(screen.getByRole("button", { name: "Edit Signing date" }));
  const card = screen.getByRole("region", { name: "Signing date" });

  // Two fields on the same slug never reach the seam: the box reverts.
  const slug = within(card).getByLabelText("Slug");
  await user.clear(slug);
  await user.type(slug, "counterparty_name");
  await user.tab();
  expect(
    await within(card).findByText(
      "Use lowercase letters, digits, and underscores, unique on this form.",
    ),
  ).toBeVisible();
  expect(slug).toHaveValue("signing_date");
  expect(saves).toHaveLength(0);

  await user.selectOptions(within(card).getByLabelText("Type"), "single_select");
  await waitFor(() => expect(saves).toHaveLength(1));
  const options = within(card).getByLabelText("Options");
  await user.clear(options);
  await user.type(options, "Standard{enter}Standard");
  await user.tab();
  expect(
    await within(card).findByText("Give the field distinct, non-empty options."),
  ).toBeVisible();
  expect(saves).toHaveLength(1);

  // A trailing newline is typing, not an empty option.
  await user.clear(options);
  await user.type(options, "Standard{enter}Legal{enter}");
  await user.tab();
  await waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1]?.fields.find((f) => f.slug === "signing_date")?.options).toEqual([
    "Standard",
    "Legal",
  ]);
});

it("reserves the destination and app routes for Member+", async () => {
  expect(destinationsFor("legal_team_member").map((d) => d.id)).toContain("auto-docs");
  expect(destinationsFor("business_user").map((d) => d.id)).not.toContain("auto-docs");
  const calls: string[] = [];
  stubApi({
    signedIn: { ...member, role: "business_user" },
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options")
        return json(200, { catalogFields: [], contractTypes: [], entities: [], legalOwners: [] });
      calls.push(call.url.pathname);
      return undefined;
    },
  });
  const { router } = renderAt("/auto-docs/nda");
  await waitFor(() => expect(router.state.location.pathname).not.toBe("/auto-docs/nda"));
  expect(calls).not.toContain("/api/v1/auto-docs/nda");
});
