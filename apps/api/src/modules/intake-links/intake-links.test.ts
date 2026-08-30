// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Deflection links (#356): the INT-004 panel's configuration.
 * Create, update, reorder, and remove, with the two placements (the
 * portal home and one request type), the absolute-http(s) URL rule, and
 * SET-002's one role gate. Every mutation appends to the activity log
 * (DD-017), asserted at the HTTP seam plus direct `activity_log` reads,
 * the way the contract-statuses suite this one is modeled on does.
 *
 * A link has no archive and no guard: nothing points at one, so removal
 * is outright. What the suite does check on the way out is the FK:
 * hard-deleting a request type takes its links with it rather than
 * setting them loose on the portal home, which is a wider audience than
 * the Administrator chose.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  asc,
  eq,
  inArray,
  intakeLinks,
  knowledgeItems,
  knowledgeTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
/** The INT-002 seeds this suite places links on. */
let contractReviewId: string;
let ndaRequestId: string;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: adminCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  const bySlug = new Map<string, string>(
    types.json().requestTypes.map((row: { slug: string; id: string }) => [row.slug, row.id]),
  );
  contractReviewId = bySlug.get("contract_review")!;
  ndaRequestId = bySlug.get("nda_request")!;
});

afterAll(async () => {
  await harness.stop();
});

interface LinkRow {
  id: string;
  label: string;
  url: string | null;
  knowledgeItemId: string | null;
  knowledgeItemTitle: string | null;
  requestTypeId: string | null;
  displayOrder: number;
}

const listLinks = async (cookies = adminCookies): Promise<LinkRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/intake-links",
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().intakeLinks;
};

const createLink = async (payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "POST",
    url: "/api/v1/intake-links",
    cookies: adminCookies,
    payload,
  });

/** Creates a link and returns it, failing the test if it was refused. */
const addLink = async (payload: Record<string, unknown>): Promise<LinkRow> => {
  const res = await createLink(payload);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().intakeLink;
};

const patchLink = async (id: string, payload: Record<string, unknown>) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/intake-links/${id}`,
    cookies: adminCookies,
    payload,
  });

const reorder = async (ids: string[]) =>
  harness.app.inject({
    method: "PUT",
    url: "/api/v1/intake-links/order",
    cookies: adminCookies,
    payload: { ids },
  });

const removeLink = async (id: string) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/intake-links/${id}`,
    cookies: adminCookies,
  });

/** Adds a request type of this suite's own, returning its id. */
const addRequestType = async (displayName: string): Promise<string> => {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().requestType.id;
};

