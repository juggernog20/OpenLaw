// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The scaffold the three disposition suites ride (INT-007, DES-058).
 *
 * Decline, Resolve, and Convert are three acts on one screen, and the
 * screen is the same screen for all three: the same Member+, the same
 * Request, the same detail read, the same sub-bar, and the same thread
 * mounted beside it. Only the endpoint segment, what the write does to
 * the row, and what the suite calls its accumulator are its own.
 *
 * Held here rather than copied three times, because a copy is a place a
 * change can be forgotten. A read added to the detail page needs one
 * answer here instead of three, and a suite that missed the third
 * fails with "Unstubbed fetch" — a message about the stub rather than
 * about the behaviour, and a debugging session each time.
 *
 * What is **not** here is each disposition's own shape: the dialog it
 * opens, the body it sends, and the sentence it prints. That is what
 * each suite is for.
 */

import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { json, type StubCall } from "./helpers";

export const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

/**
 * The Request the screen opens on, in whichever state a test needs.
 *
 * `new` and answerable by all three dispositions. A suite overrides the
 * summary, the urgency, the collected values, or the routing where its
 * own subject depends on one.
 */
export function staffRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      targetTypeId: "ct-nda",
      targetTypeName: "NDA",
    },
    requester: { id: "u7", displayName: "Tom Iwu", email: "tom.iwu@acme.com", image: null },
    convertedContract: null,
    convertedRecord: null,
    ...overrides,
  };
}

/** The whole detail read, around one Request. `fields` is what the
 * request form collected labels for, which only Convert's suite needs
 * filled. */
export function staffDetail(row: Record<string, unknown>, fields: unknown[] = []): unknown {
  return {
    request: row,
    fields,
    customFieldRefs: { users: [], entities: [] },
    attachments: [],
  };
}

export interface DispositionSeamOptions {
  /** The route segment the write posts to: `decline`, `resolve`, or
   * `convert`. */
  segment: string;
  initial?: Record<string, unknown>;
  /** What the row becomes once the write lands — the outcome this
   * disposition records. */
  applied: (row: Record<string, unknown>, body: unknown) => Record<string, unknown>;
  detail?: (row: Record<string, unknown>) => unknown;
  /** A refusal in place of the write, for the race and failure cases. */
  answer?: (call: StubCall) => Response | undefined;
  /** Anything this suite alone answers, consulted before the shared
   * reads. */
  extra?: (call: StubCall) => Response | undefined;
}

export interface DispositionSeam {
  handler: (call: StubCall) => Response | undefined;
  sent: unknown[];
  readonly reads: number;
}

/**
 * The Request seam behind the screen, stateful the way the API is: the
 * write answers the envelope it recorded and the next read answers it
 * too, so the page's re-read shows the decision rather than the state
 * it opened on.
 */
export function dispositionApi(options: DispositionSeamOptions): DispositionSeam {
  const detail = options.detail ?? ((row: Record<string, unknown>) => staffDetail(row));
  let row = options.initial ?? staffRequest();
  const sent: unknown[] = [];
  let reads = 0;
  const handler = (call: StubCall): Response | undefined => {
    const own = options.extra?.(call);
    if (own) return own;
    if (call.url.pathname === `/api/v1/requests/45/${options.segment}` && call.method === "POST") {
      sent.push(call.body);
      const refusal = options.answer?.(call);
      if (refusal) return refusal;
      row = options.applied(row, call.body);
      return json(200, { request: row });
    }
    if (/^\/api\/v1\/requests\/\d+$/.test(call.url.pathname) && call.method === "GET") {
      reads += 1;
      return json(200, detail(row));
    }
    // The thread the page mounts beside the Request. It is no
    // disposition suite's subject, so it answers empty for all three.
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
    sent,
    get reads() {
      return reads;
    },
  };
}

export async function subbar(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { level: 1 });
  return heading.closest("section")!;
}

/** Presses one of the sub-bar's actions and hands back the dialog it
 * opened. */
export async function openDisposition(
  user: ReturnType<typeof userEvent.setup>,
  action: string,
): Promise<HTMLElement> {
  await user.click(within(await subbar()).getByRole("button", { name: "Triage" }));
  await user.click(await screen.findByRole("menuitem", { name: action }));
  return screen.findByRole("dialog");
}
