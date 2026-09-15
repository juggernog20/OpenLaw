// SPDX-License-Identifier: AGPL-3.0-only

/** DES-087: the builder's rules, maps, and Publish; the settings cards; the Generations table. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
import { formatLongDateTime } from "../lib/format";
import type { paths } from "@openlaw/api-client";

type RecordAnswer =
  paths["/api/v1/auto-docs/{id}"]["get"]["responses"][200]["content"]["application/json"];
type Definition = NonNullable<RecordAnswer["formVersion"]>["definition"];
const member = {
  id: "member",
  email: "legal@example.com",
  displayName: "Legal",
  role: "legal_team_member",
};
const date = "2026-09-13T00:00:00Z";
function record(): RecordAnswer {
  const fields: Definition["fields"] = [
    {
      slug: "jurisdiction",
      label: "Jurisdiction",
      help: null,
      fieldType: "single_select",
      options: ["US", "UK"],
      required: true,
      displayOrder: 0,
      placeholder: true,
      catalogFieldId: null,
      contractAttribute: null,
    },
  ];
  const formVersion = {
    id: "form2",
    versionNumber: 2,
    definition: { fields, clauseRules: [] },
    createdBy: "member",
    createdAt: date,
  };
  return {
    autoDoc: {
      id: "nda",
      name: "Publish NDA",
      description: null,
      state: "draft",
      audience: "legal_only",
      acknowledgementText: null,
      targetContractTypeId: null,
      titlePattern: null,
      fixedEntityId: null,
      defaultLegalOwnerId: null,
      formats: "both",
      coverNote: null,
      templateDocumentId: "template",
      publishedDocumentVersionId: null,
      publishedFormVersionId: null,
      publishedAt: null,
      archivedAt: null,
      createdAt: date,
      updatedAt: date,
    },
    template: {
      id: "template",
      title: "NDA.docx",
      versions: [2, 1].map((number) => ({
        id: `file${number}`,
        versionNumber: number,
        originalFilename: "NDA.docx",
        byteSize: 100,
        createdAt: date,
      })),
    },
    detection: { placeholders: ["jurisdiction"], blocks: ["arbitration"] },
    formVersion,
    formVersions: [formVersion, { ...formVersion, id: "form1", versionNumber: 1 }],
    orphanedFields: [],
    audienceUserIds: [],
    audienceDepartmentIds: [],
    defaultAcknowledgementText: "Do not edit.",
    portalWarnings: [],
    assignmentRules: [],
  };
}
const options = {
  audienceUsers: [{ id: "buyer", displayName: "Buyer" }],
  departments: [{ id: "sales", displayName: "Sales" }],
  legalOwners: [
    { id: "member", displayName: "Legal" },
    { id: "other", displayName: "Other Legal" },
  ],
  entities: [{ id: "entity", name: "Example Subsidiary" }],
  catalogFields: [{ id: "catalog", displayName: "Contract reference", fieldType: "text" }],
  contractTypes: [{ id: "type", displayName: "NDA" }],
};
const reading = (hasField = true) => ({
  versionId: "file2",
  versionNumber: 2,
  parts: [
    {
      name: "word/document.xml",
      kind: "body",
      paragraphs: [
        [
          { kind: "text", text: "Governed by " },
          {
            kind: "placeholder",
            text: "{{jurisdiction}}",
            name: "jurisdiction",
            directive: null,
            hasField,
          },
          { kind: "text", text: "." },
        ],
        [
          { kind: "block_open", name: "arbitration" },
          { kind: "text", text: "Disputes go to arbitration." },
          { kind: "block_close", name: "arbitration" },
        ],
      ],
    },
  ],
});

/** The record stub every builder test starts from; `current` is the record the seam holds. */
function builderStub(state: { current: RecordAnswer; saves: Definition[] }) {
  return (call: { url: URL; method: string; body?: unknown }) => {
    if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
    if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
    if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, state.current);
    if (call.url.pathname.endsWith("/reading")) return json(200, reading());
    if (call.url.pathname.endsWith("/form-versions")) {
      const body = call.body as Definition;
      state.saves.push(body);
      const version = {
        ...state.current.formVersion!,
        id: `form${state.saves.length + 2}`,
        versionNumber: state.saves.length + 2,
        definition: {
          fields: body.fields.map((field, displayOrder) => ({
            ...field,
            displayOrder,
            placeholder: state.current.detection.placeholders.includes(field.slug),
          })),
          clauseRules: body.clauseRules,
        },
      };
      state.current = {
        ...state.current,
        formVersion: version,
        formVersions: [version, ...state.current.formVersions],
      };
      return json(201, state.current);
    }
    return undefined;
  };
}