const archiveRequestType = async (id: string): Promise<void> => {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/request-types/${id}/archive`,
    cookies: adminCookies,
    payload: {},
  });
  expect(res.statusCode, res.body).toBe(200);
};

const auditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "intake_link.created",
        "intake_link.updated",
        "intake_link.reordered",
        "intake_link.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

/** The panel starts empty each time: no link is seeded (INT-004, there
 * is no sensible default URL), and a suite that shared rows between
 * tests would be asserting on the order the tests happen to run in. */
beforeEach(async () => {
  await harness.db.delete(intakeLinks);
  await harness.db
    .delete(activityLog)
    .where(
      inArray(activityLog.action, [
        "intake_link.created",
        "intake_link.updated",
        "intake_link.reordered",
        "intake_link.deleted",
      ]),
    );
});

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/intake-links" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const link = await addLink({ label: "NDA FAQ", url: "https://wiki.example.com/nda" });
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/intake-links", cookies }),
      harness.app.inject({
        method: "GET",
        url: "/api/v1/intake-links/knowledge-options",
        cookies,
      }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/intake-links",
        cookies,
        payload: { label: "Sneaky", url: "https://example.com/sneaky" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/intake-links/${link.id}`,
        cookies,
        payload: { label: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/intake-links/order",
        cookies,
        payload: { ids: [link.id] },
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/intake-links/${link.id}`,
        cookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    expect(await listLinks()).toEqual([link]);
  });
});

describe("GET /intake-links", () => {
  it("starts empty — no link is seeded", async () => {
    expect(await listLinks()).toEqual([]);
  });

  it("lists both placements as one panel-ordered list", async () => {
    const home = await addLink({ label: "Purchasing policy", url: "https://wiki.example.com/buy" });
    const onType = await addLink({
      label: "Standard contract templates",
      url: "https://wiki.example.com/templates",
      requestTypeId: contractReviewId,
    });
    expect((await listLinks()).map((row) => [row.id, row.displayOrder])).toEqual([
      [home.id, 1],
      [onType.id, 2],
    ]);
  });
});

describe("POST /intake-links", () => {
  it("creates a link on the portal home and appends it to the order", async () => {
    const first = await addLink({
      label: "NDA FAQ — when you don't need legal",
      url: "https://wiki.example.com/legal/nda-faq",
    });
    expect(first.label).toBe("NDA FAQ — when you don't need legal");
    expect(first.url).toBe("https://wiki.example.com/legal/nda-faq");
    // Null is the portal home panel (INT-004).
    expect(first.requestTypeId).toBeNull();
    expect(first.displayOrder).toBe(1);

    const second = await addLink({ label: "Second", url: "https://example.com/2" });
    expect(second.displayOrder).toBe(2);
  });

  it("creates a link on a live request type", async () => {
    const link = await addLink({
      label: "Standard contract templates",
      url: "https://wiki.example.com/legal/templates",
      requestTypeId: contractReviewId,
    });
    expect(link.requestTypeId).toBe(contractReviewId);
  });

  it("stores the URL exactly as entered, keeping its path, query, and fragment", async () => {
    const url = "https://Wiki.Example.com/Legal/NDA-FAQ?tab=2#top";
    const link = await addLink({ label: "As entered", url });
    expect(link.url).toBe(url);
  });

  it("refuses a malformed or non-http(s) URL, naming what to type instead", async () => {
    for (const url of [
      "wiki.example.com/legal",
      "/legal/nda",
      "not a url",
      "ftp://files.example.com/policy.pdf",
      "mailto:legal@example.com",
      "javascript:alert(1)",
      "https://",
    ]) {
      const res = await createLink({ label: "Bad", url });
      expect(res.statusCode, `${url} → ${res.body}`).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    expect((await createLink({ label: "Bad", url: "wiki.example.com" })).json().detail).toContain(
      "http://",
    );
    expect(await listLinks()).toEqual([]);
  });

  it("takes a plain http URL — an intranet page is a fine deflection", async () => {
    const link = await addLink({ label: "Intranet", url: "http://wiki/legal/nda" });
    expect(link.url).toBe("http://wiki/legal/nda");
  });

  it("rejects a blank label", async () => {
    const res = await createLink({ label: "   ", url: "https://example.com/x" });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses a request type that does not exist", async () => {
    const res = await createLink({
      label: "Nowhere",
      url: "https://example.com/x",
      requestTypeId: "01a01b9d-0000-7000-8000-000000000000",
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(await listLinks()).toEqual([]);
  });

  it("refuses an archived request type — a link is placed on a live form or the home", async () => {
    const retiredId = await addRequestType("Retired request");
    await archiveRequestType(retiredId);
    const res = await createLink({
      label: "Nobody's form",
      url: "https://example.com/x",
      requestTypeId: retiredId,
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("archived");
    expect(await listLinks()).toEqual([]);
  });

  it("narrates the creation, naming the placement rather than its id", async () => {
    await addLink({
      label: "Standard contract templates",
      url: "https://wiki.example.com/templates",
      requestTypeId: contractReviewId,
    });
    await addLink({ label: "Purchasing policy", url: "https://wiki.example.com/buy" });
    const rows = await auditRows();
    expect(rows.map((row) => row.action)).toEqual(["intake_link.created", "intake_link.created"]);
    expect(rows[0]!.visibility).toBe("admin_only");
    expect(rows[0]!.entityType).toBe("system");
    expect(rows[0]!.payload).toMatchObject({
      label: "Standard contract templates",
      url: "https://wiki.example.com/templates",
      placement: "Contract review",
    });
    // The portal home is the null placement, in the log as on the wire.
    expect(rows[1]!.payload).toMatchObject({ label: "Purchasing policy", placement: null });
  });
});

describe("PATCH /intake-links/:id", () => {
  it("edits the label and the URL", async () => {
    const link = await addLink({ label: "Old", url: "https://example.com/old" });
    const res = await patchLink(link.id, {
      label: "New",
      url: "https://example.com/new",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().intakeLink).toMatchObject({
      label: "New",
      url: "https://example.com/new",
      displayOrder: 1,
    });
  });

  it("moves a link from the portal home onto a request type, and back", async () => {
    const link = await addLink({ label: "Templates", url: "https://example.com/t" });
    const onto = await patchLink(link.id, { requestTypeId: contractReviewId });
    expect(onto.statusCode, onto.body).toBe(200);
    expect(onto.json().intakeLink.requestTypeId).toBe(contractReviewId);

    const home = await patchLink(link.id, { requestTypeId: null });
    expect(home.statusCode, home.body).toBe(200);
    expect(home.json().intakeLink.requestTypeId).toBeNull();
  });

  it("refuses a URL that is not an absolute http(s) address, leaving the row alone", async () => {
    const link = await addLink({ label: "Policy", url: "https://example.com/policy" });
    const res = await patchLink(link.id, { url: "wiki.example.com/policy" });
    expect(res.statusCode, res.body).toBe(400);
    expect((await listLinks())[0]!.url).toBe("https://example.com/policy");
  });

  it("refuses a request type that does not exist", async () => {
    const link = await addLink({ label: "Policy", url: "https://example.com/policy" });
    const res = await patchLink(link.id, {
      requestTypeId: "01a01b9d-0000-7000-8000-000000000000",
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await listLinks())[0]!.requestTypeId).toBeNull();
  });

  /**
   * The live rule cuts one way: a move must land on a live request
   * type, but a link placed while the type was live stays put when the
   * type is archived afterwards. An edit of its label, with the
   * placement re-sent unchanged as the dialog sends it, must not
   * refuse. The ST13 picker keeps the archived type on offer for
   * exactly that row.
   */
  it("refuses a move onto an archived request type, but not an edit of a link already there", async () => {
    const sunsetId = await addRequestType("Sunset request");
    const resident = await addLink({
      label: "Old guidance",
      url: "https://example.com/old",
      requestTypeId: sunsetId,
    });
    const wanderer = await addLink({ label: "Wanderer", url: "https://example.com/w" });
    await archiveRequestType(sunsetId);

    const moved = await patchLink(wanderer.id, { requestTypeId: sunsetId });
    expect(moved.statusCode, moved.body).toBe(400);
    expect(moved.json().detail).toContain("archived");
    expect((await listLinks()).map((row) => row.requestTypeId)).toEqual([sunsetId, null]);

    const edited = await patchLink(resident.id, {
      label: "Old guidance (retired)",
      requestTypeId: sunsetId,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().intakeLink).toMatchObject({
      label: "Old guidance (retired)",
      requestTypeId: sunsetId,
    });
  });

  it("refuses an unknown key and an empty body", async () => {
    const link = await addLink({ label: "Policy", url: "https://example.com/policy" });
    expect((await patchLink(link.id, { displayOrder: 5 })).statusCode).toBe(400);
    expect((await patchLink(link.id, {})).statusCode).toBe(400);
  });

  it("404s for an id that is not there", async () => {
    const res = await patchLink("01a01b9d-0000-7000-8000-000000000000", { label: "Ghost" });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("narrates each changed dimension, and writes nothing for a no-op edit", async () => {
    const link = await addLink({
      label: "Templates",
      url: "https://example.com/t",
      requestTypeId: contractReviewId,
    });
    const noop = await patchLink(link.id, { label: "Templates" });
    expect(noop.statusCode, noop.body).toBe(200);

    await patchLink(link.id, {
      label: "Contract templates",
      url: "https://example.com/templates",
      requestTypeId: null,
    });
    const rows = (await auditRows()).filter((row) => row.action === "intake_link.updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      label: "Contract templates",
      changed: {
        label: { from: "Templates", to: "Contract templates" },
        url: { from: "https://example.com/t", to: "https://example.com/templates" },
        // The placement reads as a name on both sides, and null is the
        // portal home. An id would say nothing to a later reader.
        placement: { from: "Contract review", to: null },
      },
    });
  });
});

describe("PUT /intake-links/order", () => {
  it("applies a full permutation and renumbers from 1", async () => {
    const first = await addLink({ label: "First", url: "https://example.com/1" });
    const second = await addLink({ label: "Second", url: "https://example.com/2" });
    const third = await addLink({
      label: "Third",
      url: "https://example.com/3",
      requestTypeId: ndaRequestId,
    });

    const res = await reorder([third.id, first.id, second.id]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().intakeLinks.map((row: LinkRow) => [row.label, row.displayOrder])).toEqual([
      ["Third", 1],
      ["First", 2],
      ["Second", 3],
    ]);
    expect((await listLinks()).map((row) => row.label)).toEqual(["Third", "First", "Second"]);
  });

  it("refuses a partial list, a duplicate, and an id that is not there", async () => {
    const first = await addLink({ label: "First", url: "https://example.com/1" });
    const second = await addLink({ label: "Second", url: "https://example.com/2" });
    for (const ids of [
      [first.id],
      [first.id, first.id],
      [first.id, second.id, "01a01b9d-0000-7000-8000-000000000000"],
    ]) {
      const res = await reorder(ids);
      expect(res.statusCode, res.body).toBe(400);
    }
    expect((await listLinks()).map((row) => row.label)).toEqual(["First", "Second"]);
  });

  it("narrates a real move by label, and writes nothing for an order that changed nothing", async () => {
    const first = await addLink({ label: "First", url: "https://example.com/1" });
    const second = await addLink({ label: "Second", url: "https://example.com/2" });
    expect((await reorder([first.id, second.id])).statusCode).toBe(200);
    expect((await auditRows()).filter((row) => row.action === "intake_link.reordered")).toEqual([]);

    expect((await reorder([second.id, first.id])).statusCode).toBe(200);
    const rows = (await auditRows()).filter((row) => row.action === "intake_link.reordered");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ order: ["Second", "First"] });
  });
});

describe("DELETE /intake-links/:id", () => {
  it("removes the link outright — there is no archive", async () => {
    const link = await addLink({ label: "Dead URL", url: "https://example.com/gone" });
    const res = await removeLink(link.id);
    expect(res.statusCode, res.body).toBe(204);
    expect(res.body).toBe("");
    expect(await listLinks()).toEqual([]);
  });

  it("404s for an id that is not there", async () => {
    const res = await removeLink("01a01b9d-0000-7000-8000-000000000000");
    expect(res.statusCode, res.body).toBe(404);
  });

  it("narrates the removal with the label, the URL, and the placement", async () => {
    const link = await addLink({
      label: "Standard contract templates",
      url: "https://example.com/t",
      requestTypeId: contractReviewId,
    });
    expect((await removeLink(link.id)).statusCode).toBe(204);
    const rows = (await auditRows()).filter((row) => row.action === "intake_link.deleted");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      label: "Standard contract templates",
      url: "https://example.com/t",
      placement: "Contract review",
    });
  });
});

describe("the request-type FK", () => {
  /**
   * Hard-deleting a request type takes its links with it, rather than
   * setting them loose on the portal home. `on delete set null`, the
   * rule the sibling target FKs on `request_types` follow, would
   * publish a link the Administrator scoped to one form to every
   * requester who opens the portal, and widening an audience is not a
   * demotion.
   */
  it("takes a type's links with the type, and leaves the portal home's alone", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName: "Doomed request" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const doomedId: string = created.json().requestType.id;

    const onType = await addLink({
      label: "Only on that form",
      url: "https://example.com/form",
      requestTypeId: doomedId,
    });
    const onHome = await addLink({ label: "On the home", url: "https://example.com/home" });

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/request-types/${doomedId}`,
      cookies: adminCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);

    const rows = await listLinks();
    expect(rows.map((row) => row.id)).toEqual([onHome.id]);
    expect(rows.some((row) => row.id === onType.id)).toBe(false);
  });
});

