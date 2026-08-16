// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The background pipeline (TECH-007), as the worker entrypoint sees it.
 *
 * The worker is the same application image started with a different
 * command, so it does not carry its own copy of the storage adapter, the
 * doc engine, or the schema — it imports them from here and starts the
 * pipeline with them. Everything a job handler needs is what the API is
 * built from, minus the HTTP.
 *
 * This is the worker's whole surface on purpose. The three dependency
 * builders below are re-exported rather than reached for through a
 * second subpath, because a worker that assembled its dependencies from
 * three different corners of this package would drift from the API that
 * assembles the same three.
 */

// The three dependencies a handler needs and the pipeline does not
// build for itself. Storage and the doc engine are chosen from the
// environment at startup, exactly as the API chooses them (DOC-009,
// TECH-010). The signing connector's credentials are not: they are org
// data read live per call (CTR-013), so its builder takes the database
// rather than the environment. Only the host those credentials are
// presented to is read from the environment, and only the dev/E2E
// overlay ever sets it (TECH-018).
export { createDocEngineFromEnv } from "../lib/doc-engine/config.js";
export {
  createDocuSignDriverFactory,
  readDocuSignBaseUrl,
  SigningHostConfigError,
} from "../lib/signing/config.js";
export { createSigningResolver, type SigningResolver } from "../lib/signing/resolver.js";
export { createStorageFromEnv } from "../lib/storage/config.js";
export {
  runBackfillSweep,
  BACKFILL_PAGE_SIZE,
  BACKFILL_REFUSAL_LIMIT,
  type BackfillDeps,
  type BackfillOptions,
  type BackfillSummary,
} from "./backfill.js";
export { isTerminalFailure, type DerivationDeps } from "./derivations.js";
export { needsDisplayRendition, recordRenditionOwed } from "./display-conversion.js";
export {
  runExecutedCopySweep,
  EXECUTED_COPY_SWEEP_PAGE_SIZE,
  EXECUTED_COPY_SWEEP_REFUSAL_LIMIT,
  type ExecutedCopySweepDeps,
  type ExecutedCopySweepOptions,
  type ExecutedCopySweepSummary,
} from "./executed-copy.js";
export {
  JOB_QUEUES,
  type DisplayConversionJob,
  type ExecutedCopyFetchJob,
  type JobQueue,
  type TextExtractionJob,
} from "./jobs.js";
export { createConsoleLogger, type PipelineLogger } from "./logger.js";
export {
  runReconciliationSweep,
  startReconciliationSweeps,
  RECONCILIATION_PAGE_SIZE,
  RECONCILIATION_REFUSAL_LIMIT,
  RECONCILIATION_SWEEP_INTERVAL_MS,
  type ReconciliationDeps,
  type ReconciliationOptions,
  type ReconciliationScheduleOptions,
  type ReconciliationSummary,
} from "./reconciliation.js";
export {
  startPipeline,
  DISPLAY_CONVERSION_QUEUE_OPTIONS,
  EXECUTED_COPY_QUEUE_OPTIONS,
  TEXT_EXTRACTION_QUEUE_OPTIONS,
  type Pipeline,
  type PipelineHandlers,
  type PipelineOptions,
} from "./pg-boss.js";
export {
  extractsText,
  hasUsableTextLayer,
  MIN_NATIVE_TEXT_CHARACTERS,
  recordTextOwed,
} from "./text-extraction.js";
