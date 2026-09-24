// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  and,
  asc,
  eq,
  isNull,
  lt,
  matters,
  matterKeyDates,
  matterTypeFields,
  matterTypes,
  regions,
  sql,
} from "@openlaw/db";
import { MAX_MATTER_TITLE_LENGTH } from "@openlaw/shared";
import { matterTeamScope, NO_MATTER } from "../lib/matter-access.js";
import { portalRecordScope } from "../lib/portal-record-access.js";
import { HttpError, httpError } from "../lib/problem.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  coerceCustomFieldValue,
  projectCustomFields,
  selectAttachedFields,
} from "../lib/custom-fields.js";
import { createMatter } from "../modules/matters/create.js";
import { getMatter, updateMatter, setMatterStatus } from "../modules/matters/service.js";
import {
  MatterRowSchema,
  MatterRecordEnvelope,
  MatterUpdateBody,
  MatterStatusBody,
  selectMatters,
  selectTeam,
  toRow,
} from "../modules/matters/record.js";
import { checklistOf } from "../modules/matter-tasks/service.js";
import { buildRelations, RelationsEnvelope } from "../modules/matter-relations/routes.js";
import { listMatterDocuments } from "../modules/documents/service.js";
import { listPortalDocuments } from "../modules/portal/document-service.js";
import { recordPerson } from "../lib/record-person.js";
import { departmentName } from "../modules/departments/references.js";
import { readTool } from "./workspace.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { ToolError, type ToolDefinition } from "./tool.js";

