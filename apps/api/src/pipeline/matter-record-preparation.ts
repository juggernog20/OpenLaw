// SPDX-License-Identifier: AGPL-3.0-only
/** DD-028: prepare Record Rows after Request conversion, retaining ordinary conversion evidence. */
import {
  and,
  conversionDrafts,
  eq,
  isNull,
  isNotNull,
  lt,
  or,
  sql,
  matters,
  matterTypes,
  matterKeyDates,
  regions,
  users,
  comments,
  commentAttachments,
  documents,
  documentVersions,
  type Db,
  type Executor,
} from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../lib/activity.js";
import type { ConversionSuggestion } from "@openlaw/shared";
import {
  conversionContext,
  checkedSuggestion,
  preparationEnabled,
  withAttachmentReads,
  hash,
} from "../lib/conversion-draft.js";
import { reachedMatter } from "../lib/matter-access.js";
import { readConversionAttachments } from "../lib/conversion-attachments.js";
import { extractCompleteSources } from "../lib/ai/complete-sources.js";
import { aiPreparationFailure } from "../lib/ai/provider.js";
import { boundedQueueAsk, type JobQueue } from "./jobs.js";
import type { ConversionDraftDeps } from "./conversion-draft.js";

type Preparation = typeof conversionDrafts.$inferSelect;
type Deps = Omit<ConversionDraftDeps, "notifier">;

export async function reserveMatterRecordPreparation(
  tx: Executor,
  input: {
    matterId: string;
    requestId: string;
    targetTypeId: string;
    actorId: string;
  },
) {
  if (!(await preparationEnabled(tx, "matter", true))) return null;
  const [run] = await tx
    .insert(conversionDrafts)
    .values({
      ...input,
      targetModule: "matter",
      snapshot: `record:${input.matterId}`,
    })
    .returning();
  return run!;
}

async function contextFor(db: Executor, run: Preparation, lock = false) {
  const [actor] = await db.select().from(users).where(eq(users.id, run.actorId));
  const [matter] = await db.select().from(matters).where(eq(matters.id, run.matterId!));
  if (
    !actor ||
    actor.archivedAt ||
    !["administrator", "legal_team_member"].includes(actor.role) ||
    !matter ||
    matter.archivedAt ||
    matter.matterTypeId !== run.targetTypeId ||
    !(await reachedMatter(db, actor, matter.number)) ||
    !(await preparationEnabled(db, "matter", lock))
  )
    throw new Error("changed");
  if (lock) {
    await db.select().from(matterTypes).where(eq(matterTypes.id, run.targetTypeId)).for("share");
    await db
      .select()
      .from(comments)
      .where(and(eq(comments.entityType, "matter"), eq(comments.entityId, matter.id)))
      .for("share");
    await db
      .select({ id: commentAttachments.id })
      .from(commentAttachments)
      .innerJoin(comments, eq(comments.id, commentAttachments.commentId))
      .where(and(eq(comments.entityType, "matter"), eq(comments.entityId, matter.id)))
      .for("share", { of: commentAttachments });
  }
  const context = await conversionContext(
    db,
    run.requestId,
    run.targetTypeId,
    lock,
    "matter",
    "record",
  );
  if (context.row.convertedMatterId !== matter.id) throw new Error("changed");
  for (const attachment of context.attachments) {
    if (!attachment.versionId) {
      if (attachment.id.startsWith("attachment:")) attachment.restricted = true;
      continue;
    }
    const query = db
      .select({ id: documents.id })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.id, attachment.versionId),
          eq(documents.matterId, matter.id),
          isNull(documents.archivedAt),
          eq(documents.isConfidential, false),
        ),
      );
    const [document] = await (lock ? query.for("share", { of: documents }) : query);
    if (!document) attachment.restricted = true;
  }
  context.snapshot = hash([context.snapshot, context.attachments]);
  return { context, matter };
}

