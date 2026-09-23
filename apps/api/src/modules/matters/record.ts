// SPDX-License-Identifier: AGPL-3.0-only

import {
  and,
  asc,
  eq,
  fields,
  MATTER_PROGRESSION_GROUPS,
  matters,
  matterStatuses,
  matterTeam,
  matterTypeFields,
  matterTypes,
  SEVERITY_LEVELS,
  sql,
  users,
  type AnyPgColumn,
  type CustomFieldValue,
  type Executor,
  type Matter,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import {
  MATTER_SORT_KEYS,
  MAX_MATTER_TITLE_LENGTH,
  SORT_DIRECTIONS,
  type MatterSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { z } from "zod";
import { type AuthenticatedUser } from "../../auth/guards.js";
import { civilToday } from "../../lib/contract-term.js";
import { ConversionProvenanceSchema } from "../../lib/conversion-draft.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsInput,
  CustomFieldsSchema,
} from "../../lib/custom-fields.js";
import {
  MATTER_MANAGER_REFUSAL,
  MATTER_MANAGER_ROLES,
  matterConfidentialityWrite,
  matterTeamScope,
  NO_MATTER,
  reachedMatter,
} from "../../lib/matter-access.js";
import { nextDeadline, NextDeadlineSchema } from "../../lib/next-deadline.js";
import { httpError } from "../../lib/problem.js";
import { FilterChoices, validDateRanges } from "../../lib/record-filters.js";
import { TimezoneSchema } from "../../lib/timezones.js";
import { FormNodeSchema } from "../../lib/type-form-routes.js";
import { OriginalIntakeSchema } from "../requests/original-intake.js";
import { StaffRequestCustomFieldRefsSchema } from "../requests/projection.js";

export const SeveritySchema = z.enum(SEVERITY_LEVELS);

export const NumberParams = z.object({ number: z.coerce.number().int().positive() });

export const PAGE_SIZE = 50;

const CursorSchema = z.string().min(1).max(64);

export interface SortRequest {
  key: MatterSortKey;
  dir: SortDirection;
}

function severityRank(column: AnyPgColumn): SQL {
  const arms = SEVERITY_LEVELS.map(
    (level, index) => sql`when ${level} then ${sql.raw(String(index + 1))}`,
  );
  return sql`case ${column} ${sql.join(arms, sql` `)} end`;
}

export const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

export const MatterRowSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  matterTypeId: z.string(),
  matterTypeName: z.string(),
  statusId: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(["open", "closed"]),
  statusProgressionGroup: z.enum(MATTER_PROGRESSION_GROUPS),
  manager: PersonSchema.nullable(),
  businessOwner: PersonSchema.nullable().optional(),
  departmentId: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  priority: SeveritySchema,
  risk: SeveritySchema.nullable(),
  aiUnverified: ConversionProvenanceSchema.optional(),
  customFields: CustomFieldsSchema,
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  isConfidential: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  nextDeadline: NextDeadlineSchema,
});

export const MatterEnvelope = z.object({ matter: MatterRowSchema });

/** The record plus the fields its type attaches and the people and
 * Entities its stored values name. A `user` or `entity` field holds an
 * id, and the hero must draw a name, so the read resolves them the way
 * the contract and Request reads do. */
export const MatterRecordEnvelope = MatterEnvelope.extend({
  originalIntake: OriginalIntakeSchema.nullable().optional(),
  creator: PersonSchema.nullable().optional(),
  form: z.array(FormNodeSchema).optional(),
  fields: z.array(AttachedCustomFieldSchema),
  customFieldRefs: StaffRequestCustomFieldRefsSchema,
  team: z.array(PersonSchema),
});

export const MatterTeamEnvelope = z.object({
  team: z.array(PersonSchema),
});

const LifecycleStatusSchema = z.strictObject({
  id: z.string(),
  displayName: z.string(),
});

export const OpenChildSchema = z.union([
  z.strictObject({ restricted: z.literal(true) }),
  z.strictObject({
    restricted: z.literal(false),
    number: z.number().int(),
    title: z.string(),
  }),
]);

export const MatterLifecycleEnvelope = z.strictObject({
  action: z.enum(["close", "reopen"]),
  targetCategory: z.enum(["open", "closed"]),
  statuses: z.array(LifecycleStatusSchema),
  openChildren: z.array(OpenChildSchema),
});

