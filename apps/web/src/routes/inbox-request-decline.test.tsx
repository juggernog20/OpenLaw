// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Decline on the staff request detail (#418), through the real route
 * table with the standard fetch stub.
 *
 * The screen's own subjects — the envelope, the values, the paper, the
 * thread — are `inbox-request.test.tsx`'s. This suite is INT-007's
 * disposition surface: that the sub-bar offers Decline while a Request is
 * undecided and offers nothing once it is not, that the reason is
 * required before the seam is asked, that cancelling writes nothing, and
 * that the loser of a race is told the outcome that was recorded rather
 * than being offered the button again.
 *
 * What the seam does with a decline is the API harness's subject
 * (`decline.test.ts`), including the row lock that makes the race a
 * refusal. What this suite asks of it is that the screen sends the
 * reason and reads the Request again afterwards.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

/** The Request the screen opens on, in whichever state a test needs. */
function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "r1",
    number: 45,
    status: "new",
    summary: "Orion Cloud MSA renewal — redline review",
    description: "They sent a redline of the liability cap.",
    urgency: "high",
    customFields: {},
    declinedReason: null,
    createdAt: "2026-08-20T09:14:00.000Z",
    requestType: {
      id: "rt-nda",
      displayName: "NDA request",
      targetModule: "contract",
      targetTypeName: "NDA",
    },
    requester: { id: "u7", displayName: "Tom Iwu", email: "tom.iwu@acme.com", image: null },
    convertedContract: null,
    ...overrides,
  };
}

/** The whole detail read, around one Request. */
const detail = (row: Record<string, unknown>) => ({
  request: row,
  fields: [],
  customFieldRefs: { users: [], entities: [] },
  attachments: [],
});

/**
 * The Request seam behind the screen, stateful the way the API is: the
 * decline answers the envelope it wrote and the next read answers it
 * too, so the page's re-read shows the decision rather than the state it
 * opened on.
 */
function requestApi(
  initial = request(),
  answer: (call: StubCall) => Response | undefined = () => undefined,
) {
  let row = initial;
  const declines: unknown[] = [];
  let reads = 0;
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/requests/45/decline" && call.method === "POST") {
      declines.push(call.body);
      const refusal = answer(call);
      if (refusal) return refusal;
      row = {
        ...row,
        status: "declined",
        declinedReason: (call.body as { reason: string }).reason,
      };
      return json(200, { request: row });
    }
    if (/^\/api\/v1\/requests\/\d+$/.test(call.url.pathname) && call.method === "GET") {
      reads += 1;
      return json(200, detail(row));
    }
    // The thread the page mounts beside the Request. It is not this
    // suite's subject, so it answers empty.
    if (call.url.pathname === "/api/v1/comments" && call.method === "GET") {
      return json(200, { comments: [], nextCursor: null });
    }
    if (call.url.pathname === "/api/v1/comments/unread" && call.method === "GET") {
      return json(200, { unread: 0 });
    }
    return undefined;
  };
  return {
    handler,
    declines,
    get reads() {
      return reads;
    },
  };
}

/** The sub-bar, which is where the disposition lives. */
async function subbar() {
  const heading = await screen.findByRole("heading", { level: 1 });
  return heading.closest("section")!;
}

/** Opens the Decline dialog from the sub-bar and answers it. */
async function openDecline(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(await subbar()).getByRole("button", { name: "Decline" }));
  return screen.findByRole("dialog");
}

