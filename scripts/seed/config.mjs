/* The configuration a legal team of this size would have built up.
 *
 * An install ships with a workable taxonomy and nothing else. What makes
 * a settings screen worth reviewing is the state a year of use leaves
 * behind: types the team added and types it archived, custom Fields
 * attached to some types and not others, templates, approver groups,
 * saved views, a connector or two. All of that is written here, before
 * any record exists, because records reference it.
 */

import { pool } from "./client.mjs";
import { ORG } from "./data.mjs";
import {
  APPROVER_GROUPS,
  CONTRACT_KINDS,
  CUSTOM_FIELDS,
  INTAKE_LINKS,
  LIST_VIEWS,
  MATTER_KINDS,
  MATTER_TEMPLATES,
  REQUEST_FIELDS,
  REQUEST_KINDS,
} from "./catalog.mjs";

/** Reads a taxonomy list into a slug-keyed and name-keyed index. */
async function index(admin, path, key) {
  const { body } = await admin.get(path);
  const rows = body[key] ?? [];
  return {
    rows,
    bySlug: new Map(rows.map((row) => [row.slug, row])),
    byName: new Map(rows.map((row) => [row.displayName ?? row.name, row])),
  };
}

/**
 * Creates a taxonomy row unless one with that name is already there.
 *
 * The row is read back from the list rather than out of the create
 * reply. Each of these routes answers a slightly different envelope, and
 * a helper that had to know all of them would be a list to keep in step
 * for no gain.
 */
async function ensure(admin, path, payload, existing, envelopeKey) {
  const name = payload.displayName ?? payload.name;
  const already = existing.byName.get(name);
  if (already) return already;
  await admin.post(path, payload);
  const refreshed = await index(admin, path, envelopeKey);
  return refreshed.byName.get(name) ?? null;
}

export async function configureOrganisation(admin, log) {
  await admin.patch("/api/v1/org/general", {
    name: ORG.name,
    defaultLocale: ORG.locale,
    defaultTimezone: ORG.timezone,
  });
  // Three reminders before a deadline rather than the shipped default,
  // which is the sort of change a team makes in its first month.
  await admin.put("/api/v1/org/reminder-offsets", { offsets: [30, 14, 7, 1, 0] });
  log(`organisation set to ${ORG.name} (${ORG.timezone})`);
}

/**
 * Points the mail settings at the catcher the dev loop already delivers
 * into, so the Email pane shows a configured relay rather than an empty
 * form.
 *
 * The dev loop sets SMTP in the environment, and the environment always
 * wins (SET-006). Where that is true the route refuses the save, which is
 * the right answer and not a seed failure: the pane already shows a
 * configured relay, it just says where the setting came from.
 */
export async function configureEmail(admin, log) {
  const smtpUrl = process.env.SEED_SMTP_URL ?? "smtp://127.0.0.1:1025";
  const { status } = await admin.request("PUT", "/api/v1/email-settings", {
    json: { smtpUrl, smtpFrom: `OpenLaw at Helix <legal@${ORG.domain}>` },
    expect: [409],
  });
  log(
    status === 409
      ? "email relay comes from the environment; nothing to save"
      : `email relay set to ${smtpUrl}`,
  );
}

/**
 * The types and statuses the team added on top of the shipped set, and
 * the one it stopped using.
 */
