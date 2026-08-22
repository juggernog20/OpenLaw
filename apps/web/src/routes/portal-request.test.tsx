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
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Comment } from "../lib/comments";
import type {
  MyRequestAttachment,
  MyRequestField,
  MyRequestFieldRefs,
  RequestStatus,
} from "../lib/requests";
import {
  json,
  problem,
  renderAt,
  stubApi,
  type StubAnswer,
  type StubCall,
} from "../testing/helpers";

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
    attachments?: MyRequestAttachment[];
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
    // No paper by default: attachments are optional (INT-002), and the
    // suites that are not about them need none.
    attachments: overrides.attachments ?? [],
  };
}

/** One comment as the API answers it, with an ordinary Full Thread row
 * already filled in — a suite asserts the one fact it is about. */
function comment(overrides: Partial<Comment> & { id: string; body: string }): Comment {
  return {
    entityType: "request",
    entityId: "rq1",
    author: { id: "u2", displayName: "Sarah Chen", image: null, archived: false },
    visibility: "full_thread",
    mentions: [],
    createdAt: "2026-08-07T09:14:00.000Z",
    editedAt: null,
    deletedAt: null,
    redactedAt: null,
    ...overrides,
  };
}

/** What the thread read answers: a page of comments, or a failure. */
type ThreadAnswer = { comments: Comment[]; nextCursor?: string | null } | "failed";

/**
 * Answers the two reads the detail loader makes: the Request itself,
 * and the thread that hangs off it (#381).
 *
 * One helper, because the page makes both reads on every load — a suite
 * that is not about the conversation still has to answer it. The thread
 * defaults to empty, which is what a Request nobody has replied to yet
 * has.
 */
function detailRead(body: unknown, status = 200, thread: ThreadAnswer = { comments: [] }) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/portal/requests/45" && call.method === "GET") {
      return status === 200
        ? json(200, body)
        : problem(status, "No request exists with this reference.");
    }
    if (call.url.pathname === "/api/v1/comments" && call.method === "GET") {
      if (thread === "failed") return problem(500, "The thread could not be read.");
      // A cursor means the reader asked for the page before this one.
      // The suite that walks back answers it with its own handler; this
      // one answers the newest page.
      return json(200, { comments: thread.comments, nextCursor: thread.nextCursor ?? null });
    }
    return undefined;
  };
}

function replyPost(answer: (body: unknown) => Response) {
  return (call: StubCall) =>
    call.url.pathname === "/api/v1/comments" && call.method === "POST"
      ? answer(call.body)
      : undefined;
}

/** The first handler with an answer wins, so a suite can layer its own
 * write over the two reads every load makes. */
