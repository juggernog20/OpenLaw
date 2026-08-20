// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request detail (#379): what a Requester sees when they open one
 * of their own asks — the envelope, the banner that says what the
 * status means for them, and the values the form collected.
 *
 * Which Requests the read answers with, and the 404 it gives for
 * another requester's, are covered at the API's HTTP seam and are not
 * re-tested here. What this suite asserts is what a visitor at
 * `/portal/requests/45` can see.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { MyRequestField, MyRequestFieldRefs, RequestStatus } from "../lib/requests";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const REQUESTER = {
  id: "u9",
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  role: "business_user",
};

const MEMBER = {
  id: "u2",
  email: "lee@example.com",
  displayName: "Lee Member",
  role: "legal_team_member",
};

/** One attached field as the detail read answers it, and the whole of
 * its refs map — both taken from the generated client, so a fixture
 * cannot drift from what the API answers. */
function field(
  overrides: Partial<MyRequestField> & { slug: string; displayName: string },
): MyRequestField {
  return {
    fieldId: `f-${overrides.slug}`,
    description: null,
    fieldType: "text",
    options: null,
    displayOrder: 1,
    isRequired: false,
    ...overrides,
  };
}

/** The detail as the API answers it, with the ordinary Request already
 * filled in — a suite asserts the one fact it is about. */
function detail(
  overrides: {
    status?: RequestStatus;
    declinedReason?: string | null;
    description?: string | null;
    customFields?: Record<string, unknown>;
    fields?: MyRequestField[];
    customFieldRefs?: MyRequestFieldRefs;
  } = {},
) {
  return {
    request: {
      id: "rq1",
      number: 45,
      status: overrides.status ?? "new",
      summary: "Orion Cloud MSA renewal — redline review",
      requestType: { id: "rt2", slug: "contract_review", displayName: "Contract review" },
      createdAt: "2026-08-06T09:14:00.000Z",
      description:
        overrides.description === undefined
          ? "Orion Cloud sent their redline of the MSA renewal.\nProcurement needs it back by the 22nd."
          : overrides.description,
      urgency: "high",
      customFields: overrides.customFields ?? { counterparty: "Orion Cloud Ltd" },
      declinedReason: overrides.declinedReason ?? null,
    },
    fields: overrides.fields ?? [field({ slug: "counterparty", displayName: "Counterparty" })],
    customFieldRefs: overrides.customFieldRefs ?? { users: [], entities: [] },
  };
}

/** Answers the one read the detail makes. */
function detailRead(body: unknown, status = 200) {
  return (call: StubCall) =>
    call.url.pathname === "/api/v1/portal/requests/45" && call.method === "GET"
      ? status === 200
        ? json(200, body)
        : problem(status, "No request exists with this reference.")
      : undefined;
}

describe("the request envelope", () => {
  it("draws the summary, the status, and the R-### · type · submitted line", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail()) });
    renderAt("/portal/requests/45");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Orion Cloud MSA renewal — redline review",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("R-45 · Contract review · Submitted Aug 6")).toBeInTheDocument();
  });

  it("offers the way back to my-requests", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail()) });
    renderAt("/portal/requests/45");

    expect(await screen.findByRole("link", { name: "Your requests" })).toHaveAttribute(
      "href",
      "/portal",
    );
  });

  it.each([
    ["new", "Legal has received your request"],
    ["converted", "Legal is working on this"],
    ["resolved", "Legal has answered this request"],
    ["declined", "Legal declined this request"],
  ] as const)("says what %s means for the requester", async (status, copy) => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status })) });
    renderAt("/portal/requests/45");

    expect(await screen.findByText(new RegExp(copy))).toBeInTheDocument();
  });

  it("keeps a converted Request open, and names no record it cannot open", async () => {
    // INT-001, DD-018: conversion never takes the requester's window
    // away — and a Business User cannot open a Contract or a Matter, so
    // the page offers no link into one.
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status: "converted" })) });
    renderAt("/portal/requests/45");

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Converted")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /contract/i })).not.toBeInTheDocument();
  });

  it("carries the decline reason on a declined Request (INT-006)", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(
        detail({
          status: "declined",
          declinedReason: "Procurement owns vendor paper under $10k.",
        }),
      ),
    });
    renderAt("/portal/requests/45");

    expect(
      await screen.findByText(/Procurement owns vendor paper under \$10k\./),
    ).toBeInTheDocument();
  });
});