export async function configureTaxonomy(admin, log) {
  const contractTypes = await index(admin, "/api/v1/contract-types", "contractTypes");
  for (const kind of CONTRACT_KINDS.filter((k) => k.isNew)) {
    await ensure(
      admin,
      "/api/v1/contract-types",
      { displayName: kind.displayName },
      contractTypes,
      "contractTypes",
    );
  }

  const matterTypes = await index(admin, "/api/v1/matter-types", "matterTypes");
  for (const kind of MATTER_KINDS.filter((k) => k.isNew)) {
    await ensure(
      admin,
      "/api/v1/matter-types",
      { displayName: kind.displayName },
      matterTypes,
      "matterTypes",
    );
  }

  const requestTypes = await index(admin, "/api/v1/request-types", "requestTypes");
  for (const kind of REQUEST_KINDS.filter((k) => k.isNew)) {
    await ensure(
      admin,
      "/api/v1/request-types",
      { displayName: kind.displayName },
      requestTypes,
      "requestTypes",
    );
  }
  // What a Request of this type becomes on conversion (INT-004). The
  // shipped types already carry theirs; the added ones have to be told.
  const withTargets = await index(admin, "/api/v1/request-types", "requestTypes");
  const contractTypesForTargets = await index(admin, "/api/v1/contract-types", "contractTypes");
  const matterTypesForTargets = await index(admin, "/api/v1/matter-types", "matterTypes");
  for (const kind of REQUEST_KINDS.filter((k) => k.isNew && k.targetModule)) {
    const row = withTargets.byName.get(kind.displayName);
    if (!row) continue;
    const targetType =
      kind.targetModule === "contract"
        ? contractTypesForTargets.bySlug.get("vendor")
        : matterTypesForTargets.bySlug.get("employment");
    await admin.patch(`/api/v1/request-types/${row.id}`, {
      targetModule: kind.targetModule,
      ...(targetType ? { targetTypeId: targetType.id } : {}),
    });
  }

  const contractStatuses = await index(admin, "/api/v1/contract-statuses", "contractStatuses");
  for (const status of [
    { displayName: "Signed, awaiting countersignature", stage: "signature" },
    { displayName: "Superseded", stage: "ended" },
  ]) {
    await ensure(admin, "/api/v1/contract-statuses", status, contractStatuses, "contractStatuses");
  }

  const matterStatuses = await index(admin, "/api/v1/matter-statuses", "matterStatuses");
  for (const status of [
    { displayName: "Awaiting the business", category: "open" },
    { displayName: "With external counsel", category: "open" },
  ]) {
    await ensure(admin, "/api/v1/matter-statuses", status, matterStatuses, "matterStatuses");
  }

  const officerRoles = await index(admin, "/api/v1/officer-roles", "officerRoles");
  for (const role of [
    "Managing Director",
    "Company Secretary",
    "Authorised Signatory",
    "Treasurer",
  ]) {
    await ensure(
      admin,
      "/api/v1/officer-roles",
      { displayName: role },
      officerRoles,
      "officerRoles",
    );
  }

  const knowledgeTypes = await index(admin, "/api/v1/knowledge/types", "knowledgeTypes");
  for (const type of ["Checklist", "Note"]) {
    await ensure(
      admin,
      "/api/v1/knowledge/types",
      { displayName: type },
      knowledgeTypes,
      "knowledgeTypes",
    );
  }

  // A type the team created and later stopped using, folded back into
  // MSA. The shipped types cannot be archived, because they are system
  // protected, so the archived state only exists if something was added
  // and then retired. That is how it happens in a real install.
  const retired = await ensure(
    admin,
    "/api/v1/contract-types",
    { displayName: "Framework agreement" },
    await index(admin, "/api/v1/contract-types", "contractTypes"),
    "contractTypes",
  );
  const msa = (await index(admin, "/api/v1/contract-types", "contractTypes")).bySlug.get("msa");
  if (retired && !retired.archivedAt) {
    await admin.request("POST", `/api/v1/contract-types/${retired.id}/archive`, {
      json: msa ? { reassignToId: msa.id } : {},
      expect: [200, 204, 409],
    });
    log("  contract type Framework agreement archived into MSA");
  }

  log("taxonomy extended");
  return {
    contractTypes: await index(admin, "/api/v1/contract-types", "contractTypes"),
    matterTypes: await index(admin, "/api/v1/matter-types", "matterTypes"),
    requestTypes: await index(admin, "/api/v1/request-types", "requestTypes"),
    contractStatuses: await index(admin, "/api/v1/contract-statuses", "contractStatuses"),
    matterStatuses: await index(admin, "/api/v1/matter-statuses", "matterStatuses"),
    entityTypes: await index(admin, "/api/v1/entity-types", "entityTypes"),
    officerRoles: await index(admin, "/api/v1/officer-roles", "officerRoles"),
    knowledgeTypes: await index(admin, "/api/v1/knowledge/types", "knowledgeTypes"),
  };
}

