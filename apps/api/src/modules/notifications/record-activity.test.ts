// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-002's group 2 — activity on your records (#319, M18/4) — at the
 * HTTP seam, over the real-Postgres harness, the real pg-boss queue, and
 * the deterministic fake signing provider.
 *
 * **Nothing here looks at the Notifier.** Each case performs the real
 * mutation the way a person or an integration performs it — moves a
 * status, posts a comment, uploads paper, pushes a signed Connect
 * delivery — and then asserts what a person can observe: the bell list
 * from the API, and the mail the harness's `CapturingMailer` caught. No
 * test asserts that the seam was called or how the fan-out is wired.
 *
 * Four families, and one audience rule behind all of them. **The
 * audience is the Owner and the contract team** (NOT-001): watchers are
 * the existing team roles, and there is no separate subscribe mechanism.
 * A Legal Team Member who is not on a record hears nothing about it,
 * however openly they could read it.
 *
 * Three rules every event in the group inherits, each of them pinned
 * below:
 *
 * - **No email is owed.** Group 2 is bell-on, email-opt-in, and nobody
 *   in this suite has opted in. Under the default the row records no
 *   debt and no message leaves. The other arm — somebody who opts in is
 *   mailed — is `preferences.test.ts`'s.
 * - **The actor hears nothing about their own act** — and where the act
 *   has no actor, **nobody is excluded**. A webhook is not a person, so
 *   the whole team is told, including the one who sent the envelope.
 * - **A sentence goes exactly as far as the thing it is about.** A
 *   comment carries its DD-016 tier, so a Legal Only comment never
 *   reaches a Contributor; a document event carries the file's DD-014
 *   flag, so a confidential document's events reach only the document's
 *   audience.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contractEnvelopes,
  contracts,
  desc,
  eq,
  notifications,
  users,
  type Notification,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { FAKE_SIGNATURE_HEADER, FAKE_VALID_INTEGRATION_KEY } from "../../lib/signing/fake.js";
import type { WebhookDelivery } from "../../lib/signing/provider.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who acts: they make every record here and send every
 * envelope, so they hold its `creator` team row and are on its team. */
const ACTOR = {
  email: "ambient-actor@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** The Owner of every record here — the first half of the audience. */
const OWNER = {
  email: "ambient-owner@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** Somebody put on the team by hand — the other half. */
const TEAMMATE = {
  email: "ambient-teammate@example.com",
  displayName: "Tomas Vega",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Contributor on the team: they reach the record and hear the
 * working-team tier, and no role puts them in the Legal Only room
 * (DD-016). That is what makes them the subject of the tier case. */
const CONTRIBUTOR = {
  email: "ambient-contributor@example.com",
  displayName: "Cody Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/**
 * A Legal Team Member on **no** record's team.
 *
 * CTR-021 lets them open every contract that is not confidential, so
 * they are the case that separates "who reaches this record" from "who
 * is this record about". Group 2 is the second question, and they are
 * outside it.
 */
const OUTSIDER = {
  email: "ambient-outsider@example.com",
  displayName: "Priya Outside",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A private key shaped like the one an Administrator pastes. Inert:
 * nothing in this suite parses it. */
const RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAopenlawfixturekeyneverusedanywhereexceptthissuite",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const CONNECTOR = {
  environment: "demo",
  integrationKey: FAKE_VALID_INTEGRATION_KEY,
  apiUserId: "99999999-8888-7777-6666-555555555555",
  privateKey: RSA_KEY,
  webhookSecret: "connect-hmac-fixture-secret", // NOSONAR — inert fixture
} as const;

const WEBHOOK_URL = "/api/v1/signing/docusign/webhook";

const SIGNERS = [
  { name: "Sarah Chen", email: "sarah@meridianbio.example" },
  { name: "J. Malone", email: "j.malone@orioncloud.example" },
] as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();
/** The seed statuses, by slug, with the stage behind each one. */
let statuses: { id: string; slug: string; stage: string }[] = [];
let ndaType = "";

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};
const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

interface BellItem {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  userIds.set(ADMIN.email, admin!.id);
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  for (const fixture of [ACTOR, OWNER, TEAMMATE, CONTRIBUTOR, OUTSIDER] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({ role: fixture === CONTRIBUTOR ? "contributor" : "legal_team_member" })
      .where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }

  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(ADMIN),
  });
  expect(options.statusCode, options.body).toBe(200);
  const data = options.json() as {
    contractTypes: { id: string; slug: string }[];
    contractStatuses: { id: string; slug: string; stage: string }[];
  };
  ndaType = data.contractTypes.find((row) => row.slug === "nda")!.id;
  statuses = data.contractStatuses;

  // The signing connector, so the envelope arm has a provider to reach
  // and a Connect secret to verify deliveries against.
  const connector = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/signing-connectors/docusign",
    cookies: as(ADMIN),
    payload: CONNECTOR,
  });
  expect(connector.statusCode, connector.body).toBe(200);
});

