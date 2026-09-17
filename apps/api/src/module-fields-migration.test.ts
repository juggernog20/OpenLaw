// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations, sql } from "@openlaw/db";
import { freshDb, migrateThrough, migrationEntries } from "./testing/migration-rehearsal.js";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
});
afterAll(async () => container?.stop());

it("splits legacy global fields without losing attachments, values, defaults or Auto-Doc mappings", async () => {
  const db = await freshDb(container, "module_fields");
  try {
    await migrateThrough(db, "0139_advanced-settings", migrationEntries());
    await db.execute(
      sql`insert into users (id, email, display_name, role) values ('admin', 'admin@example.com', 'Admin', 'administrator')`,
    );
    await db.execute(sql`insert into fields (id, slug, display_name, module_scope, field_type, field_tag, description, options, archived_at) values
      ('shared', 'project', 'Project', 'global', 'single_select', 'legal', 'Project reference', '["A", "B"]', now()),
      ('matter-only', 'docket', 'Docket', 'global', 'text', 'legal', null, null, null),
      ('unused', 'unused', 'Unused', 'global', 'text', 'business', null, null, null),
      ('collision', 'project_matter', 'Other field', 'matter', 'text', 'business', null, null, null)`);
    for (const module of ["contract", "matter", "entity"]) {
      await db.execute(
        sql.raw(`insert into ${module}_type_fields (${module}_type_id, field_id, display_order, is_required)
        select id, 'shared', 10, true from ${module}_types limit 1`),
      );
    }
    await db.execute(sql`insert into matter_type_fields (matter_type_id, field_id, display_order, is_required)
      select id, 'matter-only', 11, false from matter_types limit 1`);
    for (const module of ["contract", "matter"]) {
      await db.execute(
        sql.raw(`insert into ${module}s (id, title, ${module}_type_id, status_id, created_by, custom_fields)
        select '${module}', 'Example', t.id, s.id, 'admin', '{"project":"A","untouched":"B"}' from
        (select id from ${module}_types limit 1) t cross join (select id from ${module}_statuses limit 1) s`),
      );
    }
    await db.execute(
      sql`update matters set ai_unverified = '{"field:project":{"draftId":"draft","writtenAt":"2026-09-01","targetTypeId":"type"}}' where id = 'matter'`,
    );
    await db.execute(sql`insert into entities (id, legal_name, entity_type_id, custom_fields)
      select 'entity', 'Example', id, '{"project":"B"}' from entity_types limit 1`);
    await db.execute(sql`insert into matter_templates (id, matter_type_id, name, default_custom_fields)
      select 'template', id, 'Example', '{"project":"A"}' from matter_types limit 1`);
    await db.execute(sql`insert into request_types (id, slug, display_name, display_order, target_module) values
      ('for-matter', 'for_matter', 'Matter form', 99, 'matter'), ('undecided', 'undecided', 'General form', 100, null)`);
    await db.execute(sql`insert into request_type_fields (request_type_id, field_id, display_order, is_required) values
      ('for-matter', 'shared', 1, false), ('undecided', 'shared', 1, false)`);
    await db.execute(sql`insert into requests (id, title, request_type_id, requester_id, urgency, custom_fields) values
      ('request', 'Matter request', 'for-matter', 'admin', 'medium', '{"project":"A"}'),
      ('general', 'General request', 'undecided', 'admin', 'medium', '{"project":"B"}')`);
    await db.execute(
      sql`insert into auto_docs (id, name, created_by, updated_by) values ('auto', 'Example', 'admin', 'admin')`,
    );
    await db.execute(sql`insert into auto_doc_form_versions (id, auto_doc_id, version_number, definition, created_by) values
      ('version', 'auto', 1, '{"fields":[{"slug":"project","catalogFieldId":"shared"}]}', 'admin')`);
    const source = {
      id: "field:request:project",
      kind: "field",
      label: "Project (single_select)",
      text: "A",
    };
    const revision = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const suggestions = {
      "field:project": {
        value: "A",
        citations: [{ sourceId: source.id, revision: revision(source), quote: "A" }],
      },
      title: {
        value: "Example",
        citations: [{ sourceId: source.id, revision: "stale-revision", quote: "old answer" }],
      },
    };
    await db.execute(sql`insert into conversion_drafts (id, request_id, actor_id, target_module, target_type_id, snapshot, state, suggestions, conflicts)
      select 'draft', 'request', 'admin', 'matter', id, 'snapshot', 'ready', ${JSON.stringify(suggestions)}::jsonb, ${JSON.stringify(suggestions)}::jsonb from matter_types limit 1`);
    await runMigrations(db);
    const catalog = (
      await db.execute(
        sql`select id, slug, module_scope, display_name, description, options, archived_at from fields where display_name = 'Project' order by module_scope`,
      )
    ).rows;
    expect(catalog.map((f) => [f.slug, f.module_scope])).toEqual([
      ["project", "contract"],
      ["project_entity", "entity"],
      ["project_matter_2", "matter"],
    ]);
    expect(
      catalog.every(
        (f) =>
          f.description === "Project reference" &&
          f.archived_at &&
          JSON.stringify(f.options) === '["A","B"]',
      ),
    ).toBe(true);
    for (const module of ["contract", "matter", "entity"]) {
      const f = catalog.find((f) => f.module_scope === module)!;
      const values = (
        await db.execute(
          sql.raw(
            `select custom_fields from ${module === "entity" ? "entities" : module + "s"} where id = '${module}'`,
          ),
        )
      ).rows[0]!.custom_fields as Record<string, unknown>;
      expect(values[f.slug as string]).toBe(module === "entity" ? "B" : "A");
      const attachment = (
        await db.execute(
          sql.raw(
            `select field_id, display_order, is_required from ${module}_type_fields where field_id = '${f.id}'`,
          ),
        )
      ).rows[0];
      expect(attachment).toMatchObject({ field_id: f.id, display_order: 10, is_required: true });
    }
    expect(
      (
        await db.execute(
          sql`select default_custom_fields from matter_templates where id = 'template'`,
        )
      ).rows[0],
    ).toEqual({ default_custom_fields: { project_matter_2: "A" } });
    expect(
      (await db.execute(sql`select ai_unverified from matters where id = 'matter'`)).rows[0]!
        .ai_unverified,
    ).toHaveProperty("field:project_matter_2");
    expect(
      (await db.execute(sql`select custom_fields from requests where id = 'request'`)).rows[0]!
        .custom_fields,
    ).toHaveProperty("project_matter_2", "A");
    expect(
      (await db.execute(sql`select custom_fields from requests where id = 'general'`)).rows[0],
    ).toEqual({ custom_fields: { project: "B" } });
    expect(
      (await db.execute(sql`select definition from auto_doc_form_versions where id = 'version'`))
        .rows[0]!.definition,
    ).toEqual({ fields: [{ slug: "project", catalogFieldId: "shared" }] });
    expect(
      (await db.execute(sql`select module_scope from fields where id = 'matter-only'`)).rows[0],
    ).toEqual({ module_scope: "matter" });
    expect(
      (await db.execute(sql`select count(*)::int as n from fields where module_scope = 'global'`))
        .rows[0],
    ).toEqual({ n: 0 });
    await expect(
      db.execute(sql`update fields set module_scope = 'global' where id = 'unused'`),
    ).rejects.toThrow();
    const draft = (
      await db.execute(sql`select suggestions, conflicts from conversion_drafts where id = 'draft'`)
    ).rows[0]!;
    for (const column of ["suggestions", "conflicts"]) {
      const migrated = draft[column] as typeof suggestions & {
        "field:project_matter_2": (typeof suggestions)["field:project"];
      };
      expect(migrated["field:project_matter_2"].citations[0]).toEqual({
        sourceId: "field:request:project_matter_2",
        revision: revision({ ...source, id: "field:request:project_matter_2" }),
        quote: "A",
      });
      expect(migrated.title.citations[0]).toMatchObject({
        sourceId: "field:request:project_matter_2",
        revision: "stale-revision",
      });
    }
    const before = (await db.execute(sql`select count(*)::int as n from fields`)).rows;
    await runMigrations(db);
    expect((await db.execute(sql`select count(*)::int as n from fields`)).rows).toEqual(before);
  } finally {
    await db.$client.end();
  }
});