function stubs(...handlers: ((call: StubCall) => StubAnswer)[]) {
  return (call: StubCall) => {
    for (const handler of handlers) {
      const answer = handler(call);
      if (answer) return answer;
    }
    return undefined;
  };
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
    expect(screen.getByText("Open")).toBeInTheDocument();
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

  // The INT-003 M21/6 addendum: the pill says the words the email says,
  // so a requester's inbox and their screen never disagree about the
  // same Request. The enum's own words are the staff detail's.
  it.each([
    ["new", "Open"],
    ["converted", "In progress"],
    ["resolved", "Resolved"],
    ["declined", "Declined"],
  ] as const)("says %s in the requester's own vocabulary", async (status, word) => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status })) });
    renderAt("/portal/requests/45");

    expect(await screen.findByText(word)).toBeInTheDocument();
  });

  it.each([
    ["new", "Legal has received your request"],
    ["converted", "Legal is working on this"],
    ["resolved", "Legal has answered this request and closed it"],
    ["declined", "Legal declined this request"],
  ] as const)("says what %s means for the requester", async (status, copy) => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status })) });
    renderAt("/portal/requests/45");

    expect(await screen.findByText(new RegExp(copy))).toBeInTheDocument();
  });

  it.each(["converted", "resolved", "declined"] as const)(
    "sends %s paper to the conversation instead of a Request upload",
    async (status) => {
      stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status })) });
      renderAt("/portal/requests/45");

      const pointer = await screen.findByRole("link", { name: "Attach new files to a reply" });
      expect(pointer).toHaveAttribute("href", "#portal-request-composer");
      expect(screen.queryByRole("button", { name: "Choose files" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument();
    },
  );

  it("does not point an undecided Request away from the form upload path", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status: "new" })) });
    renderAt("/portal/requests/45");

    await screen.findByRole("heading", { level: 1 });
    expect(
      screen.queryByRole("link", { name: "Attach new files to a reply" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a converted Request open, and names no record it cannot open", async () => {
    // INT-001, DD-018: conversion never takes the requester's window
    // away — and a Business User cannot open a Contract or a Matter, so
    // the page offers no link into one.
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ status: "converted" })) });
    renderAt("/portal/requests/45");

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
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

  it("lists the paper, each name the link that downloads it", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(
        detail({
          attachments: [
            {
              id: "att1",
              filename: "orion-msa-redline-v3.docx",
              createdAt: "2026-08-06T09:14:00.000Z",
            },
            {
              id: "att2",
              filename: "orion-pricing-schedule.pdf",
              createdAt: "2026-08-06T09:15:00.000Z",
            },
          ],
        }),
      ),
    });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "What you submitted" });
    const labels = within(card)
      .getAllByRole("term")
      .map((term) => term.textContent);
    // The basics in INT-002's order, with the paper between the
    // Description and the Urgency.
    expect(labels).toEqual(["Description", "Attachments", "Urgency", "Counterparty"]);

    // Same-origin and behind the session: the bytes come through the
    // API, and there is no presigned URL anywhere on this page.
    expect(within(card).getByRole("link", { name: "orion-msa-redline-v3.docx" })).toHaveAttribute(
      "href",
      "/api/v1/portal/requests/45/attachments/att1",
    );
    expect(within(card).getByRole("link", { name: "orion-pricing-schedule.pdf" })).toHaveAttribute(
      "href",
      "/api/v1/portal/requests/45/attachments/att2",
    );
  });

  it("draws no Attachments row when the ask carried no paper", async () => {
    // Attachments are optional (INT-002), so the row follows the card's
    // own rule: it says what was submitted, and a row of dashes says
    // what was not.
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail({ attachments: [] })) });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "What you submitted" });
    expect(within(card).queryByText("Attachments")).not.toBeInTheDocument();
  });

  it("draws the conversation above it, where I7 puts it", async () => {
    // #379 drew no conversation, because an empty card would have
    // claimed there was one. #381 gives the card a composer, so it is
    // now the way to start the conversation rather than a claim about
    // it, and the card draws on a Request nobody has replied to yet.
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail()) });
    renderAt("/portal/requests/45");

    const thread = await screen.findByRole("region", { name: "Conversation" });
    const submitted = screen.getByRole("region", { name: "What you submitted" });
    expect(thread.compareDocumentPosition(submitted)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(thread).getByRole("textbox", { name: "Reply to Legal" })).toBeInTheDocument();
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

/**
 * The deep link a group 5 email carries (#382, NOT-001, INT-003).
 *
 * Every requester message links to `/portal/requests/{number}`, and a
 * requester reads it in an inbox rather than in the app — so the address
 * has to answer whether or not a session is still live. It round-trips:
 * signed out it lands on the portal entry screen, where the one thing
 * they need is another link (the INT-001 M20/2 addendum); signed in it
 * lands on the Request itself.
 *
 * The link is **not** carried through redemption, and that is M20/2's
 * decision rather than a gap: the magic-link callback stays `/` and
 * landing is decided by role, so a redeemed link puts a Business User in
 * the portal and their own list is the way back to the Request. What this
 * suite pins is that the address in the email is never a dead end.
 */
describe("the portal deep link", () => {
  it("lands a signed-out visitor on the portal entry screen", async () => {
    stubApi({ signedIn: null });
    const { router } = renderAt("/portal/requests/45");

    expect(
      await screen.findByRole("heading", { name: "Legal request portal" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/portal/enter");
    // The entry screen carries the email step itself, so a stale session
    // costs one address rather than a dead end.
    expect(screen.getByRole("button", { name: "Send link" })).toBeInTheDocument();
  });

  it("lands a signed-in visitor on the Request the link names", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail()) });
    const { router } = renderAt("/portal/requests/45");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Orion Cloud MSA renewal — redline review",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/portal/requests/45");
  });
});

/**
 * The conversation (#381), from I7's Conversation card.
 *
 * Who can read the thread, which tiers each viewer hears, and what a
 * post at the wrong tier is answered are covered at the API's HTTP seam
 * and are not re-asserted here. What this suite covers is what a
 * requester at `/portal/requests/45` can see and do: the rows the card
 * draws, the composer that has no tier to choose, and what happens when
 * a reply is refused.
 */
