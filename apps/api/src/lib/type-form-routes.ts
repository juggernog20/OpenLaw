// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-028 Administrator Form routes: validate and replace whole trees, reconstruct
 * stored Rows and Branches, and record one DD-017 change entry.
 */

import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  and,
  asc,
  eq,
  fields,
  inArray,
  isNull,
  isNotNull,
  contractTypeBranches,
  contractTypeBuiltinRows,
  contractTypeFields,
  matterTypeBranches,
  matterTypeBuiltinRows,
  matterTypeFields,
  entityTypeBranches,
  entityTypeFields,
  type Transaction,
  type Field,
} from "@openlaw/db";
import {
  FORM_BUILTINS,
  pinnedFormRows,
  validateForm,
  type Form,
  type FormNode,
  type FormRow,
  type FormModule,
  type FormRowType,
  type ChangedFields,
} from "@openlaw/shared";
import { requireRole } from "../auth/guards.js";
import { recordActivity } from "./activity.js";
import { httpError, problemResponse } from "./problem.js";
import type { TypeFieldRoutesConfig, TypeFieldScopeRule } from "./type-field-routes.js";
import type { TaxonomyRow } from "./taxonomy-routes.js";

const tables = {
  contract: {
    branches: contractTypeBranches,
    builtins: contractTypeBuiltinRows,
    joins: contractTypeFields,
  },
  matter: {
    branches: matterTypeBranches,
    builtins: matterTypeBuiltinRows,
    joins: matterTypeFields,
  },
  entity: { branches: entityTypeBranches, builtins: null, joins: entityTypeFields },
};
const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const Row = z.object({
  kind: z.literal("row"),
  id: z.string().min(1).max(128),
  rowRef: z.string().min(1).max(256),
  fieldType: z.enum([
    "text",
    "long_text",
    "number",
    "money",
    "currency",
    "date",
    "boolean",
    "single_select",
    "multi_select",
    "user",
    "entity",
  ]),
  onIntakeForm: z.boolean().optional(),
  isRequired: z.boolean(),
  visibleOnPortal: z.boolean(),
});
// Recursive schemas retain the shared evaluator's wire shape in OpenAPI as well as at runtime.
const Node: z.ZodType<FormNode> = z.union([
  Row,
  z.object({
    kind: z.literal("branch"),
    id: z.string().min(1).max(128),
    match: z.enum(["all", "any"]),
    conditions: z
      .array(
        z.object({
          rowRef: z.string().min(1),
          operator: z.enum([
            "equals",
            "is_not",
            "is_one_of",
            "is_set",
            "greater_than",
            "less_than",
          ]),
          value: z.union([Scalar, z.array(Scalar), z.null()]),
        }),
      )
      .min(1)
      .max(100),
    get children(): z.ZodArray<typeof Node> {
      return z.array(Node);
    },
  }),
]);
z.globalRegistry.add(Node, { id: "FormNode" });
const Envelope = z.object({ form: z.array(Node) });

/** Called inside type creation's transaction, so a newly created type has its built-in Rows. */
export async function seedTypeForm(tx: Transaction, module: FormModule, typeId: string) {
  const table = tables[module].builtins;
  if (!table) return;
  await tx.insert(table).values(
    Object.keys(FORM_BUILTINS[module]).map((builtinKey, index) => ({
      typeId,
      builtinKey,
      // Leave the legacy attachment order (starting at 1) available.
      displayOrder: index - Object.keys(FORM_BUILTINS[module]).length + 1,
    })),
  );
}

