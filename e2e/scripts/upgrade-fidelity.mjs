#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Upgrade fidelity: fill an install, upgrade it, and check it is still
 * the same install ([#260](https://github.com/juggernog20/OpenLaw/issues/260)).
 *
 * **The gap this closes.** Every other test starts from an empty
 * database. So the *first* install is tested on every commit and the
 * *second* has never been tested at all. A migration that passes
 * against an empty table can still fail against one with real rows — a
 * NOT NULL column with no default, a unique index over data that
 * already has duplicates, a backfill that assumes a shape the old rows
 * do not have. Those only appear against populated data, and today the
 * install that finds them belongs to a self-hoster, at their 2am, on
 * their contracts.
 *
 * **Two commands, one database.** `seed` runs against the baseline
 * release and fills it through the public API — no direct SQL, because
 * a seed that wrote rows the application would never write proves
 * nothing about the application. It leaves a fingerprint file. `verify`
 * runs against the same database after the upgrade and checks every
 * recorded fact still reads back. In between, CI swaps the images and
 * keeps the volumes.
 *
 * ```
 * node e2e/scripts/upgrade-fidelity.mjs seed   --out /tmp/fingerprint.json
 * # ... upgrade the stack, volumes intact ...
 * node e2e/scripts/upgrade-fidelity.mjs verify --in  /tmp/fingerprint.json
 * ```
 *
 * **It has no dependencies and is not built.** It runs on plain `node`
 * against whichever stack is up, which is what lets one copy drive both
 * versions across a `git checkout` in the middle of a CI job.
 *
 * **The seed may only use API surface the baseline already has.** It is
 * the current commit's script talking to the *previous* release's
 * server, so an endpoint added in the change under test would 404 here.
 * A new endpoint is verified after the upgrade, never during the seed.
 *
 * **What is compared is named facts, not whole responses.** A release
 * is allowed to add a field to a response — that is not an upgrade
 * failure, and a deep equality check would call it one. So the
 * fingerprint records scalars that must survive: a contract's number,
 * title, stage and custom field values; a document version's SHA-256
 * and byte count; a user's role; whether the signing connector still
 * holds its credentials.
 *
 * **Matters are missing from the seed because they do not exist yet.**
 * The install has matter *types* and no matter records (no module, no
 * table), so the seed fills the taxonomy and stops there. It grows a
 * matter the same day the product does.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const BASE_URL = process.env.UPGRADE_BASE_URL ?? "http://localhost:3000";

/**
 * What rides the `Origin` header. It is the stack's own `BASE_URL`,
 * which is usually the address we are calling — but a stack published
 * on another host port and told its public origin separately needs the
 * two to differ, and better-auth refuses a sign-in whose origin does
 * not match what the app was configured with.
 */
const ORIGIN = process.env.UPGRADE_ORIGIN ?? BASE_URL;

/**
 * The Administrator the seed creates and the verify signs in as.
 * Matching the E2E suite's fixture keeps one set of credentials working
 * against any stack somebody brings up by hand.
 */
const ADMIN = {
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway CI stack
};

/**
 * A private key shaped like the one an Administrator pastes. It signs
 * nothing: what matters is that the bytes written before the upgrade
 * are the bytes readable after it.
 */
const RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAopenlawupgradefidelityfixturekeyneverusedanywhere",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const CONNECT_SECRET = "openlaw-upgrade-fidelity-connect-secret"; // NOSONAR — inert fixture, not a credential

/** The session the whole run carries, as a cookie jar. */
const jar = new Map();

function cookieHeader() {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function keepCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";", 1)[0];
    const split = pair.indexOf("=");
    if (split > 0) jar.set(pair.slice(0, split).trim(), pair.slice(split + 1));
  }
}

/**
 * One API call. `Origin` rides every request because better-auth
 * compares it against BASE_URL and treats a missing one on a
 * session-bearing request as CSRF.
 */