interface MatterContext {
  row: Matter;
  matterTypeName: string;
  statusName: string;
  statusCategory: "open" | "closed";
  statusProgressionGroup: (typeof MATTER_PROGRESSION_GROUPS)[number];
  manager: {
    id: string;
    displayName: string;
    image: string | null;
    archivedAt: Date | null;
  } | null;
  nextDeadline?: z.infer<typeof NextDeadlineSchema>;
}

export function toRow(
  context: MatterContext,
  customFields: Readonly<Record<string, CustomFieldValue>> = context.row.customFields,
) {
  const { row } = context;
  return {
    id: row.id,
    createdBy: row.createdBy,
    departmentId: row.departmentId,
    region: row.region,
    number: row.number,
    title: row.title,
    description: row.description,
    matterTypeId: row.matterTypeId,
    matterTypeName: context.matterTypeName,
    statusId: row.statusId,
    statusName: context.statusName,
    statusCategory: context.statusCategory,
    statusProgressionGroup: context.statusProgressionGroup,
    manager: context.manager
      ? {
          id: context.manager.id,
          displayName: context.manager.displayName,
          image: context.manager.image,
          archived: context.manager.archivedAt !== null,
        }
      : null,
    priority: row.priority,
    risk: row.risk,
    aiUnverified: row.aiUnverified
      ? Object.fromEntries(
          Object.entries(row.aiUnverified).filter(
            ([slug]) => !slug.startsWith("field:") || slug.slice(6) in customFields,
          ),
        )
      : null,
    customFields,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    isConfidential: row.isConfidential,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    nextDeadline: context.nextDeadline ?? null,
  };
}

export const selectMatters = (db: Executor, today: string = civilToday()) =>
  db
    .select({
      row: matters,
      matterTypeName: matterTypes.displayName,
      statusName: matterStatuses.displayName,
      statusCategory: matterStatuses.category,
      statusProgressionGroup: matterStatuses.progressionGroup,
      manager: {
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
      },
      nextDeadline: nextDeadline("matter", today),
    })
    .from(matters)
    .innerJoin(matterTypes, eq(matters.matterTypeId, matterTypes.id))
    .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
    .leftJoin(users, eq(matters.managerId, users.id));

export const selectTeam = async (db: Executor, matterId: string) => {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    })
    .from(matterTeam)
    .innerJoin(users, eq(matterTeam.userId, users.id))
    .where(eq(matterTeam.matterId, matterId))
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    image: row.image,
    archived: row.archivedAt !== null,
  }));
};

export async function lockedMatter(
  tx: Transaction,
  number: number,
  user: AuthenticatedUser,
): Promise<MatterContext> {
  const row = await reachedMatter(tx, user, number, { lock: true });
  if (!row) throw httpError(404, NO_MATTER);
  const [context] = await selectMatters(tx).where(eq(matters.id, row.id)).limit(1);
  if (!context) throw httpError(404, NO_MATTER);
  return context;
}

export function assertEditable(context: MatterContext): void {
  if (context.row.archivedAt) {
    throw httpError(409, "This matter is archived. Restore it before editing.");
  }
}

export async function assertAudienceActor(
  tx: Transaction,
  current: MatterContext,
  user: AuthenticatedUser,
  refusal: string,
): Promise<void> {
  const verdict = await matterConfidentialityWrite(tx, user, current.row);
  if (verdict === "unreachable") throw httpError(404, NO_MATTER);
  if (verdict === "refused") throw httpError(403, refusal);
}

export async function lockedLiveUser(tx: Transaction, userId: string, managerOnly = false) {
  const [person] = await tx
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!person || person.archivedAt || (managerOnly && !MATTER_MANAGER_ROLES.has(person.role))) {
    throw httpError(400, managerOnly ? MATTER_MANAGER_REFUSAL : "That is not a person we can add.");
  }
  return person;
}

export const scope = (db: Executor, user: AuthenticatedUser) => matterTeamScope(db, user);

const SORTS: Record<MatterSortKey, { expr: SQL; joined: boolean }> = {
  number: { expr: sql`${matters.number}`, joined: false },
  title: { expr: sql`lower(${matters.title})`, joined: false },
  type: { expr: sql`lower(${matterTypes.displayName})`, joined: true },
  status: { expr: sql`${matterStatuses.displayOrder}`, joined: true },
  priority: { expr: severityRank(matters.priority), joined: false },
  risk: { expr: severityRank(matters.risk), joined: false },
  manager: { expr: sql`lower(${users.displayName})`, joined: true },
  openedAt: { expr: sql`${matters.openedAt}`, joined: false },
};

