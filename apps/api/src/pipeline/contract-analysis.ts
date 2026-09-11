// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-008's pg-boss worker: resolve the analysis Version, extract answers,
 * apply the no-overwrite writer rules in one transaction, and distinguish
 * terminal provider faults from transient failures that the queue retries.
 */

import {
  activityLog,
  and,
  contractAnalysisRuns,
  contractCounterparties,
  contracts,
  counterparties,
  desc,
  documents,
  documentVersions,
  documentVersionText,
  eq,
  isNull,
  lt,
  or,
  sql,
  TERM_TYPES,
  VALUE_CADENCES,
  type Contract,
  type ContractAnalysisRun,
  type CustomFieldValue,
  type Db,
  type Executor,
} from "@openlaw/db";
import {
  AI_ANALYSIS_CHARACTER_BUDGET,
  type AiUnverifiedMap,
  type ContractAnalysisOutcome,
  type ContractAnalysisResult,
} from "@openlaw/shared";
import { buildAnalysisTargets, type AnalysisTarget } from "../lib/analysis-targets.js";
import { AiConfigError, isTerminalAiError, type AiExtraction } from "../lib/ai/provider.js";
import type { AiResolver } from "../lib/ai/resolver.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../lib/activity.js";
import { requestAnalysisContext } from "./conversion-analysis.js";
import { hash, normalizeQuote, withAttachmentReads } from "../lib/conversion-draft.js";
import { ATTACHMENT_LIMITS, readConversionAttachments } from "../lib/conversion-attachments.js";
import type { StorageAdapter } from "../lib/storage/adapter.js";
import type { DocEngine } from "../lib/doc-engine/engine.js";
import type { ConversionAnalysisContext, ConversionSuggestion } from "@openlaw/shared";
import type { PipelineLogger } from "./logger.js";

export interface ContractAnalysisDeps {
  db: Db;
  resolveAiProvider: AiResolver;
  log: PipelineLogger;
  storage?: StorageAdapter;
  docEngine?: DocEngine;
}

export interface ContractAnalysisAttempt {
  runId: string;
  retryCount: number;
  retryLimit: number;
}

export interface AnalysisTargetText {
  contractId: string;
  contractTypeId: string;
  versionId: string;
  text: string;
}

export class AnalysisTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisTargetError";
  }
}

/** Resolves the executed pin on the primary Document, else its current Version. */
export async function analysisTargetText(
  db: Executor,
  contractId: string,
): Promise<AnalysisTargetText | null> {
  const [contract] = await db
    .select({
      id: contracts.id,
      contractTypeId: contracts.contractTypeId,
      primaryDocumentId: contracts.primaryDocumentId,
      archivedAt: contracts.archivedAt,
      endedAt: contracts.endedAt,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!contract?.primaryDocumentId || contract.archivedAt || contract.endedAt) return null;

  const [document] = await db
    .select({ executedVersionId: documents.executedVersionId })
    .from(documents)
    .where(
      and(
        eq(documents.id, contract.primaryDocumentId),
        eq(documents.contractId, contract.id),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1);
  if (!document) return null;

  let versionId = document.executedVersionId;
  if (!versionId) {
    const [current] = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, contract.primaryDocumentId))
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1);
    versionId = current?.id ?? null;
  }
  if (!versionId) return null;

  const [derived] = await db
    .select({ state: documentVersionText.state, text: documentVersionText.text })
    .from(documentVersionText)
    .where(eq(documentVersionText.versionId, versionId))
    .limit(1);
  if (derived?.state !== "ready" || !derived.text?.trim()) return null;
  return {
    contractId: contract.id,
    contractTypeId: contract.contractTypeId,
    versionId,
    text: derived.text,
  };
}