it("selects a field from its Placeholder chip, maps it, and writes each Clause operator as its own form version", async () => {
  const user = userEvent.setup();
  const state = { current: record(), saves: [] as Definition[] };
  stubApi({ signedIn: member, extra: builderStub(state) });
  renderAt("/auto-docs/nda/form");
  await screen.findByRole("heading", { name: "Publish NDA" });
  await user.click(screen.getByRole("button", { name: "Placeholder jurisdiction" }));
  const card = screen.getByRole("region", { name: "Jurisdiction" });
  await user.selectOptions(within(card).getByLabelText("Map to"), "catalog:catalog");
  await waitFor(() => expect(state.saves).toHaveLength(1));
  expect(state.saves[0]?.fields[0]).toMatchObject({
    catalogFieldId: "catalog",
    contractAttribute: null,
  });
  await user.click(screen.getByRole("button", { name: "Edit the rule for arbitration" }));
  const rule = screen.getByRole("region", { name: "arbitration" });
  await user.selectOptions(within(rule).getByLabelText("Include"), "conditional");
  await waitFor(() =>
    expect(state.saves.at(-1)?.clauseRules[0]).toMatchObject({
      blockName: "arbitration",
      operator: "equals",
    }),
  );
  for (const operator of ["is_one_of", "is_set", "is_not"]) {
    await user.selectOptions(within(rule).getByLabelText("Operator"), operator);
    await waitFor(() => expect(state.saves.at(-1)?.clauseRules[0]?.operator).toBe(operator));
    if (operator === "is_one_of") {
      const value = within(rule).getByLabelText("Value");
      expect(within(value).getByRole("option", { name: "US" })).toBeInTheDocument();
      await user.selectOptions(value, ["US", "UK"]);
      await waitFor(() => expect(state.saves.at(-1)?.clauseRules[0]?.value).toEqual(["US", "UK"]));
    }
  }
  expect(screen.getByText("Included when Jurisdiction is not US")).toBeVisible();
  // One selection at a time: the rule card replaced the field card.
  expect(screen.queryByRole("region", { name: "Jurisdiction" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit Jurisdiction" }));
  await user.selectOptions(
    within(screen.getByRole("region", { name: "Jurisdiction" })).getByLabelText("Map to"),
    "attribute:title",
  );
  await waitFor(() =>
    expect(state.saves.at(-1)?.fields[0]).toMatchObject({
      catalogFieldId: null,
      contractAttribute: "title",
    }),
  );
  expect(
    within(screen.getByRole("region", { name: "Fields" })).getByText(
      "jurisdiction · Single select · Title",
    ),
  ).toBeVisible();
});

it("publishes from a dialog that lists every gap, then unpublishes, archives, and restores from the menu", async () => {
  const user = userEvent.setup();
  let current = record();
  let refuse = true;
  const publishes: unknown[] = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/reading")) return json(200, reading());
      if (call.url.pathname.endsWith("/form-versions/diff"))
        return json(200, {
          changes: [
            { kind: "retyped", name: "jurisdiction", before: "text", after: "single_select" },
            { kind: "rules_changed", name: "arbitration", before: null, after: "rule" },
          ],
        });
      for (const action of ["publish", "unpublish", "archive", "restore"])
        if (call.url.pathname.endsWith(`/${action}`)) {
          if (action === "publish") {
            publishes.push(call.body);
            if (refuse)
              return problem(
                409,
                'Add a form field for "counterparty_name". Block "missing" is absent. Option "CA" is absent.',
              );
          }
          const pair = call.body as { documentVersionId: string; formVersionId: string };
          current = {
            ...current,
            autoDoc: {
              ...current.autoDoc,
              state:
                action === "publish" ? "published" : action === "archive" ? "archived" : "draft",
              publishedDocumentVersionId: action === "publish" ? pair.documentVersionId : null,
              publishedFormVersionId: action === "publish" ? pair.formVersionId : null,
              publishedAt: action === "publish" ? date : null,
              archivedAt: action === "archive" ? date : null,
            },
          };
          return json(200, current);
        }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  // The sub-bar's Publish and the Publication card's both open the dialog.
  await user.click(screen.getAllByRole("button", { name: "Publish" })[0]!);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("File version")).toHaveValue("file2");
  expect(within(dialog).getByLabelText("Form version")).toHaveValue("form2");
  await user.selectOptions(within(dialog).getByLabelText("File version"), "file1");
  await user.selectOptions(within(dialog).getByLabelText("Form version"), "form1");
  await user.click(within(dialog).getByRole("button", { name: "Publish" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent('"counterparty_name"');
  expect(within(dialog).getByRole("alert")).toHaveTextContent('"missing"');
  expect(within(dialog).getByRole("alert")).toHaveTextContent('"CA"');
  refuse = false;
  await user.click(within(dialog).getByRole("button", { name: "Publish" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(publishes.at(-1)).toEqual({ documentVersionId: "file1", formVersionId: "form1" });
  expect(
    screen.getByText("Live since Sep 13, 2026: file version 1, form version 1."),
  ).toBeVisible();
  expect(
    screen.getByText(
      "File version 2 and form version 2 are newer than the currently published file and form.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Generate" })).toHaveAttribute(
    "href",
    "/auto-docs/nda/generate",
  );
  await user.click(screen.getByRole("link", { name: "Form" }));
  await user.click(await screen.findByRole("button", { name: "Compare versions" }));
  expect(await screen.findByText(/Retyped jurisdiction/)).toBeVisible();
  expect(screen.getByText(/Clause rule changed: arbitration/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("link", { name: "Compare files" })).toHaveAttribute(
    "href",
    "/documents/template/compare?from=file1&to=file2",
  );
  const menu = () => screen.getByRole("button", { name: "Auto-Doc actions" });
  await user.click(menu());
  await user.click(await screen.findByRole("menuitem", { name: "Unpublish" }));
  await screen.findByRole("button", { name: "Publish" });
  await user.click(menu());
  await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument(),
  );
  await user.click(menu());
  await user.click(await screen.findByRole("menuitem", { name: "Restore" }));
  await screen.findByRole("button", { name: "Publish" });
});

it("commits each setting on its own, then applies list filters", async () => {
  const user = userEvent.setup();
  let current = record();
  const edits: unknown[] = [];
  const searches: URLSearchParams[] = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") {
        if (call.method === "PATCH") {
          const body = call.body as Partial<RecordAnswer["autoDoc"]>;
          edits.push(body);
          current = { ...current, autoDoc: { ...current.autoDoc, ...body } };
        }
        return json(200, current);
      }
      if (call.url.pathname === "/api/v1/auto-docs") {
        searches.push(call.url.searchParams);
        return json(200, { autoDocs: [current.autoDoc] });
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/settings");
  await screen.findByRole("heading", { name: "Publish NDA" });
  const reach = screen.getByRole("region", { name: "Reach" });
  await user.selectOptions(within(reach).getByLabelText("Audience"), "everyone");
  await waitFor(() => expect(edits).toEqual([{ audience: "everyone" }]));
  const creation = screen.getByRole("region", { name: "Contract creation" });
  expect(
    within(creation).getByText(
      "Without a target, a Generation's file stays on the Generation until it is Filed.",
    ),
  ).toBeVisible();
  await user.selectOptions(within(creation).getByLabelText("Target Contract Type"), "type");
  await waitFor(() => expect(edits).toHaveLength(2));
  const titleInput = within(creation).getByLabelText("Title pattern");
  await user.click(titleInput);
  await user.paste("NDA ");
  await user.tab();
  expect(within(creation).getByRole("button", { name: "Insert title variable" })).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "Jurisdiction" }));
  expect(titleInput).toHaveValue("NDA {{jurisdiction}}");
  expect(titleInput).toHaveFocus();
  expect(edits).toHaveLength(2);
  await user.tab();
  await user.tab();
  await waitFor(() => expect(edits.at(-1)).toEqual({ titlePattern: "NDA {{jurisdiction}}" }));
  await user.selectOptions(within(creation).getByLabelText("Our Entity"), "entity");
  await waitFor(() => expect(edits.at(-1)).toEqual({ fixedEntityId: "entity" }));
  const output = screen.getByRole("region", { name: "Output" });
  await user.selectOptions(within(output).getByLabelText("Formats"), "pdf");
  await waitFor(() => expect(edits.at(-1)).toEqual({ formats: "pdf" }));
  await user.type(within(output).getByLabelText("Cover note"), "Please **review** this.");
  expect(within(output).getByText("review")).toBeVisible();
  await user.tab();
  await waitFor(() => expect(edits.at(-1)).toEqual({ coverNote: "Please **review** this." }));
  expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("link", { name: "Auto-Docs" })[0]!);
  await screen.findByRole("button", { name: "Filter" });
  await user.type(screen.getByRole("searchbox", { name: "Search Auto-Docs" }), "NDA{enter}");
  await waitFor(() => expect(searches.at(-1)?.get("q")).toBe("NDA"));
  for (const [label, choice] of [
    ["State", "Archived"],
    ["Audience", "Everyone"],
    ["Target Contract Type", options.contractTypes[0]!.displayName],
  ]) {
    await waitFor(() => expect(screen.getByRole("button", { name: /^Filter/ })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    const menu = screen.getByRole("dialog", { name: "Filter" });
    await user.click(within(menu).getByRole("button", { name: label }));
    await user.click(within(menu).getByRole("radio", { name: choice }));
    await user.click(within(menu).getByRole("button", { name: "Apply" }));
    await screen.findByRole("button", { name: `${label}: ${choice}` });
  }
  expect(Object.fromEntries(searches.at(-1)!)).toEqual({
    q: "NDA",
    state: "archived",
    audience: "everyone",
    targetContractTypeId: "type",
  });
});

it("commits a typed is-one-of rule value when focus leaves the rule", async () => {
  const user = userEvent.setup();
  const state = { current: record(), saves: [] as Definition[] };
  state.current.formVersion!.definition.fields[0] = {
    ...state.current.formVersion!.definition.fields[0]!,
    fieldType: "text",
    options: null,
  };
  stubApi({ signedIn: member, extra: builderStub(state) });
  renderAt("/auto-docs/nda/form");
  await screen.findByRole("heading", { name: "Publish NDA" });
  await user.click(screen.getByRole("button", { name: "Edit the rule for arbitration" }));
  const rule = screen.getByRole("region", { name: "arbitration" });
  await user.selectOptions(within(rule).getByLabelText("Include"), "conditional");
  await waitFor(() => expect(state.saves).toHaveLength(1));
  await user.selectOptions(within(rule).getByLabelText("Operator"), "is_one_of");
  const input = within(rule).getByLabelText("Value");
  await user.type(input, "United States{enter}United Kingdom{enter}");
  expect(input).toHaveValue("United States\nUnited Kingdom\n");
  expect(state.saves).toHaveLength(1);
  await user.tab();
  await waitFor(() =>
    expect(state.saves.at(-1)?.clauseRules[0]?.value).toEqual(["United States", "United Kingdom"]),
  );
});

it("drops unknown state and audience filters from a copied list URL", async () => {
  const searches: URLSearchParams[] = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs") {
        searches.push(call.url.searchParams);
        return json(200, { autoDocs: [] });
      }
      return undefined;
    },
  });
  renderAt("/auto-docs?state=obsolete&audience=unknown");
  await screen.findByRole("button", { name: "Filter" });
  expect(searches[0]?.has("state")).toBe(false);
  expect(searches[0]?.has("audience")).toBe(false);
  expect(screen.queryByRole("button", { name: "Remove State filter" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Audience filter" })).not.toBeInTheDocument();
});

it("draws a rule on the Block tag and marks a Block the file no longer holds", async () => {
  const state = { current: record(), saves: [] as Definition[] };
  state.current.formVersion!.definition.clauseRules = ["arbitration", "notice"].map(
    (blockName) => ({
      blockName,
      fieldSlug: "jurisdiction",
      operator: "equals",
      value: "US",
    }),
  );
  stubApi({ signedIn: member, extra: builderStub(state) });
  renderAt("/auto-docs/nda/form");
  await screen.findByRole("heading", { name: "Publish NDA" });
  expect(screen.getByRole("button", { name: "Block arbitration" })).toHaveTextContent(
    "arbitration · when Jurisdiction equals US",
  );
  const clauses = screen.getByRole("region", { name: "Clauses" });
  expect(within(clauses).getByText("1 missing")).toBeVisible();
  expect(within(clauses).getByText("Not in file version 2")).toBeVisible();
  expect(within(clauses).getAllByText("Included when Jurisdiction equals US")).toHaveLength(2);
});

it("redirects a section the record does not have to the bare address", async () => {
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, record());
      return undefined;
    },
  });
  const { router } = renderAt("/auto-docs/nda/paperwork");
  await waitFor(() => expect(router.state.location.pathname).toBe("/auto-docs/nda"));
  await screen.findByRole("region", { name: "About" });
});