afterAll(async () => {
  await harness.stop();
});

/** The seed status at one stage, by slug. */
function statusBySlug(slug: string): { id: string; stage: string } {
  const row = statuses.find((entry) => entry.slug === slug);
  expect(row, `the ${slug} seed status`).toBeDefined();
  return row!;
}

/** Puts somebody on a contract's team, which is what makes the record
 * about them (NOT-001). */
async function addToTeam(number: number, userId: string, role = "member"): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/team`,
    cookies: as(ACTOR),
    payload: { userId, role },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/**
 * A record the acting Member made, owned by {@link OWNER} and with
 * {@link TEAMMATE} on its team.
 *
 * That is the shape every case here needs: three people the record is
 * about — the creator, the Owner, and one team row — and one Member
 * ({@link OUTSIDER}) who reaches it and is not on it.
 */
async function newRecord(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(ACTOR),
    payload: { title, contractTypeId: ndaType },
  });
  expect(res.statusCode, res.body).toBe(201);
  const contract = res.json().contract as ContractRow;
  // Straight in the column, and deliberately not over the PATCH:
  // handing a record to an Owner is NOT-002's group 1 (#318), so doing
  // it over HTTP would put a `contract.owner_assigned` row — which owes
  // an immediate email — on every bell this suite then reads. The
  // subject here is what the record's people hear **afterwards**.
  await harness.db
    .update(contracts)
    .set({ managerId: idOf(OWNER) })
    .where(eq(contracts.id, contract.id));
  await addToTeam(contract.number, idOf(TEAMMATE));
  return contract;
}

/** Moves a record to the seed status with this slug, as a person does. */
async function moveTo(
  number: number,
  slug: string,
  fixture: { email: string } = ACTOR,
): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${String(number)}`,
    cookies: as(fixture),
    payload: { statusId: statusBySlug(slug).id },
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function bell(fixture: { email: string }): Promise<BellItem[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/notifications",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { notifications: BellItem[] }).notifications;
}

/** The items on one person's bell about one record, oldest first — the
 * order the events happened in. */
async function bellFor(fixture: { email: string }, contract: ContractRow): Promise<BellItem[]> {
  const items = (await bell(fixture)).filter((row) => row.entityId === contract.id);
  return items.reverse();
}

/** The slugs on one person's bell about one record. */
const eventsFor = async (fixture: { email: string }, contract: ContractRow): Promise<string[]> =>
  (await bellFor(fixture, contract)).map((row) => row.eventType);

/**
 * Every notification row one person holds, newest first.
 *
 * The one thing this suite reads outside the HTTP seam, and only where
 * the seam cannot answer the question. **"Nothing was written" and "a
 * row was written and the wall omitted it" are the same empty bell**
 * (M10's silent omission), so every case that claims an event told
 * nobody has to be able to tell them apart — otherwise a fan-out that
 * ignored the audience rule would pass the very test written to catch
 * it. The same read answers "was email owed", which is a fact about the
 * row that no endpoint exposes and the whole point of `email_owed`
 * (NOT-001's M18/1 addendum). Every positive claim is made against the
 * bell endpoint and the captured mail.
 */
const rowsFor = (fixture: { email: string }): Promise<Notification[]> =>
  harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));

/** The rows one person holds about one record. */
const recordRowsFor = async (
  fixture: { email: string },
  contract: ContractRow,
): Promise<Notification[]> =>
  (await rowsFor(fixture)).filter((row) => row.entityId === contract.id);

/**
 * The whole of group 2's email promise, asserted in both directions.
 *
 * No row owes an email and no message about this record has reached this
 * person. The row half is the load-bearing one: an owed-and-unsent row
 * would look exactly like a never-owed one from the mailer's side until
 * the round that re-asks ran.
 *
 * What holds it is the group's **default** (NOT-002: bell on, email
 * opt-in), not the absence of machinery — nobody in this suite has
 * opened the preferences pane. `preferences.test.ts` asserts the other
 * arm: somebody who opts in is mailed.
 */
