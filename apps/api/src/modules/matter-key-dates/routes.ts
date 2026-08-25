// SPDX-License-Identifier: AGPL-3.0-only

/** Named civil Key dates on a Matter (MTR-004, #491). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  matterKeyDates,
  matters,
  matterStatuses,
  type Executor,
  type Matter,
  type Transaction,
} from "@openlaw/db";
import {
  MAX_KEY_DATE_LABEL_LENGTH,
  MAX_KEY_DATE_NOTE_LENGTH,
  type ChangedFields,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { civilToday, daysBetween } from "../../lib/contract-term.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const requireReader = requireRole("administrator", "legal_team_member", "contributor");
const requireMember = requireRole("administrator", "legal_team_member");
const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const KeyDateParams = z.object({ keyDateId: z.string().min(1).max(64) });
const LabelSchema = z.string().trim().min(1).max(MAX_KEY_DATE_LABEL_LENGTH);
const NoteSchema = z.string().trim().max(MAX_KEY_DATE_NOTE_LENGTH).nullable();
const NO_KEY_DATE = "No Matter Key date exists with this id.";
const FROZEN = "This matter is archived. Restore it before changing its Key dates.";

const DeadlineSchema = z.object({
  keyDateId: z.string(),
  date: z.iso.date(),
  label: z.string(),
  note: z.string().nullable(),
  daysAway: z.int(),
  overdue: z.boolean(),
  isNext: z.boolean(),
});
const DeadlinesEnvelope = z.object({ deadlines: z.array(DeadlineSchema) });

interface MatterContext {
  matter: Matter;
  statusCategory: "open" | "closed";
}

export const matterKeyDatesRoutes: FastifyPluginAsyncZod = async (app) => {
  async function reachedContext(
    db: Executor,
    user: AuthenticatedUser,
    number: number,
  ): Promise<MatterContext | null>;
  async function reachedContext(
    db: Transaction,
    user: AuthenticatedUser,
    number: number,
    lock: true,
  ): Promise<MatterContext | null>;
  async function reachedContext(
    db: Executor,
    user: AuthenticatedUser,
    number: number,
    lock = false,
  ): Promise<MatterContext | null> {
    const matter = lock
      ? await reachedMatter(db as Transaction, user, number, { lock: true })
      : await reachedMatter(db, user, number);
    if (!matter) return null;
    const [status] = await db
      .select({ category: matterStatuses.category })
      .from(matterStatuses)
      .where(eq(matterStatuses.id, matter.statusId))
      .limit(1);
    return status ? { matter, statusCategory: status.category } : null;
  }

  async function deadlinesOf(db: Executor, context: MatterContext, now: Date = new Date()) {
    const rows = await db
      .select({
        keyDateId: matterKeyDates.id,
        date: matterKeyDates.date,
        label: matterKeyDates.label,
        note: matterKeyDates.note,
      })
      .from(matterKeyDates)
      .where(eq(matterKeyDates.matterId, context.matter.id))
      .orderBy(asc(matterKeyDates.date), asc(matterKeyDates.id));
    const today = civilToday(now);
    const active = context.statusCategory === "open" && context.matter.archivedAt === null;
    const deadlines = rows.map((row) => {
      const daysAway = daysBetween(today, row.date);
      return { ...row, daysAway, overdue: daysAway < 0, isNext: false };
    });
    if (active) {
      const next = deadlines.find((row) => !row.overdue);
      if (next) next.isNext = true;
    }
    return { deadlines };
  }

  async function reachedKeyDate(tx: Transaction, user: AuthenticatedUser, keyDateId: string) {
    const [row] = await tx
      .select({
        id: matterKeyDates.id,
        date: matterKeyDates.date,
        label: matterKeyDates.label,
        note: matterKeyDates.note,
        matter: matters,
        statusCategory: matterStatuses.category,
      })
      .from(matterKeyDates)
      .innerJoin(matters, eq(matterKeyDates.matterId, matters.id))
      .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
      .where(and(eq(matterKeyDates.id, keyDateId), matterTeamScope(tx, user)))
      .limit(1)
      .for("update", { of: matters });
    return row
      ? {
          id: row.id,
          date: row.date,
          label: row.label,
          note: row.note,
          context: { matter: row.matter, statusCategory: row.statusCategory },
        }
      : null;
  }

  function assertWritable(context: MatterContext | null): asserts context is MatterContext {
    if (!context) throw httpError(404, NO_MATTER);
    if (context.matter.archivedAt) throw httpError(409, FROZEN);
  }
  const toNote = (note: string | null | undefined): string | null => note?.trim() || null;

  app.get(
    "/matters/:number/key-dates",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterKeyDates",
        summary:
          "List a reached Matter's named Key dates chronologically, marking overdue rows and the earliest active Next deadline. Closed and archived Matters retain their rows but mark none active",
        tags: ["matter-key-dates"],
        params: NumberParams,
        response: { 200: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const context = await reachedContext(app.db, request.user, request.params.number);
      if (!context) throw httpError(404, NO_MATTER);
      return deadlinesOf(app.db, context);
    },
  );

  app.post(
    "/matters/:number/key-dates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addMatterKeyDate",
        summary:
          "Add a named civil Key date to a reached, non-archived Matter. Closing does not freeze the record",
        tags: ["matter-key-dates"],
        params: NumberParams,
        body: z.strictObject({
          date: z.iso.date(),
          label: LabelSchema,
          note: NoteSchema.optional(),
        }),
        response: { 201: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const answer = await app.db.transaction(async (tx) => {
        const context = await reachedContext(tx, request.user, request.params.number, true);
        assertWritable(context);
        const note = toNote(request.body.note);
        const [created] = await tx
          .insert(matterKeyDates)
          .values({
            matterId: context.matter.id,
            date: request.body.date,
            label: request.body.label,
            note,
          })
          .returning({ id: matterKeyDates.id });
        await recordActivity(tx, {
          entityType: "matter",
          entityId: context.matter.id,
          actorId: request.user.id,
          action: "key_date.added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { keyDateId: created!.id, label: request.body.label, date: request.body.date },
        });
        return deadlinesOf(tx, context);
      });
      return reply.status(201).send(answer);
    },
  );

  app.patch(
    "/matter-key-dates/:keyDateId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateMatterKeyDate",
        summary: "Move, rename, or amend one reached Matter Key date",
        tags: ["matter-key-dates"],
        params: KeyDateParams,
        body: z
          .strictObject({
            date: z.iso.date().optional(),
            label: LabelSchema.optional(),
            note: NoteSchema.optional(),
          })
          .meta({ minProperties: 1 })
          .refine((body) => Object.keys(body).length > 0, {
            message: "Send at least one of date, label, or note.",
          }),
        response: { 200: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const current = await reachedKeyDate(tx, request.user, request.params.keyDateId);
        if (!current) throw httpError(404, NO_KEY_DATE);
        assertWritable(current.context);
        const wanted = {
          date: request.body.date ?? current.date,
          label: request.body.label ?? current.label,
          note: request.body.note === undefined ? current.note : toNote(request.body.note),
        };
        const changed: ChangedFields = {};
        if (wanted.date !== current.date) changed.date = { from: current.date, to: wanted.date };
        if (wanted.label !== current.label)
          changed.label = { from: current.label, to: wanted.label };
        if (wanted.note !== current.note) changed.note = { from: current.note, to: wanted.note };
        if (Object.keys(changed).length > 0) {
          await tx.update(matterKeyDates).set(wanted).where(eq(matterKeyDates.id, current.id));
          await recordActivity(tx, {
            entityType: "matter",
            entityId: current.context.matter.id,
            actorId: request.user.id,
            action: "key_date.edited",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { keyDateId: current.id, label: wanted.label, changed },
          });
        }
        return deadlinesOf(tx, current.context);
      }),
  );

  app.delete(
    "/matter-key-dates/:keyDateId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeMatterKeyDate",
        summary: "Remove one reached Matter Key date while retaining its Activity narration",
        tags: ["matter-key-dates"],
        params: KeyDateParams,
        response: { 200: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const current = await reachedKeyDate(tx, request.user, request.params.keyDateId);
        if (!current) throw httpError(404, NO_KEY_DATE);
        assertWritable(current.context);
        await tx.delete(matterKeyDates).where(eq(matterKeyDates.id, current.id));
        await recordActivity(tx, {
          entityType: "matter",
          entityId: current.context.matter.id,
          actorId: request.user.id,
          action: "key_date.removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { keyDateId: current.id, label: current.label, date: current.date },
        });
        return deadlinesOf(tx, current.context);
      }),
  );
};