it("shows Generation history and retries a failed fill", async () => {
  const user = userEvent.setup();
  let retried = false;
  const base = {
    autoDocId: "nda",
    autoDocName: "Publish NDA",
    formats: "docx",
    createdContract: null,
    hasPdf: false,
    emailState: "not_requested",
    emailSentAt: null,
    emailFailure: null,
    documentVersionId: "file1",
    formVersionId: "form2",
    documentVersionNumber: 1,
    formVersionNumber: 2,
    generatedBy: "member",
    person: { id: "member", displayName: "Legal" },
    answers: {},
    createdAt: date,
    updatedAt: date,
  };
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, record());
      if (call.url.pathname.endsWith("/failed/retry") && call.method === "POST") {
        retried = true;
        return json(200, {
          generation: { ...base, id: "failed", state: "ready", hasDocx: true, failure: null },
        });
      }
      if (call.url.pathname.endsWith("/generations"))
        return json(200, {
          generations: [
            { ...base, id: "ready", state: "ready", hasDocx: true, failure: null },
            {
              ...base,
              id: "failed",
              state: retried ? "ready" : "failed",
              hasDocx: retried,
              failure: retried
                ? null
                : { code: "fill_failed", detail: "The Word fill timed out. Try again." },
            },
          ],
        });
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generations");
  const list = await screen.findByRole("region", { name: "Generations" });
  expect(within(list).getAllByRole("link", { name: "Legal" })[0]).toHaveAttribute(
    "href",
    "/auto-docs/nda/generations/ready",
  );
  expect(within(list).getAllByText("File version 1, form version 2")).toHaveLength(2);
  expect(within(list).getAllByTitle(formatLongDateTime(date))[0]).toHaveAttribute("datetime", date);
  expect(within(list).getByRole("link", { name: "Download Word" })).toHaveAttribute(
    "href",
    "/api/v1/auto-docs/nda/generations/ready/docx",
  );
  expect(within(list).getByText("The Word fill timed out. Try again.")).toBeVisible();
  const fileButtons = within(list).getAllByRole("button", { name: "File" });
  expect(fileButtons[0]).toBeEnabled();
  expect(fileButtons[1]).toBeDisabled();
  expect(within(list).getAllByRole("link", { name: "Generate again" })[0]).toHaveAttribute(
    "href",
    "/auto-docs/nda/generate?from=ready",
  );
  await user.click(within(list).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(within(list).getAllByRole("link", { name: "Download Word" })).toHaveLength(2),
  );
  expect(within(list).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

it("saves the currency and cadence of a Contract Value map", async () => {
  const user = userEvent.setup();
  const state = { current: record(), saves: [] as Definition[] };
  state.current.formVersion!.definition.fields[0] = {
    ...state.current.formVersion!.definition.fields[0]!,
    fieldType: "currency",
    options: null,
    valueCurrency: "AED",
  };
  stubApi({ signedIn: member, extra: builderStub(state) });
  renderAt("/auto-docs/nda/form");
  await screen.findByRole("heading", { name: "Publish NDA" });
  await user.click(screen.getByRole("button", { name: "Edit Jurisdiction" }));
  const card = screen.getByRole("region", { name: "Jurisdiction" });
  await user.selectOptions(within(card).getByLabelText("Map to"), "attribute:value");
  await waitFor(() => expect(state.saves).toHaveLength(1));
  expect(within(card).getByLabelText("Currency")).toHaveValue("AED");
  await user.selectOptions(within(card).getByLabelText("Cadence"), "annually");
  await waitFor(() =>
    expect(state.saves.at(-1)?.fields[0]).toMatchObject({
      contractAttribute: "value",
      valueCurrency: "AED",
      valueCadence: "annually",
    }),
  );
  await user.selectOptions(within(card).getByLabelText("Cadence"), "");
  await waitFor(() => expect(state.saves.at(-1)?.fields[0]).toMatchObject({ valueCadence: null }));
});

it("edits ordered Assignment rules in a dialog with every operator and an optional default Legal Owner", async () => {
  const user = userEvent.setup();
  let current = record();
  current.autoDoc.targetContractTypeId = "type";
  let nextRuleId = 0;
  const saves: Array<{
    rules: Array<{
      id?: string;
      fieldSlug: string;
      operator: string;
      value: unknown;
      legalOwnerId: string;
    }>;
    defaultLegalOwnerId: string | null;
  }> = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/assignment-rules")) {
        const body = call.body as (typeof saves)[number];
        saves.push(body);
        current = {
          ...current,
          autoDoc: { ...current.autoDoc, defaultLegalOwnerId: body.defaultLegalOwnerId },
          assignmentRules: body.rules.map((rule, displayOrder) => ({
            ...rule,
            id: rule.id ?? `rule-${nextRuleId++}`,
            displayOrder,
          })) as RecordAnswer["assignmentRules"],
        };
        return json(200, current);
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/settings");
  const editor = within(await screen.findByRole("region", { name: "Assignment rules" }));
  await user.click(editor.getByRole("button", { name: "Add rule" }));
  let dialog = screen.getByRole("dialog");
  await user.selectOptions(within(dialog).getByLabelText("Value"), "US");
  await user.selectOptions(within(dialog).getByLabelText("Legal Owner"), "other");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]?.rules[0]).toMatchObject({
    operator: "equals",
    value: "US",
    legalOwnerId: "other",
  });
  expect(editor.getByText("Jurisdiction equals US")).toBeVisible();
  for (const operator of ["is_one_of", "is_set", "is_not"]) {
    await user.click(editor.getByRole("button", { name: "Edit rule 1" }));
    dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Operator"), operator);
    if (operator !== "is_set")
      await user.selectOptions(
        within(dialog).getByLabelText("Value"),
        operator === "is_one_of" ? ["US", "UK"] : "US",
      );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves.at(-1)?.rules[0]?.operator).toBe(operator));
  }
  expect(saves[1]?.rules[0]?.value).toEqual(["US", "UK"]);
  expect(saves[2]?.rules[0]?.value).toBeNull();
  await user.click(editor.getByRole("button", { name: "Add rule" }));
  dialog = screen.getByRole("dialog");
  await user.selectOptions(within(dialog).getByLabelText("Legal Owner"), "member");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saves.at(-1)?.rules).toHaveLength(2));
  editor.getByRole("button", { name: "Reorder rule 2 of 2" }).focus();
  await user.keyboard("{ArrowUp}");
  await waitFor(() =>
    expect(saves.at(-1)?.rules.map((rule) => rule.legalOwnerId)).toEqual(["member", "other"]),
  );
  await user.selectOptions(screen.getByLabelText("Default Legal Owner"), "member");
  await waitFor(() => expect(saves.at(-1)?.defaultLegalOwnerId).toBe("member"));
  await user.click(editor.getByRole("button", { name: "Remove rule 1" }));
  await waitFor(() =>
    expect(saves.at(-1)?.rules).toEqual([
      expect.objectContaining({ id: "rule-0", legalOwnerId: "other" }),
    ]),
  );
  await user.selectOptions(screen.getByLabelText("Default Legal Owner"), "");
  await waitFor(() => expect(saves.at(-1)?.defaultLegalOwnerId).toBeNull());
});

