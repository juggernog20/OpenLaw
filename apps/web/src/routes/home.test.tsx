// SPDX-License-Identifier: AGPL-3.0-only

/** The M29 Home surface through the real route table and standard fetch stub. */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { json, renderAt, stubApi } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

const approvalSection = {
  type: "approvals",
  total: 5,
  rows: [
    {
      id: "approval-1",
      contract: {
        id: "contract-1",
        number: 42,
        title: "Meridian Bio supply agreement",
        isConfidential: true,
      },
      requestedBy: { id: "u7", displayName: "Priya Nair" },
      requestedAt: "2026-08-28T09:00:00.000Z",
    },
  ],
} as const;

describe("Home", () => {
  it("renders the loader's Approvals card and links each row to the Contract section", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [approvalSection] })
          : undefined,
    });
    renderAt("/");

    const card = await screen.findByRole("region", { name: "Approvals waiting on you" });
    expect(within(card).getByText("5")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Meridian Bio supply agreement" }),
    ).toHaveAttribute("href", "/contracts/42/approvals");
    expect(within(card).getByText(/Requested by Priya Nair/)).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Confidential" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View all 5" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(screen.queryByText("Welcome to OpenLaw")).not.toBeInTheDocument();
  });

  it("omits an empty section and shows the all-empty welcome", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/home" && call.method === "GET"
          ? json(200, { sections: [] })
          : undefined,
    });
    renderAt("/");

    const welcomeHeading = await screen.findByRole("heading", { name: "Welcome to OpenLaw" });
    const welcome = welcomeHeading.closest("section");
    expect(welcome).not.toBeNull();
    expect(
      screen.queryByRole("region", { name: "Approvals waiting on you" }),
    ).not.toBeInTheDocument();
    expect(within(welcome!).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(within(welcome!).getByRole("link", { name: "Matters" })).toHaveAttribute(
      "href",
      "/matters",
    );
  });
});