export async function handleMatterRecordPreparation(deps: Deps, id: string) {
  const now = new Date();
  const [run] = await deps.db
    .update(conversionDrafts)
    .set({ startedAt: now, leaseAt: now })
    .where(
      and(
        eq(conversionDrafts.id, id),
        isNotNull(conversionDrafts.matterId),
        eq(conversionDrafts.state, "pending"),
        or(
          isNull(conversionDrafts.startedAt),
          lt(
            sql`coalesce(${conversionDrafts.leaseAt}, ${conversionDrafts.startedAt})`,
            new Date(Date.now() - 180_000),
          ),
        ),
      ),
    )
    .returning();
  if (!run) return;
  const lease = and(
    eq(conversionDrafts.id, id),
    eq(conversionDrafts.state, "pending"),
    eq(conversionDrafts.startedAt, now),
  );
  let renewing = Promise.resolve();
  const heartbeat = setInterval(() => {
    renewing = renewing
      .then(async () => {
        await deps.db.update(conversionDrafts).set({ leaseAt: new Date() }).where(lease);
      })
      .catch(() => {
        deps.log?.warn({ preparationId: id }, "Matter preparation lease renewal failed");
      });
  }, 30_000);
  heartbeat.unref();
  try {
    const { context, matter: original } = await contextFor(deps.db, run);
    const reads = await readConversionAttachments(deps, context.attachments, id);
    withAttachmentReads(context, reads);
    const provider = await deps.resolveAiProvider();
    if (!provider) throw new Error("disabled");
    if ((await contextFor(deps.db, run)).context.snapshot !== context.snapshot)
      throw new Error("changed");
    const answers = context.targets.length
      ? await extractCompleteSources(provider, context.sources, context.targets, {
          answerStyle: context.answerStyle,
        })
      : [];
    const conflicts = new Set(answers.filter((a) => a.conflict).map((a) => a.slug));
    const suggestions: Record<string, ConversionSuggestion> = {};
    for (const answer of answers) {
      if (conflicts.has(answer.slug) || !context.targets.some((t) => t.slug === answer.slug))
        continue;
      const suggestion = checkedSuggestion(answer, context);
      if (suggestion) suggestions[answer.slug] = suggestion;
    }
    await deps.db.transaction(async (tx) => {
      const [matter] = await tx
        .select()
        .from(matters)
        .where(eq(matters.id, run.matterId!))
        .for("update");
      const [held] = await tx.select().from(conversionDrafts).where(lease).for("update");
      if (!held || !matter) return;
      if ((await contextFor(tx, run, true)).context.snapshot !== context.snapshot)
        throw new Error("changed");
      const customFields = { ...matter.customFields };
      const flags = { ...matter.aiUnverified };
      const patch: Partial<typeof matters.$inferInsert> = {};
      const written: string[] = [];
      for (const [slug, suggestion] of Object.entries(suggestions)) {
        // A human edit during the provider call wins, including an explicit clear.
        if (matter.updatedAt.valueOf() !== original.updatedAt.valueOf()) continue;
        const marker = {
          draftId: id,
          targetTypeId: run.targetTypeId,
          writtenAt: new Date().toISOString(),
        };
        if (slug.startsWith("field:")) {
          const key = slug.slice(6);
          if (customFields[key] !== undefined) continue;
          customFields[key] = suggestion.value;
        } else if (slug === "needed_by") {
          const [existing] = await tx
            .select()
            .from(matterKeyDates)
            .where(
              and(eq(matterKeyDates.matterId, matter.id), eq(matterKeyDates.label, "Needed by")),
            )
            .limit(1);
          if (existing) continue;
          const [date] = await tx
            .insert(matterKeyDates)
            .values({ matterId: matter.id, label: "Needed by", date: String(suggestion.value) })
            .returning();
          flags[slug] = { ...marker, keyDateId: date!.id };
          written.push(slug);
          await recordActivity(tx, {
            entityType: "matter",
            entityId: matter.id,
            actorId: run.actorId,
            action: "key_date.added",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { keyDateId: date!.id, label: "Needed by", date: String(suggestion.value) },
          });
          continue;
        } else if (slug === "risk" && matter.risk === null)
          patch.risk = suggestion.value as "low" | "medium" | "high" | "critical";
        else if (slug === "region" && matter.region === null) {
          const [region] = await tx
            .select()
            .from(regions)
            .where(eq(regions.id, String(suggestion.value)));
          if (!region) continue;
          patch.region = region.displayName;
        } else if (slug === "department" && matter.departmentId === null)
          patch.departmentId = String(suggestion.value);
        else continue;
        flags[slug] = marker;
        written.push(slug);
      }
      if (written.length)
        await tx
          .update(matters)
          .set({ ...patch, customFields, aiUnverified: Object.keys(flags).length ? flags : null })
          .where(eq(matters.id, matter.id));
      if (written.length)
        await recordActivity(tx, {
          entityType: "matter",
          entityId: matter.id,
          actorId: run.actorId,
          action: "matter.updated",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: matter.number,
            title: matter.title,
            changed: Object.fromEntries(
              written
                .filter((slug) => slug !== "needed_by")
                .map((slug) => [
                  slug.startsWith("field:") ? `field.${slug.slice(6)}` : slug,
                  { from: null, to: slug === "region" ? patch.region : suggestions[slug]!.value },
                ]),
            ),
          },
        });
      await tx
        .update(conversionDrafts)
        .set({
          state: "ready",
          suggestions,
          attachmentReads: reads,
          warnings: context.warnings,
          model: provider.model,
          snapshot: context.snapshot,
          failure: null,
          finishedAt: new Date(),
        })
        .where(lease);
    });
  } catch (error) {
    const reason = aiPreparationFailure(error);
    await deps.db
      .update(conversionDrafts)
      .set({ state: "failed", failure: reason, finishedAt: new Date() })
      .where(lease);
    deps.log?.warn({ preparationId: id, reason }, "Matter Record Row preparation failed");
  } finally {
    clearInterval(heartbeat);
    await renewing;
  }
}

export async function sweepMatterRecordPreparations(db: Db, queue: JobQueue) {
  const runs = await db
    .select({ id: conversionDrafts.id })
    .from(conversionDrafts)
    .where(
      and(
        isNotNull(conversionDrafts.matterId),
        eq(conversionDrafts.state, "pending"),
        or(
          isNull(conversionDrafts.startedAt),
          lt(
            sql`coalesce(${conversionDrafts.leaseAt}, ${conversionDrafts.startedAt})`,
            new Date(Date.now() - 180_000),
          ),
        ),
      ),
    )
    .limit(100);
  for (const run of runs)
    await boundedQueueAsk(queue.requestMatterRecordPreparation(run.id)).catch(() => {});
}
