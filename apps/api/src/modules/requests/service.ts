// SPDX-License-Identifier: AGPL-3.0-only

import type { Db } from "@openlaw/db";
import {
  and,
  count,
  departments,
  desc,
  eq,
  gte,
  isNull,
  ne,
  REQUEST_STATUSES,
  requests,
  requestTypes,
  SEVERITY_LEVELS,
  sql,
  users,
  type CustomFieldValue,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { evaluateForm, intakeFormAnswers, isOpenRequestStatus } from "@openlaw/shared";
import { z } from "zod";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { NO_PERMISSION } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import {
  coerceCustomFieldValue,
  CustomFieldsInput,
  hasCustomFieldValue,
  listNames,
  type AttachedCustomField,
} from "../../lib/custom-fields.js";
import {
  IntakeCounterpartiesInput,
  resolveIntakeCounterparties,
} from "../../lib/intake-counterparties.js";
import { readIntakeContractFacts } from "../../lib/intake-default-fields.js";
import {
  invalidIntakeRows,
  IntakeFormError as RequestFormError,
} from "../../lib/intake-form-error.js";
import { intakeRowKeys, readIntakeForm } from "../../lib/intake-form.js";
import type { Notifier } from "../../lib/notifications/notifier.js";
import { assertPortalEntity } from "../../lib/portal-entities.js";
import { HttpError, httpError } from "../../lib/problem.js";
import { departmentName, lockedDepartment } from "../departments/references.js";
import { publishInboxTotal } from "./live-inbox.js";
import { NO_REQUEST, requestAssignees, staffRequestRow, toStaffRequest } from "./projection.js";

function assertMember(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}

export const SubmitRequestBody = z.strictObject({
  requestTypeId: z.string(),
  departmentId: z.string().min(1).nullable().optional(),
  title: z.string(),
  description: z.string().optional(),
  /** DES-018's four severity levels and nothing else. */
  urgency: z.enum(SEVERITY_LEVELS),
  customFields: CustomFieldsInput.optional(),
  counterparties: IntakeCounterpartiesInput.optional(),
});
export async function submitRequest(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof SubmitRequestBody>,
  notifier: Notifier,
) {
  const body = SubmitRequestBody.parse(input);
  // The seam's transaction rather than the database's: the receipt
  // is written inside the same commit as the Request it is about
  // (NOT-001), so a submission that rolls back leaves no receipt for
  // an ask nobody made — and the email leaves only after it commits.
  const created = await notifier.notifying(async (tx) => {
    // One person's submissions run one at a time through this lock,
    // so a burst cannot read the same count and all pass the quota.
    await lockPerson(tx, user.id);
    if ((await recentRequestCount(tx, user.id)) >= MAX_REQUESTS_PER_HOUR)
      throw httpError(
        429,
        `You have submitted ${MAX_REQUESTS_PER_HOUR} Requests in the last hour. Wait before submitting another.`,
      );
    // Locked for the reason the contract create locks its type: an
    // unlocked read lets a concurrent archive commit between the
    // check and the insert, and the Request is then born on a form
    // that takes no submissions.
    const [requestType] = await tx
      .select({
        id: requestTypes.id,
        displayName: requestTypes.displayName,
        archivedAt: requestTypes.archivedAt,
      })
      .from(requestTypes)
      .where(eq(requestTypes.id, body.requestTypeId))
      .limit(1)
      .for("update");
    if (!requestType || requestType.archivedAt) {
      throw httpError(400, "That request type is not taking submissions.");
    }

    // The type's attached fields, in the order the form draws them.
    // The portal's form route reads the same thing the same way —
    // that is what makes the refusal and the screen agree.
    const intake = await readIntakeForm(tx, requestType.id, { lock: true });
    const attached = intake.fields;
    const rawFields = { ...(body.customFields ?? {}) };
    // Description is a Row of the destination Form (DD-028.3). Off the
    // form, a top-level description still lands on the Request column.
    const collectsDescription = attached.some((field) => field.slug === "description");
    if (body.description !== undefined && body.description.trim() && collectsDescription)
      rawFields.description = body.description;
    if (rawFields.counterparties !== undefined && body.counterparties === undefined) {
      const picks = rawFields.counterparties;
      if (!Array.isArray(picks))
        throw invalidIntakeRows("Counterparties: pick from the registry.", "Counterparties");
      const parsed = IntakeCounterpartiesInput.safeParse(
        picks.map((counterpartyId) => ({ counterpartyId })),
      );
      if (!parsed.success)
        throw invalidIntakeRows(
          "Counterparties: select up to 50 registry entries.",
          "Counterparties",
        );
      body.counterparties = parsed.data;
    }
    let intakeCounterparties: Array<{ counterpartyId?: string; name: string }> = [];
    if (body.counterparties !== undefined) {
      const field = attached.find((field) => field.builtInKey === "counterparties");
      if (!field)
        throw invalidIntakeRows("This form does not collect counterparties.", "Counterparties");
      try {
        intakeCounterparties = await resolveIntakeCounterparties(tx, body.counterparties);
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
        throw invalidIntakeRows(error.message, field.displayName);
      }
      rawFields[field.slug] = intakeCounterparties.map(
        (party) => party.counterpartyId ?? party.name,
      );
    }
    const customFields = collectValues(attached, rawFields);
    const visible = evaluateForm(intake.form, intakeFormAnswers(customFields)).visibleRows;
    const visibleKeys = new Set(visible.flatMap((row) => intakeRowKeys(row.rowRef)));
    for (const key of Object.keys(rawFields)) {
      if (visibleKeys.has(key)) continue;
      // Description keeps its Request column when its Row is off the
      // form (DD-028.3); older intake clients still send it top-level.
      if (key === "description" && body.customFields?.description === undefined) {
        delete rawFields.description;
        delete customFields.description;
        continue;
      }
      throw invalidIntakeRows(
        "That Row is not on the visible Request form.",
        attached.find((field) => field.slug === key)?.displayName ?? key,
      );
    }
    const visibleFields = attached.filter((field) => visibleKeys.has(field.slug));
    // Validate native facts now; conversion reads them again when creating the record.
    readIntakeContractFacts(customFields);

    // Lock referenced rows until submission commits, so a concurrent
    // archive or change to Portal-listed cannot admit a stale choice.
    for (const field of attached) {
      const value = customFields[field.slug];
      if (value === undefined) continue;
      if (field.fieldType === "user" || field.fieldType === "entity") {
        try {
          await assertLiveReference(tx, field, value as string);
        } catch (error) {
          if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
          throw new RequestFormError(error.message, [
            { name: field.displayName, reason: "invalid" },
          ]);
        }
      }
    }

    // The one refusal, over the basics and the attachments
    // together. Two refusals would make a requester press Submit
    // twice to learn two halves of the same answer.
    const title = body.title.trim();
    const description =
      typeof customFields.description === "string"
        ? customFields.description
        : (body.description?.trim() ?? "");
    assertAnswered([
      { name: "Title", answered: title !== "" },
      ...visibleFields
        .filter((field) => field.isRequired)
        .map((field) => ({
          name: field.displayName,
          answered: hasCustomFieldValue(customFields[field.slug]),
        })),
    ]);

    // Description already has a native Request column for older intake clients.
    if (body.description !== undefined && body.customFields?.description === undefined)
      delete customFields.description;
    const department = body.departmentId
      ? await lockedDepartment(tx, body.departmentId).catch((error: unknown) => {
          if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
          throw invalidIntakeRows(error.message, "Department");
        })
      : null;
    if (!department) {
      const [available] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(isNull(departments.archivedAt))
        .limit(1);
      if (available)
        throw new RequestFormError("Choose a Department.", [
          { name: "Department", reason: "missing" },
        ]);
    }
    const [row] = await tx
      .insert(requests)
      .values({
        requestTypeId: requestType.id,
        // DD-013, as a shape: the Requester is the session. There
        // is no body field to forge and no route to create one on
        // somebody else's behalf.
        requesterId: user.id,
        departmentId: department?.id ?? null,
        title,
        description,
        urgency: body.urgency,
        customFields,
        intakeCounterparties,
      })
      .returning();

    // DD-017's narration, in the same transaction as the insert, so
    // no Request can exist without the entry that says who asked.
    // The payload carries no free text — not the title, and not
    // the collected values, only the slugs that were answered. The
    // log is append-only, so a requester's own words could never
    // leave it again; R-42 is the Request's name, and the number
    // never changes.
    await recordActivity(tx, {
      entityType: "request",
      entityId: row!.id,
      actorId: user.id,
      action: "request.created",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        number: row!.number,
        requestType: requestType.displayName,
        urgency: row!.urgency,
        customFields: Object.keys(customFields).sort((a, b) => a.localeCompare(b)),
      },
    });
    // The receipt (INT-001, NOT-002 group 5), and the one event in
    // the catalog addressed to the person who caused it: proof that
    // an ask arrived is the whole content of the message, and a
    // receipt addressed to nobody is not a receipt. The exception
    // lives behind the seam — this route names what happened and
    // nothing else.
    await notifier.requestCreated(tx, {
      requestId: row!.id,
      actorId: user.id,
      actorName: user.displayName,
    });
    // The arrival (INT-006, NOT-002 group 4), which is the same act
    // told to the other side: every live Member+ hears that
    // something is waiting, bell on and email opt-in. Two events
    // rather than one, because the staff side and the requester side
    // are two sentences to two audiences with two defaults — and the
    // audience, the actor exclusion, the preferences, and the
    // after-commit wake-up are all the seam's, so this route still
    // names what happened and nothing else.
    await notifier.requestSubmitted(tx, {
      requestId: row!.id,
      actorId: user.id,
      actorName: user.displayName,
      requestType: requestType.displayName,
      urgency: row!.urgency,
    });
    await publishInboxTotal(tx);
    return row!;
  });

  return {
    request: {
      id: created.id,
      number: created.number,
      requestTypeId: created.requestTypeId,
      status: "new" as const,
      title: created.title,
      description: created.description,
      urgency: created.urgency,
      customFields: created.customFields,
      departmentId: created.departmentId,
      department: await departmentName(db, created.departmentId),
      createdAt: created.createdAt.toISOString(),
    },
  };
}
export async function listMyRequests(db: Db, user: AuthenticatedUser) {
  const rows = await db
    .select({
      id: requests.id,
      number: requests.number,
      status: requests.status,
      title: requests.title,
      createdAt: requests.createdAt,
      typeId: requestTypes.id,
      typeSlug: requestTypes.slug,
      typeDisplayName: requestTypes.displayName,
      owner: { displayName: requestAssignees.displayName },
    })
    .from(requests)
    .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
    .leftJoin(requestAssignees, eq(requests.assigneeId, requestAssignees.id))
    // DD-013 as a `where` clause: the Requester is the session, and
    // the route offers no other filter to be widened by a query
    // string. Archived Requests are absent by the house rule that
    // NULL means live; nothing archives one yet, and a rule stated
    // now is a rule the first archiver inherits.
    .where(
      and(
        eq(requests.requesterId, user.id),
        isNull(requests.archivedAt),
        ne(requests.status, "converted"),
      ),
    )
    // Newest first — the index the table declares, and the order a
    // person reading their own asks expects.
    //
    // Unpaged, deliberately. The lists that page in this API are
    // org-wide, where the row count is a fact about the whole
    // instance; this one is bounded by what a single person has
    // asked Legal for. A cap would silently drop a requester's own
    // Request from the only list that can show it, and the portal
    // home draws the block whole — there is no "load more" in I5 to
    // recover the tail with.
    .orderBy(desc(requests.createdAt), desc(requests.number));
  return { requests: rows.map((row) => toPortalRequestRow(row)) };
}
/** The joined row, reshaped into the answer's nested request type. */
export function toPortalRequestRow<T extends RequestRowColumns>(row: T) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    title: row.title,
    owner: row.owner,
    createdAt: row.createdAt.toISOString(),
    requestType: { id: row.typeId, slug: row.typeSlug, displayName: row.typeDisplayName },
  };
}

