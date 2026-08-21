// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The staff request detail (#414), through the real route table with
 * the standard fetch stub: the envelope, the values labelled by the
 * form that collected them, the paper, the thread at every tier, and
 * the trail from the Inbox row that opens it.
 *
 * A Contributor and a Business User never reach the screen — the API's
 * 403 is the real refusal, and the loader is its client half.
 *
 * What the comment panel *is* is `contract-record.test.tsx`'s subject
 * and is not re-asserted here. What this suite asks of it is that the
 * Request mounts it, that a Member+ is offered every room on one, and
 * that posting into it changes nothing about the Request (INT-007).
 */

import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
};
const BUSINESS = {
  id: "u9",
  email: "business@example.com",
  displayName: "Bao Business",
  role: "business_user",
};

/** One attached field, as the staff read answers it. */
function field(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "f-counterparty",
    slug: "counterparty",
    displayName: "Counterparty",
    fieldType: "text",
    fieldTag: "legal",
    moduleScope: "global",
    isRequired: false,
    displayOrder: 1,
    options: null,
    helpText: null,
    archivedAt: null,
    ...overrides,
  };
}

/** The whole detail read, with the shape the screen destructures. */
function detail(overrides: Partial<Record<string, unknown>> = {}) {
  const request = {
    id: "r1",
    number: 45,
    status: "new",
    summary: "Orion Cloud MSA renewal — redline review",
    description: "They sent a redline of the liability cap.\nProcurement needs it by Friday.",
    urgency: "high",
    customFields: { counterparty: "Orion Cloud Ltd" },
    declinedReason: null,
    createdAt: "2026-08-20T09:14:00.000Z",
    requestType: {
      id: "rt-nda",
      displayName: "NDA request",
      targetModule: "contract",
      targetTypeName: "NDA",
    },
    requester: {
      id: "u7",
      displayName: "Tom Iwu",
      email: "tom.iwu@acme.com",
      image: null,
    },
    convertedContract: null,
    ...((overrides.request as Record<string, unknown>) ?? {}),
  };
  return {
    request,
    fields: (overrides.fields as unknown[]) ?? [field()],
    customFieldRefs: (overrides.customFieldRefs as unknown) ?? { users: [], entities: [] },
    attachments: (overrides.attachments as unknown[]) ?? [],
  };
}

/** The detail read behind the screen, and the thread the panel opens
 * on. Both are answered, because both are calls the page makes. */
function detailApi(body: ReturnType<typeof detail>, status = 200) {
  const asked: string[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (/^\/api\/v1\/requests\/\d+$/.test(call.url.pathname) && call.method === "GET") {
      asked.push(call.url.pathname);
      return status === 200 ? json(200, body) : problem(status, "No such request.");
    }
    return undefined;
  };
  return { handler, asked };
}

/** The @-typeahead's list on a Request: a Member+ hears all three
 * rooms, the Requester hears Full Thread alone (DD-016). */
const CANDIDATES = [
  {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    tiers: ["legal_only", "working_team", "full_thread"],
  },
  { id: "u7", displayName: "Tom Iwu", image: null, tiers: ["full_thread"] },
];

function comment(
  id: string,
  body: string,
  visibility: string,
  author = { id: MEMBER.id, displayName: MEMBER.displayName, image: null },
) {
  return {
    id,
    entityType: "request",
    entityId: "r1",
    body,
    visibility,
    author,
    mentions: [],
    createdAt: "2026-08-20T10:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    redactedAt: null,
  };
}

/** The thread seam, stateful the way the API is: a post appends, and
 * the next read answers what the poster now sees. */
function commentsApi(initial: ReturnType<typeof comment>[] = []) {
  let thread = initial;
  const posts: unknown[] = [];
  const reads: Record<string, string | null>[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/comments/mention-candidates" && call.method === "GET") {
      return json(200, { candidates: CANDIDATES });
    }
    if (call.url.pathname === "/api/v1/comments/unread" && call.method === "GET") {
      return json(200, { unread: 0 });
    }
    if (call.url.pathname === "/api/v1/comments/read" && call.method === "POST") {
      return json(200, { unread: 0 });
    }
    if (call.url.pathname !== "/api/v1/comments") return undefined;
    if (call.method === "GET") {
      reads.push({
        entityType: call.url.searchParams.get("entityType"),
        entityId: call.url.searchParams.get("entityId"),
      });
      return json(200, { comments: thread, nextCursor: null });
    }
    if (call.method === "POST") {
      posts.push(call.body);
      const sent = call.body as { body: string; visibility: string; mentions?: string[] };
      const posted = comment(`c-new-${thread.length}`, sent.body, sent.visibility);
      thread = [...thread, posted];
      return json(201, { comment: posted });
    }
    return undefined;
  };
  return { handler, posts, reads };
}

