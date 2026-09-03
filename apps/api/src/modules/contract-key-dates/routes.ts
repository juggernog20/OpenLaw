// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's key dates, and the deadline union they belong to (M16/3)
 * — CTR-009's free-form dates beside CTR-006's typed term.
 *
 * A Member+ user with reach puts a named date on a record, moves it, and
 * takes it off. The read answers more than those rows: it answers the
 * **union** CTR-009 commits to — the key dates, the contract's expiry,
 * and the derived notice deadline — in one list, so a reader asking
 * "what is the next date on this contract" asks one question.
 *
 * **Two of the three sources are not rows.** The expiry is a column of
 * `contracts` and the notice deadline is a subtraction over two of them
 * ({@link noticeDeadline}), computed here and stored nowhere. Both ride
 * the union with a null `keyDateId`, which is what says they cannot be
 * edited or removed here: the way to move them is to edit the term, on
 * the record's own card.
 *
 * **The next deadline is the seam's answer, not the client's.** The
 * union is ordered upcoming-first and nearest-first, the dates that have
 * gone by follow it most-recent-first, and exactly one entry — the
 * earliest upcoming — is marked. A record whose every date has passed
 * marks none. `daysAway` rides each entry for the same reason
 * `daysRemaining` rides the contract row (DES-040 clause 4): it is one
 * number two places could disagree about, so one place counts it.
 *
 * **Deliberately flat** (CTR-009). No owner on a date, because the
 * matters-side owner question is a matters question. No per-date
 * reminder schedule, because NOT-004 already fixed one global offset
 * list for every tracked date — what fires on these dates is M18's, and
 * this module ships the data it will fire on.
 *
 * **Access is inherited and nothing is held here** (DD-014, CTR-021).
 * Every route answers the owning contract's reach question first, with
 * the same `reachedContract` read the record, its paper, its approvals,
 * and its feed are read through — so a viewer who cannot reach the
 * contract is answered exactly as for a contract that was never created,
 * on the listing and on every write alike. Confidentiality therefore
 * inherits for free, and no rule here had to say so. Reads are the
 * contract read floor, so a Contributor on the team reads the record's
 * deadlines; DD-015 deliberately keeps date writes at Member+.
 *
 * **Every act is narrated** (DD-017). Add, edit, and remove each append
 * one entry on the owning contract at the standing record tier, inside
 * the same transaction as the write — so a failed log write rolls the
 * mutation back rather than leaving an unrecorded change. A removal
 * deletes the row, which is why its entry carries the label and the date
 * rather than only the id: the entry is what is left of the date.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractKeyDates,
  contracts,
  eq,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import {
  MAX_KEY_DATE_LABEL_LENGTH,
  MAX_KEY_DATE_NOTE_LENGTH,
  type ChangedFields,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { derivedDateUnverified, type DerivedDateSource } from "../../lib/ai-unverified.js";
import {
  contractTeamScope,
  NO_CONTRACT,
  reachedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import { civilToday, daysBetween, noticeDeadline } from "../../lib/contract-term.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The contract read floor (CTR-021), which is the deadline surface's
 * read floor too: a Contributor on the team reads what is coming up on
 * the record they are working. The role alone opens nothing — the reach
 * predicate narrows it to the records they hold a `contract_team` row
 * on. */
const requireKeyDateReader = requireRole("administrator", "legal_team_member", "contributor");

/** Adding, moving, and removing a date are Member+ in M16, as putting
 * paper on a record is. A Contributor reads the surface but DD-015 gives
 * them no Key-date write. */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * A key date on a contract this viewer cannot reach answers exactly as
 * `NO_CONTRACT` has the record itself answer. Its own id says nothing
 * about which record it belongs to, so refusing it any other way would
 * be the leak the 404 exists to prevent.
 */
const NO_KEY_DATE = "No key date exists with this id.";

/** The sentence every write on a frozen record answers with (CTR-021):
 * an archived contract reads as facts until it is restored, and its
 * dates are part of the record rather than a conversation about it. */
const FROZEN = "This contract is archived. Restore it before changing its key dates.";

const RecordIdSchema = z.string().min(1).max(64);

/** A label is a line and never blank: a date nobody named is a date
 * nobody can act on. Trimmed before the bound is applied, so a label of
 * nothing but spaces is refused rather than stored as a name nobody can
 * see. */
const LabelSchema = z.string().trim().min(1).max(MAX_KEY_DATE_LABEL_LENGTH);
/** A note is a paragraph beside the date, and `null` is how it is
 * cleared. A blank string is not a shorter note — it is the same
 * absence, and it is normalized to `null` before the column sees it. */
const NoteSchema = z.string().trim().max(MAX_KEY_DATE_NOTE_LENGTH).nullable();

/** Where one row of the union came from (CTR-009). Fixed rather than
 * configurable: the surface branches on it — only a `key_date` carries
 * controls — and the two derived sources have no row to rename. */
const DEADLINE_SOURCES = ["notice_deadline", "expiry", "key_date"] as const;

/**
 * One date on the record's deadline surface, whichever of the three
 * sources it came from.
 *
 * One shape for all three rather than a list of key dates beside a pair
 * of scalars: the surface draws them in one table, ordered together, and
 * two shapes would mean the order was assembled twice — once here and
 * once wherever they were merged.
 */
const DeadlineSchema = z.object({
  source: z.enum(DEADLINE_SOURCES),
  /** The row's own id on a key date, and `null` on the two the term
   * derives — which is what says which rows may be edited and removed
   * here. */
  keyDateId: z.string().nullable(),
  date: z.iso.date(),
  /** What a key date is called. `null` on the derived rows: the expiry
   * and the notice deadline are named by the surface that draws them,
   * in its own locale copy (DES-013), not by the seam. */
  label: z.string().nullable(),
  note: z.string().nullable(),
  /** Whole days from today, negative once the date has gone by. Derived
   * here so the count, the order, and the mark below cannot disagree. */
  daysAway: z.int(),
  /** The earliest date still ahead — CTR-009's "next deadline". Exactly
   * one entry carries it, or none when every date has passed. */
  isNext: z.boolean(),
  /** True only when a term-derived row reads an AI-written source no
   * person has confirmed. Key dates are always false. */
  unverified: z.boolean(),
});

const DeadlinesEnvelope = z.object({ deadlines: z.array(DeadlineSchema) });

const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const KeyDateParams = z.object({ keyDateId: RecordIdSchema });

/** Which of the three sources leads when two of them fall on one day, so
 * the order is total: the deadline that warns of the expiry, then the
 * expiry, then the record's own dates. */
const SOURCE_RANK: Record<(typeof DEADLINE_SOURCES)[number], number> = {
  notice_deadline: 0,
  expiry: 1,
  key_date: 2,
};

export const contractKeyDatesRoutes: FastifyPluginAsyncZod = async (app) => {
  /** One key date this viewer reaches, and the record it is on. The
   * record comes along whole because the answer to every write is the
   * whole union, and two of the union's three sources are columns of
   * that record. */
  interface ReachedKeyDate {
    id: string;
    date: string;
    label: string;
    note: string | null;
    contract: ReachedContract;
  }

  /**
   * One key date this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and the reach predicate rides
   * beside the id, so a key date on a contract the viewer cannot reach
   * is indistinguishable from one that was never created. The lock is
   * held on the **contract** row — not the key-date row — because that
   * is the lock every write on a record serializes behind.
   */
  async function reachedKeyDate(
    tx: Transaction,
    user: AuthenticatedUser,
    keyDateId: string,
  ): Promise<ReachedKeyDate | null> {
    const [row] = await tx
      .select({
        id: contractKeyDates.id,
        date: contractKeyDates.date,
        label: contractKeyDates.label,
        note: contractKeyDates.note,
        contract: {
          id: contracts.id,
          number: contracts.number,
          title: contracts.title,
          archivedAt: contracts.archivedAt,
          managerId: contracts.managerId,
          primaryDocumentId: contracts.primaryDocumentId,
          matterId: contracts.matterId,
          isConfidential: contracts.isConfidential,
          expiryDate: contracts.expiryDate,
          noticePeriodDays: contracts.noticePeriodDays,
          aiUnverified: contracts.aiUnverified,
        },
      })
      .from(contractKeyDates)
      .innerJoin(contracts, eq(contractKeyDates.contractId, contracts.id))
      .where(and(eq(contractKeyDates.id, keyDateId), contractTeamScope(tx, user)))
      .limit(1)
      .for("update", { of: contracts });
    return row ?? null;
  }

  /**
   * One contract's whole deadline surface: the CTR-009 union, ordered,
   * counted, and marked.
   *
   * The two term-derived entries are built from the columns the reach
   * read already carried, so the union costs one query — the key dates
   * — rather than two.
   *
   * The order is the mock's (C6) and it is two runs, not one: what is
   * still ahead, nearest first, and then what has gone by, most recent
   * first. Both runs read outward from today, which is the day the
   * surface is being read on and the only place a reader's attention
   * starts from. Within one day the source rank breaks the tie, then the
   * label, then the id — so the order is total and a redraw never
   * shuffles two rows past each other.
   */
  async function deadlinesOf(db: Executor, contract: ReachedContract, now: Date = new Date()) {
    const rows = await db
      .select({
        id: contractKeyDates.id,
        date: contractKeyDates.date,
        label: contractKeyDates.label,
        note: contractKeyDates.note,
      })
      .from(contractKeyDates)
      .where(eq(contractKeyDates.contractId, contract.id))
      .orderBy(asc(contractKeyDates.date), asc(contractKeyDates.id));

    const today = civilToday(now);
    const entries: z.infer<typeof DeadlineSchema>[] = rows.map((row) => ({
      source: "key_date" as const,
      keyDateId: row.id,
      date: row.date,
      label: row.label,
      note: row.note,
      daysAway: daysBetween(today, row.date),
      isNext: false,
      unverified: false,
    }));

    /** A term-derived date joins the union as a row with no row behind
     * it: no id, no label, and nothing here to edit. */
    const derived = (source: DerivedDateSource, date: string | null) => {
      if (date === null) return;
      entries.push({
        source,
        keyDateId: null,
        date,
        label: null,
        note: null,
        daysAway: daysBetween(today, date),
        isNext: false,
        unverified: derivedDateUnverified(contract.aiUnverified, source),
      });
    };
    derived("expiry", contract.expiryDate);
    derived("notice_deadline", noticeDeadline(contract.expiryDate, contract.noticePeriodDays));

    entries.sort((left, right) => {
      const leftPast = left.daysAway < 0;
      const rightPast = right.daysAway < 0;
      if (leftPast !== rightPast) return leftPast ? 1 : -1;
      // Ahead: nearest first. Behind: most recently passed first. Both
      // are "outward from today", which is one rule read twice.
      if (left.date !== right.date) {
        const ascending = left.date < right.date ? -1 : 1;
        return leftPast ? -ascending : ascending;
      }
      if (left.source !== right.source) return SOURCE_RANK[left.source] - SOURCE_RANK[right.source];
      const byLabel = (left.label ?? "").localeCompare(right.label ?? "");
      if (byLabel !== 0) return byLabel;
      return (left.keyDateId ?? "").localeCompare(right.keyDateId ?? "");
    });

    // The first entry that is still ahead, which the sort has already
    // put at the front of the list when there is one at all.
    const next = entries.find((entry) => entry.daysAway >= 0);
    if (next) next.isNext = true;
    return { deadlines: entries };
  }

  /**
   * The two refusals every key-date write shares, in the order they have
   * to be asked in.
   *
   * Reach first: a 409 on a record the writer cannot reach would tell
   * them it is there. Then the freeze.
   */
  function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) throw httpError(409, FROZEN);
  }

  /** A note as the column holds it: the text, or nothing at all. A blank
   * string is the same absence spelled differently, and readers must
   * have one absence to test. */
  const toNote = (note: string | null | undefined): string | null => note?.trim() || null;

  app.get(
    "/contracts/:number/key-dates",
    {
      preHandler: requireKeyDateReader,
      schema: {
        operationId: "listContractKeyDates",
        summary:
          "One contract's whole deadline surface (CTR-009): the union of " +
          "its key dates, its expiry date, and its derived notice " +
          "deadline, ordered with what is still ahead first and nearest " +
          "first, then what has gone by, most recently passed first. " +
          "Exactly one entry — the earliest still ahead — is marked as " +
          "the next deadline, and none is on a record whose every date " +
          "has passed. The expiry and the notice deadline carry no key " +
          "date id, because no row backs them: the notice deadline is " +
          "the expiry minus the notice period, computed on every read " +
          "and stored nowhere, and both move by editing the term on the " +
          "record. Access is inherited from the contract and nothing " +
          "else: a Contributor on the team reads the surface, and anyone " +
          "who cannot reach the contract — a Contributor who is not on " +
          "it, a Legal Team Member outside a confidential record's " +
          "audience — is answered 404, exactly as for a contract that " +
          "does not exist. An archived contract still reads: archiving " +
          "freezes a record, it does not hide it",
        tags: ["key-dates"],
        params: NumberParams,
        response: { 200: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return await deadlinesOf(app.db, contract);
    },
  );

  app.post(
    "/contracts/:number/key-dates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractKeyDate",
        summary:
          "Put a named date on a contract (CTR-009): a calendar date, a " +
          "label, and an optional note — the free-form escape hatch " +
          "beside the typed term columns, for price reviews, " +
          "option-exercise windows, and delivery milestones. A blank " +
          "label is refused and a blank note is stored as no note at " +
          "all. There is no owner and no per-date reminder schedule: " +
          "NOT-004 fixed one global offset list for every tracked date. " +
          "Answers the record's whole deadline surface, because a new " +
          "date can change which one is next. Appends one key_date.added " +
          "entry on the owning contract at the working-team tier " +
          "(DD-017). Member+: a Contributor who reaches the record is " +
          "refused 403 rather than 404, because they can already see it. " +
          "An archived contract takes no new date until it is restored",
        tags: ["key-dates"],
        params: NumberParams,
        // Strict: an unknown key is a client bug, not a silent strip.
        body: z.strictObject({
          date: z.iso.date(),
          label: LabelSchema,
          note: NoteSchema.optional(),
        }),
        response: { 201: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { date, label } = request.body;
      const note = toNote(request.body.note);

      const answer = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        assertOpen(contract);

        const [created] = await tx
          .insert(contractKeyDates)
          .values({ contractId: contract.id, date, label, note })
          .returning({ id: contractKeyDates.id });

        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "key_date.added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { keyDateId: created!.id, label, date },
        });

        return deadlinesOf(tx, contract);
      });
      return reply.status(201).send(answer);
    },
  );

  app.patch(
    "/key-dates/:keyDateId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContractKeyDate",
        summary:
          "Move a key date, rename it, or change its note (CTR-009). " +
          "Every field is optional and only what is sent is read, so a " +
          "surface that edits one of them sends one of them; a note is " +
          "cleared by sending null. A request that changes nothing " +
          "writes nothing and narrates nothing. Answers the record's " +
          "whole deadline surface, because moving a date can change " +
          "which one is next. Appends one key_date.edited entry naming " +
          "only what moved, at the working-team tier (DD-017). A key " +
          "date on a contract this viewer cannot reach answers 404, " +
          "exactly as for one that does not exist; an archived contract " +
          "takes no edit until it is restored",
        tags: ["key-dates"],
        params: KeyDateParams,
        body: z
          .strictObject({
            date: z.iso.date().optional(),
            label: LabelSchema.optional(),
            note: NoteSchema.optional(),
          })
          // A body with nothing in it is a client that built the request
          // badly, not an edit of nothing.
          .refine((body) => Object.keys(body).length > 0, {
            message: "Send at least one of date, label, or note.",
          }),
        response: { 200: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        const keyDate = await reachedKeyDate(tx, request.user, request.params.keyDateId);
        if (!keyDate) throw httpError(404, NO_KEY_DATE);
        if (keyDate.contract.archivedAt) throw httpError(409, FROZEN);

        // Only what was sent is read, so a surface that edits one field
        // sends one field — the DES-017 rule, said over a row rather
        // than over the record's own columns.
        const wanted = {
          date: request.body.date ?? keyDate.date,
          label: request.body.label ?? keyDate.label,
          note: request.body.note === undefined ? keyDate.note : toNote(request.body.note),
        };
        const changed: ChangedFields = {};
        if (wanted.date !== keyDate.date) changed.date = { from: keyDate.date, to: wanted.date };
        if (wanted.label !== keyDate.label) {
          changed.label = { from: keyDate.label, to: wanted.label };
        }
        if (wanted.note !== keyDate.note) changed.note = { from: keyDate.note, to: wanted.note };

        // A re-sent identical row writes nothing and narrates nothing:
        // an audit entry saying something changed when nothing did is
        // worse than no entry at all.
        if (Object.keys(changed).length > 0) {
          await tx.update(contractKeyDates).set(wanted).where(eq(contractKeyDates.id, keyDate.id));

          await recordActivity(tx, {
            entityType: "contract",
            entityId: keyDate.contract.id,
            actorId: request.user.id,
            action: "key_date.edited",
            visibility: RECORD_ACTIVITY_TIER,
            // The label as it stands after the edit, so the sentence
            // names the date a reader would go and look at; a rename
            // carries both sides in `changed`.
            payload: { keyDateId: keyDate.id, label: wanted.label, changed },
          });
        }

        return deadlinesOf(tx, keyDate.contract);
      });
    },
  );

  app.delete(
    "/key-dates/:keyDateId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractKeyDate",
        summary:
          "Take a key date off a contract (CTR-009). The row is deleted " +
          "and the key_date.removed activity entry is the durable record " +
          "of it, which is why that entry carries the label and the date " +
          "rather than only the id. Answers the record's whole deadline " +
          "surface, because removing a date can change which one is " +
          "next. A key date on a contract this viewer cannot reach " +
          "answers 404, exactly as for one that does not exist; an " +
          "archived contract takes no removal until it is restored",
        tags: ["key-dates"],
        params: KeyDateParams,
        response: { 200: DeadlinesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        const keyDate = await reachedKeyDate(tx, request.user, request.params.keyDateId);
        if (!keyDate) throw httpError(404, NO_KEY_DATE);
        if (keyDate.contract.archivedAt) throw httpError(409, FROZEN);

        await tx.delete(contractKeyDates).where(eq(contractKeyDates.id, keyDate.id));

        // The row is gone, so this entry is the only thing left that
        // says the date was ever on the record — which is why it carries
        // the label and the date and not only the id.
        await recordActivity(tx, {
          entityType: "contract",
          entityId: keyDate.contract.id,
          actorId: request.user.id,
          action: "key_date.removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { keyDateId: keyDate.id, label: keyDate.label, date: keyDate.date },
        });

        return deadlinesOf(tx, keyDate.contract);
      });
    },
  );
};