async function call(method, path, options = {}) {
  const accepted = options.accept ?? [200, 201];
  const headers = { origin: ORIGIN, accept: "application/json" };
  if (jar.size > 0) headers.cookie = cookieHeader();

  let body;
  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form !== undefined) {
    body = options.form;
  }

  const response = await fetch(new URL(path, BASE_URL), { method, headers, body });
  keepCookies(response);
  const text = await response.text();
  if (!accepted.includes(response.status)) {
    throw new Error(
      `${method} ${path} answered ${response.status}, expected ${accepted.join(" or ")}\n${text.slice(0, 600)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

const get = (path, options) => call("GET", path, options);
const post = (path, json, options) => call("POST", path, { json, ...options });
const patch = (path, json, options) => call("PATCH", path, { json, ...options });
const put = (path, json, options) => call("PUT", path, { json, ...options });

/** Downloads a stored file and answers its SHA-256, hex. */
async function downloadChecksum(path) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: { origin: ORIGIN, cookie: cookieHeader() },
  });
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

/** A deterministic file body, so the checksum is a fact about storage
 * rather than about the moment the seed ran. */
function fixtureFile(name, contents) {
  return new File([contents], name, { type: "text/plain" });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Compares one recorded fact against what the upgraded install answers.
 *
 * `undefined` on either side is refused rather than compared.
 * `JSON.stringify(undefined)` is `undefined`, so two of them would be
 * equal and the check would assert nothing — and the fingerprint is
 * written through `JSON.stringify`, which drops every `undefined`
 * property. A field the seed failed to record, or one the upgrade
 * renamed, would read as absent on both sides and pass silently. That
 * is precisely the case this gate exists to catch.
 */
function same(actual, expected, what) {
  check(expected !== undefined, `${what}: the seed recorded nothing, so there is nothing to check`);
  check(
    actual !== undefined,
    `${what}: the upgraded install answered nothing; seeded ${JSON.stringify(expected)}`,
  );
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(a === b, `${what}: read ${a}, seeded ${b}`);
}

// ---------------------------------------------------------------- seed

async function signInAdmin() {
  await post("/api/auth/sign-in/email", { email: ADMIN.email, password: ADMIN.password });
}

async function seed() {
  const status = await get("/api/v1/auth/setup");
  check(status.needsSetup, "the seed needs a fresh install; this one already has an Administrator");
  await post("/api/v1/auth/setup", ADMIN, { accept: [201] });
  await post("/api/v1/onboarding/complete");

  // Org identity, so `org_settings` carries more than its seeded defaults.
  await patch("/api/v1/org/general", {
    name: "Upgrade Fidelity Ltd",
    defaultLocale: "en-US",
    defaultTimezone: "Europe/London",
  });

  // Users in more than one role. Invites deliver into the overlay's
  // Mailpit; nobody activates, so the rows stay `invited`, which is
  // itself a state worth carrying across an upgrade.
  const invited = [];
  for (const [email, displayName, role] of [
    ["legal@example.com", "Lena Legal", "legal_team_member"],
    ["contrib@example.com", "Cody Contributor", "contributor"],
    ["admin2@example.com", "Ada Admin", "administrator"],
  ]) {
    const created = await post("/api/v1/auth/invites", { email, displayName, role });
    invited.push({ id: created.user.id, email, role });
  }
  // A role edit, so the users table holds somebody whose role is not
  // the one they were invited under.
  await patch(`/api/v1/users/${invited[1].id}/role`, { role: "business_user" });
  invited[1].role = "business_user";

  // Taxonomy. A custom row of each kind, beside the seeded defaults.
  const contractType = (await post("/api/v1/contract-types", { displayName: "Upgrade MSA" }))
    .contractType;
  const matterType = (await post("/api/v1/matter-types", { displayName: "Upgrade Advice" }))
    .matterType;
  const entityType = (await post("/api/v1/entity-types", { displayName: "Upgrade Holdco" }))
    .entityType;
  const field = (
    await post("/api/v1/fields", {
      displayName: "Upgrade reference",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    })
  ).field;
  await post(`/api/v1/contract-types/${contractType.id}/fields`, {
    fieldId: field.id,
    isRequired: false,
  });
  const customStatus = (
    await post("/api/v1/contract-statuses", { displayName: "Upgrade hold", stage: "review" })
  ).contractStatus;

  const entity = (
    await post("/api/v1/entities", {
      legalName: "Upgrade Fidelity Holdings Ltd",
      entityTypeId: entityType.id,
      jurisdiction: "England and Wales",
      status: "active",
    })
  ).entity;

  // One live status per stage, from whatever this release seeds. Taking
  // them from the API rather than naming them keeps the seed working
  // when the default set is renamed.
  const statuses = (await get("/api/v1/contract-statuses")).contractStatuses.filter(
    (row) => row.archivedAt === null,
  );
  const byStage = new Map();
  for (const row of statuses) if (!byStage.has(row.stage)) byStage.set(row.stage, row);

  // Contracts across the lifecycle — the populated table this whole job
  // exists for. One per stage the release offers a status for.
  const contracts = [];
  for (const [stage, status] of byStage) {
    const created = (
      await post("/api/v1/contracts", {
        title: `Upgrade ${stage} contract`,
        contractTypeId: contractType.id,
        isConfidential: stage === "signature",
      })
    ).contract;
    const updated = (
      await patch(`/api/v1/contracts/${created.number}`, {
        title: `Upgrade ${stage} contract`,
        contractTypeId: contractType.id,
        statusId: status.id,
        description: `Seeded at the ${stage} stage before the upgrade.`,
        priority: "high",
        entityId: entity.id,
        customFields: { [field.slug]: `ref-${stage}` },
        isConfidential: stage === "signature",
      })
    ).contract;
    contracts.push({
      number: updated.number,
      title: updated.title,
      stage: updated.stage,
      statusName: updated.statusName,
      isConfidential: updated.isConfidential,
      description: updated.description,
      priority: updated.priority,
      entityName: updated.entity?.legalName ?? null,
      customFields: updated.customFields,
      archived: false,
    });
  }
  check(contracts.length >= 4, `expected a contract per stage, seeded ${contracts.length}`);

  // A contract that was archived before the upgrade. An archived row is
  // exactly the kind a backfill forgets to filter for.
  const archived = contracts[contracts.length - 1];
  await post(`/api/v1/contracts/${archived.number}/archive`);
  archived.archived = true;

  // An approval nobody has answered, so `contract_approvals` is not empty.
  const approvalHost = contracts[0];
  await post(`/api/v1/contracts/${approvalHost.number}/approvals`, {
    approverIds: [invited[0].id],
  });

  // A team member and a comment, so those tables carry rows too.
  await post(`/api/v1/contracts/${approvalHost.number}/team`, {
    userId: invited[0].id,
    role: "member",
  });
  const commentBody = "Seeded before the upgrade.";
  const approvalHostId = (await get(`/api/v1/contracts/${approvalHost.number}`)).contract.id;
  await post("/api/v1/comments", {
    entityType: "contract",
    entityId: approvalHostId,
    body: commentBody,
    visibility: "working_team",
  });

  // Documents: a two-version chain on the record root, and a second
  // document filed into a folder. The bytes are what the verify checks —
  // rows and blobs have to still agree after the volumes are reused.
  const docHost = contracts[0];
  const folderName = "Upgrade folder";
  const folders = (await post(`/api/v1/contracts/${docHost.number}/folders`, { name: folderName }))
    .folders;
  const folder = folders.find((row) => row.name === folderName);
  check(folder !== undefined, "the seeded folder was not in the answer");

  const first = new FormData();
  first.append("kind", "draft_ours");
  first.append("note", "Version one, before the upgrade.");
  first.append("file", fixtureFile("upgrade-draft.txt", "The first round, seeded pre-upgrade.\n"));
  const primary = (
    await call("POST", `/api/v1/contracts/${docHost.number}/documents`, {
      form: first,
      accept: [201],
    })
  ).document;

  const second = new FormData();
  second.append("kind", "redline_theirs");
  second.append("note", "Version two, before the upgrade.");
  second.append(
    "file",
    fixtureFile("upgrade-redline.txt", "The second round, seeded pre-upgrade.\n"),
  );
  await call("POST", `/api/v1/documents/${primary.id}/versions`, {
    form: second,
    accept: [201],
  });

  const filed = new FormData();
  filed.append("folderId", folder.id);
  filed.append("file", fixtureFile("upgrade-filed.txt", "Filed into a folder pre-upgrade.\n"));
  await call("POST", `/api/v1/contracts/${docHost.number}/documents`, {
    form: filed,
    accept: [201],
  });

  const documents = (await get(`/api/v1/contracts/${docHost.number}/documents`)).documents.map(
    (document) => ({
      id: document.id,
      title: document.title,
      isPrimary: document.isPrimary,
      folderId: document.folderId,
      versions: document.versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        kind: version.kind,
        originalFilename: version.originalFilename,
        byteSize: version.byteSize,
        checksumSha256: version.checksumSha256,
      })),
    }),
  );
  check(documents.length === 2, `expected two documents, seeded ${documents.length}`);

  // The signing connector, credentials and all. On a release before
  // TECH-022 these land in the clear, and the upgrade is what seals
  // them — so this row is the one that proves the boot pass works
  // against real data rather than only against a fixture.
  await put("/api/v1/signing-connectors/docusign", {
    environment: "demo",
    integrationKey: "upgrade-fidelity-integration-key",
    apiUserId: randomUUID(),
    privateKey: RSA_KEY,
    webhookSecret: CONNECT_SECRET,
  });
  const connector = (await get("/api/v1/signing-connectors/docusign")).connector;

  // The feed of the busiest seeded record. Entries are appended and
  // never removed, so its length is a floor the upgrade must not go
  // under.
  const feed = await get(
    `/api/v1/activity?entityType=contract&entityId=${encodeURIComponent(approvalHostId)}`,
  );

  return {
    baseUrl: BASE_URL,
    admin: { email: ADMIN.email },
    users: invited,
    org: { name: "Upgrade Fidelity Ltd", defaultTimezone: "Europe/London" },
    taxonomy: {
      contractTypeId: contractType.id,
      contractTypeName: contractType.displayName,
      matterTypeName: matterType.displayName,
      entityTypeName: entityType.displayName,
      fieldSlug: field.slug,
      customStatusName: customStatus.displayName,
    },
    entity: { id: entity.id, legalName: entity.legalName },
    contracts,
    folder: { id: folder.id, name: folder.name, contractNumber: docHost.number },
    comment: { contractId: approvalHostId, contractNumber: approvalHost.number, body: commentBody },
    documents: { contractNumber: docHost.number, list: documents },
    connector: {
      environment: connector.environment,
      integrationKey: connector.integrationKey,
      apiUserId: connector.apiUserId,
      hasPrivateKey: connector.hasPrivateKey,
      hasWebhookSecret: connector.hasWebhookSecret,
    },
    // Only ever asserted as a floor. An install that logged more is not
    // a regression; one that logged fewer has lost an audit record.
    activityFloor: feed.entries.length,
  };
}

// -------------------------------------------------------------- verify

async function verify(fingerprint) {
  // The session is the first thing checked, because it is the first
  // thing a self-hoster notices: sessions and password hashes are rows
  // like any other, and a migration can break them.
  await signInAdmin();
  const me = await get("/api/v1/me");
  check(me.user.email === ADMIN.email, `signed in as ${me.user.email}, seeded ${ADMIN.email}`);

  const { general } = await get("/api/v1/org/general");
  same(general.name, fingerprint.org.name, "org name");
  same(general.defaultTimezone, fingerprint.org.defaultTimezone, "org timezone");

  const users = (await get("/api/v1/users")).users;
  for (const seeded of fingerprint.users) {
    const found = users.find((user) => user.email === seeded.email);
    check(found !== undefined, `user ${seeded.email} is gone after the upgrade`);
    same(found.role, seeded.role, `role of ${seeded.email}`);
  }

  const contractTypes = (await get("/api/v1/contract-types")).contractTypes;
  check(
    contractTypes.some((type) => type.displayName === fingerprint.taxonomy.contractTypeName),
    "the seeded contract type is gone after the upgrade",
  );
  const matterTypes = (await get("/api/v1/matter-types")).matterTypes;
  check(
    matterTypes.some((type) => type.displayName === fingerprint.taxonomy.matterTypeName),
    "the seeded matter type is gone after the upgrade",
  );
  const statuses = (await get("/api/v1/contract-statuses")).contractStatuses;
  check(
    statuses.some((row) => row.displayName === fingerprint.taxonomy.customStatusName),
    "the seeded contract status is gone after the upgrade",
  );

  const entity = (await get(`/api/v1/entities/${fingerprint.entity.id}`)).entity;
  same(entity.legalName, fingerprint.entity.legalName, "entity legal name");

  for (const seeded of fingerprint.contracts) {
    const read = (await get(`/api/v1/contracts/${seeded.number}`)).contract;
    same(read.title, seeded.title, `contract ${seeded.number} title`);
    same(read.stage, seeded.stage, `contract ${seeded.number} stage`);
    same(read.statusName, seeded.statusName, `contract ${seeded.number} status`);
    same(read.description, seeded.description, `contract ${seeded.number} description`);
    same(read.priority, seeded.priority, `contract ${seeded.number} priority`);
    same(read.isConfidential, seeded.isConfidential, `contract ${seeded.number} confidentiality`);
    same(read.entity?.legalName ?? null, seeded.entityName, `contract ${seeded.number} entity`);
    // The custom field values are the strongest single signal here: they
    // live in a JSON column keyed by a field slug, which is exactly the
    // shape a careless migration reshapes.
    same(read.customFields, seeded.customFields, `contract ${seeded.number} custom fields`);
    check(
      (read.archivedAt !== null) === seeded.archived,
      `contract ${seeded.number} archival changed across the upgrade`,
    );
  }

  const documents = (
    await get(`/api/v1/contracts/${fingerprint.documents.contractNumber}/documents`)
  ).documents;
  for (const seeded of fingerprint.documents.list) {
    const read = documents.find((document) => document.id === seeded.id);
    check(read !== undefined, `document ${seeded.title} is gone after the upgrade`);
    same(read.title, seeded.title, `document ${seeded.id} title`);
    same(read.isPrimary, seeded.isPrimary, `document ${seeded.id} primary flag`);
    same(read.folderId, seeded.folderId, `document ${seeded.id} folder`);
    same(read.versions.length, seeded.versions.length, `document ${seeded.id} version count`);
    for (const version of seeded.versions) {
      const readVersion = read.versions.find((row) => row.id === version.id);
      check(readVersion !== undefined, `version ${version.versionNumber} is gone`);
      same(readVersion.versionNumber, version.versionNumber, "version number");
      same(readVersion.kind, version.kind, "version kind");
      same(readVersion.originalFilename, version.originalFilename, "version filename");
      same(readVersion.byteSize, version.byteSize, "version byte size");
      same(readVersion.checksumSha256, version.checksumSha256, "version checksum");
      // And the blob itself, not only the row that describes it: the
      // files volume is reused across the upgrade too, and a row that
      // survived while its file did not is the worse failure.
      const downloaded = await downloadChecksum(
        `/api/v1/documents/${seeded.id}/versions/${version.id}/download`,
      );
      same(downloaded, version.checksumSha256, `stored bytes of version ${version.id}`);
    }
  }

  // The signing connector, which on an upgrade across TECH-022 was
  // written in the clear and is read back through the seal.
  const connector = (await get("/api/v1/signing-connectors/docusign")).connector;
  check(connector.configured, "the signing connector is no longer configured after the upgrade");
  same(connector.environment, fingerprint.connector.environment, "connector environment");
  same(connector.integrationKey, fingerprint.connector.integrationKey, "connector integration key");
  same(connector.apiUserId, fingerprint.connector.apiUserId, "connector API user");
  check(
    connector.hasPrivateKey && connector.hasWebhookSecret,
    "the signing connector lost its credentials across the upgrade — they were readable before it",
  );

  const feed = await get(
    `/api/v1/activity?entityType=contract&entityId=${encodeURIComponent(fingerprint.comment.contractId)}`,
  );
  check(
    feed.entries.length >= fingerprint.activityFloor,
    `the record's activity feed shrank across the upgrade: ${feed.entries.length} entries, ${fingerprint.activityFloor} before`,
  );
}

// ----------------------------------------------------------------- cli

function argument(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const command = process.argv[2];
if (command === "seed") {
  const out = argument("--out") ?? "upgrade-fingerprint.json";
  const fingerprint = await seed();
  await writeFile(out, `${JSON.stringify(fingerprint, null, 2)}\n`);
  console.log(
    `seeded ${fingerprint.contracts.length} contracts, ${fingerprint.documents.list.length} documents, ` +
      `${fingerprint.users.length} invited users and one signing connector; fingerprint written to ${out}`,
  );
} else if (command === "verify") {
  const from = argument("--in") ?? "upgrade-fingerprint.json";
  await verify(JSON.parse(await readFile(from, "utf8")));
  console.log("the upgraded install still reads back every seeded record");
} else {
  console.error("usage: upgrade-fidelity.mjs seed --out <file> | verify --in <file>");
  process.exit(2);
}