/** The page's own seam plus the thread's, in that order. */
function pageApi(
  request: ReturnType<typeof detailApi>,
  comments: ReturnType<typeof commentsApi> = commentsApi(),
) {
  return (call: StubCall) => request.handler(call) ?? comments.handler(call);
}

/** Opens the chat panel from the activity bar and answers its icon. */
async function openChat(user: ReturnType<typeof userEvent.setup>) {
  const bar = await screen.findByRole("toolbar", { name: "Applets" });
  const icon = within(bar).getByRole("button", { name: "Comments" });
  await user.click(icon);
  return icon;
}

/** The applet panel animates its width; the close needs the frame. */
function finishAppletSlide(panel: HTMLElement) {
  const clip = panel.parentElement;
  expect(clip).not.toBeNull();
  fireEvent.transitionEnd(clip!, { propertyName: "width" });
}

describe("who may open a Request (INT-006)", () => {
  it("opens for a Legal Team Member", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail())) });
    renderAt("/inbox/45");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Orion Cloud MSA renewal — redline review",
      }),
    ).toBeInTheDocument();
  });

  it("sends a Contributor and a Business User home without asking the API", async () => {
    // Home for a Business User is the portal, which is where their own
    // window on a Request is (the INT-001 M20/2 addendum).
    for (const [person, home] of [
      [CONTRIBUTOR, "/"],
      [BUSINESS, "/portal"],
    ] as const) {
      const request = detailApi(detail());
      stubApi({ signedIn: person, extra: pageApi(request) });
      const { router } = renderAt("/inbox/45");

      await waitFor(() => expect(router.state.location.pathname).toBe(home));
      expect(request.asked).toEqual([]);
    }
  });

  it("lands back on the queue when the reference names no Request", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail(), 404)) });
    const { router } = renderAt("/inbox/9999");

    await waitFor(() => expect(router.state.location.pathname).toBe("/inbox"));
  });
});