export function listOrder(sort: SortRequest | null): SQL[] {
  if (!sort) return [sql`${matters.number} desc`];
  const { expr } = SORTS[sort.key];
  return [
    sql`${expr} ${sql.raw(sort.dir === "asc" ? "asc" : "desc")} nulls last`,
    sql`${matters.number} desc`,
  ];
}

export function furtherDownThan(
  db: Executor,
  cursor: string,
  user: AuthenticatedUser,
  sort: SortRequest | null,
): SQL {
  const reach = scope(db, user);
  const at = sql`(
      select ${matters.number} from ${matters}
      where ${and(eq(matters.id, cursor), reach)}
    )`;
  if (!sort) return sql`${matters.number} < ${at}`;
  const { expr, joined } = SORTS[sort.key];
  const value = joined
    ? sql`(
          select ${expr} from ${matters}
            inner join ${matterTypes} on ${eq(matters.matterTypeId, matterTypes.id)}
            inner join ${matterStatuses} on ${eq(matters.statusId, matterStatuses.id)}
            left join ${users} on ${eq(matters.managerId, users.id)}
          where ${and(eq(matters.id, cursor), reach)}
          limit 1
        )`
    : sql`(
          select ${expr} from ${matters}
          where ${and(eq(matters.id, cursor), reach)}
        )`;
  const later = sql.raw(sort.dir === "asc" ? ">" : "<");
  return sql`case
      when ${value} is null
        then (${expr} is null and ${matters.number} < ${at})
      else (
        ${expr} is null
        or ${expr} ${later} ${value}
        or (${expr} = ${value} and ${matters.number} < ${at})
      )
    end`;
}

export const incomplete = sql`exists (
    select 1 from ${matterTypeFields}
    inner join ${fields} on ${fields.id} = ${matterTypeFields.fieldId}
    where ${matterTypeFields.typeId} = ${matters.matterTypeId}
      and ${matterTypeFields.isRequired} = true
      and ${fields.archivedAt} is null
      and (
        not jsonb_exists(${matters.customFields}, ${fields.slug})
        or ${matters.customFields} -> ${fields.slug} = 'null'::jsonb
        or ${matters.customFields} -> ${fields.slug} = '[]'::jsonb
        or ${matters.customFields} ->> ${fields.slug} = ''
      )
  )`;
export const MatterListQuery = z
  .object({
    includeClosed: z.enum(["true", "false"]).optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
    status: FilterChoices.optional(),
    type: FilterChoices.optional(),
    priority: FilterChoices.refine((value) =>
      value
        .split(",")
        .every((item) => SEVERITY_LEVELS.includes(item as (typeof SEVERITY_LEVELS)[number])),
    ).optional(),
    risk: FilterChoices.refine((value) =>
      value
        .split(",")
        .every(
          (item) =>
            item === "unassigned" ||
            SEVERITY_LEVELS.includes(item as (typeof SEVERITY_LEVELS)[number]),
        ),
    ).optional(),
    timeZone: TimezoneSchema.optional(),
    openedFrom: z.iso.date().optional(),
    openedTo: z.iso.date().optional(),
    deadlineFrom: z.iso.date().optional(),
    deadlineTo: z.iso.date().optional(),
    manager: FilterChoices.optional(),
    incomplete: z.enum(["true", "false"]).optional(),
    sort: z.enum(MATTER_SORT_KEYS).optional(),
    dir: z.enum(SORT_DIRECTIONS).optional(),
    cursor: CursorSchema.optional(),
  })
  .refine(validDateRanges, "The end date must be on or after the start date");

export const MatterPatchBody = z.strictObject({
  title: z.string().trim().min(1).max(MAX_MATTER_TITLE_LENGTH).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  matterTypeId: z.string().optional(),
  managerId: z.string().nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  region: z.string().trim().max(200).nullable().optional(),
  businessOwnerId: z.string().nullable().optional(),
  priority: SeveritySchema.optional(),
  risk: SeveritySchema.nullable().optional(),
  customFields: CustomFieldsInput.optional(),
  statusId: z.string().optional(),
  closingNote: z.string().trim().min(1).max(2000).optional(),
  confirmReopen: z.literal(true).optional(),
  isConfidential: z.boolean().optional(),
});

export const MatterUpdateBody = MatterPatchBody.omit({
  statusId: true,
  closingNote: true,
  confirmReopen: true,
});
export const MatterStatusBody = MatterPatchBody.pick({
  statusId: true,
  closingNote: true,
  confirmReopen: true,
}).required({ statusId: true });
