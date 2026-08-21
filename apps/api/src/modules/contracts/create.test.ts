// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract create as a callable a second caller reaches (M21/1).
 *
 * The create route is the first caller and stays the whole HTTP
 * contract; `contracts.test.ts` and its siblings assert that half. What
 * this suite asserts is the half the route cannot: the same write, run
 * inside a transaction some **other** caller opened and owns.
 *
 * That is what INT-002's conversion needs. Converting a Request is one
 * transaction that dispositions the Request, creates the contract,
 * promotes the paper, and re-parents the thread; the contract write has
 * to be a step inside it rather than a transaction of its own, or a
 * failure after the contract is born leaves a C-### nobody asked for.
 * The conversion arm itself lands in M21/9 — this suite proves the door
 * it walks through.
 *
 * Two things are asserted, and both are things a caller can observe.
 *
 * - **Atomicity is the caller's.** The contract commits when the
 *   enclosing transaction commits and vanishes when it rolls back, so a
 *   caller that fails after the create leaves no record behind.
 * - **The refusals are the same refusals.** An archived type, an empty
 *   hard-required field (CTR-016/MTR-014), and a slug the type does not
 *   attach are each asked for twice — once through the route, once
 *   through the callable — and the two answers are compared field for
 *   field. The route's problem body is the source of truth; the
 *   callable has to match it, not the other way round.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, contracts, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { HttpError, type Problem } from "../../lib/problem.js";
import { createContract, type CreateContractInput } from "./create.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let memberId: string;

/** A live type with nothing attached — the ordinary create. */
let plainTypeId: string;
/** A type an Administrator has archived. */
let archivedTypeId: string;
/** A live type that hard-requires one field (CTR-016). */
let demandingTypeId: string;
/** That type's required field, by slug. */
let requiredSlug: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberId = member.id;
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  plainTypeId = await newType("Door plain");
  archivedTypeId = await newType("Door retired");
  const archive = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contract-types/${archivedTypeId}/archive`,
    cookies: adminCookies,
    payload: {},
  });
  expect(archive.statusCode, archive.body).toBe(200);

  demandingTypeId = await newType("Door demanding");
  requiredSlug = await attachRequiredField(demandingTypeId, "Signing office");
});

afterAll(async () => {
  await harness.stop();
});

/** Adds a contract type, requiring success. */
async function newType(displayName: string): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contract-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contractType.id as string;
}

/** Defines a text field and attaches it to a type as hard-required. */
async function attachRequiredField(typeId: string, displayName: string): Promise<string> {
  const defined = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { moduleScope: "contract", fieldTag: "legal", displayName, fieldType: "text" },
  });
  expect(defined.statusCode, defined.body).toBe(201);
  const field = defined.json().field as { id: string; slug: string };
  const attached = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contract-types/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId: field.id, isRequired: true },
  });
  expect(attached.statusCode, attached.body).toBe(201);
  return field.slug;
}

/** The create as the route asks it. */
const createOverHttp = (payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload,
  });

/** The create as a caller that owns the transaction asks it. */
const createInCallerTransaction = (input: Omit<CreateContractInput, "actorId">) =>
  harness.db.transaction((tx) => createContract(tx, { actorId: memberId, ...input }));

/** The refusal a call threw, or a failure if it did not refuse. */
async function refusalOf(call: Promise<unknown>): Promise<HttpError> {
  const outcome = await call.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome, "the call was expected to refuse").toBeInstanceOf(HttpError);
  return outcome as HttpError;
}

/**
 * Asks one create both ways and asserts the two refusals are one
 * refusal: same status, same problem type, same sentence.
 */
async function expectMatchingRefusal(payload: {
  title: string;
  contractTypeId: string;
  customFields?: Record<string, string>;
}) {
  const overHttp = await createOverHttp(payload);
  const problem = overHttp.json() as Problem;
  const thrown = await refusalOf(createInCallerTransaction(payload));
  expect(overHttp.statusCode, overHttp.body).toBe(thrown.statusCode);
  expect(problem.detail).toBe(thrown.message);
  expect(problem.type).toBe(thrown.type);
  return problem;
}

describe("the contract create inside a caller's transaction", () => {
  it("commits with the transaction that opened it, numbering each contract from the CTR-003 sequence", async () => {
    const born = await harness.db.transaction(async (tx) => {
      const first = await createContract(tx, {
        actorId: memberId,
        title: "Door commit one",
        contractTypeId: plainTypeId,
      });
      const second = await createContract(tx, {
        actorId: memberId,
        title: "Door commit two",
        contractTypeId: plainTypeId,
      });
      return [first, second];
    });
    expect(born[0]!.row.number).toBeGreaterThan(0);
    expect(born[1]!.row.number).toBeGreaterThan(born[0]!.row.number);

    for (const contract of born) {
      const res = await harness.app.inject({
        method: "GET",
        url: `/api/v1/contracts/${contract.row.number}`,
        cookies: memberCookies,
      });
      expect(res.statusCode, res.body).toBe(200);
      const answered = res.json().contract as {
        title: string;
        stage: string;
        manager: unknown;
        isConfidential: boolean;
      };
      // An ordinary contract, not a special case: the draft seed, no
      // Owner, and the flag off (the M16 successor rule's sibling).
      expect(answered.title).toBe(contract.row.title);
      expect(answered.stage).toBe("draft");
      expect(answered.manager).toBeNull();
      expect(answered.isConfidential).toBe(false);
      const narration = await harness.db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.entityId, contract.row.id),
            eq(activityLog.action, "contract.created"),
          ),
        );
      expect(narration).toHaveLength(1);
      expect(narration[0]!.actorId).toBe(memberId);
    }
  });

  it("rolls back with the transaction that opened it, leaving no record behind", async () => {
    const title = "Door rollback";
    await expect(
      harness.db.transaction(async (tx) => {
        await createContract(tx, { actorId: memberId, title, contractTypeId: plainTypeId });
        throw new Error("the caller failed after the create");
      }),
    ).rejects.toThrow("the caller failed after the create");

    const left = await harness.db.select().from(contracts).where(eq(contracts.title, title));
    expect(left).toHaveLength(0);
  });
});

describe("the refusals, whichever caller asks", () => {
  it("refuses an archived contract type the same way", async () => {
    const problem = await expectMatchingRefusal({
      title: "Door archived type",
      contractTypeId: archivedTypeId,
    });
    expect(problem.status).toBe(400);
  });

  it("refuses an empty hard-required field the same way", async () => {
    const problem = await expectMatchingRefusal({
      title: "Door required gap",
      contractTypeId: demandingTypeId,
    });
    expect(problem.status).toBe(400);
    expect(problem.detail).toContain("Signing office");
  });

  it("refuses a slug the type does not attach the same way", async () => {
    const problem = await expectMatchingRefusal({
      title: "Door stray slug",
      contractTypeId: plainTypeId,
      customFields: { [requiredSlug]: "Dubai" },
    });
    expect(problem.status).toBe(400);
  });
});
