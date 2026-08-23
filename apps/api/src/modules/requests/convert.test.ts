// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Convert (#420): the disposition the Inbox exists to reach, asserted
 * at the HTTP seam the dialog presses.
 *
 * The subject is what a conversion *carries* and what it *refuses to
 * carry*. The target is confirmed from the request type and never
 * chosen (DD-018); an archived target type reads as no type; a
 * matter-targeting or no-target Request re-targets to a contract. The
 * title, the priority, and every collected value with a field to land
 * in arrive on the record; a collected value with no field to land in
 * does not, and stays readable on the Request. The record is born
 * ordinary, both records narrate, and the requester hears "in progress"
 * in the one vocabulary.
 *
 * The scaffold itself — the row lock, the `new` guard, the refusal the
 * loser is answered — is `decline.test.ts`'s subject. What this suite
 * asks of it is the one thing Convert made it say: that the loser's
 * refusal names the record the winner made.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractStatuses,
  contractTeam,
  contractTypes,
  eq,
  requestTypes,
  users,
} from "@openlaw/db";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import {
  dispositionScaffold,
  settles,
  REQUESTER,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN as ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let otherMemberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let requesterId: string;
let memberId: string;

/** The seeded request types, by slug. */
let requestTypeIds: Map<string, string>;
/** The seeded contract types, by slug. */
let contractTypeIds: Map<string, string>;
/** The catalog fields this suite uses, by display name. */
let fieldSlugs: Map<string, string>;

/** A request type whose bound contract type has since been archived. */
let retiredTargetTypeId: string;
/** A request type that targets the Matter module — Re-target's subject. */
let matterTargetTypeId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  cast = await dispositionScaffold(harness);
  ({
    adminCookies,
    memberCookies,
    otherMemberCookies,
    contributorCookies,
    requesterCookies,
    requesterId,
    memberId,
  } = cast);

  requestTypeIds = new Map(
    (
      await harness.db.select({ id: requestTypes.id, slug: requestTypes.slug }).from(requestTypes)
    ).map((row) => [row.slug, row.id] as const),
  );
  contractTypeIds = new Map(
    (
      await harness.db
        .select({ id: contractTypes.id, slug: contractTypes.slug })
        .from(contractTypes)
    ).map((row) => [row.slug, row.id] as const),
  );

  // Four catalog fields, each with one job in this suite.
  //
  // "Counterparty" is on the NDA request form *and* on both contract
  // types, so it is the value that carries. "Deal desk region" is on
  // the request form and on no contract type, so it is the value with
  // nowhere to land (the INT-002 M19/7 addendum). "Governing law" is
  // hard-required on the MSA contract type and on no request form, so
  // it is the gap the dialog has to prompt for (CTR-016/MTR-014).
  // "Requesting manager" is a carried reference whose archived row
  // conversion refuses until the caller supplies a live override.
  fieldSlugs = new Map();
  for (const field of [
    {
      displayName: "Counterparty",
      fieldType: "text",
      onRequestForm: true,
      onNda: true,
      onMsa: true,
      required: false,
    },
    {
      displayName: "Deal desk region",
      fieldType: "text",
      onRequestForm: true,
      onNda: false,
      onMsa: false,
      required: false,
    },
    {
      displayName: "Governing law",
      fieldType: "text",
      onRequestForm: false,
      onNda: false,
      onMsa: true,
      required: true,
    },
    {
      displayName: "Requesting manager",
      fieldType: "user",
      onRequestForm: true,
      onNda: true,
      onMsa: false,
      required: false,
    },
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
    const fieldId = created.json().field.id as string;
    fieldSlugs.set(field.displayName, created.json().field.slug as string);

    // The registry rides in the tuple rather than being inferred from the
    // id: a second request type in this loop would otherwise be attached
    // through `contract-types` and answered 404 by the wrong registry.
    for (const [attach, registry, typeId, isRequired] of [
      [field.onRequestForm, "request-types", requestTypeIds.get("nda_request")!, false],
      [field.onNda, "contract-types", contractTypeIds.get("nda")!, false],
      [field.onMsa, "contract-types", contractTypeIds.get("msa")!, field.required],
    ] as const) {
      if (!attach) continue;
      const attached = await harness.app.inject({
        method: "POST",
        url: `/api/v1/${registry}/${typeId}/fields`,
        cookies: adminCookies,
        payload: { fieldId, isRequired },
      });
      expect(attached.statusCode, attached.body).toBe(201);
    }
  }

  // A request type whose bound contract type is retired afterwards. Its
  // own contract type, so archiving it disturbs no other test.
  const retiredType = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: adminCookies,
    payload: { displayName: "Retired paper" },
  });
  expect(retiredType.statusCode, retiredType.body).toBe(201);
  retiredTargetTypeId = await makeRequestType("Retired routing", {
    targetModule: "contract",
    targetTypeId: retiredType.json().contractType.id as string,
  });
  await harness.db
    .update(contractTypes)
    .set({ archivedAt: new Date() })
    .where(eq(contractTypes.id, retiredType.json().contractType.id as string));

  // A Matter-targeting Request can still convert into a Contract —
  // DD-018 rule 5's lossless Re-target, symmetric since M22.
  matterTargetTypeId = await makeRequestType("Advice request", { targetModule: "matter" });
});

