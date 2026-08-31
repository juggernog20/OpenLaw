// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The portal home's reads (#377): what a Business User session can see
 * of the Administrator's intake configuration, and what it still
 * cannot.
 *
 * Two things are asserted here and nowhere else. The first is that the
 * requester-facing reads answer a Business User at all. Every M19
 * route refuses that session, which is why these reads exist. The
 * second is that opening them changed nothing about the
 * Administrator-facing ones. The M19 suites assert their own gate, and
 * this suite asserts that a requester holding a portal session cannot
 * walk through it.
 *
 * The taxonomy's own behaviors (ordering, archive, the display-order
 * rewrite) are covered in `request-types.test.ts`, and the deflection
 * links' in `intake-links.test.ts`. What this suite adds is the
 * requester's view of the same rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, intakeLinks, knowledgeItems, knowledgeTypes, users } from "@openlaw/db";
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
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

/** The INT-002 seeds, in seeded display order. */
const SEED_SLUGS = ["nda_request", "contract_review", "legal_question"] as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let memberCookies: Record<string, string>;

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
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
  }

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
});

afterAll(async () => {
  await harness.stop();
});

interface PortalType {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  displayOrder: number;
}

interface PortalLink {
  id: string;
  label: string;
  url?: string;
  knowledgeItemId?: string;
  displayOrder: number;
}

async function portalTypes(cookies = requesterCookies): Promise<PortalType[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/portal/request-types",
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().requestTypes;
}

async function portalLinks(cookies = requesterCookies): Promise<PortalLink[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/portal/intake-links",
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().intakeLinks;
}

/** One id per seed slug, read through the Administrator's own list. */
async function seedTypeIds(): Promise<Map<string, string>> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return new Map(
    (res.json().requestTypes as { slug: string; id: string }[]).map((row) => [row.slug, row.id]),
  );
}

async function addLink(body: {
  label?: string;
  url?: string;
  knowledgeItemId?: string;
  requestTypeId?: string | null;
}): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/intake-links",
    cookies: adminCookies,
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().intakeLink.id as string;
}

