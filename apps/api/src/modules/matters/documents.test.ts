// SPDX-License-Identifier: AGPL-3.0-only

/** M22/7's matter-owned paper at the HTTP and database seams. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentFolders, documents, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "matter-paper-member@example.com",
  displayName: "Mina Matter",
  password: "correct-horse-battery",
} as const;
const OUTSIDER = {
  email: "matter-paper-outsider@example.com",
  displayName: "Oscar Outside",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let memberId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  for (const fixture of [MEMBER, OUTSIDER]) {
    const person = await provisionUser(harness.app.auth, fixture);
    await harness.db
      .update(users)
      .set({ role: "legal_team_member" })
      .where(eq(users.id, person.id));
    if (fixture === MEMBER) memberId = person.id;
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
});

afterAll(async () => {
  await harness.stop();
});

async function newMatter(title: string) {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: memberCookies,
  });
  const [type] = options.json().matterTypes as { id: string }[];
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: memberCookies,
    payload: { title, matterTypeId: type!.id, managerId: memberId },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().matter as { id: string; number: number };
}

async function newContract(title: string) {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  const [type] = options.json().contractTypes as { id: string }[];
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: type!.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().contract as { id: string };
}

const BOUNDARY = "openlaw-matter-paper-boundary";

function uploadBody(
  filename: string,
  content: Buffer,
  folderPath?: string,
): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [
    Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n`,
    ),
  ];
  if (folderPath) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="folderPath"\r\n\r\n${folderPath}\r\n`,
      ),
    );
  }
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

async function upload(number: number, filename: string, path?: string) {
  const bytes = Buffer.from(`%PDF-1.7 matter paper ${filename}`);
  const form = uploadBody(filename, bytes, path);
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matters/${number}/documents`,
    cookies: memberCookies,
    headers: form.headers,
    payload: form.payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  return {
    bytes,
    document: response.json().document as {
      id: string;
      isPrimary: boolean;
      versions: { id: string; isExecuted: boolean }[];
    },
  };
}

describe("matter documents", () => {
  it("uploads, lists, downloads, previews, extracts text, and recreates a dropped folder path", async () => {
    const matter = await newMatter("Paper trail");
    const { bytes, document } = await upload(matter.number, "advice.pdf", "Disclosure/Expert");
    const [version] = document.versions;
    expect(document.isPrimary).toBe(false);
    expect(version!.isExecuted).toBe(false);

    const listed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/documents`,
      cookies: memberCookies,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().documents.map((row: { id: string }) => row.id)).toContain(document.id);

    for (const leaf of ["download", "preview"] as const) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${version!.id}/${leaf}`,
        cookies: memberCookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.rawPayload.equals(bytes)).toBe(true);
    }

    const deadline = Date.now() + 20_000;
    let text: { state: string; text: string | null } | undefined;
    while (Date.now() < deadline) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${version!.id}/text`,
        cookies: memberCookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      text = response.json().text;
      if (text?.state !== "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(text?.state).toBe("ready");
    expect(text?.text).toMatch(/\S/);

    const folders = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/folders`,
      cookies: memberCookies,
    });
    expect(folders.statusCode, folders.body).toBe(200);
    expect(folders.json().folders.map((row: { name: string }) => row.name)).toEqual([
      "Disclosure",
      "Expert",
    ]);
  });

  it("answers confidential matter paper as absent outside the matter team", async () => {
    const matter = await newMatter("Sensitive paper");
    const { document } = await upload(matter.number, "strategy.pdf");
    const [version] = document.versions;
    const flagged = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${document.id}`,
      cookies: memberCookies,
      payload: { isConfidential: true },
    });
    expect(flagged.statusCode, flagged.body).toBe(200);

    const list = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/documents`,
      cookies: outsiderCookies,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().documents).toEqual([]);
    for (const leaf of ["download", "preview", "text"] as const) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${version!.id}/${leaf}`,
        cookies: outsiderCookies,
      });
      expect(response.statusCode, response.body).toBe(404);
    }
  });

  it("answers paper on a confidential matter as absent outside the matter team", async () => {
    const matter = await newMatter("Confidential matter");
    const { document } = await upload(matter.number, "privileged.pdf");
    const [version] = document.versions;
    const walled = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matters/${matter.number}`,
      cookies: memberCookies,
      payload: { isConfidential: true },
    });
    expect(walled.statusCode, walled.body).toBe(200);

    // The flag is the matter's, not the document's: an open document on
    // a walled matter is still out of reach, because reach goes
    // through the owner.
    for (const leaf of ["documents", "folders"] as const) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/matters/${matter.number}/${leaf}`,
        cookies: outsiderCookies,
      });
      expect(response.statusCode, response.body).toBe(404);
    }
    for (const leaf of ["download", "preview", "text"] as const) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${version!.id}/${leaf}`,
        cookies: outsiderCookies,
      });
      expect(response.statusCode, response.body).toBe(404);
    }
    const onTeam = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version!.id}/download`,
      cookies: memberCookies,
    });
    expect(onTeam.statusCode, onTeam.body).toBe(200);
  });

  it("refuses the primary and executed designations on matter paper", async () => {
    const matter = await newMatter("No designations");
    const { document } = await upload(matter.number, "brief.pdf");
    const [version] = document.versions;
    const primary = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/primary`,
      cookies: memberCookies,
    });
    expect(primary.statusCode, primary.body).toBe(409);
    const executed = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/executed-version`,
      cookies: memberCookies,
      payload: { versionId: version!.id },
    });
    expect(executed.statusCode, executed.body).toBe(409);
  });

  it("refuses paper rows with two owners or no owner", async () => {
    const matter = await newMatter("Constraint matter");
    const contract = await newContract("Constraint contract");
    await expect(
      harness.db.insert(documents).values({
        title: "Two owners",
        contractId: contract.id,
        matterId: matter.id,
        createdBy: memberId,
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      harness.db.insert(documents).values({ title: "No owner", createdBy: memberId }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      harness.db.insert(documentFolders).values({
        name: "Two owner folder",
        contractId: contract.id,
        matterId: matter.id,
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      harness.db.insert(documentFolders).values({ name: "No owner folder" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});