afterAll(async () => {
  await harness.stop();
});

/** Creates one request type and points it at a target. */
async function makeRequestType(
  displayName: string,
  target: { targetModule: "matter" | "contract"; targetTypeId?: string },
): Promise<string> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().requestType.id as string;
  const pointed = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/request-types/${id}`,
    cookies: adminCookies,
    payload: { targetModule: target.targetModule, targetTypeId: target.targetTypeId ?? null },
  });
  expect(pointed.statusCode, pointed.body).toBe(200);
  return id;
}

/** Submits one Request as the Business User, and answers the row. */
async function submit(
  summary: string,
  options: { typeId?: string; customFields?: Record<string, unknown>; urgency?: string } = {},
): Promise<{ id: string; number: number }> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId: options.typeId ?? requestTypeIds.get("nda_request"),
      summary,
      description: "For the pilot kicking off next month.",
      urgency: options.urgency ?? "high",
      ...(options.customFields ? { customFields: options.customFields } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}

/** Presses Convert on one Request. */
function convert(number: number, body: Record<string, unknown>, cookies = memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/convert`,
    cookies,
    payload: body,
  });
}

/** Reads the staff-visible Request state after a conversion attempt. */
function readRequest(number: number) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/requests/${number}`,
    cookies: memberCookies,
  });
}

/** The stored Request, for the facts the wire does not state. */
const stored = (id: string) => cast.stored(id);

/** The stored contract a conversion made, by its C-### number. */
async function contractNumbered(number: number) {
  const [row] = await harness.db
    .select()
    .from(contracts)
    .where(eq(contracts.number, number))
    .limit(1);
  return row!;
}

/** Every entry on one record, oldest first. This suite reads a
 * contract's as well as a Request's, so the entity type leads. */
const entriesOn = (entityType: "request" | "contract", entityId: string) =>
  cast.entriesOn(entityId, entityType);

const bellRowsOn = (userId: string, requestId: string) => cast.bellRowsOn(userId, requestId);

/** How many contracts exist right now — the all-or-nothing check. */
async function contractCount(): Promise<number> {
  return (await harness.db.select({ id: contracts.id }).from(contracts)).length;
}

/** The messages one person has been sent about one Request — the
 * scaffold's read, bound once the cast is installed. */
const mailAbout = (email: string, number: number) => cast.mailAbout(email, number);

describe("who may convert (INT-006, DD-013)", () => {
  it("answers an Administrator and a Legal Team Member", async () => {
    for (const cookies of [adminCookies, memberCookies]) {
      const request = await submit("Whoever triages may convert");
      const res = await convert(request.number, { title: "Northwind NDA" }, cookies);
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it("refuses a Contributor and a Business User with 403", async () => {
    const request = await submit("Not theirs to convert");
    for (const cookies of [contributorCookies, requesterCookies]) {
      const res = await convert(request.number, { title: "Northwind NDA" }, cookies);
      expect(res.statusCode, res.body).toBe(403);
    }
    expect((await stored(request.id)).status).toBe("new");
  });

  it("refuses a caller with no session", async () => {
    const request = await submit("Needs a session");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/convert`,
      payload: { title: "Northwind NDA" },
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("answers 404 for a reference nobody has", async () => {
    const res = await convert(9_999_999, { title: "Nothing to convert" });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the target is confirmed, never classified (DD-018, INT-002)", () => {
  it("converts a contract-targeting type onto the type it names, with no type in the body", async () => {
    const request = await submit("The routing was bound at configuration");
    const res = await convert(request.number, { title: "Northwind mutual NDA" });
    expect(res.statusCode, res.body).toBe(200);

    const number = res.json().request.convertedContract.number as number;
    expect((await contractNumbered(number)).contractTypeId).toBe(contractTypeIds.get("nda"));
  });

  it("accepts a body that repeats the bound type — echoing is agreeing", async () => {
    const request = await submit("Confirmed out loud");
    const res = await convert(request.number, {
      title: "Northwind mutual NDA",
      contractTypeId: contractTypeIds.get("nda"),
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("refuses an empty contractTypeId as a malformed body, not as a contradicted target", async () => {
    // A blank choice is no choice. The schema requires one character, so
    // the caller is told their body is wrong rather than accused of
    // naming a different type from the bound one — a refusal that would
    // have named an act they did not perform.
    const request = await submit("The box was left empty");
    const before = await contractCount();
    const res = await convert(request.number, { title: "Nothing picked", contractTypeId: "" });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).not.toContain("Triage confirms the routing");
    expect((await stored(request.id)).status).toBe("new");
    expect(await contractCount()).toBe(before);
  });

  it("refuses a body that names a different type from the one bound", async () => {
    // The act DD-018 takes away from triage: the Administrator decided
    // "NDA request" makes NDAs, and a triager does not re-decide it.
    const request = await submit("Classification is not triage's");
    const before = await contractCount();
    const res = await convert(request.number, {
      title: "Actually an MSA",
      contractTypeId: contractTypeIds.get("msa"),
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await stored(request.id)).status).toBe("new");
    expect(await contractCount()).toBe(before);
  });

  it("asks a module-only target for the type the form deferred", async () => {
    // "Contract review" promises a contract without pre-deciding which
    // kind (the INT-002 M19/4 addendum). That one choice is the
    // triager's, and it is the only one they get.
    const request = await submit("Which kind is still open", {
      typeId: requestTypeIds.get("contract_review"),
    });
    const before = await contractCount();
    const without = await convert(request.number, { title: "Orion redline" });
    expect(without.statusCode, without.body).toBe(400);
    expect((await stored(request.id)).status).toBe("new");
    // The refusal writes nothing. Without this the second press below
    // would supply a contract for a test that never checked the first
    // press had not already made one.
    expect(await contractCount()).toBe(before);

    const withType = await convert(request.number, {
      title: "Orion redline",
      contractTypeId: contractTypeIds.get("msa"),
      customFields: { [fieldSlugs.get("Governing law")!]: "England and Wales" },
    });
    expect(withType.statusCode, withType.body).toBe(200);
    const number = withType.json().request.convertedContract.number as number;
    expect((await contractNumbered(number)).contractTypeId).toBe(contractTypeIds.get("msa"));
  });

  it("reads an archived target type as no type, on the read and at the write", async () => {
    // INT-002's addendum: conversion never writes a type the taxonomy
    // has retired. The staff read says the same thing, so the dialog
    // asks for a live type rather than pre-selecting a dead one.
    const request = await submit("The bound type has been retired", {
      typeId: retiredTargetTypeId,
    });
    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: memberCookies,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().request.requestType.targetModule).toBe("contract");
    expect(detail.json().request.requestType.targetTypeId).toBeNull();
    expect(detail.json().request.requestType.targetTypeName).toBeNull();

    const before = await contractCount();
    const without = await convert(request.number, { title: "Still needs a live type" });
    expect(without.statusCode, without.body).toBe(400);
    expect(await contractCount()).toBe(before);

    const withLive = await convert(request.number, {
      title: "On a live type",
      contractTypeId: contractTypeIds.get("nda"),
    });
    expect(withLive.statusCode, withLive.body).toBe(200);
  });

  it("re-targets a matter-targeting Request into a contract (DD-018 rule 5)", async () => {
    const request = await submit("This is really paper", { typeId: matterTargetTypeId });
    const res = await convert(request.number, {
      title: "Turned out to be an NDA",
      contractTypeId: contractTypeIds.get("nda"),
    });
    expect(res.statusCode, res.body).toBe(200);
    // Lossless: the Request survives as the requester's portal shell.
    const row = await stored(request.id);
    expect(row.status).toBe("converted");
    expect(row.convertedMatterId).toBeNull();
  });

  it("re-targets a no-target Request into a contract", async () => {
    const request = await submit("A question that turned into paper", {
      typeId: requestTypeIds.get("legal_question"),
    });
    const res = await convert(request.number, {
      title: "Not a question after all",
      contractTypeId: contractTypeIds.get("nda"),
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe("what the record is born with (INT-002, MTR-012, CTR-016)", () => {
  it("carries the title, the priority, and every value with a field to land in", async () => {
    const request = await submit("Northwind pilot NDA", {
      urgency: "critical",
      customFields: {
        [fieldSlugs.get("Counterparty")!]: "Northwind Labs",
        [fieldSlugs.get("Deal desk region")!]: "EMEA",
      },
    });
    const res = await convert(request.number, { title: "Northwind Labs — mutual NDA" });
    expect(res.statusCode, res.body).toBe(200);

    const number = res.json().request.convertedContract.number as number;
    const contract = await contractNumbered(number);
    expect(contract.title).toBe("Northwind Labs — mutual NDA");
    // MTR-012's 1:1 map. Urgency is what the requester claimed; priority
    // is what legal now holds, and they start equal.
    expect(contract.priority).toBe("critical");
    // Never requester-set, and never assessed at birth.
    expect(contract.risk).toBeNull();
    expect(contract.customFields[fieldSlugs.get("Counterparty")!]).toBe("Northwind Labs");
  });

  it("seeds the title from the summary when the dialog sends the summary back", async () => {
    const request = await submit("Northwind Labs mutual NDA");
    const res = await convert(request.number, { title: "Northwind Labs mutual NDA" });
    expect(res.statusCode, res.body).toBe(200);
    const number = res.json().request.convertedContract.number as number;
    expect((await contractNumbered(number)).title).toBe("Northwind Labs mutual NDA");
  });

  it("refuses a title of spaces by name, and writes nothing", async () => {
    const request = await submit("A title nobody wrote");
    const before = await contractCount();
    const res = await convert(request.number, { title: "   " });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Name the contract");
    expect((await stored(request.id)).status).toBe("new");
    expect(await contractCount()).toBe(before);
  });

  it("is born ordinary — C-###, the draft seed, no Owner, no team, not confidential", async () => {
    const request = await submit("An ordinary birth");
    const res = await convert(request.number, { title: "Ordinary NDA" });
    expect(res.statusCode, res.body).toBe(200);

    const number = res.json().request.convertedContract.number as number;
    const contract = await contractNumbered(number);
    // The CTR-003 sequence gives the number; conversion invents none.
    expect(Number.isInteger(contract.number)).toBe(true);
    expect(contract.number).toBeGreaterThan(0);
    // The M16 successor rule's sibling: nothing is inherited.
    expect(contract.managerId).toBeNull();
    expect(contract.isConfidential).toBe(false);
    expect(contract.entityId).toBeNull();
    expect(contract.parentId).toBeNull();

    const [status] = await harness.db
      .select({ slug: contractStatuses.slug })
      .from(contractStatuses)
      .where(eq(contractStatuses.id, contract.statusId))
      .limit(1);
    expect(status!.slug).toBe("draft");

    // The CTR-004 creator row and nothing else: the triager's
    // provenance, not a working group somebody chose.
    const team = await harness.db
      .select({ userId: contractTeam.userId, role: contractTeam.role })
      .from(contractTeam)
      .where(eq(contractTeam.contractId, contract.id));
    expect(team).toEqual([{ userId: memberId, role: "creator" }]);
  });

  it("refuses an empty hard-required field by name, and writes nothing", async () => {
    // CTR-016/MTR-014's rule, met at conversion: the MSA type requires
    // a governing law and no request form collects one, so the dialog
    // has to prompt for it before anybody can press.
    const request = await submit("A gap the form never collected", {
      typeId: requestTypeIds.get("contract_review"),
    });
    const before = await contractCount();
    const res = await convert(request.number, {
      title: "Orion MSA renewal",
      contractTypeId: contractTypeIds.get("msa"),
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Governing law");
    // All-or-nothing: no contract, no status move, no back-link.
    expect(await contractCount()).toBe(before);
    const row = await stored(request.id);
    expect(row.status).toBe("new");
    expect(row.convertedContractId).toBeNull();
    expect(await entriesOn("request", request.id)).toHaveLength(1);
  });

  it("lands the gap the triager filled in the dialog", async () => {
    const request = await submit("The gap, answered at conversion", {
      typeId: requestTypeIds.get("contract_review"),
      customFields: {},
    });
    const res = await convert(request.number, {
      title: "Orion MSA renewal",
      contractTypeId: contractTypeIds.get("msa"),
      customFields: { [fieldSlugs.get("Governing law")!]: "England and Wales" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const number = res.json().request.convertedContract.number as number;
    expect((await contractNumbered(number)).customFields).toMatchObject({
      [fieldSlugs.get("Governing law")!]: "England and Wales",
    });
  });

  it("refuses an archived carry by name, then converts with the live override", async () => {
    const manager = fieldSlugs.get("Requesting manager")!;
    const request = await submit("A manager who left before triage", {
      customFields: { [manager]: requesterId },
    });
    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, requesterId));

    try {
      const before = await contractCount();
      const refused = await convert(request.number, { title: "Northwind NDA" });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().detail).toContain("Requesting manager: pick a live person.");
      expect(await contractCount()).toBe(before);
      const unchanged = await readRequest(request.number);
      expect(unchanged.statusCode, unchanged.body).toBe(200);
      expect(unchanged.json().request).toMatchObject({
        status: "new",
        convertedContract: null,
      });

      const repaired = await convert(request.number, {
        title: "Northwind NDA",
        customFields: { [manager]: memberId },
      });
      expect(repaired.statusCode, repaired.body).toBe(200);
      const contract = await contractNumbered(
        repaired.json().request.convertedContract.number as number,
      );
      expect(contract.customFields[manager]).toBe(memberId);
    } finally {
      await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, requesterId));
    }
  });

  it("refuses an unknown key rather than dropping it", async () => {
    const request = await submit("A body nobody designed");
    const res = await convert(request.number, {
      title: "Northwind NDA",
      reason: "Wrong disposition's field.",
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await stored(request.id)).status).toBe("new");
  });
});

describe("a value with nowhere to land (the INT-002 M19/7 addendum)", () => {
  it("does not carry, is not deleted, and stays readable on the Request", async () => {
    const request = await submit("One value carries, one does not", {
      customFields: {
        [fieldSlugs.get("Counterparty")!]: "Northwind Labs",
        [fieldSlugs.get("Deal desk region")!]: "EMEA",
      },
    });
    const res = await convert(request.number, { title: "Northwind Labs NDA" });
    expect(res.statusCode, res.body).toBe(200);

    const number = res.json().request.convertedContract.number as number;
    const contract = await contractNumbered(number);
    // The NDA contract type attaches Counterparty and not Deal desk
    // region, so one lands and the other has no field to land in.
    expect(contract.customFields[fieldSlugs.get("Counterparty")!]).toBe("Northwind Labs");
    expect(contract.customFields[fieldSlugs.get("Deal desk region")!]).toBeUndefined();

    // Copied, never moved: the Request keeps its custom fields whole.
    const row = await stored(request.id);
    expect(row.customFields).toEqual({
      [fieldSlugs.get("Counterparty")!]: "Northwind Labs",
      [fieldSlugs.get("Deal desk region")!]: "EMEA",
    });
    // And the staff detail still draws it, labelled by the form that
    // collected it.
    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: memberCookies,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().request.customFields[fieldSlugs.get("Deal desk region")!]).toBe("EMEA");
  });
});

describe("what a conversion narrates (DD-017, INT-007)", () => {
  it("writes request.converted on the ask, naming the record it became", async () => {
    const request = await submit("Narrate on the ask");
    const res = await convert(request.number, { title: "Narrated NDA" });
    expect(res.statusCode, res.body).toBe(200);
    const number = res.json().request.convertedContract.number as number;

    const entries = await entriesOn("request", request.id);
    expect(entries.map((row) => row.action)).toEqual(["request.created", "request.converted"]);
    const converted = entries[1]!;
    // INT-007: who dispositioned is audit data, and it is the actor.
    expect(converted.actorId).toBe(memberId);
    // Two permanent references and no free text: the log is append-only.
    expect(converted.payload).toEqual({ number: request.number, contractNumber: number });
  });

  it("writes contract.created_from_request on the record, beside its ordinary birth", async () => {
    const request = await submit("Narrate on the record");
    const res = await convert(request.number, { title: "Narrated NDA two" });
    expect(res.statusCode, res.body).toBe(200);
    const contract = await contractNumbered(res.json().request.convertedContract.number as number);

    const entries = await entriesOn("contract", contract.id);
    // The birth is ordinary and is narrated as such; where it came from
    // is a second sentence about the same birth.
    expect(entries.map((row) => row.action)).toEqual([
      "contract.created",
      "contract.created_from_request",
    ]);
    expect(entries[1]!.actorId).toBe(memberId);
    expect(entries[1]!.payload).toEqual({
      number: contract.number,
      title: contract.title,
      requestNumber: request.number,
    });
  });
});

describe("what a conversion tells the requester (INT-003, NOT-002 group 5)", () => {
  it("moves the Request out of the queue and links the row to the record", async () => {
    const request = await submit("Leaves the undecided queue");
    const res = await convert(request.number, { title: "Queue-leaving NDA" });
    expect(res.statusCode, res.body).toBe(200);
    const number = res.json().request.convertedContract.number as number;

    const queue = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests",
      cookies: memberCookies,
    });
    expect(
      (queue.json().requests as { number: number }[]).some((row) => row.number === request.number),
    ).toBe(false);

    const triaged = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests?includeTriaged=true",
      cookies: memberCookies,
    });
    const row = (
      triaged.json().requests as {
        number: number;
        status: string;
        convertedContract: { number: number } | null;
      }[]
    ).find((candidate) => candidate.number === request.number);
    expect(row?.status).toBe("converted");
    expect(row?.convertedContract).toEqual({ number });
  });

  it("reads converted on the requester's own window", async () => {
    const request = await submit("The portal reads the conversion");
    expect((await convert(request.number, { title: "Portal-read NDA" })).statusCode).toBe(200);

    const mine = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: requesterCookies,
    });
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json().request.status).toBe("converted");
    expect(mine.json().request.declinedReason).toBeNull();
  });

  it("raises the status change, and never a decline", async () => {
    const request = await submit("One piece of news");
    expect((await convert(request.number, { title: "News NDA" })).statusCode).toBe(200);

    const rows = await bellRowsOn(requesterId, request.id);
    expect(rows.map((row) => row.eventType).sort()).toEqual([
      "request.created",
      "request.status_changed",
    ]);
    expect(rows.find((row) => row.eventType === "request.status_changed")!.payload).toMatchObject({
      from: "new",
      to: "converted",
    });
  });

  it("mails it in the requester's own words, not the enum's", async () => {
    const request = await submit("The conversion reaches the inbox");
    expect((await convert(request.number, { title: "Mailed NDA" })).statusCode).toBe(200);

    await settles(`the conversion email about R-${request.number}`, () =>
      mailAbout(REQUESTER.email, request.number).some((m) =>
        m.subject.includes("Your request is in progress"),
      ),
    );
    const messages = mailAbout(REQUESTER.email, request.number).filter((m) =>
      m.subject.includes("Your request is in progress"),
    );
    expect(messages).toHaveLength(1);
    // The INT-003 M21/6 vocabulary: the mail and the portal say one word
    // for one status, and "converted" is not that word.
    expect(messages[0]!.text).toContain("is now in progress");
    expect(messages[0]!.subject).not.toContain("converted");
  });

  it("tells the triager nothing about their own act", async () => {
    const request = await submit("The converter hears nothing");
    expect((await convert(request.number, { title: "Silent NDA" })).statusCode).toBe(200);
    const rows = await bellRowsOn(memberId, request.id);
    expect(rows.map((row) => row.eventType).filter((type) => type !== "request.submitted")).toEqual(
      [],
    );
  });
});

