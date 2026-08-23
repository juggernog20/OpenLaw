// SPDX-License-Identifier: AGPL-3.0-only

/** #488 ticket 2: the Contributor supporting-Document grid at the HTTP seam. */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentVersions, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "contributor-paper-member@example.com",
  displayName: "Mina Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "contributor-paper-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

type Owner = {
  type: "matter" | "contract";
  id: string;
  number: number;
};
type Version = {
  id: string;
  versionNumber: number;
  checksumSha256: string;
  uploadedBy: { id: string };
};
type Document = {
  id: string;
  title: string;
  isPrimary: boolean;
  isConfidential: boolean;
  createdBy: { id: string };
  archivedAt: string | null;
  versions: Version[];
};

let harness: TestHarness;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let memberId: string;
let contributorId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, person.id));
    if (fixture === MEMBER) memberId = person.id;
    else contributorId = person.id;
  }

  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
});

afterAll(async () => {
  await harness.stop();
});

async function createOwner(type: Owner["type"], title: string): Promise<Owner> {
  const options = await harness.app.inject({
    method: "GET",
    url: `/api/v1/${type}s/options`,
    cookies: memberCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  const optionName = type === "matter" ? "matterTypes" : "contractTypes";
  const [recordType] = options.json()[optionName] as { id: string }[];
  const payload =
    type === "matter"
      ? { title, matterTypeId: recordType!.id, managerId: memberId }
      : { title, contractTypeId: recordType!.id };
  const created = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${type}s`,
    cookies: memberCookies,
    payload,
  });
  expect(created.statusCode, created.body).toBe(201);
  const row = created.json()[type] as { id: string; number: number };
  return { type, id: row.id, number: row.number };
}

async function addContributor(owner: Owner): Promise<void> {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${owner.type}s/${owner.number}/team`,
    cookies: memberCookies,
    payload: { userId: contributorId, role: "contributor" },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function removeContributor(owner: Owner): Promise<void> {
  const response = await harness.app.inject({
    method: "DELETE",
    url: `/api/v1/${owner.type}s/${owner.number}/team/${contributorId}/contributor`,
    cookies: memberCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
}

const BOUNDARY = "openlaw-contributor-paper-boundary";

function uploadBody(
  filename: string,
  content: Buffer,
  destination?: { folderId?: string; folderPath?: string },
) {
  const fields = [
    ["kind", "draft_ours"],
    ...(destination?.folderId ? [["folderId", destination.folderId]] : []),
    ...(destination?.folderPath ? [["folderPath", destination.folderPath]] : []),
  ];
  const chunks: Buffer[] = fields.map(([name, value]) =>
    Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  chunks.push(
    Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "content-type: application/pdf\r\n\r\n",
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  );
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

function upload(
  cookies: Record<string, string>,
  owner: Owner,
  filename: string,
  content: Buffer,
  destination?: { folderId?: string; folderPath?: string },
) {
  const form = uploadBody(filename, content, destination);
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/${owner.type}s/${owner.number}/documents`,
    cookies,
    headers: form.headers,
    payload: form.payload,
  });
}

function append(
  cookies: Record<string, string>,
  documentId: string,
  filename: string,
  content: Buffer,
) {
  const form = uploadBody(filename, content);
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies,
    headers: form.headers,
    payload: form.payload,
  });
}

async function uploaded(
  cookies: Record<string, string>,
  owner: Owner,
  filename: string,
  content = Buffer.from(`%PDF-1.7 ${filename}`),
): Promise<Document> {
  const response = await upload(cookies, owner, filename, content);
  expect(response.statusCode, response.body).toBe(201);
  return response.json().document as Document;
}

function documents(cookies: Record<string, string>, owner: Owner) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/${owner.type}s/${owner.number}/documents`,
    cookies,
  });
}

function download(cookies: Record<string, string>, documentId: string, versionId: string) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/download`,
    cookies,
  });
}

async function blobBytes(documentId: string, versionId: string): Promise<Buffer> {
  const [row] = await harness.db
    .select({ fileRef: documentVersions.fileRef })
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId));
  expect(row, `stored version ${versionId} on ${documentId}`).toBeDefined();
  const stream = await harness.storage.get(row!.fileRef);
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function waitForDerivedText(documentId: string, versionId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/versions/${versionId}/text`,
      cookies: contributorCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    const state = (response.json().text as { state: string }).state;
    if (state !== "pending") {
      expect(state).toBe("ready");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Derived text for ${versionId} did not finish.`);
}

async function feed(owner: Owner) {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=${owner.type}&entityId=${owner.id}`,
    cookies: contributorCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().entries as {
    action: string;
    actor: { id: string } | null;
    payload: Record<string, unknown>;
  }[];
}

async function archiveOwner(owner: Owner): Promise<void> {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${owner.type}s/${owner.number}/archive`,
    cookies: memberCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
}

for (const ownerType of ["matter", "contract"] as const) {
  describe(`Contributor supporting Documents on a ${ownerType}`, () => {
    it("creates a supporting Document and appends a Version with the ordinary storage, derivation, and narration", async () => {
      const owner = await createOwner(ownerType, `${ownerType}: Contributor supporting paper`);
      await addContributor(owner);

      // A Contract already has an instrument. The Contributor's upload must stay beside it.
      if (owner.type === "contract") await uploaded(memberCookies, owner, "primary.pdf");

      const firstBytes = Buffer.from(`%PDF-1.7 ${ownerType} supporting bytes \u0000\u0001`, "utf8");
      const createdResponse = await upload(contributorCookies, owner, "supporting.pdf", firstBytes);
      expect(createdResponse.statusCode, createdResponse.body).toBe(201);
      const created = createdResponse.json().document as Document;
      const first = created.versions.at(-1)!;
      expect(created.isPrimary).toBe(false);
      expect(created.createdBy.id).toBe(contributorId);
      expect(first.uploadedBy.id).toBe(contributorId);
      expect(first.checksumSha256).toBe(createHash("sha256").update(firstBytes).digest("hex"));
      expect((await blobBytes(created.id, first.id)).equals(firstBytes)).toBe(true);
      expect(
        (await download(contributorCookies, created.id, first.id)).rawPayload.equals(firstBytes),
      ).toBe(true);
      await waitForDerivedText(created.id, first.id);

      const secondBytes = Buffer.from(`%PDF-1.7 ${ownerType} supporting version two`);
      const appended = await append(
        contributorCookies,
        created.id,
        "supporting-v2.pdf",
        secondBytes,
      );
      expect(appended.statusCode, appended.body).toBe(201);
      const updated = appended.json().document as Document;
      const second = updated.versions.at(-1)!;
      expect(second.versionNumber).toBe(2);
      expect(second.uploadedBy.id).toBe(contributorId);
      expect(second.checksumSha256).toBe(createHash("sha256").update(secondBytes).digest("hex"));
      expect((await blobBytes(created.id, second.id)).equals(secondBytes)).toBe(true);
      await waitForDerivedText(created.id, second.id);

      const entries = await feed(owner);
      for (const action of ["document.created", "document.version_added"]) {
        const entry = entries.find(
          (candidate) => candidate.action === action && candidate.payload.documentId === created.id,
        );
        expect(entry, action).toMatchObject({
          actor: { id: contributorId },
          payload: { actorRole: "contributor" },
        });
      }
    });

    it("refuses every Document-administration boundary while leaving supporting uploads open", async () => {
      const owner = await createOwner(ownerType, `${ownerType}: Contributor Document boundaries`);
      await addContributor(owner);
      const first = await uploaded(memberCookies, owner, "member-paper.pdf");
      const [version] = first.versions;

      const calls = [
        harness.app.inject({
          method: "PATCH",
          url: `/api/v1/documents/${first.id}`,
          cookies: contributorCookies,
          payload: { isConfidential: true },
        }),
        harness.app.inject({
          method: "PATCH",
          url: `/api/v1/documents/${first.id}/versions/${version!.id}`,
          cookies: contributorCookies,
          payload: { kind: "redline_theirs" },
        }),
        harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${first.id}/primary`,
          cookies: contributorCookies,
        }),
        harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${first.id}/executed-version`,
          cookies: contributorCookies,
          payload: { versionId: version!.id },
        }),
        harness.app.inject({
          method: "DELETE",
          url: `/api/v1/documents/${first.id}/executed-version`,
          cookies: contributorCookies,
        }),
        harness.app.inject({
          method: "POST",
          url: `/api/v1/${owner.type}s/${owner.number}/folders`,
          cookies: contributorCookies,
          payload: { name: "Contributor folder" },
        }),
        harness.app.inject({
          method: "POST",
          url:
            "/api/v1/comments/00000000-0000-7000-8000-000000000001/attachments/00000000-0000-7000-8000-000000000002/file" +
            `?entityType=${owner.type}&entityId=${owner.id}`,
          cookies: contributorCookies,
          payload: {
            destination: "new_document",
            kind: "draft_ours",
            name: "Filed by Contributor",
            isConfidential: false,
          },
        }),
        harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${first.id}/archive`,
          cookies: contributorCookies,
        }),
        harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${first.id}/restore`,
          cookies: contributorCookies,
        }),
        harness.app.inject({
          method: "DELETE",
          url: `/api/v1/documents/${first.id}`,
          cookies: contributorCookies,
          payload: { confirmTitle: first.title },
        }),
      ];
      for (const response of await Promise.all(calls)) {
        expect(response.statusCode, response.body).toBe(403);
      }

      const pathUpload = await upload(
        contributorCookies,
        owner,
        "folder-admin.pdf",
        Buffer.from("%PDF-1.7 no implicit folder administration"),
        { folderPath: "Contributor/Created" },
      );
      expect(pathUpload.statusCode, pathUpload.body).toBe(403);

      const folderResponse = await harness.app.inject({
        method: "POST",
        url: `/api/v1/${owner.type}s/${owner.number}/folders`,
        cookies: memberCookies,
        payload: { name: "Member folder" },
      });
      expect(folderResponse.statusCode, folderResponse.body).toBe(201);
      const [folder] = folderResponse.json().folders as { id: string }[];
      const filedUpload = await upload(
        contributorCookies,
        owner,
        "folder-choice.pdf",
        Buffer.from("%PDF-1.7 no folder selection"),
        { folderId: folder!.id },
      );
      expect(filedUpload.statusCode, filedUpload.body).toBe(403);

      if (owner.type === "contract") {
        const primaryAppend = await append(
          contributorCookies,
          first.id,
          "primary-v2.pdf",
          Buffer.from("%PDF-1.7 primary chain"),
        );
        expect(primaryAppend.statusCode, primaryAppend.body).toBe(403);
      }
    });

    it("freezes upload with the archived owning record and removes access with the team row", async () => {
      const owner = await createOwner(ownerType, `${ownerType}: live Contributor reach`);
      await addContributor(owner);
      if (owner.type === "contract") await uploaded(memberCookies, owner, "primary.pdf");
      const supporting = await uploaded(contributorCookies, owner, "reachable-supporting.pdf");
      const current = supporting.versions.at(-1)!;

      await archiveOwner(owner);
      const frozen = await upload(
        contributorCookies,
        owner,
        "late.pdf",
        Buffer.from("%PDF-1.7 too late"),
      );
      expect(frozen.statusCode, frozen.body).toBe(409);
      const frozenAppend = await append(
        contributorCookies,
        supporting.id,
        "late-version.pdf",
        Buffer.from("%PDF-1.7 too late for the chain"),
      );
      expect(frozenAppend.statusCode, frozenAppend.body).toBe(409);

      // Restore the owner so the team-row assertion is about reach, not the freeze.
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/${owner.type}s/${owner.number}/restore`,
        cookies: memberCookies,
      });
      expect(restored.statusCode, restored.body).toBe(200);
      await removeContributor(owner);

      expect((await documents(contributorCookies, owner)).statusCode).toBe(404);
      expect((await download(contributorCookies, supporting.id, current.id)).statusCode).toBe(404);
      const removedAppend = await append(
        contributorCookies,
        supporting.id,
        "after-removal-v2.pdf",
        Buffer.from("%PDF-1.7 removed from chain"),
      );
      expect(removedAppend.statusCode, removedAppend.body).toBe(404);
      const removed = await upload(
        contributorCookies,
        owner,
        "after-removal.pdf",
        Buffer.from("%PDF-1.7 removed"),
      );
      expect(removed.statusCode, removed.body).toBe(404);
    });
  });
}