/** Reads the Version a run snapshotted on its first attempt. */
async function snapshottedTargetText(
  db: Executor,
  contractId: string,
  contractTypeId: string,
  versionId: string,
): Promise<AnalysisTargetText | null> {
  const [derived] = await db
    .select({ state: documentVersionText.state, text: documentVersionText.text })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .innerJoin(documentVersionText, eq(documentVersionText.versionId, documentVersions.id))
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documents.contractId, contractId),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1);
  if (derived?.state !== "ready" || !derived.text?.trim()) return null;
  return { contractId, contractTypeId, versionId, text: derived.text };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTerminalAnalysisFailure(error: unknown): boolean {
  return error instanceof AnalysisTargetError || isTerminalAiError(error);
}

function normalized(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function evidenceIsSupported(text: string, evidence: string | undefined): evidence is string {
  if (!evidence?.trim()) return false;
  return normalized(text).includes(normalized(evidence));
}

function isoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function integer(raw: unknown, min: number, max: number): number | null {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^-?\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function option(raw: unknown, options: readonly string[]): string | null {
  if (typeof raw !== "string") return null;
  const wanted = normalized(raw);
  return options.find((candidate) => normalized(candidate) === wanted) ?? null;
}

function coerce(target: AnalysisTarget, raw: unknown): CustomFieldValue | object | null {
  switch (target.type) {
    case "term_type": {
      if (typeof raw !== "string") return null;
      const value = raw
        .trim()
        .toLocaleLowerCase("en-US")
        .replace(/[\s-]+/g, "_");
      if (value === "fixed_term") return "fixed";
      if (value === "auto_renewing") return "auto_renew";
      return (TERM_TYPES as readonly string[]).includes(value) ? value : null;
    }
    case "date":
      return isoDate(raw);
    case "integer":
      return target.slug === "notice_period_days"
        ? integer(raw, 0, 36_500)
        : integer(raw, 1, 1_200);
    case "value": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const value = raw as Record<string, unknown>;
      const amount = integer(value.amount, 0, Number.MAX_SAFE_INTEGER);
      const currency =
        typeof value.currency === "string" ? value.currency.trim().toUpperCase() : "";
      const cadence =
        typeof value.cadence === "string"
          ? value.cadence
              .trim()
              .toLocaleLowerCase("en-US")
              .replace(/[\s-]+/g, "_")
          : "";
      if (
        amount === null ||
        !Intl.supportedValuesOf("currency").includes(currency) ||
        !(VALUE_CADENCES as readonly string[]).includes(cadence)
      ) {
        return null;
      }
      return { amount, currency, cadence };
    }
    case "counterparty":
    case "text": {
      if (typeof raw !== "string" || !raw.trim()) return null;
      return raw.trim().length <= 500 ? raw.trim() : null;
    }
    case "long_text": {
      if (typeof raw !== "string" || !raw.trim()) return null;
      return raw.trim().length <= 10_000 ? raw.trim() : null;
    }
    case "number": {
      const value =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== ""
            ? Number(raw)
            : Number.NaN;
      return Number.isFinite(value) ? value : null;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (typeof raw !== "string") return null;
      if (normalized(raw) === "true" || normalized(raw) === "yes") return true;
      if (normalized(raw) === "false" || normalized(raw) === "no") return false;
      return null;
    }
    case "currency":
      return typeof raw === "string" &&
        Intl.supportedValuesOf("currency").includes(raw.trim().toUpperCase())
        ? raw.trim().toUpperCase()
        : null;
    case "single_select":
      return option(raw, target.options ?? []);
    case "multi_select": {
      if (!Array.isArray(raw) || raw.length === 0) return null;
      const selected = raw.map((item) => option(item, target.options ?? []));
      if (selected.some((item) => item === null)) return null;
      const distinct = new Set(selected as string[]);
      return (target.options ?? []).filter((item) => distinct.has(item));
    }
    case "user":
    case "entity":
      // Paper can name a person or Entity, but it cannot safely choose an internal row id.
      return null;
  }
}

function hasValue(row: Contract, slug: string): boolean {
  switch (slug) {
    case "term_type":
      return true;
    case "effective_date":
      return row.effectiveDate !== null;
    case "expiry_date":
      return row.expiryDate !== null;
    case "renewal_period_months":
      return row.renewalPeriodMonths !== null;
    case "notice_period_days":
      return row.noticePeriodDays !== null;
    case "value":
      return row.valueAmount !== null;
    default:
      return row.customFields[slug] !== undefined;
  }
}

function writable(row: Contract, flags: AiUnverifiedMap, slug: string, termTypeWasSet: boolean) {
  if (row.analysisHumanFields.includes(slug) || row.analysisHumanFields.includes(`field:${slug}`))
    return false;
  if (flags[`field:${slug}`]?.draftId) return false;
  if (flags[slug]) return true;
  if (slug === "term_type") return !termTypeWasSet;
  return !hasValue(row, slug);
}

async function termTypeIsEstablished(db: Executor, contractId: string): Promise<boolean> {
  const [entry] = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, "contract"),
        eq(activityLog.entityId, contractId),
        or(
          and(
            eq(activityLog.action, "contract.updated"),
            sql`${activityLog.payload}->'changed' ? 'termType'`,
          ),
          and(
            eq(activityLog.action, "contract.analysis_completed"),
            sql`${activityLog.payload}->'written' ? 'term_type'`,
          ),
        ),
      ),
    )
    .limit(1);
  return entry !== undefined;
}

