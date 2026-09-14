// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001 and ADO-004: database constraints protect template ownership beneath the routes. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { autoDocs, documents, entities, entityTypes, eq, users } from "@openlaw/db";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
  expect(
    (await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
});
afterAll(async () => {
  await h.stop();
});

it("enforces exactly one owner and refuses a template pointer to another Auto-Doc's Document", async () => {
  const [actor] = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  const [other] = await h.db
    .insert(autoDocs)
    .values({ name: "Other template", createdBy: actor!.id, updatedBy: actor!.id })
    .returning();
  const [type] = await h.db.select().from(entityTypes).limit(1);
  const [entity] = await h.db
    .insert(entities)
    .values({ legalName: "Template owner test", entityTypeId: type!.id })
    .returning();
  for (const owners of [{}, { autoDocId: other!.id, entityId: entity!.id }]) {
    await expect(
      h.db.insert(documents).values({ ...owners, title: "Invalid owner", createdBy: actor!.id }),
    ).rejects.toMatchObject({ cause: { constraint: "documents_owner_check" } });
  }
  const [source] = await h.db
    .insert(autoDocs)
    .values({ name: "Source template", createdBy: actor!.id, updatedBy: actor!.id })
    .returning();
  const [template] = await h.db
    .insert(documents)
    .values({ autoDocId: source!.id, title: "Template", createdBy: actor!.id })
    .returning();
  await h.db
    .update(autoDocs)
    .set({ templateDocumentId: template!.id })
    .where(eq(autoDocs.id, source!.id));
  await expect(
    h.db
      .update(autoDocs)
      .set({ templateDocumentId: template!.id })
      .where(eq(autoDocs.id, other!.id)),
  ).rejects.toBeDefined();
  // A different Document avoids the unique pointer constraint and proves common ownership itself.
  const [foreign] = await h.db
    .insert(documents)
    .values({ entityId: entity!.id, title: "Entity paper", createdBy: actor!.id })
    .returning();
  await expect(
    h.db
      .update(autoDocs)
      .set({ templateDocumentId: foreign!.id })
      .where(eq(autoDocs.id, other!.id)),
  ).rejects.toMatchObject({ cause: { constraint: "auto_docs_template_owner_check" } });
});
