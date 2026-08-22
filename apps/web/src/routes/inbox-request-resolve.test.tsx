// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolve on the staff request detail (#419), through the real route
 * table with the standard fetch stub.
 *
 * The screen's own subjects — the envelope, the values, the paper, the
 * thread — are `inbox-request.test.tsx`'s, and the scaffold the dialog
 * rides is `inbox-request-decline.test.tsx`'s. This suite is Resolve's
 * own shape: that the sub-bar offers it beside Decline while a Request
 * is undecided, that the closing reply is genuinely optional and is
 * omitted rather than sent empty, that the page repaints as Resolved,
 * and that a lost race ends the dialog in a statement.
 *
 * What the seam does with a resolution — the comment on the thread, the
 * two events, the row lock — is the API harness's subject
 * (`resolve.test.ts`). What this suite asks of it is that the screen
 * sends the reply it was given and reads the Request again afterwards.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";
import {
  dispositionApi,
  MEMBER,
  openDisposition,
  staffDetail as detail,
  staffRequest,
  subbar,
} from "../testing/disposition";

/** The Request the screen opens on: a question with a short answer, so
 * the closing reply is the natural thing to type. */
const request = (overrides: Record<string, unknown> = {}) =>
  staffRequest({
    summary: "Which NDA template do we use under $1k?",
    description: "Small vendor, standard terms.",
    urgency: "low",
    ...overrides,
  });

/**
 * The Request seam behind the screen, with Resolve's own outcome on it.
 * Everything else — the detail read, the thread, the counters — is the
 * shared scaffold's.
 */
function requestApi(
  initial = request(),
  answer: (call: StubCall) => Response | undefined = () => undefined,
) {
  const api = dispositionApi({
    segment: "resolve",
    initial,
    answer,
    applied: (row) => ({ ...row, status: "resolved" }),
  });
  return {
    handler: api.handler,
    resolutions: api.sent,
    get reads() {
      return api.reads;
    },
  };
}

/** Opens the Resolve dialog from the sub-bar and answers it. */
const openResolve = (user: ReturnType<typeof userEvent.setup>) => openDisposition(user, "Resolve");

describe("the disposition surface (INT-007, DES-058)", () => {
  it("offers Resolve beside Decline while the Request is undecided", async () => {
    stubApi({ signedIn: MEMBER, extra: requestApi().handler });
    renderAt("/inbox/45");

    const bar = await subbar();
    expect(within(bar).getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("offers nothing once the Request has been decided", async () => {
    // A decided Request has nothing left to decide, and the Outcome card
    // is what says what was decided.
    stubApi({ signedIn: MEMBER, extra: requestApi(request({ status: "resolved" })).handler });
    renderAt("/inbox/45");

    expect(within(await subbar()).queryByRole("button", { name: "Resolve" })).toBeNull();
    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(within(outcome).getByText("Resolved")).toBeInTheDocument();
  });

  it("writes nothing when the dialog is cancelled", async () => {
    // INT-007's whole point about Assign: opening the flow is not an act,
    // so cancelling returns the Request to the queue untouched.
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    await user.type(within(dialog).getByLabelText(/Closing reply/), "Second thoughts.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.resolutions).toEqual([]);
    expect(within(await subbar()).getByText("New")).toBeInTheDocument();
  });
});

describe("the closing reply (INT-006)", () => {
  it("says the box is optional and what the words in it become", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: requestApi().handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    expect(within(dialog).getByLabelText("Closing reply (optional)")).toBeInTheDocument();
    // Which of the two disposition boxes this is: a reply goes on the
    // conversation, where the requester can answer it.
    expect(
      within(dialog).getByText("This goes on the request's thread, and to the requester by email."),
    ).toBeInTheDocument();
  });

  it("sends the reply and repaints the Request as resolved", async () => {
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    await user.type(
      within(dialog).getByLabelText(/Closing reply/),
      "Use the short-form NDA in the templates folder.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Resolve request" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.resolutions).toEqual([{ reply: "Use the short-form NDA in the templates folder." }]);

    // The page re-reads, so the pill, the actions, and the Outcome card
    // all state the decision rather than the state the page opened on.
    await waitFor(() => expect(api.reads).toBeGreaterThan(1));
    const bar = await subbar();
    await waitFor(() => expect(within(bar).getByText("Resolved")).toBeInTheDocument());
    expect(within(bar).queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("closes the Request with no reply at all when the box is left empty", async () => {
    // INT-006's optional half: the answer is often already on the thread,
    // and a second copy of it would be noise.
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    await user.click(within(dialog).getByRole("button", { name: "Resolve request" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.resolutions).toEqual([{}]);
  });

  it("treats a box of spaces as no reply rather than sending a blank one", async () => {
    // The seam refuses a blank reply, and it is right to: a box of
    // spaces is not an answer. The screen never asks it to.
    const user = userEvent.setup();
    const api = requestApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    await user.type(within(dialog).getByLabelText(/Closing reply/), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Resolve request" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.resolutions).toEqual([{}]);
  });

  it("prints the seam's own refusal when it gives one", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () => problem(400, "That request is not taking writes."));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    await user.type(within(dialog).getByLabelText(/Closing reply/), "All sorted.");
    await user.click(within(dialog).getByRole("button", { name: "Resolve request" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That request is not taking writes.",
    );
    // The dialog stays a form, because the refusal is about the write
    // rather than about the decision being gone.
    expect(within(dialog).getByRole("button", { name: "Resolve request" })).toBeInTheDocument();
  });
});

describe("the lost race (INT-007, TECH-020)", () => {
  it("states the outcome somebody else recorded, and offers no second resolution", async () => {
    const user = userEvent.setup();
    const api = requestApi(request(), () => {
      const body = {
        type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
        title: "Already decided",
        status: 409,
        detail: "This request has already been declined.",
        outcome: "declined",
      };
      return new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      });
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox/45");

    const dialog = await openResolve(user);
    await user.click(within(dialog).getByRole("button", { name: "Resolve request" }));

    // The outcome comes off the problem type's extension member, so the
    // dialog names the decision rather than printing a sentence about a
    // failure.
    expect(
      await within(dialog).findByText("Somebody else already declined this request."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Resolve request" })).toBeNull();
    // The box and the submit that held focus have just unmounted, so the
    // one control left takes it (DES-011).
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();

    await user.click(close);
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

    const dialog = await openResolve(user);
    await user.type(within(dialog).getByLabelText(/Closing reply/), "Answered on the thread.");
    await user.click(within(dialog).getByRole("button", { name: "Resolve request" }));

    await within(dialog).findByText("Somebody else already declined this request.");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    const outcome = await screen.findByRole("region", { name: "Outcome" });
    expect(within(outcome).getByText("Priya said no.")).toBeInTheDocument();
  });
});