const id = z.string().min(1).max(128);
const numberSchema = z.number().int().min(1);
const listInput = z.strictObject({
  statusId: id.optional(),
  typeId: id.optional(),
  managerId: id.optional(),
  keyDateWithinDays: z.number().int().min(0).max(36500).optional(),
  ...pageInput,
});
const getInput = z.strictObject({
  number: numberSchema,
  documentsCursor: id.optional(),
  documentsLimit: z.number().int().min(1).max(50).default(10),
});
const createInput = z.strictObject({
  matterTypeId: id,
  answers: z.record(z.string(), z.unknown()),
  managerId: id.nullable().optional(),
  templateId: id.optional(),
  isConfidential: z.boolean().optional(),
});
const changesSchema = MatterUpdateBody.omit({ isConfidential: true, matterTypeId: true });
const updateInput = z.strictObject({ number: numberSchema, changes: changesSchema });
const statusInput = MatterStatusBody.extend({ number: numberSchema });
const writeTool = {
  toolset: "matters",
  kind: "write",
  legalUser: "on",
  businessUser: "off",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: false,
  },
} as const;
const mutationOutput = z.object({ number: numberSchema });
// Facts exposed by the Portal overview and work reads.
const portalRow = MatterRowSchema.pick({
  id: true,
  number: true,
  title: true,
  description: true,
  matterTypeName: true,
  statusName: true,
  statusCategory: true,
  manager: true,
  businessOwner: true,
  departmentId: true,
  department: true,
  region: true,
});
const recordRow = z.union([MatterRowSchema, portalRow]);
const object = z.record(z.string(), z.unknown());
const getOutput = z.object({
  matter: recordRow,
  fields: z.array(AttachedCustomFieldSchema),
  customFields: CustomFieldsInput,
  team: MatterRecordEnvelope.shape.team,
  documents: z.array(object),
  documentsNextCursor: z.string().nullable(),
  keyDates: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        label: z.string(),
        note: z.string().nullable(),
      }),
    )
    .optional(),
  tasks: z.array(object).optional(),
  relations: RelationsEnvelope.optional(),
});
const answerNames: Record<string, string> = {
  title: "title",
  description: "description",
  department: "departmentId",
  region: "region",
  priority: "priority",
  risk: "risk",
  needed_by: "neededBy",
};
const creationAnswers = changesSchema.omit({ managerId: true, businessOwnerId: true }).extend({
  title: z.string().trim().min(1).max(MAX_MATTER_TITLE_LENGTH),
  neededBy: z.iso.date().nullable().optional(),
});
function parseAnswers(answers: Record<string, unknown>, matterTypeId: string) {
  const native: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (key === "matter_type") {
      if (value !== matterTypeId)
        throw new ToolError("validation_error", "Matter type: the answer must match matterTypeId.");
    } else if (Object.hasOwn(answerNames, key)) native[answerNames[key]!] = value;
    else customFields[key] = value;
  }
  const parsed = creationAnswers.safeParse({ ...native, customFields });
  if (!parsed.success)
    throw new ToolError(
      "validation_error",
      parsed.error.issues
        .map((issue) => {
          const path = issue.path.map(String);
          if (path[0] === "customFields") path.shift();
          else if (path[0])
            path[0] =
              Object.entries(answerNames).find(([, value]) => value === path[0])?.[0] ?? path[0];
          return `${path.join(".")}: ${issue.message}`;
        })
        .join("; "),
    );
  return parsed.data;
}
export const matterTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "matters",
    name: "openlaw_matters_list",
    title: "List Matters",
    description:
      "List non-archived Matters you can reach, including closed Matters. Filter by statusId, typeId, Matter Manager managerId and keyDateWithinDays, from today through N days inclusive. Key dates are distinct from Task due dates. Key-date filtering is Legal Users only. Business Users receive only Portal facts on their team Matters. Continue with nextCursor and the same filters.",
    inputSchema: listInput,
    outputSchema: z.object({ matters: z.array(recordRow), nextCursor: z.string().nullable() }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { statusId, typeId, managerId, keyDateWithinDays, cursor, limit } =
          listInput.parse(input);
        if (user.role === "business_user" && keyDateWithinDays !== undefined)
          throw new ToolError("forbidden", "Key dates are not available on the Portal.");
        const cursorNumber = cursor === undefined ? undefined : Number(cursor);
        if (
          cursorNumber !== undefined &&
          (!/^\d+$/.test(cursor!) || !Number.isSafeInteger(cursorNumber) || cursorNumber < 1)
        )
          throw new ToolError("validation_error", "cursor must be a positive Matter number.");
        const rows = await selectMatters(db)
          .where(
            and(
              isNull(matters.archivedAt),
              user.role === "business_user"
                ? portalRecordScope(db, user, "matter")
                : matterTeamScope(db, user),
              statusId ? eq(matters.statusId, statusId) : undefined,
              typeId ? eq(matters.matterTypeId, typeId) : undefined,
              managerId ? eq(matters.managerId, managerId) : undefined,
              keyDateWithinDays !== undefined
                ? sql`exists (select 1 from ${matterKeyDates} where ${matterKeyDates.matterId} = ${matters.id} and ${matterKeyDates.date} between current_date and current_date + ${keyDateWithinDays}::integer)`
                : undefined,
              cursorNumber !== undefined
                ? lt(matters.number, sql`${cursorNumber}::bigint`)
                : undefined,
            ),
          )
          .orderBy(sql`${matters.number} desc`)
          .limit(limit + 1);
        const projected = rows.map((r) =>
          user.role === "business_user"
            ? portalRow.parse(toRow(r, {}))
            : MatterRowSchema.parse(toRow(r)),
        );
        const page = boundedPage(projected, limit, (r) => String(r.number));
        return bounded({ matters: page.items, nextCursor: page.nextCursor });
      }),
  },
  {
    ...readTool,
    toolset: "matters",
    name: "openlaw_matter_get",
    title: "Read a Matter",
    description:
      "Read a Matter by its M-number: overview, Fields, team, Key dates, Tasks, relations and Documents. Restricted relatives withhold identity. Business Users receive only Portal facts, Portal-visible Fields, team and Documents. documentsNextCursor continues with documentsCursor; documentsLimit bounds the page. Reduce it if the whole record exceeds the byte budget.",
    inputSchema: getInput,
    outputSchema: getOutput,
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { number, documentsCursor, documentsLimit } = getInput.parse(input);
        const portal = user.role === "business_user";
        let result;
        if (portal) {
          const [row] = await selectMatters(db)
            .where(and(eq(matters.number, number), portalRecordScope(db, user, "matter")))
            .limit(1);
          if (!row) throw httpError(404, NO_MATTER);
          const attached = await selectAttachedFields(db, matterTypeFields, row.row.matterTypeId);
          const projection = projectCustomFields(user.role, attached, row.row.customFields);
          result = {
            matter: portalRow.parse({
              ...toRow(row, {}),
              businessOwner: await recordPerson(db, row.row.businessOwnerId),
              department: await departmentName(db, row.row.departmentId),
            }),
            ...projection,
            team: await selectTeam(db, row.row.id),
          };
        } else {
          const details = await getMatter(db, user, number);
          result = {
            matter: details.matter,
            fields: details.fields,
            customFields: details.matter.customFields,
            team: details.team,
          };
        }
        const paper = portal
          ? await listPortalDocuments(db, user, "matter", number, { cursor: documentsCursor })
          : await listMatterDocuments(db, user, number, { cursor: documentsCursor });
        const page = boundedPage<{ id: string } & Record<string, unknown>>(
          paper.documents,
          documentsLimit,
          (d) => d.id,
          paper.nextCursor,
        );
        const withDocuments = {
          ...result,
          documents: page.items,
          documentsNextCursor: page.nextCursor,
        };
        if (portal) return bounded(withDocuments);
        const [keyDates, checklist, relations] = await Promise.all([
          db
            .select({
              id: matterKeyDates.id,
              date: matterKeyDates.date,
              label: matterKeyDates.label,
              note: matterKeyDates.note,
            })
            .from(matterKeyDates)
            .where(eq(matterKeyDates.matterId, result.matter.id))
            .orderBy(asc(matterKeyDates.date), asc(matterKeyDates.id)),
          checklistOf(db, result.matter.id),
          buildRelations(db, user, result.matter.id),
        ]);
        return bounded({ ...withDocuments, keyDates, tasks: checklist.tasks, relations });
      }),
  },
  {
    ...writeTool,
    name: "openlaw_matter_create",
    title: "Create a Matter",
    description:
      "Create a Matter from creation Form answers, optionally applying templateId. Read openlaw_form_get with kind matter first. Key answers by rowRef, including title and attached Field slugs. Department uses its id; Region accepts name or id. priority and risk: low, medium, high, critical. Explicit answers override template defaults. Ask the person for missing answers with your Client's question tool. Missing or invalid Fields return validation_error. Creates a new Matter each time.",
    inputSchema: createInput,
    outputSchema: mutationOutput,
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { matterTypeId, answers, ...options } = createInput.parse(input);
        const facts = parseAnswers(answers, matterTypeId);
        const born = await db.transaction(async (tx) => {
          const [type] = await tx
            .select({ id: matterTypes.id })
            .from(matterTypes)
            .where(and(eq(matterTypes.id, matterTypeId), isNull(matterTypes.archivedAt)))
            .for("update");
          if (!type) throw httpError(400, "The matter type must be a live matter type.");
          const attached = await selectAttachedFields(tx, matterTypeFields, matterTypeId);
          const invalid: string[] = [];
          for (const [slug, value] of Object.entries(facts.customFields ?? {})) {
            const field = attached.find((f) => f.slug === slug);
            if (!field) {
              invalid.push(`${slug}: this Field is not on the Matter type.`);
              continue;
            }
            try {
              coerceCustomFieldValue(field, value);
            } catch (error) {
              if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
              invalid.push(`${slug}: ${error.message}`);
            }
          }
          if (invalid.length) throw new ToolError("validation_error", invalid.join("; "));
          if (facts.region) {
            const [region] = await tx
              .select({ name: regions.displayName })
              .from(regions)
              .where(eq(regions.id, facts.region));
            if (region) facts.region = region.name;
          }
          return createMatter(tx, { ...facts, ...options, matterTypeId, actorId: user.id });
        });
        return { number: born.row.number };
      }),
  },
  {
    ...writeTool,
    annotations: { ...writeTool.annotations, idempotentHint: true },
    name: "openlaw_matter_update",
    title: "Update Matter Fields and Manager",
    description:
      "Change Matter Fields, title, description, managerId, businessOwnerId, departmentId or Region name. Fields use customFields keyed by slug. Null clears nullable values. priority and risk: low, medium, high, critical. Status moves use openlaw_matter_set_status.",
    inputSchema: updateInput,
    outputSchema: mutationOutput,
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { number, changes } = updateInput.parse(input);
        await updateMatter(db, user, number, changes);
        return { number };
      }),
  },
  {
    ...writeTool,
    name: "openlaw_matter_set_status",
    title: "Move Matter status",
    description:
      "Move a Matter to a configured statusId. Closing requires closingNote. Reopening returns a named confirmation error; ask the person before repeating with confirmReopen true. Uses the UI lifecycle rules and records the status change in Activity.",
    inputSchema: statusInput,
    outputSchema: mutationOutput,
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const { number, ...change } = statusInput.parse(input);
        await setMatterStatus(db, user, number, change);
        return { number };
      }),
  },
];
