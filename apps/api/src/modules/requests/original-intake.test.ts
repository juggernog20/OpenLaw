// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  contracts,
  contractTeam,
  eq,
  matters,
  matterTeam,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import {
  CONTRIBUTOR,
  dispositionScaffold,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let requestTypeId: string;
let contributorId: string;
beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cast = await dispositionScaffold(harness);
  const [type] = await harness.db
    .select()
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"));
  requestTypeId = type!.id;
  const [contributor] = await harness.db
    .select()
    .from(users)
    .where(eq(users.email, CONTRIBUTOR.email));
  contributorId = contributor!.id;
});
afterAll(async () => {
  await harness?.stop();
});

it.each(["contract", "matter"] as const)(
  "preserves original intake on the %s after description edits and enforces both audiences",
  async (module) => {
    const description = "Original requester context.\nAn exception that the title leaves out.";
    const submitted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/requests",
      cookies: cast.requesterCookies,
      payload: { requestTypeId, title: "Compare descriptions", description, urgency: "medium" },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    const original = submitted.json().request;
    let matterTypeId: string | undefined;
    if (module === "matter") {
      const type = await harness.app.inject({
        method: "POST",
        url: "/api/v1/matter-types",
        cookies: cast.adminCookies,
        payload: { displayName: "Original intake comparison" },
      });
      expect(type.statusCode, type.body).toBe(201);
      matterTypeId = type.json().matterType.id;
    }
    const converted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${original.number}/convert`,
      cookies: cast.memberCookies,
      payload: {
        title: "Prepared record",
        description: "A concise description.",
        ...(matterTypeId ? { matterTypeId } : {}),
      },
    });
    expect(converted.statusCode, converted.body).toBe(200);
    const number = converted.json().request.convertedRecord.number;
    const url = `/api/v1/${module}s/${number}`;
    async function read(cookies = cast.memberCookies) {
      return harness.app.inject({ method: "GET", url, cookies });
    }
    const result = await read();
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()[module].description).toBe("A concise description.");
    expect(result.json().originalIntake).toEqual({ number: original.number, description });
    const edited = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: cast.memberCookies,
      payload: { description: "Lawyer's revised description." },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await read()).json().originalIntake).toEqual({ number: original.number, description });
    expect((await cast.stored(original.id)).description).toBe(description);

    // Membership on the new record alone does not grant access to another person's Request.
    const id = result.json()[module].id;
    if (module === "contract")
      await harness.db.insert(contractTeam).values({ contractId: id, userId: contributorId });
    else await harness.db.insert(matterTeam).values({ matterId: id, userId: contributorId });
    const limited = await read(cast.contributorCookies);
    expect(limited.statusCode, limited.body).toBe(403);
    const portal = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/${module}s/${result.json()[module].number}/work`,
      cookies: cast.contributorCookies,
    });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(portal.json().work.originalRequests).toEqual([
      expect.objectContaining({ number: original.number, description }),
    ]);
    expect(limited.body).not.toContain("An exception that the title leaves out.");

    const table = module === "contract" ? contracts : matters;
    await harness.db.update(table).set({ isConfidential: true }).where(eq(table.id, id));
    expect((await read(cast.otherMemberCookies)).statusCode).toBe(404);
    expect((await read()).json().originalIntake).toEqual({ number: original.number, description });
    await harness.db
      .update(requests)
      .set({ archivedAt: new Date() })
      .where(eq(requests.id, original.id));
    expect((await read()).json().originalIntake).toBeNull();
    await harness.db
      .update(requests)
      .set({ archivedAt: null, description: null })
      .where(eq(requests.id, original.id));
    expect((await read()).json().originalIntake).toEqual({
      number: original.number,
      description: null,
    });
  },
);