describe("what the requester submitted", () => {
  it("draws each value under the label the form collected it with", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(
        detail({
          customFields: { counterparty: "Orion Cloud Ltd", paper_side: "Theirs" },
          fields: [
            field({ slug: "counterparty", displayName: "Counterparty" }),
            field({
              slug: "paper_side",
              displayName: "Paper side",
              fieldType: "single_select",
              options: ["Ours", "Theirs"],
              displayOrder: 2,
            }),
          ],
        }),
      ),
    });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "What you submitted" });
    const labels = within(card)
      .getAllByRole("term")
      .map((term) => term.textContent);
    // Description and Urgency first — the basics every form collects —
    // then the type's own fields in display order.
    expect(labels).toEqual(["Description", "Urgency", "Counterparty", "Paper side"]);
    expect(within(card).getByText("High")).toBeInTheDocument();
    expect(within(card).getByText("Orion Cloud Ltd")).toBeInTheDocument();
    expect(within(card).getByText("Theirs")).toBeInTheDocument();
    expect(within(card).getByText(/Procurement needs it back by the 22nd/)).toBeInTheDocument();
  });

  it("leaves out a field the requester did not answer", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(
        detail({
          customFields: { counterparty: "Orion Cloud Ltd" },
          fields: [
            field({ slug: "counterparty", displayName: "Counterparty" }),
            field({ slug: "deal_desk_region", displayName: "Deal desk region", displayOrder: 2 }),
          ],
        }),
      ),
    });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "What you submitted" });
    expect(within(card).getByText("Counterparty")).toBeInTheDocument();
    expect(within(card).queryByText("Deal desk region")).not.toBeInTheDocument();
  });

  it("reads each field type the way that type reads", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(
        detail({
          customFields: {
            contract_value: 480000,
            needed_by: "2026-08-22",
            auto_renews: false,
            regions: ["EMEA", "APAC"],
            requesting_manager: "u4",
            contracting_entity: "e7",
          },
          fields: [
            field({ slug: "contract_value", displayName: "Contract value", fieldType: "number" }),
            field({
              slug: "needed_by",
              displayName: "Needed by",
              fieldType: "date",
              displayOrder: 2,
            }),
            field({
              slug: "auto_renews",
              displayName: "Auto-renews",
              fieldType: "boolean",
              displayOrder: 3,
            }),
            field({
              slug: "regions",
              displayName: "Regions",
              fieldType: "multi_select",
              options: ["EMEA", "APAC"],
              displayOrder: 4,
            }),
            field({
              slug: "requesting_manager",
              displayName: "Requesting manager",
              fieldType: "user",
              displayOrder: 5,
            }),
            field({
              slug: "contracting_entity",
              displayName: "Contracting entity",
              fieldType: "entity",
              displayOrder: 6,
            }),
          ],
          customFieldRefs: {
            users: [{ id: "u4", displayName: "Dana Okafor" }],
            entities: [{ id: "e7", legalName: "Acme Holdings LLC" }],
          },
        }),
      ),
    });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "What you submitted" });
    expect(within(card).getByText("480,000")).toBeInTheDocument();
    expect(within(card).getByText("Aug 22, 2026")).toBeInTheDocument();
    // `false` is an answer, not a gap: the field asked and was told no.
    expect(within(card).getByText("No")).toBeInTheDocument();
    expect(within(card).getByText("EMEA and APAC")).toBeInTheDocument();
    // The two types that name a row read as a name, never as an id.
    expect(within(card).getByText("Dana Okafor")).toBeInTheDocument();
    expect(within(card).getByText("Acme Holdings LLC")).toBeInTheDocument();
    expect(within(card).queryByText("u4")).not.toBeInTheDocument();
  });

  it("draws no conversation yet", async () => {
    // The thread is #381. A page that drew an empty one would be
    // claiming there is a conversation.
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail()) });
    renderAt("/portal/requests/45");

    await screen.findByRole("region", { name: "What you submitted" });
    expect(screen.queryByRole("region", { name: "Conversation" })).not.toBeInTheDocument();
  });
});

describe("who reaches the detail", () => {
  it("sends an unauthenticated visitor to the portal door", async () => {
    stubApi({ signedIn: null });
    renderAt("/portal/requests/45");

    expect(
      await screen.findByRole("heading", { name: "Legal request portal" }),
    ).toBeInTheDocument();
  });

  it("sends a reference that is not the caller's back to their own list", async () => {
    // A reference nobody has and a reference somebody else has are the
    // same 404 (DD-013), and neither is a fault a requester can act on.
    stubApi({ signedIn: REQUESTER, extra: detailRead(null, 404) });
    renderAt("/portal/requests/45");

    expect(
      await screen.findByRole("heading", { name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
  });

  it("sends a reference that is not a number back too", async () => {
    stubApi({ signedIn: REQUESTER });
    renderAt("/portal/requests/not-a-number");

    expect(
      await screen.findByRole("heading", { name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
  });

  it("lands on the error boundary when the read fails for any other reason", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(null, 500) });
    renderAt("/portal/requests/45");

    expect(
      await screen.findByRole("heading", { name: "Something went wrong." }),
    ).toBeInTheDocument();
  });

  it("draws the same page for Member+ staff, who are Requesters here", async () => {
    stubApi({ signedIn: MEMBER, extra: detailRead(detail()) });
    renderAt("/portal/requests/45");

    expect(await screen.findByRole("region", { name: "What you submitted" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