describe("the envelope (I2)", () => {
  it("states the reference, the status, the requester, the routing, the urgency, and the age", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail())) });
    renderAt("/inbox/45");

    const heading = await screen.findByRole("heading", { level: 1 });
    const subbar = heading.closest("section")!;
    expect(within(subbar).getByText("R-45")).toBeInTheDocument();
    expect(within(subbar).getByText("New")).toBeInTheDocument();
    // The trail back to the queue the Request was picked up from.
    expect(within(subbar).getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/inbox");

    // The hero strip, which is where the envelope's five facts sit.
    const hero = screen.getByText("Submitted").closest("div")!.parentElement!;
    expect(within(hero).getByText("Tom Iwu")).toBeInTheDocument();
    expect(within(hero).getByText("NDA request")).toBeInTheDocument();
    // DD-018: triage confirms the routing the Administrator bound.
    expect(within(hero).getByText("Contract · NDA")).toBeInTheDocument();
    expect(within(hero).getByText("High")).toBeInTheDocument();
    // The age, which is what triage weighs. What it reads depends on
    // how long ago that is, so the assertion is on the stamp the
    // element carries rather than on today's wording (DES-014).
    const submitted = hero.querySelector("time");
    expect(submitted).toHaveAttribute("datetime", "2026-08-20T09:14:00.000Z");
    expect(submitted?.textContent).toBeTruthy();
  });

  it("names the requester's address, so triage can answer out of band", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail())) });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Requester" });
    expect(within(card).getByRole("link", { name: "tom.iwu@acme.com" })).toHaveAttribute(
      "href",
      "mailto:tom.iwu@acme.com",
    );
  });

  it("draws the Description with the requester's own line breaks", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail())) });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Description" });
    expect(card.textContent).toContain("They sent a redline of the liability cap.");
    expect(within(card).getByText("From the portal form")).toBeInTheDocument();
  });

  it("draws no Description card when the Request carries none", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(detailApi(detail({ request: { description: null } }))),
    });
    renderAt("/inbox/45");

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Description" })).not.toBeInTheDocument();
  });

  it("opens a triaged Request and states what became of it", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            request: { status: "converted", convertedContract: { number: 12 } },
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Outcome" });
    expect(within(card).getByText("Converted")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "C-12" })).toHaveAttribute(
      "href",
      "/contracts/12",
    );
  });

  it("carries a decline's recorded reason itself (INT-006)", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            request: {
              status: "declined",
              declinedReason: "Procurement owns vendor paper under $10k.",
            },
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Outcome" });
    expect(within(card).getByText("Declined")).toBeInTheDocument();
    expect(within(card).getByText("Procurement owns vendor paper under $10k.")).toBeInTheDocument();
  });

  it("draws no Outcome card while the Request is still undecided", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail())) });
    renderAt("/inbox/45");

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Outcome" })).not.toBeInTheDocument();
  });

  it("names a converted Request's record as absent when the server withheld it (DD-014)", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(detail({ request: { status: "converted", convertedContract: null } })),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Outcome" });
    expect(within(card).getByText("Converted")).toBeInTheDocument();
    // The screen never has a reference it must decide not to render.
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("the values, labelled by the form that collected them", () => {
  it("names each answered value with its field, and draws no row for an unanswered one", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            fields: [
              field(),
              field({ id: "f-region", slug: "deal_desk_region", displayName: "Deal desk region" }),
            ],
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Form responses" });
    expect(
      within(card)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Counterparty"]);
    expect(within(card).getByText("Orion Cloud Ltd")).toBeInTheDocument();
  });

  it("draws no row for a value whose field has been detached or archived", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            // The field is gone from the read; the value stays on the
            // row, and the label that would name it is no longer here.
            request: { customFields: { deal_desk_region: "EMEA" } },
            fields: [field()],
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Form responses" });
    expect(within(card).queryByText("EMEA")).not.toBeInTheDocument();
    expect(card.textContent).toContain("This form collected nothing beyond the basics.");
  });

  it("resolves a person and an Entity into names, archived rows included", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            request: { customFields: { manager: "u7", holder: "e1" } },
            fields: [
              field({
                id: "f-manager",
                slug: "manager",
                displayName: "Requesting manager",
                fieldType: "user",
              }),
              field({
                id: "f-holder",
                slug: "holder",
                displayName: "Contracting entity",
                fieldType: "entity",
              }),
            ],
            customFieldRefs: {
              users: [{ id: "u7", displayName: "Tom Iwu" }],
              entities: [{ id: "e1", legalName: "Wound Down GmbH" }],
            },
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Form responses" });
    expect(within(card).getByText("Tom Iwu")).toBeInTheDocument();
    expect(within(card).getByText("Wound Down GmbH")).toBeInTheDocument();
  });

  it("renders an id that resolves to nothing as the id (the INT-001 M20/10 rule)", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            request: { customFields: { manager: "01a01b9d-0000-7000-8000-00000000dead" } },
            fields: [
              field({
                id: "f-manager",
                slug: "manager",
                displayName: "Requesting manager",
                fieldType: "user",
              }),
            ],
            customFieldRefs: { users: [], entities: [] },
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Form responses" });
    // The Request does hold a value, so a dash would say it holds none.
    expect(within(card).getByText("01a01b9d-0000-7000-8000-00000000dead")).toBeInTheDocument();
  });
});

describe("the paper (INT-002)", () => {
  it("lists each file as the link that downloads it, through the staff mount", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(
          detail({
            attachments: [
              {
                id: "a1",
                filename: "orion-msa-redline-v3.docx",
                createdAt: "2026-08-20T09:15:00.000Z",
              },
              {
                id: "a2",
                filename: "orion-pricing-schedule.pdf",
                createdAt: "2026-08-20T09:16:00.000Z",
              },
            ],
          }),
        ),
      ),
    });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Attachments" });
    const links = within(card).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "orion-msa-redline-v3.docx",
      "orion-pricing-schedule.pdf",
    ]);
    expect(links[0]).toHaveAttribute("href", "/api/v1/requests/45/attachments/a1");
    expect(links[0]).toHaveAttribute("download");
  });

  it("says plainly when no paper travelled with the ask", async () => {
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail())) });
    renderAt("/inbox/45");

    const card = await screen.findByRole("region", { name: "Attachments" });
    expect(card.textContent).toContain("No files travelled with this request.");
  });
});

