// SPDX-License-Identifier: AGPL-3.0-only

/** M28/5's requester-facing Knowledge read and download gate (#603). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, knowledgeTypes, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "portal-knowledge-member@example.com",
  displayName: "Portal Knowledge Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "portal-knowledge-contributor@example.com",
  displayName: "Portal Knowledge Contributor",
  password: "correct-horse-battery",
} as const;
const REQUESTER = {
  email: "portal-knowledge-requester@example.com",
  displayName: "Portal Knowledge Requester",
  password: "correct-horse-battery",
} as const;
const BOUNDARY = "portal-knowledge-boundary";

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let playbookId: string;

function multipart(filename: string, content: string) {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `content-type: application/pdf\r\n\r\n${content}\r\n--${BOUNDARY}--\r\n`,
    ),
  };
}

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [REQUESTER, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
  }
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  requesterCookies = await signInCookies(harness.app, REQUESTER.email, REQUESTER.password);
  const [type] = await harness.db
    .select({ id: knowledgeTypes.id })
    .from(knowledgeTypes)
    .where(eq(knowledgeTypes.slug, "playbook"));
  playbookId = type!.id;
}, 180_000);

afterAll(async () => harness.stop());

async function createItem(title: string, audience: "legal_only" | "everyone") {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/knowledge",
    cookies: memberCookies,
    payload: { title, knowledgeTypeId: playbookId },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().knowledgeItem.id as string;
  if (audience === "everyone") {
    const updated = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${id}`,
      cookies: memberCookies,
      payload: { audience },
    });
    expect(updated.statusCode, updated.body).toBe(200);
  }
  return id;
}

async function publish(id: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/knowledge/${id}/publish`,
    cookies: memberCookies,
    payload: {},
  });
  expect(response.statusCode, response.body).toBe(200);
}

describe("GET /portal/knowledge/:id", () => {
  it("serves a published Everyone item to every signed-in role, with primary paper first", async () => {
    const id = await createItem("When an NDA is not needed", "everyone");
    const upload = async (filename: string, content: string) => {
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/knowledge/${id}/documents`,
        cookies: memberCookies,
        ...multipart(filename, content),
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().document as { id: string; versions: Array<{ id: string }> };
    };
    const other = await upload("appendix.pdf", "%PDF appendix");
    const primary = await upload("nda-guide.pdf", "%PDF first version");
    const next = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${primary.id}/versions`,
      cookies: memberCookies,
      ...multipart("nda-guide-v2.pdf", "%PDF current version"),
    });
    expect(next.statusCode, next.body).toBe(201);
    const currentVersionId = next.json().document.versions.at(-1).id as string;
    const pinned = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${primary.id}/primary`,
      cookies: memberCookies,
      payload: {},
    });
    expect(pinned.statusCode, pinned.body).toBe(200);
    const body = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${id}`,
      cookies: memberCookies,
      payload: { body: "## Read this first" },
    });
    expect(body.statusCode, body.body).toBe(200);
    await publish(id);

    for (const cookies of [adminCookies, memberCookies, contributorCookies, requesterCookies]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/portal/knowledge/${id}`,
        cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().knowledgeItem).toMatchObject({
        id,
        title: "When an NDA is not needed",
        body: "## Read this first",
        primaryDocument: { id: primary.id, title: "nda-guide.pdf" },
      });
      expect(response.json().knowledgeItem.documents.map((row: { id: string }) => row.id)).toEqual([
        primary.id,
        other.id,
      ]);
      expect(response.json().knowledgeItem.documents[0].currentVersion).toMatchObject({
        id: currentVersionId,
        originalFilename: "nda-guide-v2.pdf",
        downloadUrl: `/api/v1/portal/knowledge/${id}/documents/${primary.id}/download`,
      });
    }

    const download = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/knowledge/${id}/documents/${primary.id}/download`,
      cookies: requesterCookies,
    });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toBe("%PDF current version");
    expect(download.headers["content-disposition"]).toContain("nda-guide-v2.pdf");
  });

  it("answers draft, Legal Only, archived, and unknown items with the identical 404 body", async () => {
    const draft = await createItem("Draft answer", "everyone");
    const legalOnly = await createItem("Legal answer", "legal_only");
    await publish(legalOnly);
    const archived = await createItem("Archived answer", "everyone");
    await publish(archived);
    const archivedResponse = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${archived}/archive`,
      cookies: memberCookies,
      payload: {},
    });
    expect(archivedResponse.statusCode, archivedResponse.body).toBe(200);

    const responses = await Promise.all(
      [draft, legalOnly, archived, "00000000-0000-7000-8000-000000000000"].map((id) =>
        harness.app.inject({
          method: "GET",
          url: `/api/v1/portal/knowledge/${id}`,
          cookies: requesterCookies,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
    expect(new Set(responses.map((response) => response.body))).toHaveLength(1);
  });

  it("keeps both the item and download behind a session and the same item gate", async () => {
    const id = await createItem("Session-only answer", "everyone");
    const uploaded = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/documents`,
      cookies: memberCookies,
      ...multipart("session-only.pdf", "%PDF gated"),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const documentId = uploaded.json().document.id as string;

    const draftDownload = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/knowledge/${id}/documents/${documentId}/download`,
      cookies: requesterCookies,
    });
    expect(draftDownload.statusCode).toBe(404);
    await publish(id);
    const item = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/knowledge/${id}`,
    });
    const download = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/knowledge/${id}/documents/no-document/download`,
    });
    expect(item.statusCode).toBe(401);
    expect(download.statusCode).toBe(401);

    const reachableDownload = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/knowledge/${id}/documents/${documentId}/download`,
      cookies: requesterCookies,
    });
    expect(reachableDownload.statusCode, reachableDownload.body).toBe(200);

    const unpublished = await harness.app.inject({
      method: "POST",
      url: `/api/v1/knowledge/${id}/unpublish`,
      cookies: memberCookies,
      payload: {},
    });
    expect(unpublished.statusCode, unpublished.body).toBe(200);
    const lostReach = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/knowledge/${id}/documents/${documentId}/download`,
      cookies: requesterCookies,
    });
    expect(lostReach.statusCode).toBe(404);
    expect(lostReach.body).toBe(draftDownload.body);
  });
});
