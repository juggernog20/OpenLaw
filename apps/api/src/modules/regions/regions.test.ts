// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { provisionUser } from "../../auth/instance.js";
import { eq, users } from "@openlaw/db";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const credentials = {
    email: "regions@example.com",
    displayName: "Regions Member",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(h.app.auth, credentials);
  await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, person.id));
  member = await signInCookies(h.app, credentials.email, credentials.password);
});
afterAll(async () => h?.stop());

it("manages Regions as an admin and validates, renames, and retains Contract references", async () => {
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/v1/regions",
        cookies: member,
        payload: { displayName: "No" },
      })
    ).statusCode,
  ).toBe(403);
  const add = async (displayName: string) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/regions",
      cookies: admin,
      payload: { displayName },
    });
  const created = await add("EMEA");
  expect(created.statusCode, created.body).toBe(201);
  const region = created.json().region;
  expect((await add("emea")).statusCode).toBe(409);
  await add("Americas");
  const options = await h.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: member,
  });
  expect(options.json().regions.map((row: { displayName: string }) => row.displayName)).toEqual([
    "Americas",
    "EMEA",
  ]);
  const createContract = (region: string) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: member,
      payload: {
        title: "Region Contract",
        contractTypeId: options.json().contractTypes[0].id,
        region,
      },
    });
  expect((await createContract("Unconfigured")).statusCode).toBe(400);
  const contractResponse = await createContract("EMEA");
  expect(contractResponse.statusCode, contractResponse.body).toBe(201);
  const contract = contractResponse.json().contract;
  const renamed = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/regions/${region.id}`,
    cookies: admin,
    payload: { displayName: "Europe" },
  });
  expect(renamed.statusCode, renamed.body).toBe(200);
  const read = () =>
    h.app.inject({ method: "GET", url: `/api/v1/contracts/${contract.number}`, cookies: member });
  expect((await read()).json().contract.region).toBe("Europe");
  const archived = await h.app.inject({
    method: "POST",
    url: `/api/v1/regions/${region.id}/archive`,
    cookies: admin,
    payload: {},
  });
  expect(archived.statusCode, archived.body).toBe(200);
  expect(archived.json().region.inUseCount).toBe(1);
  expect((await read()).json().contract.region).toBe("Europe");
  expect((await createContract("Europe")).statusCode).toBe(400);
  expect(
    (await h.app.inject({ method: "DELETE", url: `/api/v1/regions/${region.id}`, cookies: admin }))
      .statusCode,
  ).toBe(409);
  const patch = (value: string | null) =>
    h.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: member,
      payload: { region: value },
    });
  expect((await patch("Invented")).statusCode).toBe(400);
  expect((await patch("Americas")).statusCode).toBe(200);
  expect((await patch("Europe")).statusCode).toBe(400);
  expect((await patch(null)).statusCode).toBe(200);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/regions/${region.id}/restore`,
        cookies: admin,
      })
    ).statusCode,
  ).toBe(200);
  expect((await patch("Europe")).statusCode).toBe(200);
});

it("shares Regions with Matters and retains their references on rename and archive", async () => {
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/regions",
    cookies: admin,
    payload: { displayName: "Asia Pacific" },
  });
  expect(made.statusCode, made.body).toBe(201);
  const region = made.json().region;
  const options = await h.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: member,
  });
  expect(options.json().regions).toContainEqual({ id: region.id, displayName: "Asia Pacific" });
  const create = (region: string) =>
    h.app.inject({
      method: "POST",
      url: "/api/v1/matters",
      cookies: member,
      payload: { title: "Regional advice", matterTypeId: options.json().matterTypes[0].id, region },
    });
  expect((await create("Unknown")).statusCode).toBe(400);
  const created = await create("Asia Pacific");
  expect(created.statusCode, created.body).toBe(201);
  const number = created.json().matter.number;
  const read = () =>
    h.app.inject({ method: "GET", url: `/api/v1/matters/${number}`, cookies: member });
  expect((await read()).json().matter.region).toBe("Asia Pacific");
  const renamed = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/regions/${region.id}`,
    cookies: admin,
    payload: { displayName: "APAC" },
  });
  expect(renamed.statusCode, renamed.body).toBe(200);
  expect((await read()).json().matter.region).toBe("APAC");
  const archived = await h.app.inject({
    method: "POST",
    url: `/api/v1/regions/${region.id}/archive`,
    cookies: admin,
    payload: {},
  });
  expect(archived.json().region.inUseCount).toBe(1);
  expect((await read()).json().matter.region).toBe("APAC");
  expect((await create("APAC")).statusCode).toBe(400);
  expect(
    (await h.app.inject({ method: "DELETE", url: `/api/v1/regions/${region.id}`, cookies: admin }))
      .statusCode,
  ).toBe(409);
  const patch = (region: string | null) =>
    h.app.inject({
      method: "PATCH",
      url: `/api/v1/matters/${number}`,
      cookies: member,
      payload: { region },
    });
  expect((await patch("Unknown")).statusCode).toBe(400);
  expect((await patch(null)).statusCode).toBe(200);
  expect((await patch("APAC")).statusCode).toBe(400);
  const alternate = await h.app.inject({
    method: "POST",
    url: "/api/v1/regions",
    cookies: admin,
    payload: { displayName: "Matter alternate" },
  });
  expect(alternate.statusCode, alternate.body).toBe(201);
  const assigned = await patch("matter ALTERNATE");
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.json().matter.region).toBe("Matter alternate");
});