interface PreparedAnswer {
  target: AnalysisTarget;
  evidence: string;
  value: CustomFieldValue | object;
}

async function applyAnswers(
  deps: ContractAnalysisDeps,
  run: ContractAnalysisRun,
  targetText: AnalysisTargetText,
  targets: AnalysisTarget[],
  extractions: AiExtraction[],
  model: string,
  requestSnapshot?: string,
): Promise<void> {
  const answerBySlug = new Map(extractions.map((answer) => [answer.slug, answer]));
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, run.contractId))
      .limit(1)
      .for("update");
    if (!row) return;
    if (row.archivedAt || row.endedAt) {
      throw new AnalysisTargetError("The Contract became frozen before analysis completed.");
    }

    if (run.sourceContext) {
      const [lease] = await tx
        .select()
        .from(contractAnalysisRuns)
        .where(eq(contractAnalysisRuns.id, run.id))
        .for("update");
      if (lease?.state !== "pending" || lease.startedAt?.valueOf() !== run.startedAt?.valueOf())
        return;
      const current = await requestAnalysisContext(tx, run, true);
      const currentTargets = await buildAnalysisTargets(tx, row.contractTypeId);
      if (current.context.snapshot !== requestSnapshot || hash(currentTargets) !== hash(targets))
        throw new AnalysisTargetError(
          "Request sources or Contract Fields changed. Retry the Analysis run.",
        );
    }
    if (row.contractTypeId !== targetText.contractTypeId)
      throw new AnalysisTargetError("The Contract Type changed before analysis completed.");
    const outcome: ContractAnalysisOutcome = {
      written: [],
      kept: [],
      unsupported: [],
      invalid: [],
      results: [],
    };
    const results = new Map<string, ContractAnalysisResult>();
    const noteResult = (
      slug: string,
      answer: { value?: unknown; evidence?: string } | undefined,
      result: ContractAnalysisResult["outcome"],
      value: unknown = answer?.value ?? null,
    ) => {
      results.set(slug, {
        slug,
        value,
        evidence: answer?.evidence ?? null,
        outcome: result,
      });
    };
    const prepared = new Map<string, PreparedAnswer>();
    for (const target of targets) {
      const answer = answerBySlug.get(target.slug);
      if (
        answer?.conflict ||
        (run.sourceContext
          ? !run.sourceContext.suggestions[target.slug]
          : (answer?.sourceId !== undefined && answer.sourceId !== targetText.versionId) ||
            !evidenceIsSupported(targetText.text, answer?.evidence))
      ) {
        outcome.unsupported.push(target.slug);
        noteResult(target.slug, run.sourceContext ? undefined : answer, "unsupported");
        continue;
      }
      const value = coerce(target, answer?.value);
      if (value === null) {
        outcome.invalid.push(target.slug);
        noteResult(target.slug, answer, "invalid");
        continue;
      }
      prepared.set(target.slug, { target, evidence: answer!.evidence!, value });
    }

    const flags: AiUnverifiedMap = { ...(row.aiUnverified ?? {}) };
    const patch: Partial<Contract> = {};
    const termWasSet = await termTypeIsEstablished(tx, row.id);
    let nextTermType = row.termType;
    const term = prepared.get("term_type");
    if (term) {
      if (!writable(row, flags, "term_type", termWasSet)) {
        outcome.kept.push("term_type");
        noteResult("term_type", term, "kept", term.value);
      } else {
        const proposed = term.value as Contract["termType"];
        const blocksEvergreen =
          proposed === "evergreen" && row.expiryDate !== null && !flags.expiry_date;
        const blocksNonRenewing =
          proposed !== "auto_renew" &&
          row.renewalPeriodMonths !== null &&
          !flags.renewal_period_months;
        if (blocksEvergreen || blocksNonRenewing) {
          outcome.invalid.push("term_type");
          noteResult("term_type", term, "invalid", term.value);
        } else {
          patch.termType = proposed;
          nextTermType = proposed;
          if (proposed === "evergreen" && row.expiryDate !== null) {
            patch.expiryDate = null;
            delete flags.expiry_date;
          }
          if (proposed !== "auto_renew" && row.renewalPeriodMonths !== null) {
            patch.renewalPeriodMonths = null;
            delete flags.renewal_period_months;
          }
          flags.term_type = flag(term.evidence, run.id, !!run.sourceContext);
          outcome.written.push("term_type");
          noteResult("term_type", term, "written", term.value);
        }
      }
      prepared.delete("term_type");
    }

    for (const slug of [
      "effective_date",
      "expiry_date",
      "renewal_period_months",
      "notice_period_days",
      "value",
    ] as const) {
      const item = prepared.get(slug);
      if (!item) continue;
      // A core answer is consumed here even when the writer keeps or rejects it.
      // Leaving it in `prepared` would make the custom-field pass below write the
      // same slug into `custom_fields`, bypassing the core writer's decision.
      prepared.delete(slug);
      if (slug === "expiry_date" && nextTermType === "evergreen") {
        outcome.invalid.push(slug);
        noteResult(slug, item, "invalid", item.value);
        continue;
      }
      if (slug === "renewal_period_months" && nextTermType !== "auto_renew") {
        outcome.invalid.push(slug);
        noteResult(slug, item, "invalid", item.value);
        continue;
      }
      if (!writable(row, flags, slug, termWasSet)) {
        outcome.kept.push(slug);
        noteResult(slug, item, "kept", item.value);
        continue;
      }
      if (slug === "effective_date") patch.effectiveDate = item.value as string;
      if (slug === "expiry_date") patch.expiryDate = item.value as string;
      if (slug === "renewal_period_months") patch.renewalPeriodMonths = item.value as number;
      if (slug === "notice_period_days") patch.noticePeriodDays = item.value as number;
      if (slug === "value") {
        const value = item.value as {
          amount: number;
          currency: string;
          cadence: Contract["valueCadence"];
        };
        patch.valueAmount = value.amount;
        patch.valueCurrency = value.currency;
        patch.valueCadence = value.cadence;
      }
      flags[slug] = flag(item.evidence, run.id, !!run.sourceContext);
      outcome.written.push(slug);
      noteResult(slug, item, "written", item.value);
    }

    const counterparty = prepared.get("counterparty");
    if (counterparty) {
      const name = counterparty.value as string;
      const [matches, linked] = await Promise.all([
        tx
          .select({ id: counterparties.id })
          .from(counterparties)
          .where(
            and(
              isNull(counterparties.archivedAt),
              sql`lower(${counterparties.name}) = lower(${name})`,
            ),
          ),
        tx
          .select({
            id: contractCounterparties.counterpartyId,
            isPrimary: contractCounterparties.isPrimary,
          })
          .from(contractCounterparties)
          .where(eq(contractCounterparties.contractId, row.id)),
      ]);
      if (row.analysisHumanFields.includes("counterparty")) {
        outcome.kept.push("counterparty");
        noteResult("counterparty", counterparty, "kept", name);
      } else if (matches.length === 1 && linked.length === 0) {
        await tx.insert(contractCounterparties).values({
          contractId: row.id,
          counterpartyId: matches[0]!.id,
          isPrimary: true,
        });
        flags.counterparty = flag(counterparty.evidence, run.id, !!run.sourceContext);
        outcome.written.push("counterparty");
        noteResult("counterparty", counterparty, "written", name);
      } else if (
        matches.length === 1 &&
        linked.some((party) => party.id === matches[0]!.id && party.isPrimary)
      ) {
        outcome.kept.push("counterparty");
        noteResult("counterparty", counterparty, "kept", name);
      } else {
        outcome.unmatched = name;
        noteResult("counterparty", counterparty, "unmatched", name);
      }
      prepared.delete("counterparty");
    }

    for (const [slug, item] of prepared) {
      // Core targets have dedicated writers above. Keep this boundary even if
      // a future core branch forgets to consume its prepared answer.
      if (item.target.core) continue;
      if (!writable(row, flags, slug, termWasSet)) {
        outcome.kept.push(slug);
        noteResult(slug, item, "kept", item.value);
        continue;
      }
      const customFields = { ...(patch.customFields ?? row.customFields) };
      customFields[slug] = item.value as CustomFieldValue;
      patch.customFields = customFields;
      flags[slug] = flag(item.evidence, run.id, !!run.sourceContext);
      outcome.written.push(slug);
      noteResult(slug, item, "written", item.value);
    }

    // The model saw the target list in this order, and the card reads
    // it back in that same order. Every target takes exactly one arm.
    outcome.results = targets.flatMap((target) => {
      const result = results.get(target.slug);
      return result ? [result] : [];
    });

    if (outcome.written.length > 0) {
      patch.aiUnverified = Object.keys(flags).length > 0 ? flags : null;
    }
    if (Object.keys(patch).length > 0) {
      await tx.update(contracts).set(patch).where(eq(contracts.id, row.id));
    }
    const finishedAt = new Date();
    await tx
      .update(contractAnalysisRuns)
      .set({ state: "ready", outcome, sourceContext: run.sourceContext, failure: null, finishedAt })
      .where(eq(contractAnalysisRuns.id, run.id));
    await recordActivity(tx, {
      entityType: "contract",
      entityId: row.id,
      action: "contract.analysis_completed",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        number: row.number,
        title: row.title,
        runId: run.id,
        versionId: run.sourceContext ? null : targetText.versionId,
        model,
        written: outcome.written,
        kept: outcome.kept,
        unsupported: outcome.unsupported,
        invalid: outcome.invalid,
        ...(outcome.unmatched === undefined ? {} : { unmatched: outcome.unmatched }),
      },
    });
  });
}

