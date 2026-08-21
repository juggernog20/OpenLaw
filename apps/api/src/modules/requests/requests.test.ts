// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Submission (#378): what stands between a portal form and a `requests`
 * row, at the seam a form actually posts to.
 *
 * How a form definition is *built* — attaching a field, reordering
 * one, toggling its required flag — is the M19 suites' subject and is
 * not re-asserted here. This suite covers the two routes M20/4 adds:
 * what the API does with a submission (the type must be live, the
 * required fields must be answered, the values must belong to the
 * form, the number comes from the global sequence, the Requester is the
 * session, and the creation is narrated per DD-017), and what the
 * requester-facing form read answers with (the type, its attached
 * fields in display order with their required flags and select options,
 * and the deflection links placed on that form).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, eq, requestTypeFields, requests, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery",
} as const;

const OTHER_REQUESTER = {
  email: "dana.okafor@acme.com",
  displayName: "Dana Okafor",
  password: "correct-horse-battery",
} as const;

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

/** One row of my-requests, as the list read answers it. */
interface MyRequestRow {
  id: string;
  number: number;
  status: string;
  summary: string;
  requestType: { id: string; slug: string; displayName: string };
  createdAt: string;
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let otherCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let requesterId: string;
/** The INT-002 seeds, by slug. */
let typeIds: Map<string, string>;
/** The catalog rows this suite attaches, by display name. */
let fieldIds: Map<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [OTHER_REQUESTER, "business_user"],
    [MEMBER, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === REQUESTER) requesterId = user.id;
  }

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);
  otherCookies = await harnessSignInCookies(
    harness.app,
    OTHER_REQUESTER.email,
    OTHER_REQUESTER.password,
  );
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: adminCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  typeIds = new Map(
    (types.json().requestTypes as { slug: string; id: string }[]).map((row) => [row.slug, row.id]),
  );

  // The form "Contract review" collects: one required contract-scoped
  // field, one optional global one, and one select — enough to exercise
  // the required rule, the scope rule, and coercion in one form.
  fieldIds = new Map();
  for (const field of [
    { displayName: "Counterparty", moduleScope: "contract", fieldType: "text", required: true },
    { displayName: "Deal desk region", moduleScope: "global", fieldType: "text", required: false },
    {
      displayName: "Paper side",
      moduleScope: "contract",
      fieldType: "single_select",
      options: ["Ours", "Theirs"],
      required: false,
    },
  ] as const) {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/fields",
      cookies: adminCookies,
      payload: {
        displayName: field.displayName,
        moduleScope: field.moduleScope,
        fieldType: field.fieldType,
        fieldTag: "legal",
        ...("options" in field ? { options: field.options } : {}),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().field.id as string;
    fieldIds.set(field.displayName, id);

    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${typeIds.get("contract_review")}/fields`,
      cookies: adminCookies,
      payload: { fieldId: id, isRequired: field.required },
    });
    expect(attached.statusCode, attached.body).toBe(201);
  }
});

afterAll(async () => {
  await harness.stop();
});

/** A complete submission against "Contract review". */
function completeBody(overrides: Record<string, unknown> = {}) {
  return {
    requestTypeId: typeIds.get("contract_review"),
    summary: "MSA renewal with Orion Cloud",
    description: "They sent a redline on the liability cap. We need it back by Friday.",
    urgency: "high",
    customFields: { counterparty: "Orion Cloud" },
    ...overrides,
  };
}

async function submit(body: Record<string, unknown>, cookies = requesterCookies) {
  return await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies,
    payload: body,
  });
}

/** The row as the database holds it — what the wire answer is checked
 * against, and the only way to read columns no route answers yet. */
async function storedRequest(id: string) {
  const [row] = await harness.db.select().from(requests).where(eq(requests.id, id)).limit(1);
  return row!;
}

describe("submitting a Request", () => {
  it("creates it with a fresh R-### number, status new, and values keyed by slug", async () => {
    const res = await submit(completeBody());
    expect(res.statusCode, res.body).toBe(201);
    const answered = res.json().request;
    expect(answered.status).toBe("new");
    expect(answered.number).toBeGreaterThan(0);
    expect(answered.customFields).toEqual({ counterparty: "Orion Cloud" });

    const stored = await storedRequest(answered.id);
    expect(stored.number).toBe(answered.number);
    expect(stored.status).toBe("new");
    expect(stored.summary).toBe("MSA renewal with Orion Cloud");
    expect(stored.urgency).toBe("high");
    // Keyed by the field's slug, not its id or its display name — the
    // slug is what survives a rename, and what conversion reads.
    expect(stored.customFields).toEqual({ counterparty: "Orion Cloud" });
  });

  it("draws each number from the global sequence, in order", async () => {
    const first = await submit(completeBody({ summary: "First" }));
    const second = await submit(completeBody({ summary: "Second" }));
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().request.number).toBeGreaterThan(first.json().request.number);
  });

  it("records the Requester as the session, not as anything the body sent", async () => {
    // DD-013 as a shape: there is no requesterId to send, and a body
    // that invents one is refused outright rather than quietly ignored.
    const forged = await submit(completeBody({ requesterId: "someone-else" }));
    expect(forged.statusCode, forged.body).toBe(400);

    const res = await submit(completeBody());
    expect(res.statusCode, res.body).toBe(201);
    expect((await storedRequest(res.json().request.id)).requesterId).toBe(requesterId);
  });

  it("admits a Member+ staff session, who is a Requester here like anybody else", async () => {
    const res = await submit(completeBody(), memberCookies);
    expect(res.statusCode, res.body).toBe(201);
  });

  it("refuses a caller with no session", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/requests",
      payload: completeBody(),
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("stores an optional field left blank as no key at all", async () => {
    const res = await submit(
      completeBody({ customFields: { counterparty: "Orion Cloud", deal_desk_region: "  " } }),
    );
    expect(res.statusCode, res.body).toBe(201);
    // One shape for "nothing recorded", the contract column's rule.
    expect((await storedRequest(res.json().request.id)).customFields).toEqual({
      counterparty: "Orion Cloud",
    });
  });
});

describe("the basics every form collects", () => {
  it("requires Summary, Description, and Urgency", async () => {
    const blankSummary = await submit(completeBody({ summary: "   " }));
    expect(blankSummary.statusCode, blankSummary.body).toBe(400);
    expect(blankSummary.json().detail).toContain("Summary");

    const blankDescription = await submit(completeBody({ description: "" }));
    expect(blankDescription.statusCode, blankDescription.body).toBe(400);
    expect(blankDescription.json().detail).toContain("Description");

    const noUrgency = await submit({ ...completeBody(), urgency: undefined });
    expect(noUrgency.statusCode, noUrgency.body).toBe(400);
  });

  it("names every missing field in one refusal", async () => {
    // A person who has to fill something in needs to know which
    // something — and pressing Submit twice to learn two halves of the
    // same answer is the thing this avoids.
    const res = await submit(completeBody({ summary: "", description: "", customFields: {} }));
    expect(res.statusCode, res.body).toBe(400);
    const detail = res.json().detail as string;
    expect(detail).toContain("Summary");
    expect(detail).toContain("Description");
    expect(detail).toContain("Counterparty");
  });

  it("takes only the four severity levels for Urgency", async () => {
    for (const urgency of ["low", "medium", "high", "critical"]) {
      const res = await submit(completeBody({ urgency }));
      expect(res.statusCode, `${urgency}: ${res.body}`).toBe(201);
      expect((await storedRequest(res.json().request.id)).urgency).toBe(urgency);
    }
    for (const urgency of ["normal", "urgent", "HIGH", ""]) {
      const res = await submit(completeBody({ urgency }));
      expect(res.statusCode, `${urgency}: ${res.body}`).toBe(400);
    }
  });
});

describe("the attached fields the type collects", () => {
  it("enforces the Administrator's required flag, naming the field", async () => {
    const res = await submit(completeBody({ customFields: {} }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Counterparty");
  });

  it("accepts values for exactly the fields the type attaches", async () => {
    const res = await submit(
      completeBody({ customFields: { counterparty: "Orion Cloud", not_on_this_form: "x" } }),
    );
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("not on this request type's form");
  });

  it("checks a value against its field's type", async () => {
    const res = await submit(
      completeBody({ customFields: { counterparty: "Orion Cloud", paper_side: "Nobody's" } }),
    );
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Paper side");
  });

  it("collects an out-of-scope attached field like any other", async () => {
    // The INT-002 M19/7 addendum's reachable state: a contract-scoped
    // field stays attached across a re-point to Matter, so the form
    // draws it under a target whose scope no longer admits it. M20
    // meets that state rather than preventing it — the field renders,
    // its required flag still applies, and its value is collected.
    const typeId = typeIds.get("contract_review")!;
    const scoped = ["Counterparty", "Paper side"] as const;
    // Inside the try from the first mutation on: an assertion that
    // fails half way through the setup must still put the shared seed
    // type back, or every suite after it inherits a matter-targeting
    // "Contract review".
    try {
      // Archive the two contract-scoped fields so the strand check does
      // not see them, re-point, then restore: the sequence the addendum
      // records.
      for (const name of scoped) {
        const res = await harness.app.inject({
          method: "POST",
          url: `/api/v1/fields/${fieldIds.get(name)}/archive`,
          cookies: adminCookies,
          payload: {},
        });
        expect(res.statusCode, res.body).toBe(200);
      }
      const repointed = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/request-types/${typeId}`,
        cookies: adminCookies,
        payload: { targetModule: "matter", targetTypeId: null },
      });
      expect(repointed.statusCode, repointed.body).toBe(200);
      for (const name of scoped) {
        const res = await harness.app.inject({
          method: "POST",
          url: `/api/v1/fields/${fieldIds.get(name)}/restore`,
          cookies: adminCookies,
          payload: {},
        });
        expect(res.statusCode, res.body).toBe(200);
      }

      const stillAttached = await harness.db
        .select()
        .from(requestTypeFields)
        .where(
          and(
            eq(requestTypeFields.typeId, typeId),
            eq(requestTypeFields.fieldId, fieldIds.get("Counterparty")!),
          ),
        );
      expect(stillAttached).toHaveLength(1);

      // It is still required, and it still collects.
      const missing = await submit(completeBody({ customFields: {} }));
      expect(missing.statusCode, missing.body).toBe(400);
      expect(missing.json().detail).toContain("Counterparty");

      const res = await submit(completeBody());
      expect(res.statusCode, res.body).toBe(201);
      expect((await storedRequest(res.json().request.id)).customFields).toEqual({
        counterparty: "Orion Cloud",
      });
    } finally {
      const back = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/request-types/${typeId}`,
        cookies: adminCookies,
        payload: { targetModule: "contract", targetTypeId: null },
      });
      expect(back.statusCode, back.body).toBe(200);
    }
  });
});

describe("an archived request type", () => {
  it("takes no submission, even from a form opened before the archive", async () => {
    const typeId = typeIds.get("legal_question")!;
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${typeId}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    try {
      const res = await submit(completeBody({ requestTypeId: typeId, customFields: {} }));
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().detail).toContain("not taking submissions");
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${typeId}/restore`,
        cookies: adminCookies,
        payload: {},
      });
      expect(restored.statusCode, restored.body).toBe(200);
    }
  });

  it("is absent from the form read too", async () => {
    const typeId = typeIds.get("legal_question")!;
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${typeId}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    try {
      const res = await harness.app.inject({
        method: "GET",
        url: "/api/v1/portal/request-types/legal_question",
        cookies: requesterCookies,
      });
      expect(res.statusCode, res.body).toBe(404);
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${typeId}/restore`,
        cookies: adminCookies,
        payload: {},
      });
      expect(restored.statusCode, restored.body).toBe(200);
    }
  });

  it("refuses a request type id that names nothing", async () => {
    const res = await submit(
      completeBody({ requestTypeId: "01a01b9d-0000-0000-0000-000000000000" }),
    );
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("the activity a submission writes", () => {
  it("narrates the creation against the Request (DD-017)", async () => {
    const res = await submit(completeBody({ summary: "Narrated ask" }));
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().request;

    const rows = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "request"), eq(activityLog.entityId, created.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("request.created");
    expect(rows[0]!.actorId).toBe(requesterId);
    // No free text at all — not the summary, not the values. The log
    // is append-only, so a requester's own words could never leave it
    // again; R-42 is the Request's name and the number never changes.
    expect(rows[0]!.payload).toEqual({
      number: created.number,
      requestType: "Contract review",
      urgency: "high",
      customFields: ["counterparty"],
    });
  });

  it("writes nothing when the submission is refused", async () => {
    const before = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityType, "request"));
    const res = await submit(completeBody({ summary: "" }));
    expect(res.statusCode, res.body).toBe(400);
    const after = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityType, "request"));
    expect(after).toHaveLength(before.length);
  });
});

describe("the form definition a requester reads", () => {
  it("answers the type, its attached fields in display order, and its own links", async () => {
    const link = await harness.app.inject({
      method: "POST",
      url: "/api/v1/intake-links",
      cookies: adminCookies,
      payload: {
        label: "When does a contract need legal review?",
        url: "https://wiki.acme.com/review",
        requestTypeId: typeIds.get("contract_review"),
      },
    });
    expect(link.statusCode, link.body).toBe(201);

    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/request-types/contract_review",
      cookies: requesterCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const form = res.json();
    expect(form.requestType.displayName).toBe("Contract review");
    expect(form.fields.map((field: { displayName: string }) => field.displayName)).toEqual([
      "Counterparty",
      "Deal desk region",
      "Paper side",
    ]);
    expect(form.fields[0].isRequired).toBe(true);
    expect(form.fields[1].isRequired).toBe(false);
    // A select is not a control without its options.
    expect(form.fields[2].options).toEqual(["Ours", "Theirs"]);
    expect(form.intakeLinks.map((row: { label: string }) => row.label)).toEqual([
      "When does a contract need legal review?",
    ]);
  });

  it("leaves the home panel's links to the home", async () => {
    const link = await harness.app.inject({
      method: "POST",
      url: "/api/v1/intake-links",
      cookies: adminCookies,
      payload: { label: "Procurement policy", url: "https://wiki.acme.com/procurement" },
    });
    expect(link.statusCode, link.body).toBe(201);

    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/request-types/nda_request",
      cookies: requesterCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().intakeLinks).toEqual([]);
  });

  it("admits a Member+ staff session and refuses a caller with no session", async () => {
    const staff = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/request-types/contract_review",
      cookies: memberCookies,
    });
    expect(staff.statusCode, staff.body).toBe(200);

    const anonymous = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/request-types/contract_review",
    });
    expect(anonymous.statusCode, anonymous.body).toBe(401);
  });
});

describe("one requester's Requests", () => {
  it("are their own — two requesters' submissions never share a row", async () => {
    const mine = await submit(completeBody({ summary: "Mine" }));
    const theirs = await submit(completeBody({ summary: "Theirs" }), otherCookies);
    expect(mine.statusCode, mine.body).toBe(201);
    expect(theirs.statusCode, theirs.body).toBe(201);
    expect((await storedRequest(mine.json().request.id)).requesterId).toBe(requesterId);
    expect((await storedRequest(theirs.json().request.id)).requesterId).not.toBe(requesterId);
  });
});

/**
 * My-requests and the request detail (#379): the two reads a Requester
 * makes of their own asks. What they answer is settled by DD-013 — the
 * session and nobody else — so most of what is asserted here is what is
 * *absent*.
 */
describe("my-requests", () => {
  /** The caller's list, as the portal home reads it. */
  async function myRequests(cookies = requesterCookies) {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/requests",
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().requests as MyRequestRow[];
  }

  it("answers the row the list draws: number, summary, type, status, and age", async () => {
    const created = await submit(completeBody({ summary: "Row shape" }));
    expect(created.statusCode, created.body).toBe(201);
    const { number } = created.json().request;

    const row = (await myRequests()).find((candidate) => candidate.number === number);
    expect(row).toBeDefined();
    expect(row!.summary).toBe("Row shape");
    expect(row!.status).toBe("new");
    expect(row!.requestType.displayName).toBe("Contract review");
    expect(row!.requestType.slug).toBe("contract_review");
    // The age is the reader's to compute; the row carries the stamp.
    expect(Date.parse(row!.createdAt)).not.toBeNaN();
  });

  it("answers newest first", async () => {
    const first = await submit(completeBody({ summary: "Older" }));
    const second = await submit(completeBody({ summary: "Newer" }));
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);

    const numbers = (await myRequests()).map((row) => row.number);
    expect(numbers.indexOf(second.json().request.number)).toBeLessThan(
      numbers.indexOf(first.json().request.number),
    );
  });

  it("never carries another requester's Request", async () => {
    const theirs = await submit(completeBody({ summary: "Not yours" }), otherCookies);
    expect(theirs.statusCode, theirs.body).toBe(201);
    const theirNumber = theirs.json().request.number;

    expect((await myRequests()).map((row) => row.number)).not.toContain(theirNumber);
    // And the other way round, so the rule is the scoping and not an
    // accident of who submitted more.
    expect((await myRequests(otherCookies)).map((row) => row.number)).toContain(theirNumber);
  });

  it("applies the same rule to Member+ staff, who see only what they submitted", async () => {
    const staff = await submit(completeBody({ summary: "A lawyer's own ask" }), memberCookies);
    const requester = await submit(completeBody({ summary: "Not the lawyer's" }));
    expect(staff.statusCode, staff.body).toBe(201);
    expect(requester.statusCode, requester.body).toBe(201);

    const numbers = (await myRequests(memberCookies)).map((row) => row.number);
    expect(numbers).toContain(staff.json().request.number);
    // A Legal Team Member is a Requester on this surface and nothing
    // more: the staff view of every Request is M21's, at its own
    // address.
    expect(numbers).not.toContain(requester.json().request.number);
  });

  it("refuses a caller with no session", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/portal/requests" });
    expect(res.statusCode, res.body).toBe(401);
  });
});

describe("the request detail", () => {
  async function readDetail(number: number, cookies = requesterCookies) {
    return await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${number}`,
      cookies,
    });
  }

  it("answers the envelope and the values with the fields that name them", async () => {
    const created = await submit(
      completeBody({
        summary: "Detail shape",
        customFields: { counterparty: "Orion Cloud", paper_side: "Theirs" },
      }),
    );
    expect(created.statusCode, created.body).toBe(201);

    const res = await readDetail(created.json().request.number);
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json();
    expect(detail.request.number).toBe(created.json().request.number);
    expect(detail.request.status).toBe("new");
    expect(detail.request.urgency).toBe("high");
    expect(detail.request.summary).toBe("Detail shape");
    expect(detail.request.description).toContain("liability cap");
    expect(detail.request.requestType.displayName).toBe("Contract review");
    expect(detail.request.declinedReason).toBeNull();
    expect(detail.request.customFields).toEqual({
      counterparty: "Orion Cloud",
      paper_side: "Theirs",
    });
    // The labels come from the same attached-fields read the form drew
    // its boxes from, so a value is named exactly as the box was.
    expect(detail.fields.map((field: { displayName: string }) => field.displayName)).toEqual([
      "Counterparty",
      "Deal desk region",
      "Paper side",
    ]);
  });

  it("refuses another requester's Request the way it refuses one that does not exist", async () => {
    const theirs = await submit(completeBody({ summary: "Not yours" }), otherCookies);
    expect(theirs.statusCode, theirs.body).toBe(201);

    const trespass = await readDetail(theirs.json().request.number);
    // 404 rather than 403: a refusal that told the two apart would
    // confirm the row is there (DD-013).
    expect(trespass.statusCode, trespass.body).toBe(404);

    const nobodys = await readDetail(9_999_999);
    expect(nobodys.statusCode, nobodys.body).toBe(404);
    expect(trespass.json().detail).toBe(nobodys.json().detail);
  });

  it("keeps answering a converted Request, and keeps it on the list", async () => {
    // Conversion is M21's to write; what M20 owes is that it takes
    // nothing away (INT-001, DD-018). Status is set directly here
    // because no route writes it yet.
    const created = await submit(completeBody({ summary: "Became a contract" }));
    expect(created.statusCode, created.body).toBe(201);
    const { id, number } = created.json().request;
    await harness.db.update(requests).set({ status: "converted" }).where(eq(requests.id, id));

    const res = await readDetail(number);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.status).toBe("converted");

    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/requests",
      cookies: requesterCookies,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json().requests as MyRequestRow[]).map((row) => row.number)).toContain(number);
  });

  it("carries the decline reason on a declined Request (INT-006)", async () => {
    const created = await submit(completeBody({ summary: "Turned down" }));
    expect(created.statusCode, created.body).toBe(201);
    const { id, number } = created.json().request;
    await harness.db
      .update(requests)
      .set({ status: "declined", declinedReason: "Procurement owns vendor paper under $10k." })
      .where(eq(requests.id, id));

    const res = await readDetail(number);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.status).toBe("declined");
    expect(res.json().request.declinedReason).toBe("Procurement owns vendor paper under $10k.");
  });

  it("refuses a caller with no session", async () => {
    const created = await submit(completeBody({ summary: "Needs a session" }));
    expect(created.statusCode, created.body).toBe(201);
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${created.json().request.number}`,
    });
    expect(res.statusCode, res.body).toBe(401);
  });
});

describe("the two field types that name a row", () => {
  // The portal's pickers offer a requester no people and no entities,
  // so any id in a `user` or `entity` field arrived against the API —
  // and the seam holds it to the contract record's rule: the id must
  // name a live row, or the value is one nothing could ever render.
  let userSlug: string;
  let entitySlug: string;
  let liveEntityId: string;

  beforeAll(async () => {
    for (const field of [
      { displayName: "Requesting manager", fieldType: "user" },
      { displayName: "Contracting entity", fieldType: "entity" },
    ] as const) {
      const created = await harness.app.inject({
        method: "POST",
        url: "/api/v1/fields",
        cookies: adminCookies,
        payload: {
          displayName: field.displayName,
          moduleScope: "global",
          fieldType: field.fieldType,
          fieldTag: "legal",
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      if (field.fieldType === "user") userSlug = created.json().field.slug;
      else entitySlug = created.json().field.slug;

      const attached = await harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${typeIds.get("nda_request")}/fields`,
        cookies: adminCookies,
        payload: { fieldId: created.json().field.id, isRequired: false },
      });
      expect(attached.statusCode, attached.body).toBe(201);
    }

    liveEntityId = await createEntity("Orion Cloud Holdings LLC");
  });

  async function createEntity(legalName: string): Promise<string> {
    const types = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities/types",
      cookies: adminCookies,
    });
    expect(types.statusCode, types.body).toBe(200);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entities",
      cookies: adminCookies,
      payload: { legalName, entityTypeId: types.json().entityTypes[0].id },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().entity.id;
  }

  /** A complete submission against "NDA request", which is where the
   * two reference fields are attached. */
  function ndaBody(customFields: Record<string, unknown>) {
    return {
      requestTypeId: typeIds.get("nda_request"),
      summary: "Mutual NDA with Orion Cloud",
      description: "For the pilot kicking off next month.",
      urgency: "medium",
      customFields,
    };
  }

  it("refuses a user id that names nobody, naming the field", async () => {
    const res = await submit(ndaBody({ [userSlug]: "00000000-0000-0000-0000-000000000000" }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Requesting manager");
    expect(res.json().detail).toContain("live person");
  });

  it("refuses an entity id that names nothing", async () => {
    const res = await submit(ndaBody({ [entitySlug]: "00000000-0000-0000-0000-000000000000" }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Contracting entity");
    expect(res.json().detail).toContain("live entity");
  });

  it("refuses an archived entity — nothing new points at what has left", async () => {
    const archivedId = await createEntity("Wound Down GmbH");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${archivedId}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await submit(ndaBody({ [entitySlug]: archivedId }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("live entity");
  });

  it("accepts live references and stores them keyed by slug", async () => {
    const res = await submit(ndaBody({ [userSlug]: requesterId, [entitySlug]: liveEntityId }));
    expect(res.statusCode, res.body).toBe(201);
    expect((await storedRequest(res.json().request.id)).customFields).toEqual({
      [userSlug]: requesterId,
      [entitySlug]: liveEntityId,
    });
  });

  it("resolves both into a name on the detail, so the row is never a bare id", async () => {
    const created = await submit(ndaBody({ [userSlug]: requesterId, [entitySlug]: liveEntityId }));
    expect(created.statusCode, created.body).toBe(201);

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${created.json().request.number}`,
      cookies: requesterCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().customFieldRefs.users).toEqual([
      { id: requesterId, displayName: REQUESTER.displayName },
    ]);
    expect(res.json().customFieldRefs.entities).toEqual([
      { id: liveEntityId, legalName: "Orion Cloud Holdings LLC" },
    ]);
  });
});
