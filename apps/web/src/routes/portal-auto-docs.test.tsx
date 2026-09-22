// SPDX-License-Identifier: AGPL-3.0-only

/** The Portal route keeps the person's answers across acknowledgements and publication changes. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const person = {
  id: "buyer",
  email: "buyer@example.com",
  displayName: "Buyer",
  role: "business_user",
};
const autoDoc = {
  id: "nda",
  name: "Approved NDA",
  description: "Use the approved words.",
  formats: "both",
  createsContract: false,
};
const availability = { ready: true, message: null };
const acknowledgement = {
  frequency: "every_use",
  required: true,
  text: "Do not edit this NDA.\nAsk Legal for changes.",
  textHash: "a".repeat(64),
};
const form = {
  pair: { documentVersionId: "file1", formVersionId: "form1" },
  entities: [{ id: "entity1", name: "Our Company" }],
  fields: [
    {
      slug: "counterparty",
      label: "Counterparty",
      fieldType: "text",
      required: true,
      help: "Use the full name.",
      options: null,
      displayOrder: 0,
      placeholder: true,
      catalogFieldId: null,
      contractAttribute: null,
    },
    {
      slug: "entity",
      label: "Entity",
      fieldType: "entity",
      required: true,
      help: null,
      options: null,
      displayOrder: 1,
      placeholder: false,
      catalogFieldId: null,
      contractAttribute: "entity",
    },
  ],
};
const generation = {
  answerFields: form.fields,
  displayValues: { entity: "Original Company" },
  filingPending: false,
  filingFailure: null,
  id: "gen1",
  autoDocId: "nda",
  autoDocName: "Approved NDA",
  ...form.pair,
  documentVersionNumber: 1,
  formVersionNumber: 1,
  generatedBy: person.id,
  person: { id: person.id, displayName: person.displayName },
  answers: { counterparty: "Acme", entity: "entity1" },
  state: "ready",
  hasDocx: true,
  hasPdf: true,
  formats: "both",
  createdContract: { id: "contract1", number: 42, title: "Acme NDA" },
  emailState: "sent",
  emailSentAt: "2026-09-14T00:00:00Z",
  emailFailure: null,
  failure: null,
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
};

it("lists the available Auto-Docs and appends owned Generation history", async () => {
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/portal/auto-docs")
        return json(200, { autoDocs: [{ ...autoDoc, availability }] });
      if (call.url.pathname === "/api/v1/portal/auto-doc-generations")
        return json(200, {
          generations: [
            {
              ...generation,
              id: call.url.searchParams.has("before") ? "gen0" : "gen1",
              autoDocName: call.url.searchParams.has("before") ? "Earlier NDA" : "Approved NDA",
            },
          ],
          nextCursor: call.url.searchParams.has("before") ? null : "gen1",
        });
      return undefined;
    },
  });
  renderAt("/portal/auto-docs");
  await screen.findByRole("heading", { name: "Auto-Docs", level: 1 });
  expect(screen.getByRole("link", { name: "Generate Approved NDA" })).toHaveAttribute(
    "href",
    "/portal/auto-docs/nda/generate",
  );
  await userEvent.click(screen.getByRole("link", { name: "Your documents" }));
  await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
  await screen.findByRole("link", { name: /Earlier NDA/ });
  expect(screen.getByRole("link", { name: "Approved NDA" })).toBeInTheDocument();
});

it("acknowledges the displayed text before exposing the Entity form and submits the acknowledgement with the pair", async () => {
  let accepted = false;
  let acknowledged: unknown;
  let posted: unknown;
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          autoDoc,
          availability,
          acknowledgement: { ...acknowledgement, required: !accepted },
          form: accepted ? form : null,
        });
      if (call.url.pathname.endsWith("/acknowledgements")) {
        acknowledged = call.body;
        accepted = true;
        return json(201, { acknowledgementId: "ack1" });
      }
      if (call.method === "POST" && call.url.pathname.endsWith("/generations")) {
        posted = call.body;
        return json(201, { generation });
      }
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, { generation, canGenerate: true });
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/portal/auto-docs/nda/generate");
  await screen.findByRole("heading", { name: "Before you generate", level: 1 });
  expect(screen.queryByLabelText("Counterparty")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Acknowledge and continue" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "I acknowledge this statement." }));
  await user.click(screen.getByRole("button", { name: "Acknowledge and continue" }));
  await screen.findByRole("heading", { name: "Generate Approved NDA", level: 1 });
  await user.type(screen.getByRole("textbox", { name: "Counterparty" }), "Acme");
  await user.selectOptions(screen.getByRole("combobox", { name: "Entity" }), "entity1");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("heading", { name: "Your generated document", level: 1 });
  expect(acknowledged).toEqual({ textHash: acknowledgement.textHash });
  expect(posted).toEqual({ ...form.pair, answers: generation.answers, acknowledgementId: "ack1" });
  expect(screen.getByRole("link", { name: "Download Word" })).toHaveAttribute(
    "href",
    "/api/v1/portal/auto-docs/nda/generations/gen1/docx",
  );
  expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
    "href",
    "/api/v1/portal/auto-docs/nda/generations/gen1/pdf",
  );
  expect(screen.getByRole("link", { name: "Acme NDA" })).toHaveAttribute(
    "href",
    "/portal/contracts/42",
  );
  expect(screen.getByText(/Email sent/)).toBeInTheDocument();
});

it("keeps answers after a stale-pair refusal and refreshes the pair for another submission", async () => {
  let refreshed = false;
  const posts: unknown[] = [];
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          autoDoc,
          availability,
          acknowledgement: { ...acknowledgement, required: false },
          form: { ...form, pair: { ...form.pair, formVersionId: refreshed ? "form2" : "form1" } },
        });
      if (call.method === "POST" && call.url.pathname.endsWith("/generations")) {
        posts.push(call.body);
        refreshed = true;
        return problem(409, 'The published form for "Approved NDA" has changed.');
      }
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/portal/auto-docs/nda/generate");
  await screen.findByRole("textbox", { name: "Counterparty" });
  await user.type(screen.getByRole("textbox", { name: "Counterparty" }), "Keep these words");
  await user.selectOptions(screen.getByRole("combobox", { name: "Entity" }), "entity1");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Counterparty" })).toHaveValue("Keep these words");
  await user.click(screen.getByRole("button", { name: "Review current form" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toMatchObject({
    formVersionId: "form2",
    answers: { counterparty: "Keep these words" },
  });
});

it("keeps the last confirmation and its download if a status refresh fails", async () => {
  let reads = 0;
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations/gen1"))
        return ++reads === 1
          ? json(200, {
              generation: { ...generation, hasPdf: false, emailState: "pending" },
              canGenerate: true,
            })
          : problem(503, "Try again shortly.");
      return undefined;
    },
  });
  renderAt("/portal/auto-docs/nda/generations/gen1");
  await screen.findByRole("link", { name: "Download Word" });
  await screen.findByRole("alert", {}, { timeout: 4000 });
  expect(screen.getByRole("link", { name: "Download Word" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
});

it("Generate again prefills owned answers and still shows the current acknowledgement", async () => {
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, { generation, canGenerate: true });
      if (call.url.pathname.endsWith("/generate"))
        return json(200, { autoDoc, availability, acknowledgement, form: null });
      return undefined;
    },
  });
  renderAt("/portal/auto-docs/nda/generations/gen1");
  await userEvent.click(await screen.findByRole("link", { name: "Generate again" }));
  await screen.findByRole("heading", { name: "Before you generate" });
});

it("Generate again drops a saved Entity the current form cannot show and names it as a previous answer", async () => {
  let posted: unknown;
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, {
          generation: { ...generation, answers: { counterparty: "Acme", entity: "gone" } },
          canGenerate: true,
        });
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          autoDoc,
          availability,
          acknowledgement: { ...acknowledgement, required: false },
          form,
        });
      if (call.method === "POST" && call.url.pathname.endsWith("/generations")) {
        posted = call.body;
        return json(201, { generation });
      }
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/portal/auto-docs/nda/generate?from=gen1");
  expect(await screen.findByRole("textbox", { name: "Counterparty" })).toHaveValue("Acme");
  expect(screen.getByRole("combobox", { name: "Entity" })).toHaveValue("");
  expect(screen.getByRole("heading", { name: "Previous answers" })).toBeInTheDocument();
  expect(screen.getByText("Original Company")).toBeInTheDocument();
  expect(screen.queryByText("gone")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Entity" }), "entity1");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("heading", { name: "Your generated document", level: 1 });
  expect(posted).toMatchObject({ answers: { counterparty: "Acme", entity: "entity1" } });
});

it("names removed answers and drops an old text answer when the current field is boolean", async () => {
  const current = {
    ...form,
    fields: [
      { ...form.fields[0], slug: "agreed", label: "Agreed", fieldType: "boolean", required: false },
    ],
  };
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          autoDoc,
          availability,
          acknowledgement: { ...acknowledgement, required: false },
          form: current,
        });
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, {
          generation: {
            ...generation,
            answers: { retired: "Former answer", agreed: "yes", entity: "entity1" },
            answerFields: [
              { slug: "retired", label: "Retired field", fieldType: "text" },
              { slug: "agreed", label: "Old agreement", fieldType: "text" },
              { slug: "entity", label: "Former Entity", fieldType: "entity" },
            ],
            displayValues: { entity: "Original Company" },
          },
        });
      return undefined;
    },
  });
  renderAt("/portal/auto-docs/nda/generate?from=gen1");
  await screen.findByRole("heading", { name: "Generate Approved NDA" });
  expect(screen.getByLabelText("Agreed")).toHaveValue("");
  expect(screen.getByText(/Retired field/)).toBeInTheDocument();
  expect(screen.getByText(/Former answer/)).toBeInTheDocument();
  expect(screen.getByText(/Original Company/)).toBeInTheDocument();
  expect(screen.queryByText("entity1")).not.toBeInTheDocument();
});

it("drops an answer absent from the saved Form instead of guessing its previous type", async () => {
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          autoDoc,
          availability,
          acknowledgement: { ...acknowledgement, required: false },
          form,
        });
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, {
          generation: {
            ...generation,
            answerFields: [],
            answers: { counterparty: "Unrecorded type" },
          },
        });
      return undefined;
    },
  });
  renderAt("/portal/auto-docs/nda/generate?from=gen1");
  expect(await screen.findByRole("textbox", { name: "Counterparty" })).toHaveValue("");
  expect(screen.getByText("Unrecorded type")).toBeInTheDocument();
});

it("searches the template library and keeps unavailable templates out of generation actions", async () => {
  stubApi({
    signedIn: person,
    extra: (call) => {
      if (call.url.pathname === "/api/v1/portal/auto-docs")
        return json(200, {
          autoDocs: [
            { ...autoDoc, availability },
            {
              ...autoDoc,
              id: "services",
              name: "Services agreement",
              description: "Engage a supplier.",
              availability: { ready: false, message: "Legal is updating this template." },
            },
          ],
        });
      if (call.url.pathname === "/api/v1/portal/auto-doc-generations")
        return json(200, { generations: [], nextCursor: null });
      return undefined;
    },
  });
  const user = userEvent.setup();
  renderAt("/portal/auto-docs");
  await screen.findByRole("heading", { name: "Auto-Docs", level: 1 });
  expect(
    screen.queryByRole("link", { name: "Generate Services agreement" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Legal is updating this template.")).toBeVisible();
  await user.type(screen.getByRole("searchbox", { name: "Search templates" }), "supplier{Enter}");
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Generate Approved NDA" })).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Services agreement")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "Your documents" }));
  await screen.findByRole("heading", { name: "No documents generated yet" });
  await user.click(screen.getByRole("link", { name: "Browse templates" }));
  expect(await screen.findByRole("link", { name: "Generate Approved NDA" })).toBeVisible();
});