it("commits selected people and Departments and the acknowledgement override one control at a time", async () => {
  const edits: unknown[] = [];
  let current = record();
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") {
        if (call.method === "PATCH") {
          const body = call.body as Record<string, unknown>;
          edits.push(body);
          current = {
            ...current,
            autoDoc: { ...current.autoDoc, ...body },
            audienceUserIds:
              (body.audienceUserIds as string[] | undefined) ?? current.audienceUserIds,
            audienceDepartmentIds:
              (body.audienceDepartmentIds as string[] | undefined) ?? current.audienceDepartmentIds,
          };
        }
        return json(200, current);
      }
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/auto-docs/nda/settings");
  await screen.findByRole("region", { name: "Reach" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Audience" }), "selected");
  await user.selectOptions(await screen.findByRole("listbox", { name: "People" }), "buyer");
  await user.selectOptions(screen.getByRole("listbox", { name: "Departments" }), "sales");
  expect(screen.queryByRole("combobox", { name: "Cadence" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Organization Auto-Doc Settings" })).toHaveAttribute(
    "href",
    "/settings/auto-docs",
  );
  await user.click(screen.getByRole("radio", { name: "Custom text" }));
  const text = await screen.findByRole("textbox", { name: "Acknowledgement text" });
  expect(text).toHaveValue("Do not edit.");
  await user.clear(text);
  await user.type(text, "Ask Legal before changes.");
  await user.tab();
  await waitFor(() =>
    expect(edits).toEqual([
      { audience: "selected" },
      { audienceUserIds: ["buyer"] },
      { audienceDepartmentIds: ["sales"] },
      { acknowledgementText: "Do not edit." },
      { acknowledgementText: "Ask Legal before changes." },
    ]),
  );
});

it("refreshes Assignment values after saving sibling settings without overwriting the refreshed record", async () => {
  const user = userEvent.setup();
  let current = record();
  current.autoDoc.targetContractTypeId = "type";
  current.formVersion!.definition.fields[0] = {
    ...current.formVersion!.definition.fields[0]!,
    fieldType: "text",
    options: null,
  };
  current.assignmentRules = [
    {
      id: "rule",
      fieldSlug: "jurisdiction",
      operator: "equals",
      value: "old",
      legalOwnerId: "member",
      displayOrder: 0,
    },
  ];
  let saved: unknown;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") {
        if (call.method === "PATCH")
          current = {
            ...current,
            autoDoc: { ...current.autoDoc, defaultLegalOwnerId: "other" },
            assignmentRules: [
              { ...current.assignmentRules[0]!, value: "refreshed", legalOwnerId: "other" },
            ],
          };
        return json(200, current);
      }
      if (call.url.pathname.endsWith("/assignment-rules")) {
        saved = call.body;
        return json(200, current);
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/settings");
  const editor = within(await screen.findByRole("region", { name: "Assignment rules" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Audience" }), "selected");
  await waitFor(() => expect(screen.getByLabelText("Default Legal Owner")).toHaveValue("other"));
  await user.click(editor.getByRole("button", { name: "Edit rule 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit rule" });
  expect(within(dialog).getByLabelText("Value")).toHaveValue("refreshed");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(saved).toMatchObject({
      defaultLegalOwnerId: "other",
      rules: [{ value: "refreshed", legalOwnerId: "other" }],
    }),
  );
});

it("requires typed delete, keeps refusals open, and returns to the list after erasure", async () => {
  const user = userEvent.setup();
  const current = record();
  const deletions: unknown[] = [];
  stubApi({
    signedIn: { ...member, role: "administrator" },
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs") return json(200, { autoDocs: [] });
      if (call.url.pathname === "/api/v1/auto-docs/nda") {
        if (call.method === "DELETE") {
          deletions.push(call.body);
          return deletions.length === 1
            ? problem(409, "This Auto-Doc was renamed. Reload it before deleting.")
            : new Response(null, { status: 204 });
        }
        return json(200, current);
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  const trigger = await screen.findByRole("button", { name: "Auto-Doc actions" });
  expect(screen.queryByRole("button", { name: "Delete Auto-Doc" })).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "Delete Auto-Doc" }));
  let modal = await screen.findByRole("dialog", { name: "Delete this Auto-Doc?" });
  expect(
    within(modal).getByText(/Created Contracts and Filed Documents remain/),
  ).toBeInTheDocument();
  let input = within(modal).getByLabelText('Type "delete" to confirm');
  expect(input).toHaveFocus();
  const erase = within(modal).getByRole("button", { name: "Delete Publish NDA" });
  expect(erase).toBeDisabled();
  await user.type(input, "yes");
  expect(erase).toBeDisabled();
  await user.click(within(modal).getByRole("button", { name: "Cancel" }));
  expect(deletions).toEqual([]);
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(await screen.findByRole("menuitem", { name: "Delete Auto-Doc" }));
  modal = await screen.findByRole("dialog");
  input = within(modal).getByLabelText('Type "delete" to confirm');
  expect(input).toHaveValue("");
  await user.type(input, " DELETE ");
  await user.click(within(modal).getByRole("button", { name: "Delete Publish NDA" }));
  expect(await within(modal).findByRole("alert")).toHaveTextContent("was renamed");
  expect(deletions).toEqual([{ confirm: "delete", confirmName: "Publish NDA" }]);
  await user.click(within(modal).getByRole("button", { name: "Delete Publish NDA" }));
  await screen.findByRole("heading", { name: "Auto-Docs" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not offer Auto-Doc erasure to a Legal Team Member", async () => {
  const user = userEvent.setup();
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, record());
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  expect(screen.queryByRole("button", { name: "Delete Auto-Doc" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Auto-Doc actions" }));
  expect(screen.queryByRole("menuitem", { name: "Delete Auto-Doc" })).not.toBeInTheDocument();
});