/** Where a Field of a given scope gets attached, per module. */
const TYPE_PATHS = {
  contract: "/api/v1/contract-types",
  matter: "/api/v1/matter-types",
  entity: "/api/v1/entity-types",
  request: "/api/v1/request-types",
};

/**
 * The custom Fields, and the Types each one is attached to.
 *
 * Returns the Field index so record creation can fill the values: a
 * custom value is keyed by the Field's slug, which the API assigns.
 */
export async function configureFields(admin, taxonomy, log) {
  const existing = await index(admin, "/api/v1/fields", "fields");
  const definitions = [...CUSTOM_FIELDS, ...REQUEST_FIELDS];

  for (const definition of definitions) {
    if (existing.byName.has(definition.displayName)) continue;
    await admin.post("/api/v1/fields", {
      displayName: definition.displayName,
      moduleScope: definition.moduleScope,
      fieldType: definition.fieldType,
      fieldTag: definition.fieldTag,
      ...(definition.description ? { description: definition.description } : {}),
      ...(definition.options ? { options: definition.options } : {}),
      ...(definition.aiPrompt ? { aiPrompt: definition.aiPrompt } : {}),
    });
  }

  const fields = await index(admin, "/api/v1/fields", "fields");
  const typeIndexes = {
    contract: taxonomy.contractTypes,
    matter: taxonomy.matterTypes,
    entity: taxonomy.entityTypes,
    request: taxonomy.requestTypes,
  };

  let attachments = 0;
  for (const definition of definitions) {
    const field = fields.byName.get(definition.displayName);
    if (!field) continue;
    for (const [module, slugs] of Object.entries(definition.attach ?? {})) {
      for (const slug of slugs) {
        const type = typeIndexes[module]?.bySlug.get(slug);
        if (!type) continue;
        const isRequired = (definition.required?.[module] ?? []).includes(slug);
        await admin.request("POST", `${TYPE_PATHS[module]}/${type.id}/fields`, {
          json: { fieldId: field.id, isRequired },
          expect: [200, 201, 409],
        });
        attachments += 1;
      }
    }
  }

  // The three Fields the install ships with carry extraction prompts and
  // are worth nothing until a Type collects them, so put them on the
  // Types where an Analysis run would actually find an answer.
  for (const slug of ["governing_law", "jurisdiction", "our_position"]) {
    const field = fields.bySlug.get(slug);
    if (!field) continue;
    for (const typeSlug of ["msa", "sales", "sow", "vendor", "license", "reseller"]) {
      const type = taxonomy.contractTypes.bySlug.get(typeSlug);
      if (!type) continue;
      await admin.request("POST", `/api/v1/contract-types/${type.id}/fields`, {
        json: { fieldId: field.id, isRequired: false },
        expect: [200, 201, 409],
      });
      attachments += 1;
    }
  }

  log(`${definitions.length} custom fields, ${attachments} attachments`);
  return await index(admin, "/api/v1/fields", "fields");
}