describe("the disposition surface (INT-007, DES-058)", () => {
  it("offers Decline while the Request is undecided", async () => {
    stubApi({ signedIn: MEMBER, extra: requestApi().handler });
    renderAt("/inbox/45");

    expect(within(await subbar()).getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("offers nothing once the Request has been decided", async () => {
    // A decided Request has nothing left to decide, and the Outcome card
    // is what says what was decided.
    stubApi({
      signedIn: MEMBER,
      extra: requestApi(request({ status: "declined", declinedReason: "Ask Procurement." }))
        .handler,
    });
    renderAt("/inbox/45");

    expect(within(await subbar()).queryByRole("button", { name: "Decline" })).toBeNull();
    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(within(outcome).getByText("Ask Procurement.")).toBeInTheDocument();
  });

  it("writes nothing when the dialog is cancelled", async () => {
    // INT-007's whole point about Assign: opening the flow is not an act,
    // so cancelling returns the Request to the queue untouched.
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    await user.type(within(dialog).getByLabelText(/Reason/), "Second thoughts.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.declines).toEqual([]);
    expect(within(await subbar()).getByText("New")).toBeInTheDocument();
  });
});

describe("the reason (INT-006)", () => {
  it("refuses an empty reason without asking the seam", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Write why. The requester is sent this.",
    );
    expect(api.declines).toEqual([]);
    expect(within(dialog).getByLabelText(/Reason/)).toHaveAttribute("aria-invalid", "true");
  });

  it("names who reads the reason, where the reason is written", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: requestApi().handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    expect(
      within(dialog).getByText("The requester is emailed this and sees it on their request."),
    ).toBeInTheDocument();
  });

  it("sends the reason and repaints the Request as declined", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    await user.type(
      within(dialog).getByLabelText(/Reason/),
      "This one goes to Procurement, not to Legal.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.declines).toEqual([{ reason: "This one goes to Procurement, not to Legal." }]);

    // The page re-reads, so the pill, the actions, and the Outcome card
    // all state the decision rather than the state the page opened on.
    await waitFor(() => expect(api.reads).toBeGreaterThan(1));
    const bar = await subbar();
    await waitFor(() => expect(within(bar).getByText("Declined")).toBeInTheDocument());
    expect(within(bar).queryByRole("button", { name: "Decline" })).toBeNull();
    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(
      within(outcome).getByText("This one goes to Procurement, not to Legal."),
    ).toBeInTheDocument();
  });

  it("prints the seam's own refusal when it gives one", async () => {
    // A refusal the seam gave is about the write rather than about the
    // box, so it prints in the dialog's own words — the seam's sentence,
    // which is the one somebody can act on.
    const user = userEvent.setup();
    const api = requestApi(request(), () =>
      problem(400, "That request type is not taking writes."),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    await user.type(within(dialog).getByLabelText(/Reason/), "Out of scope.");
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That request type is not taking writes.",
    );
    expect(within(dialog).getByLabelText(/Reason/)).not.toHaveAttribute("aria-invalid");
  });
});

describe("the lost race (INT-007, TECH-020)", () => {
  it("states the outcome somebody else recorded, and offers no second decline", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () => {
      const body = {
        type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
        title: "Already decided",
        status: 409,
        detail: "This request has already been converted.",
        outcome: "converted",
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    await user.type(within(dialog).getByLabelText(/Reason/), "Too slow.");
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));

    // The outcome comes off the problem type's extension member, so the
    // dialog names the decision rather than printing a sentence about a
    // failure.
    expect(
      await within(dialog).findByText("Somebody else already converted this request."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Decline request" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("re-reads the Request behind the dialog, so the page is right when it closes", async () => {
    const user = userEvent.setup();
    let racedAway = false;
    const api = requestApi(request(), () => {
      racedAway = true;
      const body = {
        type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
        title: "Already decided",
        status: 409,
        outcome: "declined",
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    // The other triager's decline, applied to what the next read answers.
    const handler = (call: StubCall) => {
      if (racedAway && /^\/api\/v1\/requests\/\d+$/.test(call.url.pathname)) {
        return json(200, detail(request({ status: "declined", declinedReason: "Priya said no." })));
      }
      return api.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/inbox/45");

    const dialog = await openDecline(user);
    await user.type(within(dialog).getByLabelText(/Reason/), "Nadia says no.");
    await user.click(within(dialog).getByRole("button", { name: "Decline request" }));

    await within(dialog).findByText("Somebody else already declined this request.");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(within(outcome).getByText("Priya said no.")).toBeInTheDocument();
  });
});
