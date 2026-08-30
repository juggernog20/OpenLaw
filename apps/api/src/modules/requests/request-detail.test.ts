// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The staff request detail (#414): the read the Inbox row opens, at the
 * seam the screen calls.
 *
 * What a Request *is* — how it is submitted, what a form collects, what
 * the seam refuses — is `requests.test.ts`'s subject, and the queue's
 * scope and order are `inbox.test.ts`'s. This suite covers what the
 * detail alone answers: who may open it (Member+, INT-006), what the
 * envelope says, how the collected values are labelled and resolved
 * (the M20/10 rules, staff side), what the trail to a converted record
 * does under DD-014, and that the paper downloads through this mount
 * with the portal download's own answer.
 *
 * Statuses are written straight against the table where the ask is
 * about one no route writes yet — disposition is #418's and #419's — so
 * the suite can pin "every status opens" before the routes that reach
 * those statuses exist.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractTeam,
  contractTypes,
  eq,
  requests,
  requestTypes,
  users,
  type RequestStatus,
} from "@openlaw/db";
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

const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let requesterId: string;
/** The INT-002 seeds, by slug. */
let typeIds: Map<string, string>;
/** The catalog fields this suite attaches, by display name. */
let fieldIds: Map<string, string>;
/** Their slugs, which is how a value is keyed on the row (INT-002). */
let fieldSlugs: Map<string, string>;

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
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === REQUESTER) requesterId = user.id;
  }

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await harnessSignInCookies(
    harness.app,
    CONTRIBUTOR.email,
    CONTRIBUTOR.password,
  );
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);

  const types = await harness.db
    .select({ id: requestTypes.id, slug: requestTypes.slug })
    .from(requestTypes);
  typeIds = new Map(types.map((row) => [row.slug, row.id]));

  // "NDA request" collects four fields: a plain one, one that names a
  // person, one that names an Entity, and one that will be detached
  // again — enough to exercise labelling, both resolutions, and the
  // rule that a detached field's value is not drawn.
  fieldIds = new Map();
  fieldSlugs = new Map();
  for (const field of [
    { displayName: "Counterparty", fieldType: "text" },
    { displayName: "Requesting manager", fieldType: "user" },
    { displayName: "Contracting entity", fieldType: "entity" },
    { displayName: "Deal desk region", fieldType: "text" },
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
    fieldIds.set(field.displayName, created.json().field.id as string);
    fieldSlugs.set(field.displayName, created.json().field.slug as string);

    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${typeIds.get("nda_request")}/fields`,
      cookies: adminCookies,
      payload: { fieldId: created.json().field.id, isRequired: false },
    });
    expect(attached.statusCode, attached.body).toBe(201);
  }
});

afterAll(async () => {
  await harness.stop();
});

/** The slug a value is stored under, for a field this suite attached. */
function slug(displayName: string): string {
  return fieldSlugs.get(displayName)!;
}

/** Submits one Request as the Business User, and answers the row. */
async function submit(body: Record<string, unknown> = {}): Promise<{ id: string; number: number }> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId: typeIds.get("nda_request"),
      summary: "Mutual NDA with Orion Cloud",
      description: "For the pilot kicking off next month.",
      urgency: "high",
      ...body,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}

/** One Request as one caller reads it through the staff mount. */
function readDetail(number: number, cookies = memberCookies) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/requests/${number}`,
    cookies,
  });
}

const BOUNDARY = "openlaw-test-boundary-4174746368";