interface RequestRowColumns {
  owner: { displayName: string } | null;
  id: string;
  number: number;
  status: (typeof REQUEST_STATUSES)[number];
  title: string;
  createdAt: Date;
  typeId: string;
  typeSlug: string;
  typeDisplayName: string;
}

/**
 * The submitted values, checked against the fields the type attaches
 * and reduced to their stored shapes.
 *
 * A slug the type does not attach is refused rather than dropped: a
 * form that sent it is a form out of step with the type, and a value
 * stored under it would sit on the Request where nothing could show it
 * or clear it. An empty answer leaves no key at all, so "nothing
 * recorded" has one shape here as it does on a contract.
 */
function collectValues(
  attached: readonly AttachedCustomField[],
  incoming: Readonly<Record<string, CustomFieldValue | null>>,
): Record<string, CustomFieldValue> {
  const values: Record<string, CustomFieldValue> = {};
  for (const [slug, raw] of Object.entries(incoming)) {
    const field = attached.find((candidate) => candidate.slug === slug);
    if (!field) throw invalidIntakeRows("That field is not on this request type's form.", slug);
    if (field.builtInKey === "counterparties") {
      if (raw !== null && (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")))
        throw invalidIntakeRows("Counterparties: pick from the registry.", "Counterparties");
      if (Array.isArray(raw) && raw.length) values[slug] = raw;
      continue;
    }
    let value: CustomFieldValue | null;
    try {
      value = coerceCustomFieldValue(field, raw);
    } catch (error) {
      if (!(error instanceof HttpError) || error.statusCode !== 400) throw error;
      throw new RequestFormError(error.message, [{ name: field.displayName, reason: "invalid" }]);
    }
    if (value !== null) values[slug] = value;
  }
  return values;
}

/** Portal Entity choices must remain listed; person references must remain live. */
async function assertLiveReference(
  tx: Transaction,
  field: AttachedCustomField,
  id: string,
): Promise<void> {
  if (field.fieldType === "user") {
    // Anyone live: a custom person field carries no role floor.
    const [person] = await tx
      .select({ id: users.id, archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for("update");
    if (!person || person.archivedAt) {
      throw httpError(400, `${field.displayName}: pick a live person.`);
    }
    return;
  }
  await assertPortalEntity(tx, id, field.displayName);
}

/** The required rule for basics and attachments alike: one refusal that
 * names every gap, in the order the form draws them. */
function assertAnswered(checks: readonly { name: string; answered: boolean }[]): void {
  const missing = checks.filter((check) => !check.answered).map((check) => check.name);
  if (missing.length === 0) return;
  throw new RequestFormError(
    `Fill ${listNames(missing)} first — the form requires ${missing.length === 1 ? "it" : "them"}.`,
    missing.map((name) => ({ name, reason: "missing" })),
  );
}

const MAX_REQUESTS_PER_HOUR = 20;
const QUOTA_WINDOW_MS = 60 * 60_000;
function quotaWindowStart(): Date {
  return new Date(Date.now() - QUOTA_WINDOW_MS);
}
/** How many Requests this person submitted in the last hour. */
async function recentRequestCount(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(requests)
    .where(and(eq(requests.requesterId, userId), gte(requests.createdAt, quotaWindowStart())));
  return row?.total ?? 0;
}

/** Serialises one person's Request writes for the length of the transaction. */
export async function lockPerson(tx: Transaction, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

export const AssignRequestBody = z.strictObject({
  assigneeId: z.string().min(1).max(64).nullable(),
});
export async function assignRequest(
  _db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof AssignRequestBody>,
  notifier: Notifier,
) {
  assertMember(user);
  const body = AssignRequestBody.parse(input);
  return notifier.notifying(async (tx) => {
    const [held] = await tx
      .select()
      .from(requests)
      .where(and(eq(requests.number, number), isNull(requests.archivedAt)))
      .for("update");
    if (!held) throw httpError(404, NO_REQUEST);
    if (!isOpenRequestStatus(held.status))
      throw httpError(
        409,
        "This request has already been triaged. Its assignment cannot be changed.",
      );
    const { assigneeId } = body;
    let name: string | null = null;
    if (assigneeId !== null) {
      const [person] = await tx.select().from(users).where(eq(users.id, assigneeId)).for("update");
      if (
        !person ||
        person.archivedAt ||
        (person.role !== "administrator" && person.role !== "legal_team_member")
      ) {
        throw httpError(
          400,
          "Choose an active Administrator or Legal Team Member to triage this request.",
        );
      }
      name = person.displayName;
    }
    if (held.assigneeId !== assigneeId) {
      await tx.update(requests).set({ assigneeId }).where(eq(requests.id, held.id));
      await recordActivity(tx, {
        entityType: "request",
        entityId: held.id,
        actorId: user.id,
        action: "request.assignee_changed",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { number: held.number, assignee: name, from: held.assigneeId, to: assigneeId },
      });
      if (assigneeId)
        await notifier.requestAssigned(tx, {
          requestId: held.id,
          actorId: user.id,
          actorName: user.displayName,
          assigneeId,
        });
    }
    return { request: toStaffRequest(await staffRequestRow(tx, user, held.number)) };
  });
}

export { listRequests } from "./list.js";

export {
  IntakeFormError as RequestFormError,
  type IntakeFormRowIssue as RequestFormRowIssue,
} from "../../lib/intake-form-error.js";
