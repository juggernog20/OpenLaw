// SPDX-License-Identifier: AGPL-3.0-only

/** M28's file-first Knowledge HTTP contract (#598). */
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
  email: "knowledge-documents-member@example.com",
  displayName: "Knowledge Documents Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "knowledge-documents-contributor@example.com",
  displayName: "Knowledge Documents Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "knowledge-documents-business@example.com",
  displayName: "Knowledge Documents Business",
  password: "correct-horse-battery",
} as const;
const BOUNDARY = "knowledge-documents-boundary";

let harness: TestHarness;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let businessCookies: Record<string, string>;
let templateId: string;

function multipart(
  fields: Readonly<Record<string, string>>,
  files: readonly { filename: string; contentType: string; content: string }[],
) {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `content-type: ${file.contentType}\r\n\r\n${file.content}\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat(parts),
  };
}

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
  }
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);
  const [type] = await harness.db
    .select({ id: knowledgeTypes.id })
    .from(knowledgeTypes)
    .where(eq(knowledgeTypes.slug, "template"));
  templateId = type!.id;
}, 180_000);

afterAll(async () => harness.stop());

describe("file-first Knowledge", () => {
  it("creates one draft per file and exposes the primary format and owner in the repository", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/knowledge/from-files",
      cookies: memberCookies,
      ...multipart({ knowledgeTypeId: templateId }, [
        {
          filename: "Acquisition template.pdf",
          contentType: "application/pdf",
          content:
            "%PDF-1.4\n% openlaw-fake-doc-engine: template contains glacier indemnity phrase\n%%EOF",
        },
        {
          filename: "Board consent.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: "word bytes",
        },
        { filename: "Policy.txt", contentType: "text/plain", content: "policy" },
        { filename: "Schedule.csv", contentType: "text/csv", content: "schedule" },
        { filename: "Notice.eml", contentType: "message/rfc822", content: "Subject: Notice" },
      ]),
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().knowledgeItems).toHaveLength(5);
    expect(created.json().knowledgeItems.map((row: { title: string }) => row.title)).toEqual([
      "Acquisition template.pdf",
      "Board consent.docx",
      "Policy.txt",
      "Schedule.csv",
      "Notice.eml",
    ]);
    const first = created.json().knowledgeItems[0] as {
      id: string;
      primaryDocumentId: string;
    };

    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge?format=pdf",
      cookies: memberCookies,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().knowledgeItems).toEqual([
      expect.objectContaining({
        id: first.id,
        state: "draft",
        documentCount: 1,
        primaryDocument: expect.objectContaining({ id: first.primaryDocumentId }),
      }),
    ]);

    // A primary the table does not preview still lists: its format is
    // `other`, the same name every Document read answers with.
    const unfiltered = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge",
      cookies: memberCookies,
    });
    expect(unfiltered.statusCode, unfiltered.body).toBe(200);
    const schedule = unfiltered
      .json()
      .knowledgeItems.find((row: { title: string }) => row.title === "Schedule.csv");
    expect(schedule.primaryDocument.currentVersion.renderFamily).toBe("other");
    const bare = await harness.app.inject({
      method: "POST",
      url: "/api/v1/knowledge",
      cookies: memberCookies,
      payload: { title: "No paper yet", knowledgeTypeId: templateId },
    });
    expect(bare.statusCode, bare.body).toBe(201);
    const others = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge?format=other",
      cookies: memberCookies,
    });
    expect(others.statusCode, others.body).toBe(200);
    // Sorted before comparing: the five rows are written in one
    // transaction, so their `updated_at` values can land in the same
    // millisecond and the default sort's tie-break may order these two
    // either way. The claim under test is the format filter, not order.
    expect(
      others
        .json()
        .knowledgeItems.map((row: { title: string }) => row.title)
        .sort(),
    ).toEqual(["Policy.txt", "Schedule.csv"]);

    const repository = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents?owner=knowledge_item&record=${first.id}`,
      cookies: memberCookies,
    });
    expect(repository.statusCode, repository.body).toBe(200);
    expect(repository.json().documents[0].owner).toMatchObject({
      kind: "knowledge_item",
      id: first.id,
      reference: "Acquisition template.pdf",
    });
    const byRecordOnly = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents?record=${first.id}`,
      cookies: memberCookies,
    });
    expect(byRecordOnly.statusCode, byRecordOnly.body).toBe(200);
    expect(byRecordOnly.json().documents[0].id).toBe(first.primaryDocumentId);

    const foldersRefused = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents?owner=knowledge_item&record=${first.id}&folder=root`,
      cookies: memberCookies,
    });
    expect(foldersRefused.statusCode, foldersRefused.body).toBe(400);

    let documentHit: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 80 && !documentHit; attempt += 1) {
      const search = await harness.app.inject({
        method: "GET",
        url: "/api/v1/search?q=glacier+indemnity",
        cookies: memberCookies,
      });
      documentHit = search.json().results.find((row: { kind: string }) => row.kind === "document");
      if (!documentHit) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(documentHit).toMatchObject({
      kind: "document",
      ownerKind: "knowledge_item",
      ownerId: first.id,
    });
  });

  it("uploads and versions paper, previews PDF, reports rendition state, and enforces primary ownership", async () => {
    const make = (title: string) =>
      harness.app.inject({
        method: "POST",
        url: "/api/v1/knowledge",
        cookies: memberCookies,
        payload: { title, knowledgeTypeId: templateId },
      });
    const [firstItem, secondItem] = await Promise.all([make("First item"), make("Second item")]);
    const firstId = firstItem.json().knowledgeItem.id as string;
    const secondId = secondItem.json().knowledgeItem.id as string;

    const upload = async (itemId: string, filename: string, contentType: string) => {
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/v1/knowledge/${itemId}/documents`,
        cookies: memberCookies,
        ...multipart({}, [{ filename, contentType, content: `%PDF ${filename} bytes` }]),
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().document as {
        id: string;
        versions: Array<{ id: string; renderFamily: string }>;
      };
    };
    const first = await upload(firstId, "first.pdf", "application/pdf");
    const alternate = await upload(
      firstId,
      "alternate.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const foreign = await upload(secondId, "foreign.pdf", "application/pdf");

    const set = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${alternate.id}/primary`,
      cookies: memberCookies,
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(
      set.json().documents.find((row: { id: string }) => row.id === alternate.id).isPrimary,
    ).toBe(true);

    const cleared = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${firstId}`,
      cookies: memberCookies,
      payload: { primaryDocumentId: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().knowledgeItem.primaryDocument).toBeNull();
    const refused = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${firstId}`,
      cookies: memberCookies,
      payload: { primaryDocumentId: foreign.id },
    });
    expect(refused.statusCode, refused.body).toBe(400);

    const appended = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${first.id}/versions`,
      cookies: memberCookies,
      ...multipart({}, [
        { filename: "first-v2.pdf", contentType: "application/pdf", content: "%PDF v2" },
      ]),
    });
    expect(appended.statusCode, appended.body).toBe(201);
    expect(appended.json().document.versions).toHaveLength(2);
    const versionId = first.versions[0]!.id;
    const preview = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${first.id}/versions/${versionId}/preview`,
      cookies: memberCookies,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const rendition = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${alternate.id}/versions/${alternate.versions[0]!.id}/rendition`,
      cookies: memberCookies,
    });
    expect([200, 409]).toContain(rendition.statusCode);

    for (const cookies of [contributorCookies, businessCookies]) {
      for (const request of [
        harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${first.id}/versions`,
          cookies,
          ...multipart({}, [
            { filename: "no.pdf", contentType: "application/pdf", content: "%PDF" },
          ]),
        }),
        harness.app.inject({
          method: "GET",
          url: `/api/v1/documents/${first.id}/versions/${versionId}/preview`,
          cookies,
        }),
        harness.app.inject({
          method: "GET",
          url: `/api/v1/documents/${alternate.id}/versions/${alternate.versions[0]!.id}/rendition`,
          cookies,
        }),
      ]) {
        expect((await request).statusCode).toBe(403);
      }
    }
  });

  it("returns Knowledge and owned-Document search hits only to Member+", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/knowledge",
      cookies: memberCookies,
      payload: { title: "Orchid fallback guide", knowledgeTypeId: templateId },
    });
    const itemId = created.json().knowledgeItem.id as string;
    const itemSearch = await harness.app.inject({
      method: "GET",
      url: "/api/v1/search?q=orchid",
      cookies: memberCookies,
    });
    expect(itemSearch.statusCode, itemSearch.body).toBe(200);
    expect(itemSearch.json().results).toContainEqual(
      expect.objectContaining({ kind: "knowledge_item", id: itemId, state: "draft" }),
    );

    for (const cookies of [contributorCookies, businessCookies]) {
      const search = await harness.app.inject({
        method: "GET",
        url: "/api/v1/search?q=orchid",
        cookies,
      });
      expect(search.statusCode, search.body).toBe(200);
      expect(search.json().results).not.toContainEqual(
        expect.objectContaining({ kind: "knowledge_item" }),
      );
      for (const request of [
        harness.app.inject({
          method: "GET",
          url: `/api/v1/knowledge/${itemId}/documents`,
          cookies,
        }),
        harness.app.inject({
          method: "POST",
          url: `/api/v1/knowledge/${itemId}/documents`,
          cookies,
          ...multipart({}, [
            { filename: "no.pdf", contentType: "application/pdf", content: "%PDF" },
          ]),
        }),
        harness.app.inject({
          method: "POST",
          url: "/api/v1/knowledge/from-files",
          cookies,
          ...multipart({ knowledgeTypeId: templateId }, [
            { filename: "no.pdf", contentType: "application/pdf", content: "%PDF" },
          ]),
        }),
      ]) {
        expect((await request).statusCode).toBe(403);
      }
    }
  });
});
