// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The taxonomy machinery's two per-mount extension points (#351), at
 * the HTTP seam of a mount that turns both on: the `extras` hook and
 * the configurable `protectedSlug`. Request types (#350) are the mount
 * that will need them; this suite proves the machinery serves them
 * before that mount exists.
 *
 * The probe mount below is the factory with both options on, over the
 * `entity_types` table and beside the ordinary entity-types mount in
 * the same app. Two mounts over one table is the point: everything the
 * probe does that the plain mount does not is the option, not the
 * table. What the extras read and write — the row's `created_at` on the
 * projection, its `is_system_default` on the PATCH body — are real
 * columns the plain taxonomy keeps closed, and the rule the validator
 * enforces is this suite's, not the product's. No schema lands for a
 * test (TECH-014's incremental rule), and no assertion here reaches
 * past the routes.
 *
 * That the three real mounts are unchanged is asserted where it
 * belongs: their own suites, unedited.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { activityLog, and, asc, desc, entityTypes, eq, inArray, isNull, ne } from "@openlaw/db";
import { buildApp } from "../app.js";
import { testDeps } from "../testing/deps.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../testing/harness.js";
import { httpError } from "./problem.js";
import { taxonomyRoutes } from "./taxonomy-routes.js";

/**
 * The factory with both extension points on.
 *
 * `protectedSlug` is omitted, so no row is protected — the `other` row
 * this table seeds archives and deletes here exactly like any other,
 * while the plain mount in the same app still refuses it.
 *
 * The extras add `createdAt` to the projection, open `isSystemDefault`
 * on the PATCH body, and guard that flag under the row lock.
 */
const probeTypesRoutes = taxonomyRoutes({
  table: entityTypes,
  path: "probe-types",
  tag: "probe-types",
  idSingular: "ProbeType",
  idPlural: "ProbeTypes",
  keySingular: "probeType",
  keyPlural: "probeTypes",
  noun: "probe type",
  decision: "#351",
  actionPrefix: "entity_type",
  recordsMilestone: "M27",
  recordNoun: { singular: "probe", plural: "probes" },
  extras: {
    rowSchema: { createdAt: z.iso.datetime() },
    projectRow: (row) => ({ createdAt: row.createdAt.toISOString() }),
    patchSchema: { isSystemDefault: z.boolean().optional() },
    applyPatch: async ({ tx, row, body }) => {
      // `patchSchema` types this: no cast, and a key it does not
      // declare does not compile.
      const wanted = body.isSystemDefault;
      if (wanted === undefined || wanted === row.isSystemDefault) return {};
      if (wanted) {
        // Both halves of what a mount's validator may do: read the
        // locked row, and query the caller's transaction. A row named
        // like another live row cannot become the system default —
        // this suite's rule, standing in for the target rule request
        // types will bring.
        if (row.archivedAt) {
          throw httpError(409, "An archived probe type can't be the system default.");
        }
        const [twin] = await tx
          .select({ id: entityTypes.id })
          .from(entityTypes)
          .where(
            and(
              eq(entityTypes.displayName, row.displayName),
              ne(entityTypes.id, row.id),
              isNull(entityTypes.archivedAt),
            ),
          )
          .limit(1);
        if (twin) {
          throw httpError(
            409,
            `Another live probe type is called ${row.displayName}. ` +
              "Rename one of them before making this the system default.",
          );
        }
      }
      return {
        columns: { isSystemDefault: wanted },
        changed: { isSystemDefault: { from: row.isSystemDefault, to: wanted } },
      };
    },
  },
});

/**
 * A mount that reaches for a column the machinery writes — the slug,
 * which CTR-002 made immutable. Mounted beside the other two so the
 * refusal is observed where a caller would meet it.
 */
const rogueTypesRoutes = taxonomyRoutes({
  table: entityTypes,
  path: "rogue-types",
  tag: "rogue-types",
  idSingular: "RogueType",
  idPlural: "RogueTypes",
  keySingular: "rogueType",
  keyPlural: "rogueTypes",
  noun: "rogue type",
  decision: "#351",
  actionPrefix: "entity_type",
  recordsMilestone: "M27",
  recordNoun: { singular: "rogue", plural: "rogues" },
  extras: {
    rowSchema: {},
    projectRow: () => ({}),
    patchSchema: { renameSlugTo: z.string().optional() },
    applyPatch: ({ body }) =>
      body.renameSlugTo === undefined ? {} : { columns: { slug: body.renameSlugTo } },
  },
});

let harness: TestHarness;
/** The harness's database, with the probe mounts beside the plain one. */
let app: Awaited<ReturnType<typeof buildApp>>;
let adminCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);

  app = await buildApp(testDeps({ db: harness.db }));
  await app.register(probeTypesRoutes, { prefix: "/api/v1" });
  await app.register(rogueTypesRoutes, { prefix: "/api/v1" });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  await harness.stop();
});