describe("the thread, at every tier (DD-016, CMT-010)", () => {
  it("mounts the conversation on the Request, keyed by its own id", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail()), comments) });
    renderAt("/inbox/45");

    const icon = await openChat(user);
    const panel = await screen.findByRole("complementary", { name: "Comments" });
    expect(icon).toHaveAttribute("aria-expanded", "true");
    // Never the R-### number: the panel is keyed by the entity pair,
    // which is what makes it entity-generic (CMT-001).
    await waitFor(() => {
      expect(comments.reads).toEqual([{ entityType: "request", entityId: "r1" }]);
    });

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    finishAppletSlide(panel);
    expect(screen.queryByRole("complementary", { name: "Comments" })).not.toBeInTheDocument();
  });

  it("draws every tier to a Member+, because they are in every room on a Request", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        detailApi(detail()),
        commentsApi([
          comment("c-1", "Cap looks standard — worth a look.", "legal_only"),
          comment("c-2", "Procurement is aligned.", "working_team"),
          comment("c-3", "Can you send the signed 2025 copy?", "full_thread", {
            id: "u7",
            displayName: "Tom Iwu",
            image: null,
          }),
        ]),
      ),
    });
    renderAt("/inbox/45");
    await openChat(user);

    const thread = await screen.findByRole("list", { name: "Comments" });
    const rows = within(thread).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Legal only")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Working team")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Full thread")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Tom Iwu")).toBeInTheDocument();
  });

  it("offers the composer every tier and posts at the one picked", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail()), comments) });
    renderAt("/inbox/45");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    expect(
      within(panel)
        .getAllByRole("radio")
        .map((segment) => segment.getAttribute("value")),
    ).toEqual(["legal_only", "working_team", "full_thread"]);

    // Legal Only triage chatter and Full Thread requester-facing
    // replies, in one conversation.
    for (const [segment, tier, body] of [
      ["Legal only", "legal_only", "Cap looks standard."],
      ["Full thread", "full_thread", "Can you send the 2025 copy?"],
    ] as const) {
      await user.click(within(panel).getByRole("radio", { name: segment }));
      await user.type(within(panel).getByLabelText("New comment"), body);
      await user.click(within(panel).getByRole("button", { name: "Comment" }));
      await waitFor(() => {
        expect(comments.posts.at(-1)).toEqual({
          entityType: "request",
          entityId: "r1",
          body,
          visibility: tier,
          mentions: [],
        });
      });
    }
  });

  it("offers the mention typeahead, and posts who was named", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    stubApi({ signedIn: MEMBER, extra: pageApi(detailApi(detail()), comments) });
    renderAt("/inbox/45");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    const box = within(panel).getByLabelText("New comment");
    await user.type(box, "@Nadia");
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    // One row, the person the query names — the initials beside the
    // name are the avatar's.
    expect(options).toHaveLength(1);
    expect(within(options[0]!).getByText("Nadia Counsel")).toBeInTheDocument();

    // Picking the row writes the name and the space after it, so the
    // rest of the sentence carries none of its own.
    await user.type(box, "{Enter}take a look.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));
    await waitFor(() => {
      expect(comments.posts).toEqual([
        {
          entityType: "request",
          entityId: "r1",
          body: "@Nadia Counsel take a look.",
          visibility: "working_team",
          mentions: ["u2"],
        },
      ]);
    });
  });

  it("leaves the status untouched when a reply is posted (INT-007)", async () => {
    const user = userEvent.setup();
    const request = detailApi(detail());
    const comments = commentsApi();
    const seen: string[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        // Anything that writes the Request would be a status change the
        // clarifying back-and-forth must never make.
        if (call.method !== "GET" && /^\/api\/v1\/requests\//.test(call.url.pathname)) {
          seen.push(`${call.method} ${call.url.pathname}`);
        }
        return pageApi(request, comments)(call);
      },
    });
    renderAt("/inbox/45");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.click(within(panel).getByRole("radio", { name: "Full thread" }));
    await user.type(within(panel).getByLabelText("New comment"), "Which entity is signing?");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(comments.posts).toHaveLength(1));

    expect(seen).toEqual([]);
    const subbar = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(within(subbar).getByText("New")).toBeInTheDocument();
  });
});

describe("the trail from the queue", () => {
  it("opens the Request the Inbox row links to", async () => {
    const user = userEvent.setup();
    const row = {
      id: "r1",
      number: 45,
      status: "new",
      summary: "Orion Cloud MSA renewal — redline review",
      urgency: "high",
      requestType: {
        id: "rt-nda",
        displayName: "NDA request",
        targetModule: "contract",
        targetTypeName: "NDA",
      },
      requester: { id: "u7", displayName: "Tom Iwu" },
      createdAt: "2026-08-20T09:14:00.000Z",
      convertedContract: null,
    };
    const request = detailApi(detail());
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/requests" && call.method === "GET") {
          return json(200, { requests: [row], nextCursor: null });
        }
        return pageApi(request)(call);
      },
    });
    const { router } = renderAt("/inbox");

    const queueRow = await screen.findByRole("row", { name: /Orion Cloud MSA renewal/ });
    await user.click(
      within(queueRow).getByRole("link", { name: "Orion Cloud MSA renewal — redline review" }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe("/inbox/45"));
    expect(await screen.findByRole("region", { name: "Form responses" })).toBeInTheDocument();
    expect(request.asked).toEqual(["/api/v1/requests/45"]);
  });
});