function flag(evidence: string, runId: string, sourceContext = false) {
  return { evidence, runId, sourceContext, writtenAt: new Date().toISOString() };
}

async function failRun(
  deps: ContractAnalysisDeps,
  runId: string,
  reason: string,
  lease?: Date | null,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(contractAnalysisRuns)
      .where(eq(contractAnalysisRuns.id, runId))
      .limit(1)
      .for("update");
    if (
      !run ||
      run.state !== "pending" ||
      (run.sourceContext && run.startedAt?.valueOf() !== lease?.valueOf())
    )
      return;
    const [contract] = await tx
      .select({ number: contracts.number, title: contracts.title })
      .from(contracts)
      .where(eq(contracts.id, run.contractId))
      .limit(1);
    await tx
      .update(contractAnalysisRuns)
      .set({ state: "failed", failure: reason, finishedAt: new Date() })
      .where(eq(contractAnalysisRuns.id, run.id));
    if (contract) {
      await recordActivity(tx, {
        entityType: "contract",
        entityId: run.contractId,
        action: "contract.analysis_failed",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          number: contract.number,
          title: contract.title,
          runId: run.id,
          versionId: run.versionId,
          model: run.model,
          reason,
        },
      });
    }
  });
}

/** Runs one queued analysis attempt. Transient failures escape for pg-boss to retry. */
export async function handleContractAnalysis(
  deps: ContractAnalysisDeps,
  attempt: ContractAnalysisAttempt,
): Promise<void> {
  const [run] = await deps.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.id, attempt.runId))
    .limit(1);
  if (!run || run.state !== "pending") return;

  try {
    if (run.sourceContext) {
      await handleRequestAnalysis(deps, run);
      return;
    }
    const prepared = await deps.db.transaction(async (tx) => {
      const [contract] = await tx
        .select({
          id: contracts.id,
          contractTypeId: contracts.contractTypeId,
          archivedAt: contracts.archivedAt,
          endedAt: contracts.endedAt,
        })
        .from(contracts)
        .where(eq(contracts.id, run.contractId))
        .limit(1)
        .for("update");
      if (!contract) {
        throw new AnalysisTargetError("The Contract no longer exists.");
      }
      if (contract.archivedAt || contract.endedAt) {
        throw new AnalysisTargetError("The Contract is frozen and cannot be analyzed.");
      }

      const provider = await deps.resolveAiProvider();
      if (!provider) throw new AiConfigError("No enabled AI connector is configured.");

      const targetText =
        run.startedAt && run.versionId
          ? await snapshottedTargetText(tx, run.contractId, contract.contractTypeId, run.versionId)
          : await analysisTargetText(tx, run.contractId);
      if (!targetText) {
        throw new AnalysisTargetError("The Contract has no ready, non-empty analysis target text.");
      }
      const truncated = targetText.text.length > AI_ANALYSIS_CHARACTER_BUDGET;
      const sentText = targetText.text.slice(0, AI_ANALYSIS_CHARACTER_BUDGET);
      const targets = await buildAnalysisTargets(tx, targetText.contractTypeId);
      await tx
        .update(contractAnalysisRuns)
        .set({
          versionId: targetText.versionId,
          preset: provider.preset,
          model: provider.model,
          truncated,
          startedAt: run.startedAt ?? new Date(),
        })
        .where(eq(contractAnalysisRuns.id, run.id));
      return { provider, targetText, truncated, sentText, targets };
    });
    const { provider, targetText, truncated, sentText, targets } = prepared;
    const extractions = await provider.extract(
      [
        {
          id: targetText.versionId,
          revision: targetText.versionId,
          label: "Contract document",
          kind: "document",
          text: sentText,
        },
      ],
      targets,
    );
    await applyAnswers(
      deps,
      {
        ...run,
        versionId: targetText.versionId,
        preset: provider.preset,
        model: provider.model,
        truncated,
      },
      { ...targetText, text: sentText },
      targets,
      extractions,
      provider.model,
    );
    deps.log.info({ runId: run.id, contractId: run.contractId }, "contract analysis finished");
  } catch (error) {
    if (
      !run.sourceContext &&
      !isTerminalAnalysisFailure(error) &&
      attempt.retryCount < attempt.retryLimit
    )
      throw error;
    const reason = run.sourceContext
      ? "Request-context Analysis could not finish. Retry after checking the Type, sources and AI settings."
      : reasonOf(error);
    await failRun(deps, run.id, reason, run.startedAt);
    deps.log.error({ runId: run.id, reason }, "contract analysis failed");
  }
}