describe("a Knowledge deflection link (M28)", () => {
  async function addKnowledgeItem(
    title: string,
    options: { state?: "draft" | "published"; audience?: "legal_only" | "everyone" } = {},
  ) {
    const [admin] = await harness.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN.email))
      .limit(1);
    const [playbook] = await harness.db
      .select({ id: knowledgeTypes.id })
      .from(knowledgeTypes)
      .where(eq(knowledgeTypes.slug, "playbook"))
      .limit(1);
    const [item] = await harness.db
      .insert(knowledgeItems)
      .values({
        title,
        knowledgeTypeId: playbook!.id,
        state: options.state ?? "published",
        audience: options.audience ?? "everyone",
        publishedAt: options.state === "draft" ? null : new Date(),
        createdBy: admin!.id,
        updatedBy: admin!.id,
      })
      .returning({ id: knowledgeItems.id });
    return item!.id;
  }

  it("accepts exactly one target and defaults an internal label to the item title", async () => {
    const itemId = await addKnowledgeItem("When you do not need an NDA");
    for (const payload of [
      { label: "Neither" },
      { label: "Both", url: "https://example.com", knowledgeItemId: itemId },
    ]) {
      const refused = await createLink(payload);
      expect(refused.statusCode, refused.body).toBe(400);
    }

    const created = await createLink({ knowledgeItemId: itemId });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().intakeLink).toMatchObject({
      label: "When you do not need an NDA",
      url: null,
      knowledgeItemId: itemId,
      knowledgeItemTitle: "When you do not need an NDA",
    });

    const external = await addLink({ label: "External", url: "https://example.com/faq" });
    expect(external).toMatchObject({ knowledgeItemId: null, knowledgeItemTitle: null });
    expect((await listLinks()).map((row) => row.id)).toEqual([
      created.json().intakeLink.id,
      external.id,
    ]);
  });

  it("offers only published Everyone items in the picker", async () => {
    const reachable = await addKnowledgeItem("Reachable answer");
    await addKnowledgeItem("Draft answer", { state: "draft" });
    await addKnowledgeItem("Legal answer", { audience: "legal_only" });
    const archived = await addKnowledgeItem("Archived answer");
    await harness.db
      .update(knowledgeItems)
      .set({ archivedAt: new Date() })
      .where(eq(knowledgeItems.id, archived));

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/intake-links/knowledge-options",
      cookies: adminCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().knowledgeItems).toEqual(
      expect.arrayContaining([{ id: reachable, title: "Reachable answer" }]),
    );
    expect(response.json().knowledgeItems.map((row: { title: string }) => row.title)).not.toEqual(
      expect.arrayContaining(["Draft answer", "Legal answer", "Archived answer"]),
    );
  });

  it("switches targets, keeps an internal row when it loses reach, and lets it be repaired", async () => {
    const firstId = await addKnowledgeItem("First answer");
    const secondId = await addKnowledgeItem("Second answer");
    const internal = await addLink({ label: "Editable label", knowledgeItemId: firstId });

    const external = await patchLink(internal.id, { url: "https://example.com/replacement" });
    expect(external.statusCode, external.body).toBe(200);
    expect(external.json().intakeLink).toMatchObject({
      url: "https://example.com/replacement",
      knowledgeItemId: null,
    });
    const internalAgain = await patchLink(internal.id, { knowledgeItemId: firstId });
    expect(internalAgain.statusCode, internalAgain.body).toBe(200);
    expect(internalAgain.json().intakeLink).toMatchObject({
      url: null,
      knowledgeItemId: firstId,
      label: "Editable label",
    });

    await harness.db
      .update(knowledgeItems)
      .set({ state: "draft", publishedAt: null })
      .where(eq(knowledgeItems.id, firstId));
    expect((await listLinks())[0]).toMatchObject({ knowledgeItemId: firstId });
    const relabel = await patchLink(internal.id, { label: "Still configured" });
    expect(relabel.statusCode, relabel.body).toBe(200);
    const repaired = await patchLink(internal.id, { knowledgeItemId: secondId });
    expect(repaired.statusCode, repaired.body).toBe(200);
    expect(repaired.json().intakeLink.knowledgeItemTitle).toBe("Second answer");
  });

  it("rejects an internal target that cannot pass the portal gate", async () => {
    const draft = await addKnowledgeItem("Draft target", { state: "draft" });
    const legalOnly = await addKnowledgeItem("Legal target", { audience: "legal_only" });
    for (const knowledgeItemId of [draft, legalOnly, "00000000-0000-7000-8000-000000000000"]) {
      const refused = await createLink({ label: "Unavailable", knowledgeItemId });
      expect(refused.statusCode, refused.body).toBe(400);
    }
  });

  it("reorders and removes internal and external rows as one list", async () => {
    const itemId = await addKnowledgeItem("Internal answer");
    const internal = await addLink({ label: "Internal", knowledgeItemId: itemId });

    const external = await addLink({ label: "External", url: "https://example.com/faq" });
    expect((await reorder([external.id, internal.id])).statusCode).toBe(200);
    expect((await listLinks()).map((row) => row.id)).toEqual([external.id, internal.id]);
    expect((await removeLink(internal.id)).statusCode).toBe(204);
    expect((await listLinks()).map((row) => row.id)).toEqual([external.id]);
  });
});
