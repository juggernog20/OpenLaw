// SPDX-License-Identifier: AGPL-3.0-only
/** Durable Matter preparation with leased work and current-source checks (INT-008). */
import { and, conversionDrafts, eq, isNull, lt, or, users, type Db } from "@openlaw/db";
import type { ConversionSuggestion } from "@openlaw/shared";
import {
  checkedSuggestion,
  conversionContext,
  matterPreparationEnabled,
  withAttachmentReads,
} from "../lib/conversion-draft.js";
import { ATTACHMENT_LIMITS, readConversionAttachments } from "../lib/conversion-attachments.js";
import type { StorageAdapter } from "../lib/storage/adapter.js";
import type { DocEngine } from "../lib/doc-engine/engine.js";
import type { AiResolver } from "../lib/ai/resolver.js";
import type { PipelineLogger } from "./logger.js";
import type { JobQueue } from "./jobs.js";

export async function handleConversionDraft(
  deps: {
    db: Db;
    resolveAiProvider: AiResolver;
    storage: StorageAdapter;
    docEngine: DocEngine;
    log?: PipelineLogger;
  },
  id: string,
) {
  const now = new Date();
  const [draft] = await deps.db
    .update(conversionDrafts)
    .set({ startedAt: now })
    .where(
      and(
        eq(conversionDrafts.id, id),
        eq(conversionDrafts.state, "pending"),
        or(
          isNull(conversionDrafts.startedAt),
          lt(conversionDrafts.startedAt, new Date(Date.now() - 180_000)),
        ),
      ),
    )
    .returning();
  if (!draft) return;
  let stage = "authorization";
  try {
    const [actor] = await deps.db.select().from(users).where(eq(users.id, draft.actorId));
    if (
      !actor ||
      actor.archivedAt ||
      !["administrator", "legal_team_member"].includes(actor.role) ||
      !(await matterPreparationEnabled(deps.db))
    )
      throw new Error("disabled");
    stage = "sources";
    const context = await conversionContext(deps.db, draft.requestId, draft.targetTypeId);
    if (context.row.status !== "new" || context.snapshot !== draft.snapshot)
      throw new Error("changed");
    const attachmentReads = draft.attachmentReads.length
      ? draft.attachmentReads
      : await readConversionAttachments(
          deps,
          context.attachments,
          draft.id,
          ATTACHMENT_LIMITS.totalCharacters -
            context.sources.reduce((n, source) => n + source.text.length, 0),
        );
    await deps.db
      .update(conversionDrafts)
      .set({ attachmentReads })
      .where(and(eq(conversionDrafts.id, id), eq(conversionDrafts.startedAt, now)));
    withAttachmentReads(context, attachmentReads);
    if (
      (await conversionContext(deps.db, draft.requestId, draft.targetTypeId)).snapshot !==
      draft.snapshot
    )
      throw new Error("changed");
    stage = "provider";
    const provider = await deps.resolveAiProvider();
    if (!provider) throw new Error("disabled");
    let timer: NodeJS.Timeout | undefined;
    const answers = await Promise.race([
      provider.extract(context.sources, context.targets),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stage = "timeout";
          reject(new Error("timeout"));
        }, 125_000);
      }),
    ]).finally(() => clearTimeout(timer));
    const suggestions: Record<string, ConversionSuggestion> = {};
    const conflicts: Record<string, ConversionSuggestion> = {};
    for (const answer of answers) {
      if (!context.targets.some((t) => t.slug === answer.slug)) continue;
      const proposal = checkedSuggestion(answer, context);
      if (proposal) (answer.conflict ? conflicts : suggestions)[answer.slug] = proposal;
    }
    for (const slug of Object.keys(conflicts)) delete suggestions[slug];
    stage = "freshness";
    const current = await conversionContext(deps.db, draft.requestId, draft.targetTypeId);
    const [currentActor] = await deps.db.select().from(users).where(eq(users.id, draft.actorId));
    if (
      current.snapshot !== draft.snapshot ||
      current.row.status !== "new" ||
      !currentActor ||
      currentActor.archivedAt ||
      !["administrator", "legal_team_member"].includes(currentActor.role) ||
      !(await matterPreparationEnabled(deps.db))
    )
      throw new Error("changed");
    await deps.db
      .update(conversionDrafts)
      .set({
        state: "ready",
        suggestions,
        attachmentReads,
        conflicts,
        warnings: context.warnings,
        model: provider.model,
        finishedAt: new Date(),
        failure: null,
      })
      .where(
        and(
          eq(conversionDrafts.id, id),
          eq(conversionDrafts.state, "pending"),
          eq(conversionDrafts.startedAt, now),
        ),
      );
  } catch {
    deps.log?.warn({ draftId: id, stage }, "Matter preparation failed");
    await deps.db
      .update(conversionDrafts)
      .set({
        state: "failed",
        failure: "Preparation could not finish. Retry or continue manually.",
        suggestions: {},
        conflicts: {},
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(conversionDrafts.id, id),
          eq(conversionDrafts.state, "pending"),
          eq(conversionDrafts.startedAt, now),
        ),
      );
  }
}
export async function sweepConversionDrafts(db: Db, queue: JobQueue) {
  const owed = await db
    .select({ id: conversionDrafts.id })
    .from(conversionDrafts)
    .where(
      and(
        eq(conversionDrafts.state, "pending"),
        or(
          isNull(conversionDrafts.startedAt),
          lt(conversionDrafts.startedAt, new Date(Date.now() - 180_000)),
        ),
      ),
    )
    .limit(100);
  for (const row of owed) await queue.requestConversionDraft(row.id).catch(() => {});
}