async function handleRequestAnalysis(deps: ContractAnalysisDeps, run: ContractAnalysisRun) {
  if (!deps.storage || !deps.docEngine)
    throw new AnalysisTargetError("Source readers unavailable.");
  const [claimed] = await deps.db
    .update(contractAnalysisRuns)
    .set({ startedAt: new Date() })
    .where(
      and(
        eq(contractAnalysisRuns.id, run.id),
        eq(contractAnalysisRuns.state, "pending"),
        or(
          isNull(contractAnalysisRuns.startedAt),
          lt(contractAnalysisRuns.startedAt, new Date(Date.now() - 180_000)),
        ),
      ),
    )
    .returning();
  if (!claimed) return;
  run.startedAt = claimed.startedAt;
  const { context, contract } = await requestAnalysisContext(deps.db, run);
  const targets = await buildAnalysisTargets(deps.db, contract.contractTypeId);
  const provider = await deps.resolveAiProvider();
  if (!provider) throw new AiConfigError("AI connector disabled.");
  await deps.db
    .update(contractAnalysisRuns)
    .set({ model: provider.model, preset: provider.preset })
    .where(eq(contractAnalysisRuns.id, run.id));
  const attachmentReads = await readConversionAttachments(
    { storage: deps.storage, docEngine: deps.docEngine },
    context.attachments,
    run.id,
    ATTACHMENT_LIMITS.totalCharacters -
      context.sources.reduce((n, source) => n + source.text.length, 0),
  );
  withAttachmentReads(context, attachmentReads);
  const beforeCall = await requestAnalysisContext(deps.db, run);
  if (
    beforeCall.context.snapshot !== context.snapshot ||
    hash(await buildAnalysisTargets(deps.db, contract.contractTypeId)) !== hash(targets)
  )
    throw new AnalysisTargetError("Request sources or Contract Fields changed before extraction.");
  let timer: NodeJS.Timeout | undefined;
  const answers = await Promise.race([
    provider.extract(context.sources, targets),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AnalysisTargetError("Analysis timed out.")), 125_000);
    }),
  ]).finally(() => clearTimeout(timer));
  const suggestions: Record<string, ConversionSuggestion> = {};
  const checked: AiExtraction[] = [];
  const conflicted = new Set(
    answers.filter((answer) => answer.conflict).map((answer) => answer.slug),
  );
  for (const answer of answers) {
    if (
      conflicted.has(answer.slug) ||
      answer.conflict ||
      !targets.some((target) => target.slug === answer.slug)
    )
      continue;
    const citations = answer.citations?.length
      ? answer.citations
      : answer.sourceId && answer.evidence
        ? [{ sourceId: answer.sourceId, quote: answer.evidence }]
        : [];
    if (!citations.length || citations.length > 20) continue;
    const valid = citations.flatMap((citation) => {
      const source = context.sources.find((source) => source.id === citation.sourceId);
      return source &&
        citation.quote.trim() &&
        citation.quote.length <= 4000 &&
        normalizeQuote(source.text).includes(normalizeQuote(citation.quote))
        ? [{ ...citation, revision: source.revision }]
        : [];
    });
    if (valid.length !== citations.length) continue;
    suggestions[answer.slug] = { value: JSON.stringify(answer.value) ?? "", citations: valid };
    checked.push({ ...answer, evidence: valid.map((citation) => citation.quote).join("\n") });
  }
  const sourceContext: ConversionAnalysisContext = {
    ...run.sourceContext!,
    attachmentReads,
    suggestions,
    warnings: context.warnings,
  };
  await applyAnswers(
    deps,
    { ...run, sourceContext, model: provider.model, preset: provider.preset },
    {
      contractId: contract.id,
      contractTypeId: contract.contractTypeId,
      versionId: "",
      text: "",
    },
    targets,
    checked,
    provider.model,
    context.snapshot,
  );
}