describe("the request types a requester is offered", () => {
  it("answers a Business User session with the live types in display order", async () => {
    const rows = await portalTypes();
    expect(rows.map((row) => row.slug)).toEqual([...SEED_SLUGS]);
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2, 3]);
  });

  it("carries the name and the requester-facing description", async () => {
    const rows = await portalTypes();
    expect(rows[0]).toEqual({
      id: expect.any(String),
      slug: "nda_request",
      displayName: "NDA request",
      description: "Mutual or one-way NDA with a counterparty.",
      displayOrder: 1,
    });
  });

  it("carries nothing about administering the taxonomy", async () => {
    // The archive stamp, the conversion target, and the two counts are
    // the Administrator's business; a requester filling in a form is
    // not shown how the taxonomy is run.
    const [row] = await portalTypes();
    expect(Object.keys(row!).sort()).toEqual([
      "description",
      "displayName",
      "displayOrder",
      "id",
      "slug",
    ]);
  });

  it("leaves an archived type out of the picker", async () => {
    const ids = await seedTypeIds();
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${ids.get("legal_question")}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    try {
      const rows = await portalTypes();
      expect(rows.map((row) => row.slug)).toEqual(["nda_request", "contract_review"]);
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${ids.get("legal_question")}/restore`,
        cookies: adminCookies,
        payload: {},
      });
      expect(restored.statusCode, restored.body).toBe(200);
    }
  });

  it("admits a Member+ staff session too", async () => {
    // Staff ask legal questions as well, and on this surface they are a
    // Requester like anybody else (the INT-001 M20/2 addendum).
    expect((await portalTypes(memberCookies)).map((row) => row.slug)).toEqual([...SEED_SLUGS]);
  });

  it("refuses a caller with no session", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/portal/request-types" });
    expect(res.statusCode, res.body).toBe(401);
  });
});

describe("the deflection links a requester is offered", () => {
  beforeEach(async () => {
    await harness.db.delete(intakeLinks);
  });

  it("answers the portal home panel in panel order", async () => {
    await addLink({ label: "Procurement policy", url: "https://wiki.acme.com/procurement" });
    await addLink({ label: "NDA self-serve template", url: "https://wiki.acme.com/nda" });

    const rows = await portalLinks();
    expect(rows.map((row) => row.label)).toEqual(["Procurement policy", "NDA self-serve template"]);
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2]);
  });

  it("answers the URL exactly as it was stored", async () => {
    // INT-004: nothing normalizes the address. No lower-casing, no
    // trailing-slash trimming, no re-encoding. What a requester follows
    // is the string the Administrator pasted.
    const url = "https://Wiki.Acme.com/Legal/NDA?from=Portal#top";
    await addLink({ label: "NDA FAQ", url });
    expect((await portalLinks())[0]!.url).toBe(url);
  });

  it("leaves a link placed on a request type to that type's form", async () => {
    const ids = await seedTypeIds();
    await addLink({ label: "Home panel link", url: "https://wiki.acme.com/home" });
    await addLink({
      label: "Contract review FAQ",
      url: "https://wiki.acme.com/review",
      requestTypeId: ids.get("contract_review")!,
    });

    expect((await portalLinks()).map((row) => row.label)).toEqual(["Home panel link"]);
  });

  it("carries no placement key, because the home panel is the only answer", async () => {
    await addLink({ label: "NDA FAQ", url: "https://wiki.acme.com/nda" });
    const [row] = await portalLinks();
    expect(Object.keys(row!).sort()).toEqual(["displayOrder", "id", "label", "url"]);
  });

  it("answers an empty panel when no link is placed on the home", async () => {
    expect(await portalLinks()).toEqual([]);
  });

  it("returns an internal target, skips it when reach is lost, and leaves external links unchanged", async () => {
    const [admin] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN.email));
    const [type] = await harness.db
      .select({ id: knowledgeTypes.id })
      .from(knowledgeTypes)
      .where(eq(knowledgeTypes.slug, "article"));
    const [item] = await harness.db
      .insert(knowledgeItems)
      .values({
        title: "NDA answer",
        knowledgeTypeId: type!.id,
        state: "published",
        audience: "everyone",
        publishedAt: new Date(),
        createdBy: admin!.id,
        updatedBy: admin!.id,
      })
      .returning({ id: knowledgeItems.id });
    await addLink({ knowledgeItemId: item!.id });
    const externalUrl = "https://Wiki.Acme.com/Legal/NDA?from=Portal#top";
    await addLink({ label: "External answer", url: externalUrl });

    expect(await portalLinks()).toEqual([
      expect.objectContaining({ label: "NDA answer", knowledgeItemId: item!.id }),
      expect.objectContaining({ label: "External answer", url: externalUrl }),
    ]);
    expect(Object.keys((await portalLinks())[0]!).sort()).toEqual([
      "displayOrder",
      "id",
      "knowledgeItemId",
      "label",
    ]);

    await harness.db
      .update(knowledgeItems)
      .set({ audience: "legal_only" })
      .where(eq(knowledgeItems.id, item!.id));
    expect(await portalLinks()).toEqual([
      expect.objectContaining({ label: "External answer", url: externalUrl }),
    ]);
  });

  it("applies the same reach gate to an internal link on a request form", async () => {
    const ids = await seedTypeIds();
    const [admin] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN.email));
    const [type] = await harness.db
      .select({ id: knowledgeTypes.id })
      .from(knowledgeTypes)
      .where(eq(knowledgeTypes.slug, "article"));
    const [item] = await harness.db
      .insert(knowledgeItems)
      .values({
        title: "Contract review answer",
        knowledgeTypeId: type!.id,
        state: "published",
        audience: "everyone",
        publishedAt: new Date(),
        createdBy: admin!.id,
        updatedBy: admin!.id,
      })
      .returning({ id: knowledgeItems.id });
    await addLink({
      knowledgeItemId: item!.id,
      requestTypeId: ids.get("contract_review")!,
    });

    const readFormLinks = async () => {
      const res = await harness.app.inject({
        method: "GET",
        url: "/api/v1/portal/request-types/contract_review",
        cookies: requesterCookies,
      });
      expect(res.statusCode, res.body).toBe(200);
      return res.json().intakeLinks as PortalLink[];
    };

    expect(await readFormLinks()).toEqual([
      expect.objectContaining({
        label: "Contract review answer",
        knowledgeItemId: item!.id,
      }),
    ]);

    await harness.db
      .update(knowledgeItems)
      .set({ state: "draft", publishedAt: null })
      .where(eq(knowledgeItems.id, item!.id));
    expect(await readFormLinks()).toEqual([]);
  });

  it("refuses a caller with no session", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/portal/intake-links" });
    expect(res.statusCode, res.body).toBe(401);
  });
});

describe("the Administrator-facing intake routes", () => {
  it("stay shut to a Business User session", async () => {
    const ids = await seedTypeIds();
    const calls = [
      { method: "GET" as const, url: "/api/v1/request-types" },
      { method: "GET" as const, url: `/api/v1/request-types/${ids.get("nda_request")}` },
      { method: "GET" as const, url: `/api/v1/request-types/${ids.get("nda_request")}/fields` },
      { method: "GET" as const, url: "/api/v1/intake-links" },
      {
        method: "POST" as const,
        url: "/api/v1/intake-links",
        payload: { label: "Sneaked in", url: "https://wiki.acme.com/nope" },
      },
    ];
    for (const call of calls) {
      const res = await harness.app.inject({ ...call, cookies: requesterCookies });
      expect(res.statusCode, `${call.method} ${call.url}: ${res.body}`).toBe(403);
    }
  });

  it("keep answering the Administrator", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/request-types",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().requestTypes as { slug: string }[]).map((row) => row.slug).sort()).toEqual(
      [...SEED_SLUGS].sort(),
    );
  });
});
