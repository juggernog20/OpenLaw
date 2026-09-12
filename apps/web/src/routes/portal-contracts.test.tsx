// SPDX-License-Identifier: AGPL-3.0-only

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { json, problem, renderAt, stubApi } from "../testing/helpers";

const BUSINESS = {
  id: "business-user",
  email: "business@example.com",
  displayName: "Business person",
  role: "business_user",
};
const CONTRACT = {
  number: 12,
  title: "Supply agreement",
  stage: "active",
  type: "Supply",
  counterparty: "Supplier Ltd",
  legalOwner: { id: "lawyer", displayName: "Legal person", image: null },
  businessOwner: { id: BUSINESS.id, displayName: BUSINESS.displayName, image: null },
  termType: "auto_renew",
  effectiveDate: "2026-01-01",
  expiryDate: "2026-12-31",
  renewalPeriodMonths: 12,
  noticePeriodDays: 30,
  noticeDeadline: "2026-12-01",
  renewalPendingConfirmation: false,
  value: { amount: 120000, currency: "USD", cadence: "annually" },
  unverifiedFields: ["expiryDate"],
  primaryDocument: null,
};

describe("Portal Contracts", () => {
  it("shows a managed list and appends the next page", async () => {
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/contracts")
          return json(
            200,
            call.url.searchParams.has("cursor")
              ? {
                  contracts: [{ ...CONTRACT, number: 11, title: "Older agreement" }],
                  nextCursor: null,
                  total: 2,
                  filterOptions: { types: [], owners: [] },
                }
              : {
                  contracts: [CONTRACT],
                  nextCursor: 12,
                  total: 2,
                  filterOptions: { types: [], owners: [] },
                },
          );
        return undefined;
      },
    });
    renderAt("/portal/contracts");
    expect(await screen.findByRole("heading", { name: "Your Contracts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Supply agreement/ })).toHaveAttribute(
      "href",
      "/portal/contracts/12",
    );
    expect(screen.queryByRole("button", { name: /Save view/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("link", { name: /Older agreement/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Supply agreement/ })).toBeInTheDocument();
  });

  it("keeps term warnings visible and uses the existing reader with Portal document URLs", async () => {
    const document = {
      id: "doc-primary",
      title: "Agreed terms",
      version: {
        id: "version-current",
        versionNumber: 2,
        kind: "executed",
        originalFilename: "signed.png",
        mimeType: "image/png",
        renderFamily: "image",
        byteSize: 40,
      },
    };
    const staffReads: string[] = [];
    stubApi({
      signedIn: BUSINESS,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/portal/contracts/12")
          return json(200, { contract: { ...CONTRACT, primaryDocument: document } });
        if (call.url.pathname.startsWith("/api/v1/documents/")) staffReads.push(call.url.pathname);
        return undefined;
      },
    });
    renderAt("/portal/contracts/12");
    expect(await screen.findByRole("heading", { name: "Supply agreement" })).toBeInTheDocument();
    expect(screen.getByText(/Legal has not yet verified/)).toBeInTheDocument();
    expect(screen.getAllByText("Unverified").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Read Document" }));
    const panel = await screen.findByRole("complementary", { name: /Agreed terms/ });
    expect(within(panel).getByRole("img", { name: "signed.png" })).toHaveAttribute(
      "src",
      "/api/v1/portal/contracts/12/documents/doc-primary/versions/version-current/preview",
    );
    expect(within(panel).getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/v1/portal/contracts/12/documents/doc-primary/versions/version-current/download",
    );
    expect(staffReads).toEqual([]);
  });

  it("shows the same missing-record message for a refused Contract", async () => {
    stubApi({
      signedIn: BUSINESS,
      extra: (call) =>
        call.url.pathname === "/api/v1/portal/contracts/12"
          ? problem(404, "No contract exists with this number.")
          : undefined,
    });
    renderAt("/portal/contracts/12");
    expect(await screen.findByRole("heading", { name: "Contract not found" })).toBeInTheDocument();
    expect(screen.queryByText("Supply agreement")).not.toBeInTheDocument();
  });
});

it("opens email attachments through the Portal reader source", async () => {
  const reads: string[] = [];
  const document = {
    id: "email-doc",
    title: "Signed email",
    version: {
      id: "email-version",
      versionNumber: 1,
      kind: "executed",
      originalFilename: "signed.eml",
      mimeType: "message/rfc822",
      renderFamily: "email",
      byteSize: 100,
    },
  };
  stubApi({
    signedIn: BUSINESS,
    extra: (call) => {
      reads.push(call.url.pathname);
      if (call.url.pathname === "/api/v1/portal/contracts/12")
        return json(200, { contract: { ...CONTRACT, primaryDocument: document } });
      if (
        call.url.pathname ===
        "/api/v1/portal/contracts/12/documents/email-doc/versions/email-version/email"
      )
        return json(200, {
          email: {
            subject: "Agreed",
            from: { name: "Legal", address: "legal@example.com" },
            to: [],
            cc: [],
            bcc: [],
            date: null,
            html: null,
            text: "Attached signed terms.",
            attachments: [
              {
                index: 0,
                filename: "signed.png",
                mimeType: "image/png",
                byteSize: 40,
                renderFamily: "image",
                isInline: false,
              },
            ],
          },
        });
      return undefined;
    },
  });
  renderAt("/portal/contracts/12");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Read Document" }));
  const panel = await screen.findByRole("complementary", { name: /Signed email/ });
  expect(await within(panel).findByText("Attached signed terms.")).toBeVisible();
  await user.click(within(panel).getByRole("button", { name: /signed.png/ }));
  expect(within(panel).getByRole("img", { name: "signed.png" })).toHaveAttribute(
    "src",
    "/api/v1/portal/contracts/12/documents/email-doc/versions/email-version/attachments/0/preview",
  );
  expect(reads.filter((path) => path.startsWith("/api/v1/documents/"))).toEqual([]);
});
