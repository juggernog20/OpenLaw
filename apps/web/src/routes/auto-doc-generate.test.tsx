// SPDX-License-Identifier: AGPL-3.0-only

/** A Member submits the loaded pair and keeps answers when that pair is refused. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { paths } from "@openlaw/api-client";
import { pickDate } from "../testing/dates";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

type Form =
  paths["/api/v1/auto-docs/{id}/generate"]["get"]["responses"][200]["content"]["application/json"];
type Generation =
  paths["/api/v1/auto-docs/{id}/generations/{generationId}"]["get"]["responses"][200]["content"]["application/json"]["generation"];
const member = {
  id: "member",
  email: "legal@example.com",
  displayName: "Legal",
  role: "legal_team_member",
};
const form: Form = {
  autoDoc: {
    id: "nda",
    name: "NDA",
    description: "Fill the approved NDA.",
    targetContractTypeId: null,
    fixedEntityId: null,
  },
  pair: { documentVersionId: "file1", formVersionId: "form2" },
  fields: [
    {
      slug: "counterparty_name",
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
      slug: "amount",
      label: "Amount",
      fieldType: "currency",
      required: false,
      help: null,
      options: null,
      displayOrder: 1,
      placeholder: true,
      catalogFieldId: null,
      contractAttribute: null,
    },
    {
      slug: "agreed",
      label: "Agreed",
      fieldType: "boolean",
      required: true,
      help: null,
      options: null,
      displayOrder: 2,
      placeholder: false,
      catalogFieldId: null,
      contractAttribute: null,
    },
  ],
  entities: [],
  businessOwners: [],
};
const generation: Generation = {
  id: "generation1",
  autoDocId: "nda",
  autoDocName: "NDA",
  ...form.pair,
  documentVersionNumber: 1,
  formVersionNumber: 2,
  generatedBy: "member",
  person: { id: "member", displayName: "Legal" },
  answers: { counterparty_name: "Acme", amount: 1234.56, agreed: false },
  state: "ready",
  hasDocx: true,
  hasPdf: false,
  formats: "docx",
  createdContract: null,
  emailState: "sent",
  emailSentAt: "2026-09-14T00:00:00Z",
  emailFailure: null,
  failure: null,
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
};

it("submits typed answers and the loaded pair, then offers the Word download", async () => {
  const user = userEvent.setup();
  let posted: unknown;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate")) return json(200, form);
      if (call.method === "POST" && call.url.pathname.endsWith("/generations")) {
        posted = call.body;
        return json(201, { generation });
      }
      if (call.url.pathname.endsWith("/generations/generation1")) return json(200, { generation });
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generate");
  await screen.findByRole("heading", { name: "Generate NDA" });
  await user.type(screen.getByLabelText("Counterparty"), "Acme");
  await user.type(screen.getByLabelText("Amount"), "1234.56");
  await user.selectOptions(screen.getByLabelText("Agreed"), "false");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("heading", { name: "Generation" });
  expect(posted).toEqual({
    ...form.pair,
    answers: { counterparty_name: "Acme", amount: 1234.56, agreed: false },
  });
  expect(screen.getByRole("link", { name: "Download Word" })).toHaveAttribute(
    "href",
    "/api/v1/auto-docs/nda/generations/generation1/docx",
  );
});

it("enforces required fields and keeps answers after a stale-pair refusal", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  let reads = 0;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate")) {
        reads++;
        return json(
          200,
          reads > 1 ? { ...form, pair: { ...form.pair, formVersionId: "form3" } } : form,
        );
      }
      if (call.method === "POST" && call.url.pathname.endsWith("/generations")) {
        attempts++;
        return problem(
          409,
          "The published form has changed. Your answers have not been submitted.",
        );
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generate");
  await screen.findByRole("heading", { name: "Generate NDA" });
  await user.click(screen.getByRole("button", { name: "Generate" }));
  expect(attempts).toBe(0);
  await user.type(screen.getByLabelText("Counterparty"), "Keep this answer");
  await user.selectOptions(screen.getByLabelText("Agreed"), "true");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("published form has changed");
  expect(screen.getByLabelText("Counterparty")).toHaveValue("Keep this answer");
  await user.click(screen.getByRole("button", { name: "Review current form" }));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.getByLabelText("Counterparty")).toHaveValue("Keep this answer");
  expect(screen.getByLabelText("Agreed")).toHaveValue("true");
});

it("shows a failed Generation's reason without a download link", async () => {
  stubApi({
    signedIn: member,
    extra: (call) =>
      call.url.pathname.endsWith("/generations/generation1")
        ? json(200, {
            generation: {
              ...generation,
              state: "failed",
              hasDocx: false,
              failure: { code: "fill_failed", detail: "The Word fill timed out. Try again." },
            },
          })
        : undefined,
  });
  renderAt("/auto-docs/nda/generations/generation1");
  await screen.findByRole("heading", { name: "Generation" });
  expect(screen.getByRole("alert")).toHaveTextContent("Word fill timed out");
  expect(screen.queryByRole("link", { name: "Download Word" })).not.toBeInTheDocument();
});

it("keeps removed and retyped answers visible when reviewing a changed form", async () => {
  const user = userEvent.setup();
  let reads = 0;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate")) {
        reads++;
        return json(
          200,
          reads === 1
            ? form
            : {
                ...form,
                pair: { ...form.pair, formVersionId: "form3" },
                fields: [{ ...form.fields[1]!, fieldType: "date" }, form.fields[2]!],
              },
        );
      }
      if (call.method === "POST" && call.url.pathname.endsWith("/generations"))
        return problem(409, "The published form has changed.");
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generate");
  await screen.findByRole("heading", { name: "Generate NDA" });
  await user.type(screen.getByLabelText("Counterparty"), "Keep Acme's name");
  await user.type(screen.getByLabelText("Amount"), "1234.56");
  await user.selectOptions(screen.getByLabelText("Agreed"), "true");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Review current form" }));
  await screen.findByRole("heading", { name: "Previous answers" });
  expect(screen.getByText("Keep Acme's name")).toBeVisible();
  expect(screen.getByText("1234.56")).toBeVisible();
  expect(screen.getByLabelText("Amount")).toHaveTextContent("Select a date");
  expect(screen.getByLabelText("Agreed")).toHaveValue("true");
});

it("names an unpublished Auto-Doc on form load", async () => {
  stubApi({
    signedIn: member,
    extra: (call) =>
      call.url.pathname.endsWith("/generate")
        ? problem(409, '"NDA" is not published. Your answers have not been submitted.')
        : undefined,
  });
  renderAt("/auto-docs/nda/generate");
  expect(await screen.findByRole("alert")).toHaveTextContent('"NDA" is not published');
});

it("requires a date pick before submitting a required date answer", async () => {
  const user = userEvent.setup();
  let posted: unknown;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          ...form,
          fields: [
            { ...form.fields[1]!, fieldType: "date", label: "Signing date", required: true },
          ],
        });
      if (call.method === "POST" && call.url.pathname.endsWith("/generations")) {
        posted = call.body;
        return problem(409, "The published form has changed.");
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generate");
  await screen.findByRole("heading", { name: "Generate NDA" });
  await user.click(screen.getByRole("button", { name: "Generate" }));
  expect(await screen.findByRole("alert")).toHaveTextContent('Fill "Signing date" first.');
  expect(posted).toBeUndefined();
  await pickDate(user, "Signing date", "2026-09-14");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await waitFor(() => expect(posted).toEqual({ ...form.pair, answers: { amount: "2026-09-14" } }));
});

it("offers Word during PDF conversion, then adds PDF and the email outcome", async () => {
  let reads = 0;
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations/generation1")) {
        reads++;
        return json(200, {
          generation: {
            ...generation,
            formats: "both",
            state: reads === 1 ? "pending" : "ready",
            hasPdf: reads > 1,
            emailState: reads === 1 ? "pending" : "unconfigured",
            emailSentAt: null,
            emailFailure:
              reads === 1
                ? null
                : {
                    code: "unconfigured",
                    detail:
                      "Email was not sent because SMTP is not configured. The downloads are ready.",
                  },
          },
        });
      }
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generations/generation1");
  await screen.findByRole("link", { name: "Download Word" });
  expect(screen.queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "Download PDF" }, { timeout: 5000 }),
  ).toHaveAttribute("href", "/api/v1/auto-docs/nda/generations/generation1/pdf");
  expect(screen.getByText(/SMTP is not configured/)).toBeVisible();
});

it("lets a Member name a Business Owner and links the generated Contract on confirmation", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  const created = {
    ...generation,
    createdContract: { id: "contract", number: 27, title: "NDA Acme" },
  };
  stubApi({
    signedIn: member,
    extra: (call) => {
      if (call.url.pathname.endsWith("/generate"))
        return json(200, {
          ...form,
          autoDoc: { ...form.autoDoc, targetContractTypeId: "nda-type" },
          businessOwners: [{ id: "owner", name: "Casey Buyer" }],
        });
      if (call.url.pathname.endsWith("/generations") && call.method === "POST") {
        submitted = call.body;
        return json(201, { generation: created });
      }
      if (call.url.pathname.endsWith("/generations/generation1"))
        return json(200, { generation: created });
      return undefined;
    },
  });
  renderAt("/auto-docs/nda/generate");
  await screen.findByRole("heading", { name: "Generate NDA" });
  await user.type(screen.getByLabelText("Counterparty"), "Acme");
  await user.selectOptions(screen.getByLabelText("Agreed"), "false");
  await user.selectOptions(screen.getByLabelText("Business Owner"), "owner");
  await user.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("heading", { name: "Generation" });
  expect(submitted).toMatchObject({ businessOwnerId: "owner" });
  expect(screen.getByRole("link", { name: "NDA Acme" })).toHaveAttribute("href", "/contracts/27");
});