async function owesNoEmail(fixture: { email: string }, contract: ContractRow): Promise<void> {
  const rows = await recordRowsFor(fixture, contract);
  expect(rows.length, `${fixture.email} holds rows about ${contract.title}`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.emailOwed, `${row.eventType} owes email`).toBe(false);
    expect(row.emailedAt).toBeNull();
  }
  expect(
    harness.mailer.messagesTo(fixture.email).filter((m) => m.text.includes(contract.title)),
  ).toEqual([]);
}

describe("a record moving (CTR-001, NOT-002 group 2)", () => {
  it("leaves the Owner and the team a bell item, and owes no email", async () => {
    const contract = await newRecord("Ambient · moved along");
    await moveTo(contract.number, "internal_review");

    for (const person of [OWNER, TEAMMATE] as const) {
      const items = await bellFor(person, contract);
      const moved = items.filter((row) => row.eventType === "contract.status_changed");
      expect(moved, `${person.email}: ${JSON.stringify(items)}`).toHaveLength(1);
      expect(moved[0]!.readAt).toBeNull();
      expect(moved[0]!.payload.contractNumber).toBe(contract.number);
      expect(moved[0]!.payload.contractTitle).toBe(contract.title);
      expect(moved[0]!.payload.actorName).toBe(ACTOR.displayName);
      // The move is snapshotted, so the item says what was true when it
      // fired even after the record has moved on again.
      expect(moved[0]!.payload.toStage).toBe(statusBySlug("internal_review").stage);
      await owesNoEmail(person, contract);
    }
  });

  it("tells the person who moved it nothing", async () => {
    const contract = await newRecord("Ambient · moved by me");
    const before = (await recordRowsFor(ACTOR, contract)).length;
    await moveTo(contract.number, "internal_review");

    expect(await recordRowsFor(ACTOR, contract)).toHaveLength(before);
  });

  it("tells a Member who is not on the record nothing", async () => {
    // CTR-021 lets them open it; NOT-001 says the record is not about
    // them. Reach and audience are two questions, and this is the one
    // group 2 asks.
    const contract = await newRecord("Ambient · not your record");
    await moveTo(contract.number, "internal_review");

    expect(await bellFor(OUTSIDER, contract)).toEqual([]);
    expect(await recordRowsFor(OUTSIDER, contract)).toEqual([]);
  });

  it("says nothing about an edit that is not a move", async () => {
    // A retitle is on the record's own feed. A bell item per field would
    // be the ambient noise the group's defaults exist to avoid.
    const contract = await newRecord("Ambient · renamed");
    const before = (await recordRowsFor(OWNER, contract)).length;
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(contract.number)}`,
      cookies: as(ACTOR),
      payload: { title: "Ambient · renamed twice", description: "A note." },
    });
    expect(res.statusCode, res.body).toBe(200);

    expect(await recordRowsFor(OWNER, contract)).toHaveLength(before);
  });
});

/** Posts a comment on a record, as the chat panel's composer does. */
function postComment(
  contract: ContractRow,
  body: {
    body: string;
    visibility: "legal_only" | "working_team" | "full_thread";
    mentions?: string[];
  },
  fixture: { email: string } = ACTOR,
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(fixture),
    payload: { entityType: "contract", entityId: contract.id, ...body },
  });
}

/** Posts a comment, requiring success, and answers its id. */
async function comment(
  contract: ContractRow,
  body: Parameters<typeof postComment>[1],
  fixture: { email: string } = ACTOR,
): Promise<string> {
  const res = await postComment(contract, body, fixture);
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { comment: { id: string } }).comment.id;
}

describe("a comment on a record (DD-016, NOT-002 group 2)", () => {
  it("leaves the Owner and the team a bell item, and owes no email", async () => {
    const contract = await newRecord("Ambient · somebody said something");
    const commentId = await comment(contract, {
      body: "Clause 7 needs another look.",
      visibility: "working_team",
    });

    for (const person of [OWNER, TEAMMATE] as const) {
      const items = await bellFor(person, contract);
      const said = items.filter((row) => row.eventType === "comment.posted");
      expect(said, `${person.email}: ${JSON.stringify(items)}`).toHaveLength(1);
      expect(said[0]!.payload.commentId).toBe(commentId);
      expect(said[0]!.payload.contractTitle).toBe(contract.title);
      expect(said[0]!.payload.actorName).toBe(ACTOR.displayName);
      // The words are never in the payload: the thread is where the tier
      // is enforced and where a redact can still reach the text
      // (CMT-006).
      expect(JSON.stringify(said[0]!.payload)).not.toContain("Clause 7");
      await owesNoEmail(person, contract);
    }
    expect(await recordRowsFor(ACTOR, contract)).toEqual([]);
  });

  it("a Legal Only comment produces no bell item for a Contributor", async () => {
    // The Contributor is on the record's team, so the record is about
    // them and they hear the working-team tier. No role puts them in the
    // Legal Only room (DD-016), and a sentence about a comment may go
    // exactly as far as the comment does.
    const contract = await newRecord("Ambient · behind the tier");
    await addToTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const before = (await recordRowsFor(CONTRIBUTOR, contract)).length;

    await comment(contract, {
      body: "Privileged: our position on clause 9.",
      visibility: "legal_only",
    });
    expect(await bellFor(CONTRIBUTOR, contract)).toEqual([]);
    expect(await recordRowsFor(CONTRIBUTOR, contract)).toHaveLength(before);

    // It is the tier that excluded them and not the record: the Legal
    // Team Members on the same record did hear it, and the same words at
    // the tier the Contributor is in the room for reach them too.
    expect(await eventsFor(OWNER, contract)).toContain("comment.posted");
    await comment(contract, { body: "For the working team.", visibility: "working_team" });
    expect(await eventsFor(CONTRIBUTOR, contract)).toEqual(["comment.posted"]);
  });

  it("tells somebody the comment named once, not twice", async () => {
    // A mention is done *to* you, so it interrupts (NOT-002's M18/1
    // addendum) — and one comment is one piece of news. The person named
    // gets the louder item and not the ambient one beside it.
    const contract = await newRecord("Ambient · named in the thread");
    await comment(contract, {
      body: "@Tomas can you look at the indemnity?",
      visibility: "working_team",
      mentions: [idOf(TEAMMATE)],
    });

    expect(await eventsFor(TEAMMATE, contract)).toEqual(["comment.mentioned"]);
    // Everybody else on the record still hears the comment itself.
    expect(await eventsFor(OWNER, contract)).toEqual(["comment.posted"]);
  });
});

const BOUNDARY = "openlaw-ambient-boundary-4471";

/** One upload, as `multipart/form-data`. The route reads `kind` before
 * the file, so the order the parts are written in matters. */
function uploadBody(filename: string, content: Buffer) {
  return {
    payload: Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\ncontent-disposition: form-data; name="kind"\r\n\r\n`),
      Buffer.from("draft_ours"),
      Buffer.from(`\r\n--${BOUNDARY}\r\n`),
      Buffer.from(
        `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
          "content-type: application/pdf\r\n\r\n",
      ),
      content,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Uploads a file to a record, answering the document it made. */
async function upload(contract: ContractRow, filename: string): Promise<{ id: string }> {
  const body = uploadBody(filename, Buffer.from(`%PDF-1.7 ${filename}`, "utf8"));
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(contract.number)}/documents`,
    cookies: as(ACTOR),
    headers: body.headers,
    payload: body.payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { document: { id: string } }).document;
}

/** Appends the next round to a chain. */
async function appendVersion(documentId: string, filename: string): Promise<void> {
  const body = uploadBody(filename, Buffer.from(`%PDF-1.7 ${filename} v2`, "utf8"));
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies: as(ACTOR),
    headers: body.headers,
    payload: body.payload,
  });
  expect(res.statusCode, res.body).toBe(201);
}