describe("the disposition scaffold, from Convert (INT-007)", () => {
  it("refuses a second conversion with the recorded outcome and the record it became", async () => {
    // The one thing Convert asked the scaffold to say: "somebody
    // converted this" without the C-### is news the loser cannot act on.
    const request = await submit("Converted once, asked twice");
    const first = await convert(request.number, { title: "The one record" });
    expect(first.statusCode, first.body).toBe(200);
    const number = first.json().request.convertedContract.number as number;

    const before = await contractCount();
    const again = await convert(request.number, { title: "A second record" }, otherMemberCookies);
    expect(again.statusCode, again.body).toBe(409);
    const problem = again.json();
    expect(problem.type).toBe(REQUEST_DISPOSITIONED_PROBLEM_TYPE);
    expect(problem.outcome).toBe("converted");
    expect(problem.convertedContract).toEqual({ number });
    // One Request never becomes two records.
    expect(await contractCount()).toBe(before);
  });

  it("names no record on an outcome that made none", async () => {
    const request = await submit("Declined, then converted at");
    expect(
      (
        await harness.app.inject({
          method: "POST",
          url: `/api/v1/requests/${request.number}/decline`,
          cookies: memberCookies,
          payload: { reason: "Ask Procurement." },
        })
      ).statusCode,
    ).toBe(200);

    const res = await convert(request.number, { title: "Too late" });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().outcome).toBe("declined");
    expect(res.json().convertedContract).toBeNull();
  });

  it("lets exactly one of two racing triagers convert", async () => {
    // The row lock, from Convert's side: both calls are in flight before
    // either commits, so a scaffold that read the status without
    // `FOR UPDATE` would answer 200 twice — and one ask would become two
    // contracts, which is the thing INT-007 exists to prevent.
    const request = await submit("Two triagers, one record");
    const before = await contractCount();
    const [first, second] = await Promise.all([
      convert(request.number, { title: "Nadia's record" }, memberCookies),
      convert(request.number, { title: "Priya's record" }, otherMemberCookies),
    ]);
    const codes = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(codes, `${first.body} / ${second.body}`).toEqual([200, 409]);
    expect(await contractCount()).toBe(before + 1);
    expect(
      (await entriesOn("request", request.id)).filter((row) => row.action === "request.converted"),
    ).toHaveLength(1);
  });
});