interface ProbeRow {
  id: string;
  slug: string;
  displayName: string;
  isSystemDefault: boolean;
  archivedAt: string | null;
  /** The extras' column — absent from the plain mount's row. */
  createdAt?: string;
}

const listProbeTypes = async (includeArchived = false): Promise<ProbeRow[]> => {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/probe-types${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().probeTypes;
};

const probeTypeBySlug = async (slug: string): Promise<ProbeRow> => {
  const rows = await listProbeTypes(true);
  const row = rows.find((candidate) => candidate.slug === slug);
  expect(row, slug).toBeDefined();
  return row!;
};

/** Adds a probe type and answers the created row. */
const addProbeType = async (displayName: string): Promise<ProbeRow> => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/probe-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().probeType;
};

const UpdatedPayload = z.object({
  slug: z.string(),
  changed: z.record(z.string(), z.unknown()),
});

/** The newest `updated` entry this taxonomy's namespace carries. */
const latestUpdatedPayload = async () => {
  const [row] = await harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "entity_type.updated"))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(1);
  return row === undefined ? undefined : UpdatedPayload.parse(row.payload);
};

describe("the extras hook", () => {
  it("projects its extra column on the list and on a single row", async () => {
    const listed = await listProbeTypes();
    expect(listed).not.toHaveLength(0);
    for (const row of listed) {
      expect(new Date(row.createdAt!).getTime()).toBeGreaterThan(0);
    }

    const corporation = await probeTypeBySlug("corporation");
    const single = await app.inject({
      method: "GET",
      url: `/api/v1/probe-types/${corporation.id}`,
      cookies: adminCookies,
    });
    expect(single.statusCode, single.body).toBe(200);
    expect(single.json().probeType.createdAt).toBe(corporation.createdAt);
  });

  it("leaves the plain mount's projection alone — the same rows carry no extra column", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/entity-types",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    for (const row of res.json().entityTypes) {
      expect(row).not.toHaveProperty("createdAt");
    }
  });

  it("accepts its extra PATCH key, which the plain mount refuses as 400", async () => {
    const probe = await addProbeType("Extras probe");

    const refused = await app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${probe.id}`,
      cookies: adminCookies,
      payload: { isSystemDefault: true },
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.headers["content-type"]).toContain("application/problem+json");

    const accepted = await app.inject({
      method: "PATCH",
      url: `/api/v1/probe-types/${probe.id}`,
      cookies: adminCookies,
      payload: { isSystemDefault: true },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().probeType.isSystemDefault).toBe(true);
    expect((await probeTypeBySlug(probe.slug)).isSystemDefault).toBe(true);
  });

  it("narrates its change in the `updated` activity payload", async () => {
    const probe = await addProbeType("Narration probe");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/probe-types/${probe.id}`,
      cookies: adminCookies,
      payload: { description: "Told in the log.", isSystemDefault: true },
    });
    expect(res.statusCode, res.body).toBe(200);

    const payload = await latestUpdatedPayload();
    expect(payload?.slug).toBe(probe.slug);
    // One entry carries both the machinery's column and the mount's.
    expect(payload?.changed).toEqual({
      description: { from: null, to: "Told in the log." },
      isSystemDefault: { from: false, to: true },
    });
  });

  it("keeps the body strict — a key no mount declared is still refused", async () => {
    const probe = await probeTypeBySlug("corporation");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/probe-types/${probe.id}`,
      cookies: adminCookies,
      payload: { slug: "renamed-slug" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(await probeTypeBySlug("corporation")).toBeDefined();
  });

  it("refuses under the row lock as an RFC 9457 problem, and the whole PATCH rolls back", async () => {
    // Two live rows with one display name: what the validator refuses
    // to make a system default. Only the locked row knows this — the
    // body cannot say it.
    const first = await addProbeType("Twin probe");
    const second = await addProbeType("Twin probe");
    expect(second.slug).not.toBe(first.slug);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/probe-types/${first.id}`,
      cookies: adminCookies,
      payload: { description: "Should not survive.", isSystemDefault: true },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      status: 409,
      detail: expect.stringContaining("Twin probe"),
    });

    // The refusal took the rest of the request with it: the description
    // the same body asked for was never written, and neither was an
    // activity row for it.
    const [row] = await harness.db
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.id, first.id))
      .limit(1);
    expect(row?.description).toBeNull();
    expect(row?.isSystemDefault).toBe(false);
    const payload = await latestUpdatedPayload();
    expect(payload?.slug).not.toBe(first.slug);
  });

  it("refuses to build a mount that redeclares a key the taxonomy owns", () => {
    // Not a request: a mount that would take over `description` never
    // gets as far as serving one, so the refusal is where it is built.
    const rebuild = (extras: Parameters<typeof taxonomyRoutes>[0]["extras"]) => () =>
      taxonomyRoutes({
        table: entityTypes,
        path: "clashing-types",
        tag: "clashing-types",
        idSingular: "ClashingType",
        idPlural: "ClashingTypes",
        keySingular: "clashingType",
        keyPlural: "clashingTypes",
        noun: "clashing type",
        decision: "#351",
        actionPrefix: "entity_type",
        recordsMilestone: "M27",
        recordNoun: { singular: "clash", plural: "clashes" },
        extras,
      });

    expect(
      rebuild({ rowSchema: { slug: z.string() }, projectRow: () => ({ slug: "taken" }) }),
    ).toThrow(/slug/);
    expect(
      rebuild({
        rowSchema: {},
        projectRow: () => ({}),
        patchSchema: { description: z.string().optional() },
      }),
    ).toThrow(/description/);
  });

  it("refuses to let a mount write a column the machinery owns", async () => {
    const probe = await addProbeType("Rogue probe");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/rogue-types/${probe.id}`,
      cookies: adminCookies,
      payload: { renameSlugTo: "stolen-slug" },
    });
    expect(res.statusCode, res.body).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    // The slug CTR-002 made immutable is still the one derived at
    // creation, and no row carries the one the mount asked for.
    expect((await probeTypeBySlug(probe.slug)).id).toBe(probe.id);
    expect((await listProbeTypes(true)).some((row) => row.slug === "stolen-slug")).toBe(false);
  });

  it("writes nothing and refuses nothing when the extras have no change to make", async () => {
    const probe = await addProbeType("Idle probe");
    const before = await harness.db
      .select()
      .from(activityLog)
      .where(inArray(activityLog.action, ["entity_type.updated", "entity_type.renamed"]))
      .orderBy(asc(activityLog.createdAt));

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/probe-types/${probe.id}`,
      cookies: adminCookies,
      payload: { isSystemDefault: false },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().probeType.isSystemDefault).toBe(false);

    const after = await harness.db
      .select()
      .from(activityLog)
      .where(inArray(activityLog.action, ["entity_type.updated", "entity_type.renamed"]))
      .orderBy(asc(activityLog.createdAt));
    expect(after).toHaveLength(before.length);
  });
});

describe("a mount with no protected slug", () => {
  it("still refuses `other` at the mount that names it protected", async () => {
    const other = await probeTypeBySlug("other");
    const archive = await app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${other.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archive.statusCode, archive.body).toBe(409);
    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/entity-types/${other.id}`,
      cookies: adminCookies,
    });
    expect(remove.statusCode, remove.body).toBe(409);
  });

  it("archives, restores, and hard-deletes a row whose slug is `other`", async () => {
    const other = await probeTypeBySlug("other");

    const archived = await app.inject({
      method: "POST",
      url: `/api/v1/probe-types/${other.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().probeType.archivedAt).not.toBeNull();

    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/probe-types/${other.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().probeType.archivedAt).toBeNull();

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/probe-types/${other.id}`,
      cookies: adminCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect((await listProbeTypes(true)).some((row) => row.slug === "other")).toBe(false);
  });
});