/** Matter Templates, with the tasks and key dates each carries (MTR-009). */
export async function configureTemplates(admin, taxonomy, log) {
  const existing = await index(admin, "/api/v1/matter-templates", "matterTemplates");
  const created = [];
  for (const template of MATTER_TEMPLATES) {
    if (existing.byName.has(template.name)) {
      created.push(existing.byName.get(template.name));
      continue;
    }
    const type = taxonomy.matterTypes.bySlug.get(template.matterTypeSlug);
    if (!type) continue;
    const { body } = await admin.post("/api/v1/matter-templates", {
      matterTypeId: type.id,
      name: template.name,
      description: template.description,
      defaultPriority: template.defaultPriority,
      defaultRisk: template.defaultRisk,
      titlePrefix: template.titlePrefix,
    });
    const row = body.matterTemplate;
    if (!row) continue;
    await admin.put(`/api/v1/matter-templates/${row.id}/tasks`, { tasks: template.tasks });
    await admin.put(`/api/v1/matter-templates/${row.id}/key-dates`, {
      keyDates: template.keyDates,
    });
    created.push(row);
  }
  log(`${created.length} matter templates`);
  return created;
}

/** Approver groups (CTR-011), by the names on them. */
export async function configureApproverGroups(admin, people, log) {
  const existing = await index(admin, "/api/v1/approver-groups", "approverGroups");
  const groups = [];
  for (const group of APPROVER_GROUPS) {
    if (existing.byName.has(group.name)) {
      groups.push(existing.byName.get(group.name));
      continue;
    }
    const memberIds = group.members.map((name) => people.get(name)?.id).filter(Boolean);
    const { body } = await admin.post("/api/v1/approver-groups", {
      name: group.name,
      description: group.description,
      memberIds,
    });
    if (body.approverGroup) groups.push(body.approverGroup);
  }
  log(`${groups.length} approver groups`);
  return groups;
}

/**
 * The links beside the portal's request form (INT-006).
 *
 * Runs after Knowledge, because most of them point at an item.
 */
export async function configureIntakeLinks(admin, knowledgeByTitle, log) {
  const existing = await index(admin, "/api/v1/intake-links", "intakeLinks");
  let made = 0;
  for (const link of INTAKE_LINKS) {
    if (existing.rows.some((row) => row.label === link.label)) continue;
    const item = link.knowledgeTitle ? knowledgeByTitle.get(link.knowledgeTitle) : null;
    if (link.knowledgeTitle && !item) continue;
    await admin.post("/api/v1/intake-links", {
      label: link.label,
      ...(item ? { knowledgeItemId: item.id } : { url: link.url }),
    });
    made += 1;
  }
  log(`${made} intake links`);
}

/** Saved list views, in the menus of the people who saved them (DD-019). */
export async function configureListViews(people, log) {
  await pool(LIST_VIEWS, 4, async (view) => {
    const person = people.get(view.owner);
    if (!person) return;
    const { body } = await person.session.get(`/api/v1/list-views?surface=${view.surface}`);
    if ((body.views ?? []).some((row) => row.name === view.name)) return;
    await person.session.post("/api/v1/list-views", {
      surface: view.surface,
      name: view.name,
      config: view.config,
      isDefault: view.isDefault,
    });
  });
  log(`${LIST_VIEWS.length} saved views`);
}

/**
 * Points the AI connector at the stand-in the seed is running, so the
 * Analysis runs it triggers are real runs against a real provider seam
 * (TECH-012).
 */
export async function configureAiConnector(admin, stub, log) {
  await admin.put("/api/v1/ai-connector", {
    preset: "custom",
    protocol: "openai_chat_completions",
    baseUrl: stub.baseUrl,
    apiKey: stub.apiKey,
    model: "openlaw-seed-extractor",
  });
  const { body } = await admin.post("/api/v1/ai-connector/test", undefined, { expect: [200, 502] });
  log(`ai connector pointed at ${stub.baseUrl} (probe: ${body?.ok === true ? "ok" : "no answer"})`);
}

/**
 * Turns the connector off once the seeding is done.
 *
 * The stand-in dies with the seed script, so a connector left enabled
 * would offer a Run analysis control that could only fail. Disabled is a
 * state the app draws properly, and the runs it already wrote stay.
 */
export async function disableAiConnector(admin, log) {
  await admin.request("POST", "/api/v1/ai-connector/disable", { expect: [200, 204, 409] });
  log("ai connector disabled; the runs it wrote remain");
}
