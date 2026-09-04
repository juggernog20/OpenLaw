/* The know-how the team keeps (KNW-001 onward).
 *
 * Knowledge is the one destination whose value is entirely in its
 * content, so the items here are written out rather than generated: real
 * template names, a playbook that says something, guidance the business
 * would actually read. A folder tree with plausible names on it is also
 * the only way to review whether the tree control works.
 *
 * Both audiences are represented, because that is the distinction the
 * portal depends on: an item marked for everyone reaches a Business User,
 * and a legal-only one does not.
 */

import { pool } from "./client.mjs";
import { KNOWLEDGE_FOLDERS, KNOWLEDGE_ITEMS } from "./catalog.mjs";
import { knowledgeDocument } from "./prose.mjs";
import { memberPlus } from "./people.mjs";
import { uploadDocument } from "./uploads.mjs";

export async function seedKnowledge(admin, context, log) {
  const { random, taxonomy, people } = context;
  const authors = memberPlus(people);

  /** Creates a folder, or finds the one a previous run left there. */
  async function folder(name, parentId) {
    const { status, body } = await admin.request("POST", "/api/v1/knowledge/folders", {
      json: { name, ...(parentId ? { parentId } : {}) },
      expect: [409],
    });
    const listing = status === 409 ? (await admin.get("/api/v1/knowledge/folders")).body : body;
    return (listing.folders ?? []).find((row) => row.name === name)?.id ?? null;
  }

  const folders = new Map();
  for (const definition of KNOWLEDGE_FOLDERS) {
    const id = await folder(definition.name);
    if (id) folders.set(definition.name, id);
  }
  // One nested folder, so the tree is a tree rather than a list.
  if (folders.has("Templates")) {
    const id = await folder("Retired forms", folders.get("Templates"));
    if (id) folders.set("Retired forms", id);
  }
  log(`${folders.size} knowledge folders`);

  const byTitle = new Map();
  await pool(KNOWLEDGE_ITEMS, 3, async (item) => {
    const author = random.pick(authors);
    const type = taxonomy.knowledgeTypes.bySlug.get(item.type);
    if (!type) return;

    const { body: made } = await author.session.post("/api/v1/knowledge", {
      title: item.title,
      knowledgeTypeId: type.id,
      ...(folders.has(item.folder) ? { folderId: folders.get(item.folder) } : {}),
    });
    const knowledgeItem = made.knowledgeItem;
    await author.session.patch(`/api/v1/knowledge/${knowledgeItem.id}`, {
      body: item.body,
      audience: item.audience,
    });

    // The templates and precedents are the file, not the note, so those
    // carry a document; the guidance articles are the note itself.
    if (["template", "precedent"].includes(item.type)) {
      const document = await uploadDocument(
        author.session,
        `/api/v1/knowledge/${knowledgeItem.id}/documents`,
        knowledgeDocument(item),
        { format: item.type === "template" ? "docx" : "pdf" },
      );
      if (document) {
        await author.session.patch(`/api/v1/knowledge/${knowledgeItem.id}`, {
          primaryDocumentId: document.id,
        });
      }
    }

    if (item.published)
      await author.session.post(`/api/v1/knowledge/${knowledgeItem.id}/publish`, {});
    byTitle.set(item.title, knowledgeItem);
  });
  log(
    `${byTitle.size} knowledge items (${KNOWLEDGE_ITEMS.filter((i) => i.published).length} published)`,
  );

  // One superseded item, which is the whole point of the replacement
  // link: the archived form still exists and says what replaced it.
  const retired = byTitle.get("One-way NDA - inbound disclosures");
  const replacement = byTitle.get("Mutual NDA - Helix standard form");
  if (retired && replacement) {
    await admin.request("POST", `/api/v1/knowledge/${retired.id}/archive`, {
      json: { replacedById: replacement.id },
      expect: [200, 204, 409],
    });
    log("  one-way NDA archived, replaced by the mutual form");
  }

  return byTitle;
}
