// SPDX-License-Identifier: AGPL-3.0-only

/** M22/8: the matter arm of Request conversion, exercised at the HTTP seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  contracts,
  contractTypes,
  eq,
  matters,
  matterStatuses,
  matterTeam,
  matterTypes,
  requestTypes,
  users,
} from "@openlaw/db";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import {
  dispositionScaffold,
  REQUESTER,
  settles,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN as ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let otherMemberCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let requesterId: string;
let memberId: string;

let ordinaryMatterTypeId: string;
let requiredMatterTypeId: string;
let boundRequestTypeId: string;
let moduleOnlyRequestTypeId: string;
let retiredRequestTypeId: string;
let noTargetRequestTypeId: string;
let contractTargetRequestTypeId: string;
let carrySlug: string;
let staysSlug: string;
let requiredSlug: string;
let ownerSlug: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cast = await dispositionScaffold(harness);
  ({ adminCookies, memberCookies, otherMemberCookies, requesterCookies, requesterId, memberId } =
    cast);
  ordinaryMatterTypeId = await createMatterType("Conversion dispute");
  requiredMatterTypeId = await createMatterType("Conversion investigation");

  const carry = await createField("Opposing party", "global", "text");
  carrySlug = carry.slug;
  const stays = await createField("Deal desk only", "global", "text");
  staysSlug = stays.slug;
  const required = await createField("Forum", "matter", "text");
  requiredSlug = required.slug;
  const owner = await createField("Business owner", "global", "user");
  ownerSlug = owner.slug;

  boundRequestTypeId = await createRequestType("Dispute intake", {
    targetModule: "matter",
    targetTypeId: ordinaryMatterTypeId,
  });
  moduleOnlyRequestTypeId = await createRequestType("Matter intake", { targetModule: "matter" });
  noTargetRequestTypeId = await createRequestType("Legal question", null);

  const [nda] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"));
  contractTargetRequestTypeId = nda!.id;

  const retiredMatterTypeId = await createMatterType("Retired conversion matter");
  retiredRequestTypeId = await createRequestType("Retired matter intake", {
    targetModule: "matter",
    targetTypeId: retiredMatterTypeId,
  });
  await harness.db
    .update(matterTypes)
    .set({ archivedAt: new Date() })
    .where(eq(matterTypes.id, retiredMatterTypeId));

  for (const fieldId of [carry.id, stays.id, owner.id]) {
    await attach("request-types", boundRequestTypeId, fieldId, false);
  }
  await attach("matter-types", ordinaryMatterTypeId, carry.id, false);
  await attach("matter-types", ordinaryMatterTypeId, owner.id, false);
  await attach("matter-types", requiredMatterTypeId, required.id, true);
});

afterAll(async () => harness.stop());

async function createMatterType(displayName: string): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().matterType.id as string;
}

async function createField(displayName: string, moduleScope: string, fieldType: string) {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { displayName, moduleScope, fieldType, fieldTag: "legal" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { id: res.json().field.id as string, slug: res.json().field.slug as string };
}

async function attach(registry: string, typeId: string, fieldId: string, isRequired: boolean) {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${registry}/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId, isRequired },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function createRequestType(
  displayName: string,
  target: { targetModule: "contract" | "matter"; targetTypeId?: string } | null,
): Promise<string> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().requestType.id as string;
  if (target) {
    const pointed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${id}`,
      cookies: adminCookies,
      payload: { targetModule: target.targetModule, targetTypeId: target.targetTypeId ?? null },
    });
    expect(pointed.statusCode, pointed.body).toBe(200);
  }
  return id;
}

async function submit(
  summary: string,
  typeId = boundRequestTypeId,
  customFields: Record<string, unknown> = {},
  urgency = "high",
) {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId: typeId,
      summary,
      description: "Please open this as legal work.",
      urgency,
      customFields,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}

function convert(number: number, body: Record<string, unknown>, cookies = memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/convert`,
    cookies,
    payload: body,
  });
}

async function matterNumbered(number: number) {
  const [row] = await harness.db.select().from(matters).where(eq(matters.number, number));
  return row!;
}

async function matterCount() {
  return (await harness.db.select({ id: matters.id }).from(matters)).length;
}

describe("the matter target", () => {
  it("confirms a bound matter type and creates an ordinary M-number", async () => {
    const request = await submit(
      "Meridian injunction threat",
      boundRequestTypeId,
      { [carrySlug]: "Meridian Logistics", [staysSlug]: "EMEA" },
      "critical",
    );
    const res = await convert(request.number, { title: "Meridian injunction threat" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.convertedRecord).toEqual({
      module: "matter",
      number: expect.any(Number),
    });
    expect(res.json().request.convertedContract).toBeNull();

    const matter = await matterNumbered(res.json().request.convertedRecord.number as number);
    expect(matter).toMatchObject({
      title: "Meridian injunction threat",
      matterTypeId: ordinaryMatterTypeId,
      priority: "critical",
      risk: null,
      managerId: null,
      isConfidential: false,
      createdBy: memberId,
    });
    expect(matter.customFields).toEqual({ [carrySlug]: "Meridian Logistics" });
    expect((await cast.stored(request.id)).customFields[staysSlug]).toBe("EMEA");
    const [status] = await harness.db
      .select({ category: matterStatuses.category })
      .from(matterStatuses)
      .where(eq(matterStatuses.id, matter.statusId));
    expect(status!.category).toBe("open");
    expect(
      await harness.db
        .select({ userId: matterTeam.userId, role: matterTeam.role })
        .from(matterTeam)
        .where(eq(matterTeam.matterId, matter.id)),
    ).toEqual([{ userId: memberId, role: "creator" }]);
  });

  it("uses the matter title ceiling rather than the contract ceiling", async () => {
    const longMatterTitle = "M".repeat(201);
    const accepted = await submit("A matter with a deliberately long title");
    const converted = await convert(accepted.number, { title: longMatterTitle });
    expect(converted.statusCode, converted.body).toBe(200);
    expect(
      (await matterNumbered(converted.json().request.convertedRecord.number as number)).title,
    ).toBe(longMatterTitle);

    const tooLong = await submit("A matter title beyond its own ceiling");
    const before = await matterCount();
    const refused = await convert(tooLong.number, { title: "M".repeat(501) });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain("matter's title to 500 characters or fewer");
    expect(await matterCount()).toBe(before);
    expect((await cast.stored(tooLong.id)).status).toBe("new");
  });

  it("asks a module-only or archived target for a live matter type", async () => {
    for (const typeId of [moduleOnlyRequestTypeId, retiredRequestTypeId]) {
      const request = await submit(`Needs a live matter type ${typeId}`, typeId);
      const before = await matterCount();
      const refused = await convert(request.number, { title: "Still untyped" });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().detail).toContain("Pick a matter type");
      expect(await matterCount()).toBe(before);
      const accepted = await convert(request.number, {
        title: "Now typed",
        matterTypeId: ordinaryMatterTypeId,
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
    }
  });

  it("refuses a contradicted bound type and a body naming both modules", async () => {
    const contradicted = await submit("The bound type wins");
    expect(
      (
        await convert(contradicted.number, {
          title: "Wrong type",
          matterTypeId: requiredMatterTypeId,
        })
      ).statusCode,
    ).toBe(400);
    const both = await submit("One module only");
    const before = await matterCount();
    const res = await convert(both.number, {
      title: "Two targets",
      matterTypeId: ordinaryMatterTypeId,
      contractTypeId: "not-even-read",
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(await matterCount()).toBe(before);
    expect((await cast.stored(both.id)).status).toBe("new");
  });
});

describe("matter field carry and repair", () => {
  it("requires a missing matter field by name and lands the supplied answer", async () => {
    const request = await submit("An investigation", moduleOnlyRequestTypeId);
    const before = await matterCount();
    const refused = await convert(request.number, {
      title: "An investigation",
      matterTypeId: requiredMatterTypeId,
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain("Forum");
    expect(await matterCount()).toBe(before);

    const accepted = await convert(request.number, {
      title: "An investigation",
      matterTypeId: requiredMatterTypeId,
      customFields: { [requiredSlug]: "DIFC Courts" },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(
      (await matterNumbered(accepted.json().request.convertedRecord.number as number)).customFields,
    ).toEqual({ [requiredSlug]: "DIFC Courts" });
  });

  it("refuses a dead carried reference and accepts its live override", async () => {
    const request = await submit("Owner left", boundRequestTypeId, { [ownerSlug]: requesterId });
    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, requesterId));
    try {
      const refused = await convert(request.number, { title: "Owner left" });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().detail).toContain("Business owner: pick a live person");
      const accepted = await convert(request.number, {
        title: "Owner repaired",
        customFields: { [ownerSlug]: memberId },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(
        (await matterNumbered(accepted.json().request.convertedRecord.number as number))
          .customFields,
      ).toMatchObject({ [ownerSlug]: memberId });
    } finally {
      await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, requesterId));
    }
  });
});

describe("Re-target, reach, narration, and the race", () => {
  it("re-targets a contract-targeting and a no-target Request into matters", async () => {
    for (const typeId of [contractTargetRequestTypeId, noTargetRequestTypeId]) {
      const request = await submit(`Re-target ${typeId}`, typeId);
      const res = await convert(request.number, {
        title: "Re-targeted matter",
        matterTypeId: ordinaryMatterTypeId,
      });
      expect(res.statusCode, res.body).toBe(200);
      const stored = await cast.stored(request.id);
      expect(stored.convertedMatterId).not.toBeNull();
      expect(stored.convertedContractId).toBeNull();
    }
  });

  it("re-targets a matter-bound Request into a contract and leaves the matter id null", async () => {
    const [nda] = await harness.db
      .select({ id: contractTypes.id })
      .from(contractTypes)
      .where(eq(contractTypes.slug, "nda"));
    const request = await submit("This dispute is really paper");
    const before = await matterCount();
    const res = await convert(request.number, {
      title: "Re-targeted contract",
      contractTypeId: nda!.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.convertedRecord).toEqual({
      module: "contract",
      number: expect.any(Number),
    });
    expect(res.json().request.convertedContract).toEqual({ number: expect.any(Number) });
    const stored = await cast.stored(request.id);
    expect(stored.status).toBe("converted");
    expect(stored.convertedContractId).not.toBeNull();
    expect(stored.convertedMatterId).toBeNull();
    const [born] = await harness.db
      .select({ contractTypeId: contracts.contractTypeId })
      .from(contracts)
      .where(eq(contracts.id, stored.convertedContractId!));
    expect(born!.contractTypeId).toBe(nda!.id);
    expect(await matterCount()).toBe(before);
  });

  it("links Inbox and detail under matter reach, and withholds a confidential outsider", async () => {
    const request = await submit("Reach follows the matter");
    const converted = await convert(request.number, { title: "Reach follows the matter" });
    const number = converted.json().request.convertedRecord.number as number;
    const matter = await matterNumbered(number);

    const reached = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: otherMemberCookies,
    });
    expect(reached.json().request.convertedRecord).toEqual({ module: "matter", number });
    await harness.db.update(matters).set({ isConfidential: true }).where(eq(matters.id, matter.id));
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: otherMemberCookies,
    });
    expect(hidden.json().request.convertedRecord).toBeNull();
    const inbox = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests?includeTriaged=true",
      cookies: otherMemberCookies,
    });
    expect(
      inbox.json().requests.find((row: { number: number }) => row.number === request.number)
        .convertedRecord,
    ).toBeNull();
  });

  it("writes both narrations and sends the requester one status-change bell and email", async () => {
    const request = await submit("Narrated matter conversion");
    const res = await convert(request.number, { title: "Narrated matter conversion" });
    const matter = await matterNumbered(res.json().request.convertedRecord.number as number);
    const requestEntries = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "request"), eq(activityLog.entityId, request.id)));
    expect(requestEntries.find((row) => row.action === "request.converted")?.payload).toEqual({
      number: request.number,
      matterNumber: matter.number,
    });
    const matterEntries = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "matter"), eq(activityLog.entityId, matter.id)));
    expect(matterEntries.map((row) => row.action)).toContain("matter.created_from_request");

    const bells = await cast.bellRowsOn(requesterId, request.id);
    expect(bells.filter((row) => row.eventType === "request.status_changed")).toHaveLength(1);
    await settles(`matter conversion mail about R-${request.number}`, () =>
      cast
        .mailAbout(REQUESTER.email, request.number)
        .some((mail) => mail.subject.includes("Your request is in progress")),
    );
  });

  it("lets one racing triager win and names the matter on the 409", async () => {
    const request = await submit("One Request, one matter");
    const before = await matterCount();
    const [first, second] = await Promise.all([
      convert(request.number, { title: "First matter" }, memberCookies),
      convert(request.number, { title: "Second matter" }, otherMemberCookies),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(await matterCount()).toBe(before + 1);
    const winner = first.statusCode === 200 ? first : second;
    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json()).toMatchObject({
      type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
      outcome: "converted",
      convertedRecord: {
        module: "matter",
        number: winner.json().request.convertedRecord.number,
      },
    });
  });
});