describe("the conversation", () => {
  it("draws each reply with its author, its pill, and what was said", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(detail(), 200, {
        comments: [
          comment({
            id: "c1",
            body: "Adding context — the 22nd is a hard date.",
            author: { id: REQUESTER.id, displayName: "Tom Iwu", image: null, archived: false },
          }),
          comment({ id: "c2", body: "Thanks Tom — reviewing the redline now." }),
        ],
      }),
    });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "Conversation" });
    expect(within(card).getByText("Adding context — the 22nd is a hard date.")).toBeInTheDocument();
    expect(within(card).getByText("Thanks Tom — reviewing the redline now.")).toBeInTheDocument();
    // I7's author pill: the reader's own reply is "You", and on a
    // Request the only other author is staff.
    expect(within(card).getByText("You")).toBeInTheDocument();
    expect(within(card).getByText("Sarah Chen")).toBeInTheDocument();
    expect(within(card).getByText("Legal")).toBeInTheDocument();
  });

  it("offers the reply box no tier to choose", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail()) });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "Conversation" });
    expect(within(card).getByRole("textbox", { name: "Reply to Legal" })).toBeInTheDocument();
    // The tier picker is a staff affordance. A Requester is in one room,
    // so there is nothing here to pick between (DD-016).
    expect(within(card).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(card).queryByText("Full thread")).not.toBeInTheDocument();
    expect(within(card).queryByText("Legal only")).not.toBeInTheDocument();
    expect(within(card).queryByText("Working team")).not.toBeInTheDocument();
  });

  it("posts a reply at Full Thread and puts it on the end of the thread", async () => {
    const user = userEvent.setup();
    let sent: unknown;
    // What the loader asked the thread for. The stub answers the same
    // rows for every comments query, so without this the test passes on
    // a loader that dropped `entityId` or sent the contract's id — and
    // the whole claim of this test is that a converted Request's thread
    // is still read by the Request's own pair.
    const threadQueries: URLSearchParams[] = [];
    stubApi({
      signedIn: REQUESTER,
      extra: stubs(
        (call) => {
          if (call.url.pathname === "/api/v1/comments" && call.method === "GET") {
            threadQueries.push(call.url.searchParams);
          }
          return undefined;
        },
        replyPost((body) => {
          sent = body;
          return json(201, {
            comment: comment({
              id: "c9",
              body: "Any update on this?",
              author: { id: REQUESTER.id, displayName: "Tom Iwu", image: null, archived: false },
            }),
          });
        }),
        detailRead(detail()),
      ),
    });
    renderAt("/portal/requests/45");

    const box = await screen.findByRole("textbox", { name: "Reply to Legal" });
    await user.type(box, "Any update on this?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Any update on this?")).toBeInTheDocument();
    // Full Thread, and keyed by the Request's own id rather than its
    // R-### number (CMT-010).
    expect(sent).toEqual({
      entityType: "request",
      entityId: "rq1",
      body: "Any update on this?",
      visibility: "full_thread",
    });
    // The box is empty again, because the words landed.
    expect(box).toHaveValue("");
  });

  it("keeps the window on a converted Request, thread and composer alike", async () => {
    // CMT-001's promise from the requester's side (#422): the
    // conversation moved onto the record and the reply still lands. The
    // page asks for the Request's own thread and the API answers the
    // record's rows, so what proves it here is that the composer still
    // sends the Request's id — the redirect is the seam's and nothing on
    // this page branches on the status.
    const user = userEvent.setup();
    let sent: unknown;
    // What the loader asked the thread for. The stub answers the same
    // rows for every comments query, so without this the test passes on
    // a loader that dropped `entityId` or sent the contract's id — and
    // the whole claim of this test is that a converted Request's thread
    // is still read by the Request's own pair.
    const threadQueries: URLSearchParams[] = [];
    stubApi({
      signedIn: REQUESTER,
      extra: stubs(
        (call) => {
          if (call.url.pathname === "/api/v1/comments" && call.method === "GET") {
            threadQueries.push(call.url.searchParams);
          }
          return undefined;
        },
        replyPost((body) => {
          sent = body;
          return json(201, {
            comment: comment({
              id: "c9",
              entityType: "contract",
              entityId: "ct7",
              body: "Thanks — anything else you need?",
              author: { id: REQUESTER.id, displayName: "Tom Iwu", image: null, archived: false },
            }),
          });
        }),
        detailRead(detail({ status: "converted" }), 200, {
          // Answered from the record now, which is why the rows name a
          // contract. The page renders them exactly as it always did.
          comments: [
            comment({
              id: "c1",
              entityType: "contract",
              entityId: "ct7",
              body: "We have opened the file and started the redline.",
            }),
          ],
        }),
      ),
    });
    renderAt("/portal/requests/45");

    const card = await screen.findByRole("region", { name: "Conversation" });
    expect(
      within(card).getByText("We have opened the file and started the redline."),
    ).toBeInTheDocument();
    expect(threadQueries[0]?.get("entityType")).toBe("request");
    expect(threadQueries[0]?.get("entityId")).toBe("rq1");

    const box = within(card).getByRole("textbox", { name: "Reply to Legal" });
    await user.type(box, "Thanks — anything else you need?");
    await user.click(within(card).getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Thanks — anything else you need?")).toBeInTheDocument();
    expect(sent).toEqual({
      entityType: "request",
      entityId: "rq1",
      body: "Thanks — anything else you need?",
      visibility: "full_thread",
    });
  });

  it("keeps the words in the box and states the reason when the reply is refused", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: REQUESTER,
      extra: stubs(
        replyPost(() => problem(403, "You cannot post a comment at that visibility tier.")),
        detailRead(detail()),
      ),
    });
    renderAt("/portal/requests/45");

    const box = await screen.findByRole("textbox", { name: "Reply to Legal" });
    await user.type(box, "Any update on this?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("You cannot post a comment at that visibility tier."),
    ).toBeInTheDocument();
    // Nothing a person wrote is thrown away by a refusal.
    expect(box).toHaveValue("Any update on this?");
  });

  it("shows comment paper and sends up to five removable chosen files", async () => {
    const user = userEvent.setup();
    let sent: FormData | null = null;
    stubApi({
      signedIn: REQUESTER,
      extra: stubs(
        replyPost((body) => {
          sent = body as FormData;
          return json(201, {
            comment: comment({
              id: "c-new",
              body: String(sent.get("body")),
              attachments: (sent.getAll("file") as File[]).map((file, index) => ({
                id: `a-new-${index}`,
                filename: file.name,
              })),
            }),
          });
        }),
        detailRead(detail(), 200, {
          comments: [
            comment({
              id: "c-paper",
              body: "Please review the attached draft.",
              attachments: [{ id: "a-paper", filename: "draft for requester.pdf" }],
            }),
          ],
        }),
      ),
    });
    renderAt("/portal/requests/45");

    const existing = await screen.findByRole("link", { name: "draft for requester.pdf" });
    expect(existing).toHaveAttribute(
      "href",
      "/api/v1/comments/c-paper/attachments/a-paper?entityType=request&entityId=rq1",
    );

    const input = screen.getByLabelText("Choose files for this comment");
    const files = Array.from(
      { length: 6 },
      (_, index) => new File([`round ${index}`], `round-${index + 1}.pdf`),
    );
    await user.upload(input, files);
    const chosen = screen.getByRole("list", { name: "Files attached to this comment" });
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("Up to 5 files.")).toBeInTheDocument();

    await user.click(within(chosen).getByRole("button", { name: "Remove round-2.pdf" }));
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(4);
    await user.type(screen.getByRole("textbox", { name: "Reply to Legal" }), "Four rounds.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.get("entityType")).toBe("request");
    expect(sent!.get("entityId")).toBe("rq1");
    expect(sent!.get("visibility")).toBe("full_thread");
    expect((sent!.getAll("file") as File[]).map((file) => file.name)).toEqual([
      "round-1.pdf",
      "round-3.pdf",
      "round-4.pdf",
      "round-5.pdf",
    ]);
  });

  it("says the conversation could not be read, and still shows what was submitted", async () => {
    stubApi({ signedIn: REQUESTER, extra: detailRead(detail(), 200, "failed") });
    renderAt("/portal/requests/45");

    expect(
      await screen.findByText("The conversation could not be read. Reload the page to try again."),
    ).toBeInTheDocument();
    // A thread that could not be fetched does not take the page with
    // it: the values the requester submitted are still theirs to see.
    expect(screen.getByRole("region", { name: "What you submitted" })).toBeInTheDocument();
  });

  it("walks back into the older thread when there is more of it", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: REQUESTER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/comments" && call.url.searchParams.get("cursor")) {
          return json(200, {
            comments: [comment({ id: "c0", body: "The very first reply." })],
            nextCursor: null,
          });
        }
        return detailRead(detail(), 200, {
          comments: [comment({ id: "c5", body: "The newest reply." })],
          nextCursor: "c5",
        })(call);
      },
    });
    renderAt("/portal/requests/45");

    await user.click(await screen.findByRole("button", { name: "Show earlier replies" }));

    const older = await screen.findByText("The very first reply.");
    const newer = screen.getByText("The newest reply.");
    // Above what was already there, not below it: the thread reads
    // oldest to newest, so what came before belongs on the head of it
    // (CTR-024).
    expect(older.compareDocumentPosition(newer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // The thread reaches its own beginning, so the control goes.
    expect(screen.queryByRole("button", { name: "Show earlier replies" })).not.toBeInTheDocument();
  });

  it("draws a removed reply as the tombstone it is", async () => {
    stubApi({
      signedIn: REQUESTER,
      extra: detailRead(detail(), 200, {
        comments: [
          comment({ id: "c1", body: "", deletedAt: "2026-08-07T10:00:00.000Z" }),
          comment({ id: "c2", body: "Reposting: we are on it." }),
        ],
      }),
    });
    renderAt("/portal/requests/45");

    // The row keeps its seat so the conversation around it still reads
    // (CMT-008).
    expect(await screen.findByText("Comment deleted by its author.")).toBeInTheDocument();
    expect(screen.getByText("Reposting: we are on it.")).toBeInTheDocument();
  });
});
