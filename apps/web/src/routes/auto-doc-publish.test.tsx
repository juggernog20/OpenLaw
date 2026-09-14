// SPDX-License-Identifier: AGPL-3.0-only

/** Legal completes rules and maps, compares versions, and publishes one pair. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";
import { formatLongDateTime } from "../lib/format";
import type { paths } from "@openlaw/api-client";

type RecordAnswer =
  paths["/api/v1/auto-docs/{id}"]["get"]["responses"][200]["content"]["application/json"];
const member = {
  id: "member",
  email: "legal@example.com",
  displayName: "Legal",
  role: "legal_team_member",
};
const date = "2026-09-13T00:00:00Z";
function record(): RecordAnswer {
  const fields: NonNullable<RecordAnswer["formVersion"]>["definition"]["fields"] = [
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
      targetContractTypeId: null,
      titlePattern: null,
      fixedEntityId: null,
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
  };
}
const options = {
  entities: [{ id: "entity", name: "Example Subsidiary" }],
  catalogFields: [{ id: "catalog", displayName: "Contract reference", fieldType: "text" }],
  contractTypes: [{ id: "type", displayName: "NDA" }],
};

it("writes each Clause operator, offers the field's options, and saves maps in the same form", async () => {
  const user = userEvent.setup();
  let current = record();
  const saves: Array<{
    fields: Array<{ catalogFieldId?: string | null; contractAttribute?: string | null }>;
    clauseRules: Array<{ operator: string; value: unknown }>;
  }> = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/form-versions")) {
        const body = call.body as NonNullable<RecordAnswer["formVersion"]>["definition"];
        saves.push(body);
        const version = {
          ...current.formVersion!,
          id: `form${saves.length + 2}`,
          versionNumber: saves.length + 2,
          definition: body,
        };
        current = {
          ...current,
          formVersion: version,
          formVersions: [version, ...current.formVersions],
        };
        return json(201, current);
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  const clause = screen.getByRole("group", { name: "arbitration" });
  await user.selectOptions(within(clause).getByLabelText("Include this Block"), "conditional");
  await user.selectOptions(within(clause).getByLabelText("Form field"), "jurisdiction");
  const formField = screen.getByRole("group", { name: "jurisdiction" });
  await user.selectOptions(within(formField).getByLabelText("Map to"), "catalog:catalog");
  for (const operator of ["equals", "is_one_of", "is_set", "is_not"]) {
    await user.selectOptions(within(clause).getByLabelText("Operator"), operator);
    if (operator !== "is_set") {
      const value = within(clause).getByLabelText("Value");
      expect(within(value).getByRole("option", { name: "US" })).toBeInTheDocument();
      await user.selectOptions(value, operator === "is_one_of" ? ["US", "UK"] : "US");
    }
    await user.click(screen.getByRole("button", { name: "Save form" }));
    await waitFor(() => expect(saves.at(-1)?.clauseRules[0]?.operator).toBe(operator));
  }
  expect(saves[0]?.fields[0]).toMatchObject({ catalogFieldId: "catalog", contractAttribute: null });
  expect(saves[1]?.clauseRules[0]?.value).toEqual(["US", "UK"]);
  await user.selectOptions(within(formField).getByLabelText("Map to"), "attribute:title");
  await user.click(screen.getByRole("button", { name: "Save form" }));
  await waitFor(() =>
    expect(saves.at(-1)?.fields[0]).toMatchObject({
      catalogFieldId: null,
      contractAttribute: "title",
    }),
  );
});

it("renders all Publish gaps, pins the chosen pair, and offers the lifecycle controls and structural diff", async () => {
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
  await user.selectOptions(screen.getByLabelText("File version to publish"), "file1");
  await user.selectOptions(screen.getByLabelText("Form version to publish"), "form1");
  await user.click(screen.getByRole("button", { name: "Publish" }));
  expect(await screen.findByRole("alert")).toHaveTextContent('"counterparty_name"');
  expect(screen.getByRole("alert")).toHaveTextContent('"missing"');
  expect(screen.getByRole("alert")).toHaveTextContent('"CA"');
  refuse = false;
  await user.click(screen.getByRole("button", { name: "Publish" }));
  await screen.findByRole("button", { name: "Unpublish" });
  expect(publishes.at(-1)).toEqual({ documentVersionId: "file1", formVersionId: "form1" });
  expect(screen.getByText("Live: file version 1 and form version 1.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Compare forms" }));
  expect(await screen.findByText(/Retyped jurisdiction/)).toBeVisible();
  expect(screen.getByText(/Clause rule changed: arbitration/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Compare files" })).toHaveAttribute(
    "href",
    "/documents/template/compare?from=file1&to=file2",
  );
  // The Comparison seam refuses a newer-first pair, so picking the two
  // file versions the other way round still links to the ordered pair.
  await user.selectOptions(screen.getByLabelText("Compare file from"), "file2");
  await user.selectOptions(screen.getByLabelText("Compare file to"), "file1");
  expect(screen.getByRole("link", { name: "Compare files" })).toHaveAttribute(
    "href",
    "/documents/template/compare?from=file1&to=file2",
  );
  for (const action of ["Unpublish", "Archive", "Restore"]) {
    await user.click(screen.getByRole("button", { name: action }));
    if (action === "Archive") await screen.findByRole("button", { name: "Restore" });
    else await screen.findByRole("button", { name: "Publish" });
  }
});

it("saves audience, target Type, formats, and cover note, then applies list filters", async () => {
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
          const body = call.body as { audience: "everyone"; targetContractTypeId: string };
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
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  const settings = screen.getByRole("region", { name: "Settings" });
  await user.selectOptions(within(settings).getByLabelText("Audience"), "everyone");
  await user.selectOptions(within(settings).getByLabelText("Target Contract Type"), "type");
  await user.click(within(settings).getByLabelText("Title pattern"));
  await user.paste("NDA {{jurisdiction}}");
  await user.selectOptions(within(settings).getByLabelText("Fixed Entity"), "entity");
  await user.selectOptions(within(settings).getByLabelText("Formats"), "pdf");
  await user.type(within(settings).getByLabelText("Cover note"), "Please **review** this.");
  expect(within(settings).getByText("review")).toBeVisible();
  await user.click(within(settings).getByRole("button", { name: "Save settings" }));
  await screen.findByText("Settings saved.");
  expect(edits).toEqual([
    {
      audience: "everyone",
      targetContractTypeId: "type",
      titlePattern: "NDA {{jurisdiction}}",
      fixedEntityId: "entity",
      formats: "pdf",
      coverNote: "Please **review** this.",
    },
  ]);
  await user.click(screen.getAllByRole("link", { name: "Auto-Docs" }).at(-1)!);
  await screen.findByRole("button", { name: "Apply filters" });
  await user.type(screen.getByRole("searchbox", { name: "Search Auto-Docs" }), "NDA");
  await user.selectOptions(screen.getByLabelText("State"), "archived");
  await user.selectOptions(screen.getByLabelText("Audience"), "everyone");
  await user.selectOptions(screen.getByLabelText("Target Contract Type"), "type");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(searches.at(-1)?.get("state")).toBe("archived"));
  expect(Object.fromEntries(searches.at(-1)!)).toEqual({
    q: "NDA",
    state: "archived",
    audience: "everyone",
    targetContractTypeId: "type",
  });
});

it("keeps line breaks while typing an is-one-of rule for a text field", async () => {
  const user = userEvent.setup();
  const current = record();
  const values: unknown[] = [];
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/form-versions")) {
        const definition = call.body as NonNullable<RecordAnswer["formVersion"]>["definition"];
        values.push(definition.clauseRules[0]?.value);
        return json(201, { ...current, formVersion: { ...current.formVersion, definition } });
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  await user.selectOptions(
    within(screen.getByRole("group", { name: "jurisdiction" })).getByLabelText("Type"),
    "text",
  );
  const clause = screen.getByRole("group", { name: "arbitration" });
  await user.selectOptions(within(clause).getByLabelText("Include this Block"), "conditional");
  await user.selectOptions(within(clause).getByLabelText("Operator"), "is_one_of");
  const input = within(clause).getByLabelText("Value");
  await user.type(input, "United States{enter}United Kingdom{enter}");
  expect(input).toHaveValue("United States\nUnited Kingdom\n");
  await user.click(screen.getByRole("button", { name: "Save form" }));
  await waitFor(() => expect(values).toEqual([["United States", "United Kingdom"]]));
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
  await screen.findByRole("button", { name: "Apply filters" });
  expect(searches[0]?.has("state")).toBe(false);
  expect(searches[0]?.has("audience")).toBe(false);
  expect(screen.getByLabelText("State")).toHaveValue("");
  expect(screen.getByLabelText("Audience")).toHaveValue("");
});

it("restores a clean editor when Legal reverts an edit to the first of two Clause rules", async () => {
  const user = userEvent.setup();
  const current = record();
  current.detection.blocks.push("notice");
  current.formVersion!.definition.clauseRules = ["arbitration", "notice"].map((blockName) => ({
    blockName,
    fieldSlug: "jurisdiction",
    operator: "equals",
    value: "US",
  }));
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  const publish = screen.getByRole("button", { name: "Publish" });
  expect(publish).toBeEnabled();
  const clause = screen.getByRole("group", { name: "arbitration" });
  await user.selectOptions(within(clause).getByLabelText("Operator"), "is_not");
  expect(publish).toBeDisabled();
  await user.selectOptions(within(clause).getByLabelText("Operator"), "equals");
  expect(publish).toBeEnabled();
});

it("holds the selected forms steady while their comparison is loading", async () => {
  const user = userEvent.setup();
  let release: (() => void) | undefined;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, record());
      if (call.url.pathname.endsWith("/form-versions/diff"))
        return new Promise<Response>((resolve) => {
          release = () => resolve(json(200, { changes: [] }));
        });
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  const from = screen.getByLabelText("Compare form from");
  const to = screen.getByLabelText("Compare form to");
  await user.click(screen.getByRole("button", { name: "Compare forms" }));
  await waitFor(() => expect(release).toBeDefined());
  try {
    expect(from).toBeDisabled();
    expect(to).toBeDisabled();
    await user.selectOptions(from, "form2");
    expect(from).toHaveValue("form1");
  } finally {
    release?.();
  }
  await waitFor(() => expect(from).toBeEnabled());
  expect(to).toBeEnabled();
  await user.selectOptions(from, "form2");
  expect(from).toHaveValue("form2");
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
  renderAt("/auto-docs/nda");
  const list = await screen.findByRole("region", { name: "Generations" });
  expect(within(list).getByRole("link", { name: "Ready · Legal" })).toHaveAttribute(
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
  await user.click(within(list).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(within(list).getAllByRole("link", { name: "Download Word" })).toHaveLength(2),
  );
  expect(within(list).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

it("saves the currency and cadence of a Contract Value map", async () => {
  const user = userEvent.setup();
  const current = record();
  current.formVersion!.definition.fields[0]!.fieldType = "currency";
  current.formVersion!.definition.fields[0]!.options = null;
  current.formVersion!.definition.fields[0]!.valueCurrency = "AED";
  let saved: unknown;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations")) return json(200, { generations: [] });
      if (call.url.pathname === "/api/v1/auto-docs/options") return json(200, options);
      if (call.url.pathname === "/api/v1/auto-docs/nda") return json(200, current);
      if (call.url.pathname.endsWith("/form-versions")) {
        saved = call.body;
        const fields = (call.body as NonNullable<RecordAnswer["formVersion"]>["definition"]).fields;
        current.formVersion!.definition.fields = current.formVersion!.definition.fields.map(
          (field, index) => ({ ...field, ...fields[index] }),
        );
        return json(201, current);
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda");
  await screen.findByRole("heading", { name: "Publish NDA" });
  const field = screen.getByRole("group", { name: "jurisdiction" });
  await user.selectOptions(within(field).getByLabelText("Map to"), "attribute:value");
  expect(within(field).getByLabelText("Value currency")).toHaveValue("AED");
  await user.selectOptions(within(field).getByLabelText("Value cadence"), "annually");
  await user.click(screen.getByRole("button", { name: "Save form" }));
  await waitFor(() =>
    expect(saved).toMatchObject({
      fields: [
        expect.objectContaining({
          contractAttribute: "value",
          valueCurrency: "AED",
          valueCadence: "annually",
        }),
      ],
    }),
  );
  await user.selectOptions(within(field).getByLabelText("Value cadence"), "");
  await user.click(screen.getByRole("button", { name: "Save form" }));
  await waitFor(() =>
    expect(saved).toMatchObject({ fields: [expect.objectContaining({ valueCadence: null })] }),
  );
});
