// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The attachment machinery's per-mount scope rule (#352), at the HTTP
 * seam of a mount whose rule is a function of the type row. Request
 * types (#350) are the mount that will need it — their target decides
 * which catalog fields may attach (INT-002) — and this suite proves the
 * machinery serves such a rule before that mount exists.
 *
 * The probe mount below is the factory with a function rule, over the
 * `matter_type_fields` join table and beside the ordinary matter-types
 * mount in the same app. Two mounts over one table is the point:
 * everything the probe does that the plain mount does not is the rule,
 * not the table. The row state the rule reads — `is_system_default`, a
 * real column the machinery never writes — and the rule it encodes are
 * this suite's, not the product's. No schema lands for a test
 * (TECH-014's incremental rule), and no assertion here reaches past
 * the routes.
 *
 * That the two constant-rule mounts are unchanged is asserted where it
 * belongs: their own suites, unedited.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, fields, matterTypeFields, matterTypes } from "@openlaw/db";
import { buildApp } from "../app.js";
import { testDeps } from "../testing/deps.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../testing/harness.js";
import { typeFieldRoutes } from "./type-field-routes.js";

/** The refusal each arm of the probe rule speaks in its own words. */
const TARGETED_REFUSAL = "A targeted probe type takes contract-scoped and global fields only.";
const UNTARGETED_REFUSAL = "A probe type with no target takes global fields only.";

/**
 * The factory with a rule read off the type row.
 *
 * A row flagged `is_system_default` stands for a targeted request type
 * and takes contract-scoped and global fields; every other row stands
 * for an untargeted one and takes global fields only. Each arm carries
 * its own refusal line, so a refusal names the rule that refused rather
 * than one line for the whole mount.
 */
const probeAttachedFieldsRoutes = typeFieldRoutes({
  typesTable: matterTypes,
  joinTable: matterTypeFields,
  path: "probe-types",
  tag: "probe-types",
  idInfix: "ProbeType",
  noun: "probe type",
  scopeRule: (row) =>
    row.isSystemDefault
      ? { scopes: ["contract", "global"], refusal: TARGETED_REFUSAL }
      : { scopes: ["global"], refusal: UNTARGETED_REFUSAL },
  scopeSummary: "the scopes the type's own rule allows (#352)",
  actionPrefix: "matter_type_field",
  requiredMilestone: "M22",
});

let harness: TestHarness;
/** The harness's database, with the probe mount beside the plain one. */
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
  await app.register(probeAttachedFieldsRoutes, { prefix: "/api/v1" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await harness.stop();
});

/** Adds a type through the plain mount and answers its id. */
const addProbeType = async (displayName: string): Promise<string> => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ matterType: { id: string } }>().matterType.id;
};

/** Flips the row state the probe rule reads, between requests. */
const setTargeted = async (typeId: string, targeted: boolean) => {
  await harness.db
    .update(matterTypes)
    .set({ isSystemDefault: targeted })
    .where(eq(matterTypes.id, typeId));
};

/** Defines a catalog field through the Fields pane's own create route. */
const createField = async (displayName: string, moduleScope: "contract" | "global") => {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { displayName, moduleScope, fieldType: "text", fieldTag: "business" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ field: { id: string } }>().field.id;
};

const attach = (typeId: string, fieldId: string) =>
  app.inject({
    method: "POST",
    url: `/api/v1/probe-types/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId },
  });

const attachedSlugs = async (typeId: string): Promise<string[]> => {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/probe-types/${typeId}/fields`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ attachedFields: { slug: string }[] }>().attachedFields.map((row) => row.slug);
};

describe("a rule that is a function of the type row", () => {
  it("resolves it against the locked row: one mount, two answers", async () => {
    const targeted = await addProbeType("Targeted probe");
    const untargeted = await addProbeType("Untargeted probe");
    await setTargeted(targeted, true);
    const governingLaw = await createField("Probe governing law", "contract");

    const accepted = await attach(targeted, governingLaw);
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json().attachedField).toMatchObject({ moduleScope: "contract" });

    const refused = await attach(untargeted, governingLaw);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(await attachedSlugs(untargeted)).toEqual([]);
  });

  it("reads the row's current state on every attach, never a cached rule", async () => {
    const type = await addProbeType("Re-pointed probe");
    const first = await createField("Probe contract value", "contract");
    const second = await createField("Probe contract owner", "contract");

    const beforeTargeting = await attach(type, first);
    expect(beforeTargeting.statusCode, beforeTargeting.body).toBe(400);

    await setTargeted(type, true);
    const whileTargeted = await attach(type, first);
    expect(whileTargeted.statusCode, whileTargeted.body).toBe(201);

    // Back to the untargeted rule: the same mount, the same field
    // scope, and now a refusal again.
    await setTargeted(type, false);
    const afterUntargeting = await attach(type, second);
    expect(afterUntargeting.statusCode, afterUntargeting.body).toBe(400);
    expect(await attachedSlugs(type)).toEqual(["probe_contract_value"]);
  });

  it("refuses with the rule's own line, as an RFC 9457 problem", async () => {
    const targeted = await addProbeType("Speaking probe");
    const untargeted = await addProbeType("Silent probe");
    await setTargeted(targeted, true);
    // The catalog's create route offers no entity scope, so plant the
    // row directly — the schema allows what the API gates.
    const [entityField] = await harness.db
      .insert(fields)
      .values({
        slug: "probe_registered_office",
        displayName: "Probe registered office",
        moduleScope: "entity",
        fieldType: "text",
        fieldTag: "legal",
      })
      .returning();
    const contractField = await createField("Probe counterparty name", "contract");

    // The targeted arm refuses the entity scope in its own words.
    const outsideTargeted = await attach(targeted, entityField!.id);
    expect(outsideTargeted.statusCode, outsideTargeted.body).toBe(400);
    expect(outsideTargeted.headers["content-type"]).toContain("application/problem+json");
    expect(outsideTargeted.json()).toMatchObject({ status: 400, detail: TARGETED_REFUSAL });

    // The untargeted arm refuses a scope the targeted arm allows, and
    // says something else — the line belongs to the rule, not the mount.
    const outsideUntargeted = await attach(untargeted, contractField);
    expect(outsideUntargeted.statusCode, outsideUntargeted.body).toBe(400);
    expect(outsideUntargeted.headers["content-type"]).toContain("application/problem+json");
    expect(outsideUntargeted.json()).toMatchObject({ status: 400, detail: UNTARGETED_REFUSAL });
  });
});

/** As much of the generated document as these assertions read. */
interface SummaryDocument {
  paths: Record<string, Record<string, { summary: string }>>;
}

describe("the OpenAPI document", () => {
  /** The attach operation's summary at one mount's path. */
  const attachSummary = async (path: string): Promise<string> => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode, res.body).toBe(200);
    const operation = res.json<SummaryDocument>().paths[`/api/v1/${path}/{id}/fields`]?.post;
    expect(operation, path).toBeDefined();
    return operation!.summary;
  };

  it("reads the function mount's static scope description, not any one row's rule", async () => {
    const summary = await attachSummary("probe-types");
    expect(summary).toContain("the scopes the type's own rule allows (#352)");
    expect(summary).not.toContain("target");
  });

  it("leaves a constant mount's summary as it has always been", async () => {
    expect(await attachSummary("contract-types")).toContain(
      "contract-scoped and global fields only (CTR-016)",
    );
    expect(await attachSummary("matter-types")).toContain(
      "global fields only until M22 opens the matter scope (MTR-011)",
    );
  });
});
