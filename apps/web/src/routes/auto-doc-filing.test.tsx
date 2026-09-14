// SPDX-License-Identifier: AGPL-3.0-only

/** DES-086: Filing controls and linked history at the Member and Portal route seams. */
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const generation = {
  id: "gen1",
  autoDocId: "nda",
  autoDocName: "Filing NDA",
  documentVersionId: "v1",
  formVersionId: "f1",
  documentVersionNumber: 1,
  formVersionNumber: 1,
  generatedBy: "person",
  person: { id: "person", displayName: "Person" },
  answers: {},
  answerFields: [],
  displayValues: {},
  filingPending: false,
  filingFailure: null,
  state: "ready",
  hasDocx: true,
  hasPdf: true,
  formats: "both",
  createdContract: null,
  emailState: "sent",
  emailSentAt: "2026-09-14T00:00:00Z",
  emailFailure: null,
  failure: null,
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
};
it.each([
  { shell: "app", portal: false },
  { shell: "Portal", portal: true },
])("files from the $shell shell with a linked Filing history", async ({ portal }) => {
  let posted: unknown;
  const filings: unknown[] = [];
  stubApi({
    signedIn: {
      id: "person",
      email: "person@example.com",
      displayName: "Person",
      role: portal ? "business_user" : "legal_team_member",
    },
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, { generation, canGenerate: true });
      if (call.url.pathname.endsWith("/filing-options"))
        return json(200, {
          destinations: [{ kind: "matter", number: 7, title: "Board meeting" }],
          contractTypes: portal ? [] : [{ id: "type1", name: "NDA" }],
        });
      if (call.url.pathname.endsWith("/filings")) {
        if (call.method === "GET") return json(200, { filings });
        posted = call.body;
        const filing = {
          id: "filing1",
          generationId: "gen1",
          documentId: "document1",
          target: { kind: "matter", number: 7, title: "Board meeting" },
          format: "pdf",
          createdContract: false,
          filedBy: "person",
          createdAt: "2026-09-14T00:00:00Z",
        };
        filings.push(filing);
        return json(201, { filing });
      }
      return undefined;
    },
  });
  renderAt(`/${portal ? "portal/" : ""}auto-docs/nda/generations/gen1`);
  await userEvent.click(await screen.findByRole("button", { name: "File" }));
  const dialog = await screen.findByRole("dialog", { name: "File Filing NDA" });
  await within(dialog).findByRole("option", { name: "Matter #7: Board meeting" });
  await userEvent.selectOptions(within(dialog).getByLabelText("Filing destination"), "matter:7");
  await userEvent.selectOptions(within(dialog).getByLabelText("File format"), "pdf");
  if (portal)
    expect(within(dialog).queryByRole("option", { name: "New Contract" })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "File" }));
  await waitFor(() =>
    expect(posted).toEqual({ destination: { kind: "matter", number: 7 }, format: "pdf" }),
  );
  expect(await screen.findByRole("link", { name: "Matter #7: Board meeting" })).toHaveAttribute(
    "href",
    `/${portal ? "portal/" : ""}matters/7`,
  );
});

it.each([
  { shell: "app", portal: false },
  { shell: "Portal", portal: true },
])("keeps the destination and refusal visible in the $shell Filing dialog", async ({ portal }) => {
  stubApi({
    signedIn: {
      id: "person",
      email: "person@example.com",
      displayName: "Person",
      role: portal ? "business_user" : "legal_team_member",
    },
    extra: (call) => {
      if (call.url.pathname.endsWith("/generations/gen1"))
        return json(200, { generation, canGenerate: true });
      if (call.url.pathname.endsWith("/filing-options"))
        return json(200, {
          destinations: [{ kind: "matter", number: 7, title: "Board meeting" }],
          contractTypes: [],
        });
      if (call.url.pathname.endsWith("/filings"))
        return call.method === "GET"
          ? json(200, { filings: [] })
          : problem(409, "Restore this Matter before filing a Document.");
      return undefined;
    },
  });
  renderAt(`/${portal ? "portal/" : ""}auto-docs/nda/generations/gen1`);
  await userEvent.click(await screen.findByRole("button", { name: "File" }));
  const dialog = await screen.findByRole("dialog", { name: "File Filing NDA" });
  await within(dialog).findByRole("option", { name: "Matter #7: Board meeting" });
  await userEvent.selectOptions(within(dialog).getByLabelText("Filing destination"), "matter:7");
  await userEvent.selectOptions(within(dialog).getByLabelText("File format"), "pdf");
  await userEvent.click(within(dialog).getByRole("button", { name: "File" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Restore this Matter before filing a Document.",
  );
  expect(dialog).toBeVisible();
  expect(within(dialog).getByLabelText("Filing destination")).toHaveValue("matter:7");
  expect(within(dialog).getByLabelText("File format")).toHaveValue("pdf");
});