export async function readTypeForm(
  tx: Transaction,
  module: FormModule,
  typeId: string,
): Promise<FormNode[]> {
  const { branches, builtins, joins } = tables[module];
  const definitions: Readonly<Record<string, FormRowType>> = FORM_BUILTINS[module];
  const pins = pinnedFormRows(module);
  const branchRows = await tx.select().from(branches).where(eq(branches.typeId, typeId));
  const attachments = await tx
    .select({ join: joins, field: fields })
    .from(joins)
    .innerJoin(fields, eq(joins.fieldId, fields.id))
    .where(and(eq(joins.typeId, typeId), isNull(fields.archivedAt)))
    .orderBy(asc(joins.createdAt), asc(joins.fieldId));
  const builtinRows = builtins
    ? await tx.select().from(builtins).where(eq(builtins.typeId, typeId))
    : [];
  const nodes: { parent: string | null; order: number; node: FormNode }[] = [];
  for (const b of branchRows)
    nodes.push({
      parent: b.parentBranchId,
      order: b.displayOrder,
      node: { kind: "branch", id: b.id, match: b.match, conditions: b.conditions, children: [] },
    });
  for (const b of builtinRows)
    nodes.push({
      parent: b.branchId,
      order: b.displayOrder,
      node: {
        kind: "row",
        id: b.builtinKey,
        rowRef: b.builtinKey,
        fieldType: definitions[b.builtinKey]!,
        onIntakeForm: b.onIntakeForm,
        isRequired: b.isRequired,
        visibleOnPortal: true,
      },
    });
  for (const { join, field } of attachments)
    nodes.push({
      parent: join.branchId,
      order: join.displayOrder,
      node: {
        kind: "row",
        id: field.id,
        rowRef: field.slug,
        fieldType: field.fieldType,
        ...(module === "entity"
          ? {}
          : { onIntakeForm: "onIntakeForm" in join && join.onIntakeForm }),
        isRequired: join.isRequired,
        visibleOnPortal: join.visibleOnPortal,
      },
    });
  nodes.sort((a, b) => a.order - b.order || a.node.id.localeCompare(b.node.id));
  const children = (parent: string | null): FormNode[] =>
    nodes
      .filter((n) => n.parent === parent)
      .map(({ node }) => (node.kind === "row" ? node : { ...node, children: children(node.id) }));
  return [...pins, ...children(null)];
}

/** Once a Form mixes nodes, the legacy Field order permutes only sibling Field slots. */
export async function legacyFormFieldOrder(
  tx: Transaction,
  module: FormModule,
  typeId: string,
  fieldIds: string[],
) {
  const { branches, builtins, joins } = tables[module];
  const branchRows = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.typeId, typeId));
  const builtinRows = builtins
    ? await tx
        .select({ order: builtins.displayOrder })
        .from(builtins)
        .where(eq(builtins.typeId, typeId))
    : [];
  if (branchRows.length === 0 && builtinRows.every((row) => row.order <= 0)) return null;
  const rows = await tx
    .select()
    .from(joins)
    .where(and(eq(joins.typeId, typeId), inArray(joins.fieldId, fieldIds)));
  const slots = new Map<string | null, number[]>();
  for (const row of rows)
    slots.set(row.branchId, [...(slots.get(row.branchId) ?? []), row.displayOrder]);
  for (const orders of slots.values()) orders.sort((a, b) => a - b);
  const byId = new Map(rows.map((row) => [row.fieldId, row]));
  return new Map(fieldIds.map((id) => [id, slots.get(byId.get(id)!.branchId)!.shift()!]));
}

/** Legacy writes must not leave a Branch pointing at a missing or later Row. */
export async function assertTypeFormReferences(
  tx: Transaction,
  module: FormModule,
  typeId: string,
) {
  const [issue] = validateForm(await readTypeForm(tx, module, typeId));
  if (issue) throw httpError(400, issue.message);
}

