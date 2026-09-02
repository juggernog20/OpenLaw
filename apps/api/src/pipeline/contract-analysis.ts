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
} from "@openlaw/shared";
import { buildAnalysisTargets, type AnalysisTarget } from "../lib/analysis-targets.js";
import { AiConfigError, isTerminalAiError, type AiExtraction } from "../lib/ai/provider.js";
import type { AiResolver } from "../lib/ai/resolver.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../lib/activity.js";
import type { PipelineLogger } from "./logger.js";

export interface ContractAnalysisDeps {
  db: Db;
  resolveAiProvider: AiResolver;
  log: PipelineLogger;
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

    const outcome: ContractAnalysisOutcome = {
      written: [],
      kept: [],
      unsupported: [],
      invalid: [],
    };
    const prepared = new Map<string, PreparedAnswer>();
    for (const target of targets) {
      const answer = answerBySlug.get(target.slug);
      if (!evidenceIsSupported(targetText.text, answer?.evidence)) {
        outcome.unsupported.push(target.slug);
        continue;
      }
      const value = coerce(target, answer?.value);
      if (value === null) {
        outcome.invalid.push(target.slug);
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
          flags.term_type = flag(term.evidence, run.id);
          outcome.written.push("term_type");
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
        continue;
      }
      if (slug === "renewal_period_months" && nextTermType !== "auto_renew") {
        outcome.invalid.push(slug);
        continue;
      }
      if (!writable(row, flags, slug, termWasSet)) {
        outcome.kept.push(slug);
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
      flags[slug] = flag(item.evidence, run.id);
      outcome.written.push(slug);
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
          .select({ id: contractCounterparties.counterpartyId })
          .from(contractCounterparties)
          .where(eq(contractCounterparties.contractId, row.id))
          .limit(1),
      ]);
      if (matches.length === 1 && linked.length === 0) {
        await tx.insert(contractCounterparties).values({
          contractId: row.id,
          counterpartyId: matches[0]!.id,
          isPrimary: true,
        });
        flags.counterparty = flag(counterparty.evidence, run.id);
        outcome.written.push("counterparty");
      } else {
        outcome.unmatched = name;
      }
      prepared.delete("counterparty");
    }

    for (const [slug, item] of prepared) {
      // Core targets have dedicated writers above. Keep this boundary even if
      // a future core branch forgets to consume its prepared answer.
      if (item.target.core) continue;
      if (!writable(row, flags, slug, termWasSet)) {
        outcome.kept.push(slug);
        continue;
      }
      const customFields = { ...(patch.customFields ?? row.customFields) };
      customFields[slug] = item.value as CustomFieldValue;
      patch.customFields = customFields;
      flags[slug] = flag(item.evidence, run.id);
      outcome.written.push(slug);
    }

    if (outcome.written.length > 0) {
      patch.aiUnverified = Object.keys(flags).length > 0 ? flags : null;
    }
    if (Object.keys(patch).length > 0) {
      await tx.update(contracts).set(patch).where(eq(contracts.id, row.id));
    }
    const finishedAt = new Date();
    await tx
      .update(contractAnalysisRuns)
      .set({ state: "ready", outcome, failure: null, finishedAt })
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
        versionId: targetText.versionId,
        model,
        ...outcome,
      },
    });
  });
}

function flag(evidence: string, runId: string) {
  return { evidence, runId, writtenAt: new Date().toISOString() };
}

async function failRun(deps: ContractAnalysisDeps, runId: string, reason: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(contractAnalysisRuns)
      .where(eq(contractAnalysisRuns.id, runId))
      .limit(1)
      .for("update");
    if (!run || run.state !== "pending") return;
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
    const extractions = await provider.extract(sentText, targets);
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
    if (!isTerminalAnalysisFailure(error) && attempt.retryCount < attempt.retryLimit) throw error;
    const reason = reasonOf(error);
    await failRun(deps, run.id, reason);
    deps.log.error({ runId: run.id, reason }, "contract analysis failed");
  }
}