describe("paper landing on a record (DOC-001, NOT-002 group 2)", () => {
  it("leaves the Owner and the team a bell item for a new document", async () => {
    const contract = await newRecord("Ambient · the paper arrived");
    const document = await upload(contract, "agreement.pdf");

    for (const person of [OWNER, TEAMMATE] as const) {
      const added = (await bellFor(person, contract)).filter(
        (row) => row.eventType === "document.added",
      );
      expect(added, person.email).toHaveLength(1);
      expect(added[0]!.payload.documentId).toBe(document.id);
      expect(added[0]!.payload.documentTitle).toBe("agreement.pdf");
      expect(added[0]!.payload.actorName).toBe(ACTOR.displayName);
      await owesNoEmail(person, contract);
    }
    // The uploader is not told what they just uploaded.
    expect(await recordRowsFor(ACTOR, contract)).toEqual([]);
    expect(await recordRowsFor(OUTSIDER, contract)).toEqual([]);
  });

  it("leaves the Owner and the team one for a new version, and owes no email", async () => {
    const contract = await newRecord("Ambient · the redline came back");
    const document = await upload(contract, "agreement.pdf");
    await appendVersion(document.id, "agreement-v2.pdf");

    for (const person of [OWNER, TEAMMATE] as const) {
      const rounds = (await bellFor(person, contract)).filter(
        (row) => row.eventType === "document.version_added",
      );
      expect(rounds, person.email).toHaveLength(1);
      expect(rounds[0]!.payload.documentId).toBe(document.id);
      expect(rounds[0]!.payload.versionNumber).toBe(2);
      await owesNoEmail(person, contract);
    }
  });

  it("a confidential document's events reach only the document's audience", async () => {
    // The flag is set on the file, not on the record, so the contract
    // itself stays open — which is what makes this a document question
    // rather than a wall question. A round appended afterwards may go
    // exactly as far as the file does (DD-014, DOC-008): the record's
    // named people, and nobody else.
    const contract = await newRecord("Ambient · a file for the named few");
    const document = await upload(contract, "term-sheet.pdf");
    const walled = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${document.id}`,
      cookies: as(ACTOR),
      payload: { isConfidential: true },
    });
    expect(walled.statusCode, walled.body).toBe(200);

    await appendVersion(document.id, "term-sheet-v2.pdf");

    // The document's audience is the contract's named team, its Owner,
    // and Administrators — a document has no team of its own (DOC-008).
    // The Owner and the team row are inside it and hear the round.
    for (const person of [OWNER, TEAMMATE] as const) {
      expect(await eventsFor(person, contract)).toContain("document.version_added");
    }
    // And the Member who is on no team is outside it and hears nothing —
    // silently, which is the only way an omission can be made.
    expect(await bellFor(OUTSIDER, contract)).toEqual([]);
    expect(await recordRowsFor(OUTSIDER, contract)).toEqual([]);
  });
});

function provider() {
  expect(harness.signing, "the harness's fake provider").not.toBeNull();
  return harness.signing!;
}

/** Pushes one delivery at the webhook route, signed by this install's
 * own Connect secret — the way an ending reaches the record. */
function deliver(delivery: WebhookDelivery) {
  const signed = provider().signedDelivery(delivery);
  return harness.app.inject({
    method: "POST",
    url: WEBHOOK_URL,
    headers: {
      "content-type": "application/json",
      [FAKE_SIGNATURE_HEADER]: signed.headers[FAKE_SIGNATURE_HEADER]!,
    },
    payload: signed.body,
  });
}

/** A record with paper on it, at the signature stage, with a round out
 * for signature — the state every envelope case here starts from. */
async function recordOutForSignature(
  title: string,
): Promise<{ contract: ContractRow; envelopeId: string; providerEnvelopeId: string }> {
  const contract = await newRecord(title);
  await upload(contract, "agreement.pdf");
  await moveTo(contract.number, "out_for_signature");

  const state = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${String(contract.number)}/envelopes`,
    cookies: as(ACTOR),
  });
  expect(state.statusCode, state.body).toBe(200);
  const primary = (state.json() as { primaryDocument: { versions: { id: string }[] } | null })
    .primaryDocument;
  expect(primary, "the record's primary document").not.toBeNull();

  const sent = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(contract.number)}/envelopes`,
    cookies: as(ACTOR),
    payload: { documentVersionId: primary!.versions[0]!.id, signers: [...SIGNERS] },
  });
  expect(sent.statusCode, sent.body).toBe(201);
  const envelopeId = (sent.json() as { envelopes: { id: string }[] }).envelopes[0]!.id;
  const [row] = await harness.db
    .select({ providerEnvelopeId: contractEnvelopes.providerEnvelopeId })
    .from(contractEnvelopes)
    .where(eq(contractEnvelopes.id, envelopeId));
  expect(row, "the envelope row").toBeDefined();
  return { contract, envelopeId, providerEnvelopeId: row!.providerEnvelopeId };
}

/** How long the pipeline is given before the suite calls it stuck. */
const SETTLE_TIMEOUT_MS = 20_000;

async function settles(what: string, ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${what} did not settle within ${String(SETTLE_TIMEOUT_MS)}ms\n` +
      JSON.stringify(harness.jobLog, null, 2),
  );
}

