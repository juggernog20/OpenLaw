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
 * This is the worker's whole surface on purpose. The two `FromEnv`
 * readers below are re-exported rather than reached for through a second
 * subpath, because a worker that assembled its dependencies from three
 * different corners of this package would drift from the API that
 * assembles the same three.
 */

// The two dependencies a handler needs and the pipeline does not build
// for itself, each chosen from the environment at startup exactly as the
// API chooses them (DOC-009, TECH-010).
export { createDocEngineFromEnv } from "../lib/doc-engine/config.js";
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
  JOB_QUEUES,
  type DisplayConversionJob,
  type JobQueue,
  type TextExtractionJob,
} from "./jobs.js";
export { createConsoleLogger, type PipelineLogger } from "./logger.js";
export {
  startPipeline,
  DISPLAY_CONVERSION_QUEUE_OPTIONS,
  TEXT_EXTRACTION_QUEUE_OPTIONS,
  type Pipeline,
  type PipelineOptions,
} from "./pg-boss.js";
export {
  extractsText,
  hasUsableTextLayer,
  MIN_NATIVE_TEXT_CHARACTERS,
  recordTextOwed,
} from "./text-extraction.js";