/** The shared attachment factory mounts this only for record types. */
export function typeFormRoutes<TRow extends TaxonomyRow>(
  config: TypeFieldRoutesConfig<TRow>,
  module: FormModule,
): FastifyPluginAsyncZod {
  const { branches, builtins, joins } = tables[module];
  const { typesTable } = config;
  const definitions: Readonly<Record<string, FormRowType>> = FORM_BUILTINS[module];
  const pins = pinnedFormRows(module);

  async function validate(
    tx: Transaction,
    form: Form,
    rule: TypeFieldScopeRule,
  ): Promise<Map<string, Field>> {
    const ids = new Set<string>();
    const refs = new Set<string>();
    const rows: FormRow[] = [];
    function walk(nodes: Form, depth: number) {
      if (depth > 32) throw httpError(400, "A Form may nest at most 32 Branches.");
      for (const node of nodes) {
        if (ids.has(node.id)) throw httpError(400, `Duplicate Form node "${node.id}".`);
        ids.add(node.id);
        if (ids.size > 1000) throw httpError(400, "A Form may hold at most 1000 nodes.");
        if (node.kind === "branch") {
          walk(node.children, depth + 1);
          continue;
        }
        if (refs.has(node.rowRef)) throw httpError(400, `Duplicate Row "${node.rowRef}".`);
        refs.add(node.rowRef);
        rows.push(node);
        if (node.onIntakeForm && module === "entity")
          throw httpError(
            400,
            `Row "${node.rowRef}": an Entity Form has no On intake form switch.`,
          );
        if (node.onIntakeForm && !node.visibleOnPortal)
          throw httpError(400, `Row "${node.rowRef}": On intake form requires Visible on Portal.`);
        if (node.onIntakeForm && node.isRequired && node.fieldType === "user")
          throw httpError(
            400,
            `Row "${node.rowRef}": a user Row On intake form cannot be Required for creation.`,
          );
      }
    }
    walk(form, 0);
    // One Row per built-in key per type: a tree cannot drop Effective date from the record page.
    for (const key of Object.keys(definitions))
      if (!refs.has(key))
        throw httpError(400, `Built-in Row "${key}" is missing: every built-in keeps one Row.`);
    for (const [index, pin] of pins.entries()) {
      const node = form[index];
      if (
        node?.kind !== "row" ||
        node.rowRef !== pin.rowRef ||
        node.id !== pin.id ||
        node.fieldType !== pin.fieldType ||
        node.isRequired !== pin.isRequired ||
        node.visibleOnPortal !== pin.visibleOnPortal ||
        node.onIntakeForm !== pin.onIntakeForm
      )
        throw httpError(
          400,
          `The pinned ${pin.rowRef === "title" ? "Title" : "Type"} Row must stay first at the root with its fixed switches.`,
        );
    }
    const custom = rows.filter(
      (row) =>
        !Object.hasOwn(definitions, row.rowRef) && !pins.some((p) => p.rowRef === row.rowRef),
    );
    // Lock in stable order, after the owning type, just like the legacy attachment write.
    const catalog = custom.length
      ? await tx
          .select()
          .from(fields)
          .where(
            inArray(
              fields.id,
              custom.map((r) => r.id),
            ),
          )
          .orderBy(asc(fields.id))
          .for("share")
      : [];
    const byId = new Map(catalog.map((f) => [f.id, f]));
    for (const row of rows) {
      if (pins.some((p) => p.rowRef === row.rowRef)) continue;
      if (Object.hasOwn(definitions, row.rowRef)) {
        if (
          row.id !== row.rowRef ||
          row.fieldType !== definitions[row.rowRef] ||
          !row.visibleOnPortal
        )
          throw httpError(
            400,
            `Built-in Row "${row.rowRef}" has a fixed identity, Field type and Visible on Portal switch.`,
          );
        continue;
      }
      const field = byId.get(row.id);
      if (
        !field ||
        field.slug !== row.rowRef ||
        field.fieldType !== row.fieldType ||
        field.builtInKey
      )
        throw httpError(
          400,
          `Row "${row.rowRef}" must identify a catalog Field with its actual Field type.`,
        );
      if (!rule.scopes.includes(field.moduleScope) || rule.excludedSlugs?.includes(field.slug))
        throw httpError(400, `Row "${row.rowRef}": ${rule.refusal}`);
      if (field.archivedAt)
        throw httpError(409, `${field.displayName} is archived — restore it first.`);
    }
    const [issue] = validateForm(form);
    if (issue) throw httpError(400, issue.message);
    return byId;
  }

  function changes(before: Form, after: Form): ChangedFields {
    function index(form: Form) {
      const values = new Map<string, unknown>();
      function walk(nodes: Form, parent: string | null) {
        nodes.forEach((node, order) => {
          if (node.kind === "row") values.set(`Row ${node.rowRef}`, { ...node, parent, order });
          else {
            const { children, ...branch } = node;
            values.set(`Branch ${node.id}`, { ...branch, parent, order });
            walk(children, node.id);
          }
        });
      }
      walk(form, null);
      return values;
    }
    const from = index(before),
      to = index(after);
    return Object.fromEntries(
      [...new Set([...from.keys(), ...to.keys()])].flatMap((key) =>
        JSON.stringify(from.get(key)) === JSON.stringify(to.get(key))
          ? []
          : [[key, { from: from.get(key) ?? null, to: to.get(key) ?? null }]],
      ),
    );
  }

  return async (app) => {
    async function lock(tx: Transaction, id: string, write: boolean) {
      const [type] = await tx
        .select()
        .from(typesTable)
        .where(eq(typesTable.id, id))
        .for(write ? "update" : "share");
      if (!type) throw httpError(404, `No ${config.noun} exists with this id.`);
      return type;
    }
    app.get(
      `/${config.path}/:id/form`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `get${config.idInfix}Form`,
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          response: { 200: Envelope, default: problemResponse },
        },
      },
      async (request) =>
        app.db.transaction(async (tx) => {
          await lock(tx, request.params.id, false);
          return { form: await readTypeForm(tx, module, request.params.id) };
        }),
    );
    app.put(
      `/${config.path}/:id/form`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `replace${config.idInfix}Form`,
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          body: Envelope,
          response: { 200: Envelope, default: problemResponse },
        },
      },
      async (request) =>
        app.db.transaction(async (tx) => {
          const type = await lock(tx, request.params.id, true);
          const form = request.body.form;
          const rule =
            typeof config.scopeRule === "function"
              ? config.scopeRule(type as TRow)
              : config.scopeRule;
          const catalog = await validate(tx, form, rule);
          const before = await readTypeForm(tx, module, type.id);
          // Archived Fields are absent from GET. Preserve their attachments for restore.
          const hidden = await tx
            .select({ join: joins })
            .from(joins)
            .innerJoin(fields, eq(joins.fieldId, fields.id))
            .where(and(eq(joins.typeId, type.id), isNotNull(fields.archivedAt)))
            .orderBy(asc(joins.displayOrder), asc(joins.fieldId))
            .for("share", { of: fields });
          const branchLevels: (typeof branches.$inferInsert)[][] = [];
          const builtinValues: (typeof contractTypeBuiltinRows.$inferInsert)[] = [];
          const joinValues: (typeof contractTypeFields.$inferInsert)[] = [];
          const lastOrder = new Map<string | null, number>();
          function collect(nodes: Form, parent: string | null, depth: number) {
            lastOrder.set(parent, nodes.length);
            for (const [order, node] of nodes.entries()) {
              if (node.kind === "branch") {
                (branchLevels[depth] ??= []).push({
                  typeId: type.id,
                  id: node.id,
                  parentBranchId: parent,
                  displayOrder: order + 1,
                  match: node.match,
                  conditions: [...node.conditions],
                });
                collect(node.children, node.id, depth + 1);
              } else if (pins.some((p) => p.rowRef === node.rowRef)) continue;
              else if (builtins && Object.hasOwn(definitions, node.rowRef)) {
                builtinValues.push({
                  typeId: type.id,
                  builtinKey: node.rowRef,
                  displayOrder: order + 1,
                  branchId: parent,
                  isRequired: node.isRequired,
                  onIntakeForm: node.onIntakeForm ?? false,
                });
              } else {
                joinValues.push({
                  typeId: type.id,
                  fieldId: catalog.get(node.id)!.id,
                  displayOrder: order + 1,
                  branchId: parent,
                  isRequired: node.isRequired,
                  visibleOnPortal: node.visibleOnPortal,
                  ...(module === "entity" ? {} : { onIntakeForm: node.onIntakeForm ?? false }),
                });
              }
            }
          }
          collect(form, null, 0);
          for (const { join } of hidden) {
            const branchId = lastOrder.has(join.branchId) ? join.branchId : null;
            const displayOrder = lastOrder.get(branchId)! + 1;
            lastOrder.set(branchId, displayOrder);
            joinValues.push({ ...join, branchId, displayOrder });
          }
          await tx.delete(joins).where(eq(joins.typeId, type.id));
          if (builtins) await tx.delete(builtins).where(eq(builtins.typeId, type.id));
          await tx.delete(branches).where(eq(branches.typeId, type.id));
          // Each batch's parent Branches already exist before its children are inserted.
          for (const level of branchLevels)
            if (level?.length) await tx.insert(branches).values(level);
          if (builtins && builtinValues.length) await tx.insert(builtins).values(builtinValues);
          if (joinValues.length) await tx.insert(joins).values(joinValues);
          const result = await readTypeForm(tx, module, type.id);
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${module}_type.updated`,
            visibility: "admin_only",
            payload: { slug: type.slug, changed: changes(before, result) },
          });
          return { form: result };
        }),
    );
  };
}