describe("an envelope ending (CTR-013, NOT-002 group 2)", () => {
  it("tells the record's people, and excludes nobody — a webhook is nobody", async () => {
    const out = await recordOutForSignature("Ambient · declined at the provider");
    const declined = await deliver({
      providerEnvelopeId: out.providerEnvelopeId,
      status: "declined",
      reason: "The indemnity is unacceptable.",
    });
    expect(declined.statusCode, declined.body).toBe(204);

    // Everybody the record is about, and that includes the person who
    // sent the envelope: the provider reported the ending, so there is
    // no one person for the actor exclusion to be about.
    for (const person of [ACTOR, OWNER, TEAMMATE] as const) {
      const ended = (await bellFor(person, out.contract)).filter(
        (row) => row.eventType === "envelope.ended",
      );
      expect(ended, person.email).toHaveLength(1);
      expect(ended[0]!.payload.envelopeId).toBe(out.envelopeId);
      expect(ended[0]!.payload.status).toBe("declined");
      // Nobody is named, which is what makes the bell's own arm read it
      // as the integration speaking (CTR-013).
      expect(ended[0]!.payload.actorName).toBeNull();
      // The signer's words stay on the record's own row: the item is a
      // prompt to go and read it.
      expect(JSON.stringify(ended[0]!.payload)).not.toContain("unacceptable");
      await owesNoEmail(person, out.contract);
    }
    expect(await recordRowsFor(OUTSIDER, out.contract)).toEqual([]);
  });

  it("excludes the person who voided it, because a void is somebody's act", async () => {
    const out = await recordOutForSignature("Ambient · withdrawn by hand");
    const voided = await harness.app.inject({
      method: "POST",
      url: `/api/v1/envelopes/${out.envelopeId}/void`,
      cookies: as(ACTOR),
      payload: { reason: "Wrong counterparty on the paper." },
    });
    expect(voided.statusCode, voided.body).toBe(200);

    for (const person of [OWNER, TEAMMATE] as const) {
      const ended = (await bellFor(person, out.contract)).filter(
        (row) => row.eventType === "envelope.ended",
      );
      expect(ended, person.email).toHaveLength(1);
      expect(ended[0]!.payload.status).toBe("voided");
      // A person took this one, so the item names them.
      expect(ended[0]!.payload.actorName).toBe(ACTOR.displayName);
    }
    expect(
      (await eventsFor(ACTOR, out.contract)).filter((slug) => slug === "envelope.ended"),
    ).toEqual([]);
  });

  it("tells the whole team what the integration filed, excluding nobody", async () => {
    // The executed-copy fetch runs on the worker with no session behind
    // it (M15/5). It files a round on the chain and advances the record
    // off the signature stage, and both are the integration speaking —
    // so the sender hears them too.
    const out = await recordOutForSignature("Ambient · signed and filed");
    provider().complete(out.providerEnvelopeId);
    const signed = await deliver({
      providerEnvelopeId: out.providerEnvelopeId,
      status: "signed",
    });
    expect(signed.statusCode, signed.body).toBe(204);

    await settles("the executed copy on the sender's bell", async () =>
      (await eventsFor(ACTOR, out.contract)).includes("document.version_added"),
    );

    for (const person of [ACTOR, OWNER, TEAMMATE] as const) {
      const items = await bellFor(person, out.contract);
      const slugs = items.map((row) => row.eventType);
      expect(slugs, `${person.email}: ${JSON.stringify(items)}`).toContain("envelope.ended");
      expect(slugs, person.email).toContain("document.version_added");
      expect(slugs, person.email).toContain("contract.status_changed");

      const filed = items.find(
        (row) => row.eventType === "document.version_added" && row.payload.actorName === null,
      );
      expect(filed, `${person.email}: the integration's own round`).toBeDefined();
      expect(filed!.payload.versionNumber).toBe(2);

      const advanced = items.filter(
        (row) => row.eventType === "contract.status_changed" && row.payload.actorName === null,
      );
      expect(advanced, `${person.email}: the integration's own advance`).toHaveLength(1);
      expect(advanced[0]!.payload.fromStage).toBe("signature");
      expect(advanced[0]!.payload.toStage).toBe("active");
      await owesNoEmail(person, out.contract);
    }
    expect(await recordRowsFor(OUTSIDER, out.contract)).toEqual([]);
  });
});
