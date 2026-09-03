// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Computes and keeps one comparison between two rounds (DOC-003).
 *
 * The comparison row, not the pg-boss job, is the durable request. A
 * handler therefore reads every input live, does nothing once the row has
 * settled, and moves `pending` to one terminal state in a single update.
 * Word mode stores the tracked-changes DOCX and the parser's model together;
 * text mode is deliberately closed as unavailable until M32/5 supplies it.
 */

import { Readable } from "node:stream";
import { alias, and, documentComparisons, documentVersions, eq } from "@openlaw/db";
import { uuidv7 } from "uuidv7";
import { parseTrackedChangesDocx } from "../lib/doc-engine/change-model.js";
import { isComparableFormat } from "../lib/doc-engine/engine.js";
import { conversionFormatOf } from "../lib/render-family.js";
import { isTerminalFailure, reasonOf, type DerivationDeps } from "./derivations.js";

export const TEXT_COMPARISON_UNAVAILABLE = "Text comparison is not available yet.";

/** One comparison attempt carries only the durable row's id and pg-boss's
 * retry counters. */
export interface ComparisonAttempt {
  comparisonId: string;
  retryCount: number;
  retryLimit: number;
}

/** A fresh, human-inspectable key. The comparison id groups every attempt;
 * the fresh tail preserves DOC-012's never-overwrite rule. */
export function comparisonStorageKey(comparisonId: string): string {
  return `comparisons/${comparisonId}/${uuidv7()}`;
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}

async function forget(deps: DerivationDeps, fileRef: string): Promise<void> {
  try {
    await deps.storage.delete(fileRef);
  } catch (error) {
    deps.log.warn(
      { fileRef, reason: reasonOf(error) },
      "could not remove an unreferenced document comparison",
    );
  }
}

async function failComparison(
  deps: DerivationDeps,
  comparisonId: string,
  failure: string,
): Promise<void> {
  await deps.db
    .update(documentComparisons)
    .set({ state: "failed", failure, finishedAt: new Date() })
    .where(and(eq(documentComparisons.id, comparisonId), eq(documentComparisons.state, "pending")));
}

/** Computes one pending comparison. Returns without work when erasure or an
 * earlier job has already settled the row. */
export async function compareDocumentVersions(
  deps: DerivationDeps,
  comparisonId: string,
): Promise<void> {
  const fromVersion = alias(documentVersions, "comparison_from_version");
  const toVersion = alias(documentVersions, "comparison_to_version");
  const [comparison] = await deps.db
    .select({
      id: documentComparisons.id,
      mode: documentComparisons.mode,
      state: documentComparisons.state,
      fromFileRef: fromVersion.fileRef,
      fromMimeType: fromVersion.mimeType,
      fromFilename: fromVersion.originalFilename,
      toFileRef: toVersion.fileRef,
      toMimeType: toVersion.mimeType,
      toFilename: toVersion.originalFilename,
    })
    .from(documentComparisons)
    .innerJoin(fromVersion, eq(documentComparisons.fromVersionId, fromVersion.id))
    .innerJoin(toVersion, eq(documentComparisons.toVersionId, toVersion.id))
    .where(eq(documentComparisons.id, comparisonId))
    .limit(1);

  if (!comparison || comparison.state !== "pending") return;
  if (comparison.mode === "text") {
    await failComparison(deps, comparisonId, TEXT_COMPARISON_UNAVAILABLE);
    return;
  }

  const fromFormat = conversionFormatOf(comparison.fromMimeType, comparison.fromFilename);
  const toFormat = conversionFormatOf(comparison.toMimeType, comparison.toFilename);
  if (
    !fromFormat ||
    !toFormat ||
    !isComparableFormat(fromFormat) ||
    !isComparableFormat(toFormat)
  ) {
    throw new Error("A word comparison no longer has two Word operands.");
  }

  const older = await deps.storage.get(comparison.fromFileRef);
  let newer: Readable | undefined;
  let fileRef: string | undefined;
  try {
    newer = await deps.storage.get(comparison.toFileRef);
    const answer = await deps.docEngine.compare(older, fromFormat, newer, toFormat);
    const redline = await collect(answer);
    fileRef = await deps.storage.put(comparisonStorageKey(comparisonId), Readable.from([redline]));
    const model = parseTrackedChangesDocx(redline);
    const updated = await deps.db
      .update(documentComparisons)
      .set({
        state: "ready",
        changeModel: model,
        changeCount: model.changes.length,
        redlineFileRef: fileRef,
        finishedAt: new Date(),
      })
      .where(
        and(eq(documentComparisons.id, comparisonId), eq(documentComparisons.state, "pending")),
      )
      .returning({ id: documentComparisons.id });
    if (updated.length === 0) {
      await forget(deps, fileRef);
      return;
    }
    deps.log.info(
      { comparisonId, changeCount: model.changes.length },
      "compared two document versions",
    );
  } catch (error) {
    if (fileRef) await forget(deps, fileRef);
    throw error;
  } finally {
    older.destroy();
    newer?.destroy();
  }
}

/** Applies the derivation retry idiom: terminal input faults settle now;
 * transient faults go back to pg-boss and settle only on the last attempt. */
export async function handleDocumentComparison(
  deps: DerivationDeps,
  attempt: ComparisonAttempt,
): Promise<void> {
  try {
    await compareDocumentVersions(deps, attempt.comparisonId);
  } catch (error) {
    const terminal = isTerminalFailure(error);
    const exhausted = attempt.retryCount >= attempt.retryLimit;
    if (terminal || exhausted) {
      await failComparison(deps, attempt.comparisonId, reasonOf(error));
      deps.log.error(
        {
          comparisonId: attempt.comparisonId,
          terminal,
          attempts: attempt.retryCount + 1,
          reason: reasonOf(error),
        },
        "document comparison failed",
      );
    }
    if (!terminal) throw error;
  }
}