/** One `multipart/form-data` body carrying a single file part. */
function filePart(filename: string, content: Buffer) {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
      "content-type: application/pdf\r\n\r\n",
  );
  return {
    payload: Buffer.concat([head, content, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Puts one file on a Request as its Requester, and answers its id. */
async function attach(number: number, filename: string, content: Buffer): Promise<string> {
  const { payload, headers } = filePart(filename, content);
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/attachments`,
    cookies: requesterCookies,
    payload,
    headers,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().attachment.id as string;
}

/** One Entity, so an `entity` value has a row to name. */
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
  return created.json().entity.id as string;
}

describe("who may open a Request (INT-006, DD-013)", () => {
  it("answers an Administrator and a Legal Team Member", async () => {
    const { number } = await submit({ summary: "Open to triage" });
    for (const cookies of [adminCookies, memberCookies]) {
      const res = await readDetail(number, cookies);
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it("refuses a Contributor and a Business User with 403", async () => {
    // The Business User here is the Requester themselves: their window
    // is the portal mount, and this address is not theirs to read.
    const { number } = await submit({ summary: "Not theirs to triage" });
    for (const cookies of [contributorCookies, requesterCookies]) {
      const res = await readDetail(number, cookies);
      expect(res.statusCode, res.body).toBe(403);
    }
  });

  it("refuses a caller with no session", async () => {
    const { number } = await submit({ summary: "Needs a session" });
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${number}`,
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("answers 404 for a reference nobody has", async () => {
    const res = await readDetail(9_999_999);
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the envelope (INT-006)", () => {
  it("answers the reference, the ask, the requester, and the front door", async () => {
    const { number } = await submit({
      summary: "Mutual NDA with Orion Cloud",
      description: "For the pilot kicking off next month.",
      urgency: "critical",
    });

    const res = await readDetail(number);
    expect(res.statusCode, res.body).toBe(200);
    const { request } = res.json();
    expect(request.number).toBe(number);
    expect(request.status).toBe("new");
    expect(request.summary).toBe("Mutual NDA with Orion Cloud");
    expect(request.description).toContain("pilot");
    expect(request.urgency).toBe("critical");
    expect(request.declinedReason).toBeNull();
    expect(typeof request.createdAt).toBe("string");
    // The thread is keyed by the Request's own id (CMT-010), so the
    // envelope carries it.
    expect(request.id).toBeTruthy();
    // Who asked, with the address a triager answers out of band on.
    expect(request.requester).toMatchObject({
      id: requesterId,
      displayName: REQUESTER.displayName,
      email: REQUESTER.email,
    });
    // The front door, and the routing the Administrator bound to it —
    // triage confirms the target, never classifies (DD-018).
    expect(request.requestType).toMatchObject({
      displayName: "NDA request",
      targetModule: "contract",
      targetTypeName: "NDA",
    });
  });

  it("reads a module-only target as the module alone, and no target as none", async () => {
    const moduleOnly = await submit({
      requestTypeId: typeIds.get("contract_review"),
      summary: "Redline review",
    });
    const noTarget = await submit({
      requestTypeId: typeIds.get("legal_question"),
      summary: "Quick question",
    });

    expect((await readDetail(moduleOnly.number)).json().request.requestType).toMatchObject({
      displayName: "Contract review",
      targetModule: "contract",
      targetTypeName: null,
    });
    expect((await readDetail(noTarget.number)).json().request.requestType).toMatchObject({
      displayName: "Legal question",
      targetModule: null,
      targetTypeName: null,
    });
  });

  it("opens a Request whatever its status, and carries a decline's reason", async () => {
    for (const status of ["new", "converted", "resolved", "declined"] as RequestStatus[]) {
      const { id, number } = await submit({ summary: `Already ${status}` });
      await harness.db
        .update(requests)
        .set({
          status,
          declinedReason:
            status === "declined" ? "Procurement owns vendor paper under $10k." : null,
        })
        .where(eq(requests.id, id));

      const res = await readDetail(number);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().request.status).toBe(status);
      // INT-006: "no" always arrives with a why, and the detail is
      // where the triager who declined it reads it back.
      expect(res.json().request.declinedReason).toBe(
        status === "declined" ? "Procurement owns vendor paper under $10k." : null,
      );
    }
  });

  it("answers 404 for an archived Request", async () => {
    const { id, number } = await submit({ summary: "Archived away" });
    await harness.db.update(requests).set({ archivedAt: new Date() }).where(eq(requests.id, id));

    const res = await readDetail(number);
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the values, labelled through the type's live fields (INT-002)", () => {
  it("names each value with the field that collected it, in the form's order", async () => {
    const { number } = await submit({
      summary: "Labelled values",
      customFields: { [slug("Counterparty")]: "Orion Cloud Ltd" },
    });

    const res = await readDetail(number);
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json();
    expect(detail.request.customFields).toEqual({ [slug("Counterparty")]: "Orion Cloud Ltd" });
    // The labels come from the same attached-fields read the form drew
    // its boxes from, so a value is named exactly as the box was.
    expect(detail.fields.map((field: { displayName: string }) => field.displayName)).toEqual([
      "Counterparty",
      "Requesting manager",
      "Contracting entity",
      "Deal desk region",
    ]);
  });

  it("stops naming a value whose field the Administrator has detached", async () => {
    const { number } = await submit({
      summary: "Detached since",
      customFields: {
        [slug("Counterparty")]: "Orion Cloud Ltd",
        [slug("Deal desk region")]: "EMEA",
      },
    });

    const detached = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/request-types/${typeIds.get("nda_request")}/fields/${fieldIds.get("Deal desk region")}`,
      cookies: adminCookies,
    });
    expect(detached.statusCode, detached.body).toBe(204);

    try {
      const detail = (await readDetail(number)).json();
      // The value stays on the row — nothing deletes what somebody
      // submitted — and the label that would name it is gone, so the
      // screen has nothing to draw it with.
      expect(detail.request.customFields[slug("Deal desk region")]).toBe("EMEA");
      expect(
        detail.fields.map((field: { displayName: string }) => field.displayName),
      ).not.toContain("Deal desk region");
    } finally {
      const reattached = await harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${typeIds.get("nda_request")}/fields`,
        cookies: adminCookies,
        payload: { fieldId: fieldIds.get("Deal desk region"), isRequired: false },
      });
      expect(reattached.statusCode, reattached.body).toBe(201);
    }
  });

  it("stops naming a value whose field the Administrator has archived", async () => {
    const { number } = await submit({
      summary: "Archived field",
      customFields: { [slug("Deal desk region")]: "APAC" },
    });

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/fields/${fieldIds.get("Deal desk region")}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);

    try {
      const detail = (await readDetail(number)).json();
      expect(detail.request.customFields[slug("Deal desk region")]).toBe("APAC");
      expect(
        detail.fields.map((field: { displayName: string }) => field.displayName),
      ).not.toContain("Deal desk region");
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/fields/${fieldIds.get("Deal desk region")}/restore`,
        cookies: adminCookies,
        payload: {},
      });
      expect(restored.statusCode, restored.body).toBe(200);
    }
  });

  it("resolves a person and an Entity into names", async () => {
    const entityId = await createEntity("Orion Cloud Holdings LLC");
    const { number } = await submit({
      summary: "Named rows",
      customFields: {
        [slug("Requesting manager")]: requesterId,
        [slug("Contracting entity")]: entityId,
      },
    });

    const detail = (await readDetail(number)).json();
    expect(detail.customFieldRefs.users).toEqual([
      { id: requesterId, displayName: REQUESTER.displayName, archived: false },
    ]);
    expect(detail.customFieldRefs.entities).toEqual([
      {
        restricted: false,
        id: entityId,
        legalName: "Orion Cloud Holdings LLC",
        archived: false,
      },
    ]);
  });

  it("goes on naming a person and an Entity that have since been archived", async () => {
    const entityId = await createEntity("Wound Down GmbH");
    const { number } = await submit({
      summary: "Named rows that have left",
      customFields: {
        [slug("Requesting manager")]: requesterId,
        [slug("Contracting entity")]: entityId,
      },
    });

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entityId}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    // The person, archived straight against the table: the write path
    // refuses a new value pointed at somebody who has left, and this
    // asks what the *read* does about one recorded before they did.
    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, requesterId));

    try {
      const detail = (await readDetail(number)).json();
      // A Request that already names somebody who has left must go on
      // naming them, exactly as a contract does, and the third state is
      // stated on each resolved row rather than inferred by the client.
      expect(detail.customFieldRefs.users).toEqual([
        { id: requesterId, displayName: REQUESTER.displayName, archived: true },
      ]);
      expect(detail.customFieldRefs.entities).toEqual([
        { restricted: false, id: entityId, legalName: "Wound Down GmbH", archived: true },
      ]);
    } finally {
      await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, requesterId));
    }
  });

  it("leaves an id that resolves to nothing as the id (the INT-001 M20/10 rule)", async () => {
    const stranded = "01a01b9d-0000-7000-8000-00000000dead";
    const { id, number } = await submit({ summary: "A stranded reference" });
    // Written straight against the table: the submission route refuses
    // an id that names nobody, so the only way into this state is a row
    // whose target was hard-deleted afterwards.
    await harness.db
      .update(requests)
      .set({ customFields: { [slug("Requesting manager")]: stranded } })
      .where(eq(requests.id, id));

    const detail = (await readDetail(number)).json();
    // The Request does hold a value, so it is answered — resolved to
    // nothing, which is what leaves the screen with the raw id to draw.
    expect(detail.request.customFields[slug("Requesting manager")]).toBe(stranded);
    expect(detail.customFieldRefs.users).toEqual([]);
  });
});

describe("the trail from ask to work (DD-014, CTR-018)", () => {
  async function createContract(title: string, isConfidential: boolean) {
    const [type] = await harness.db.select().from(contractTypes).limit(1);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: adminCookies,
      payload: { title, contractTypeId: type!.id, isConfidential },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().contract as { id: string; number: number };
  }

  /** Conversion is #420's to write; what this asks is what the read
   * does with the link once it is there. */
  async function convert(requestId: string, contractId: string) {
    await harness.db
      .update(requests)
      .set({ status: "converted", convertedContractId: contractId })
      .where(eq(requests.id, requestId));
  }

  it("carries no link on a Request nothing has been made of", async () => {
    const { number } = await submit({ summary: "Still an ask" });
    expect((await readDetail(number)).json().request.convertedContract).toBeNull();
  });

  it("names the record a conversion made", async () => {
    const contract = await createContract("Northwind Labs NDA", false);
    const { id, number } = await submit({ summary: "Became a contract" });
    await convert(id, contract.id);

    expect((await readDetail(number)).json().request.convertedContract).toEqual({
      number: contract.number,
    });
  });

  it("withholds the link from a viewer who cannot reach the record, and still opens", async () => {
    // Confidential and created by the Administrator, so the Legal Team
    // Member is neither its Owner nor on its team (DD-014).
    const contract = await createContract("Project Cormorant", true);
    const { id, number } = await submit({ summary: "Something quiet" });
    await convert(id, contract.id);

    const withheld = await readDetail(number, memberCookies);
    expect(withheld.statusCode, withheld.body).toBe(200);
    expect(withheld.json().request).toMatchObject({
      summary: "Something quiet",
      status: "converted",
      // The withholding is the server's decision, and the Request
      // survives it — it is still triage's business.
      convertedContract: null,
    });

    const reached = await readDetail(number, adminCookies);
    expect(reached.json().request.convertedContract).toEqual({ number: contract.number });
  });

  it("names the record for a Member+ put on an otherwise confidential one", async () => {
    const contract = await createContract("Project Kestrel", true);
    const [member] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, MEMBER.email));
    await harness.db
      .insert(contractTeam)
      .values({ contractId: contract.id, userId: member!.id, role: "member" });
    const { id, number } = await submit({ summary: "Something quiet, shared" });
    await convert(id, contract.id);

    expect((await readDetail(number)).json().request.convertedContract).toEqual({
      number: contract.number,
    });
  });

  it("draws no link once the record is archived, and still opens", async () => {
    const contract = await createContract("Northwind Labs NDA, retired", false);
    const { id, number } = await submit({ summary: "NDA that ran its course" });
    await convert(id, contract.id);
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, contract.id));

    const res = await readDetail(number);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.convertedContract).toBeNull();
  });
});

describe("the paper, listed and downloaded through the staff mount", () => {
  it("lists every attachment, oldest first, and none when there are none", async () => {
    const bare = await submit({ summary: "No paper" });
    expect((await readDetail(bare.number)).json().attachments).toEqual([]);

    const { number } = await submit({ summary: "Two files" });
    await attach(number, "orion-msa-redline-v3.pdf", Buffer.from("the redline"));
    await attach(number, "orion-pricing-schedule.pdf", Buffer.from("the pricing"));

    const attachments = (await readDetail(number)).json().attachments as { filename: string }[];
    expect(attachments.map((row) => row.filename)).toEqual([
      "orion-msa-redline-v3.pdf",
      "orion-pricing-schedule.pdf",
    ]);
  });

  it("streams the bytes back under the portal download's own answer", async () => {
    const { number } = await submit({ summary: "Downloadable" });
    const attachmentId = await attach(
      number,
      "orion-msa-redline-v3.pdf",
      Buffer.from("the redline"),
    );

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${number}/attachments/${attachmentId}`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toBe("the redline");
    // Never a type a client declared, on either mount (DOC-004).
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain("orion-msa-redline-v3.pdf");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");

    // The portal mount answers the same bytes the same way, so the
    // Requester's own window keeps working beside the staff one.
    const portal = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${number}/attachments/${attachmentId}`,
      cookies: requesterCookies,
    });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(portal.body).toBe(res.body);
    expect(portal.headers["content-type"]).toBe(res.headers["content-type"]);
    expect(portal.headers["content-disposition"]).toBe(res.headers["content-disposition"]);
  });

  it("answers 404 for an attachment id belonging to another Request", async () => {
    const mine = await submit({ summary: "Mine" });
    const theirs = await submit({ summary: "Theirs" });
    const attachmentId = await attach(theirs.number, "elsewhere.pdf", Buffer.from("elsewhere"));

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${mine.number}/attachments/${attachmentId}`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("answers 404 for an attachment id nobody has", async () => {
    const { number } = await submit({ summary: "No such file" });
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${number}/attachments/01a01b9d-0000-7000-8000-00000000dead`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("refuses a Contributor and a Business User with 403", async () => {
    const { number } = await submit({ summary: "Not theirs to download" });
    const attachmentId = await attach(number, "orion.pdf", Buffer.from("the redline"));

    for (const cookies of [contributorCookies, requesterCookies]) {
      const res = await harness.app.inject({
        method: "GET",
        url: `/api/v1/requests/${number}/attachments/${attachmentId}`,
        cookies,
      });
      expect(res.statusCode, res.body).toBe(403);
    }
  });
});

describe("the thread, at every tier (DD-016, CMT-010)", () => {
  /** The screen reads the thread through the comments mount, keyed by
   * the Request id the envelope carries. This asserts the pair the
   * screen actually sends, so the detail and the thread cannot drift
   * apart about what identifies a Request. */
  it("answers a Member+ every tier on the Request the detail names", async () => {
    const { number } = await submit({ summary: "A conversation" });
    const requestId = (await readDetail(number)).json().request.id as string;

    for (const [cookies, visibility] of [
      [memberCookies, "legal_only"],
      [requesterCookies, "full_thread"],
    ] as const) {
      const posted = await harness.app.inject({
        method: "POST",
        url: "/api/v1/comments",
        cookies,
        payload: {
          entityType: "request",
          entityId: requestId,
          body: `at ${visibility}`,
          visibility,
        },
      });
      expect(posted.statusCode, posted.body).toBe(201);
    }

    const thread = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=request&entityId=${requestId}`,
      cookies: memberCookies,
    });
    expect(thread.statusCode, thread.body).toBe(200);
    expect(
      (thread.json().comments as { visibility: string }[]).map((row) => row.visibility),
    ).toEqual(["legal_only", "full_thread"]);

    // INT-007: replying never parks a Request — the clarifying
    // back-and-forth is the point, and the status is untouched by it.
    expect((await readDetail(number)).json().request.status).toBe("new");
  });
});
