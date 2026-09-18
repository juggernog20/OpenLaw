// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import {
  EXTRACTION_BOUND,
  extractionObject,
  extractionPrompt,
  parseExtractionReply,
  type AiCallBound,
} from "./http.js";
import {
  AiResponseError,
  AiProviderError,
  AiTimeoutError,
  type AiExtraction,
  type AiExtractionTarget,
  type AiSource,
} from "./provider.js";

function valueSchema(target: AiExtractionTarget): z.ZodType {
  switch (target.type) {
    case "boolean":
      return z.boolean();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "date":
      return z.iso.date();
    case "term_type":
      return z.enum(["fixed", "auto_renew", "evergreen"]);
    case "single_select":
      return target.options?.length ? z.enum(target.options) : z.string();
    case "multi_select":
      return z.array(target.options?.length ? z.enum(target.options) : z.string());
    case "value":
      return z.strictObject({
        amount: z.number().int().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        cadence: z.enum(["one_time", "monthly", "annually"]),
      });
    case "key_dates":
      return z
        .array(
          z.strictObject({
            kind: z.literal("milestone"),
            date: z.iso.date(),
            label: z.string().min(1).max(200),
            note: z.string().max(2000).nullable(),
            sourceId: z.string().min(1),
            evidence: z.string().min(1).max(4000),
          }),
        )
        .max(20);
    case "long_text":
      return z.string().max(10000);
    case "currency":
      return z.string().regex(/^[A-Z]{3}$/);
    case "text":
    case "counterparty":
    case "user":
    case "entity":
      return z.string().max(500);
    default:
      return z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
  }
}

function responseValidator(
  targets: readonly AiExtractionTarget[],
  sources: string | readonly AiSource[],
) {
  const ids = typeof sources === "string" ? [] : sources.map((source) => source.id);
  const sourceId = ids.length ? z.enum(["", ...new Set(ids)]) : z.string();
  return z.strictObject(
    Object.fromEntries(
      targets.map((target) => [
        target.slug,
        z.strictObject({
          value: valueSchema(target).nullable(),
          evidence: z.string().max(4000).nullish(),
          sourceId: sourceId.nullish(),
          citations: z
            .array(
              z.strictObject({
                sourceId: ids.length ? z.enum(ids) : z.string().min(1),
                quote: z.string().min(1).max(4000),
              }),
            )
            .optional(),
          conflict: z.boolean().optional(),
          justification: z.string().max(1000).nullish(),
        }),
      ]),
    ),
  );
}

/** Keep the provider schema within the shared API subset; enforce all limits locally. */
function portableSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableSchema);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "$schema",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "pattern",
      ].includes(key)
    )
      continue;
    if (key === "const") output.enum = [child];
    else if (key === "properties" && child && typeof child === "object") {
      output.properties = Object.fromEntries(
        Object.entries(child).map(([name, schema]) => [name, portableSchema(schema)]),
      );
    } else output[key] = portableSchema(child);
  }
  if (output.type === "object" && output.properties) {
    output.required = Object.keys(output.properties);
    output.additionalProperties = false;
  }
  return output;
}

export function extractionSchema(
  targets: readonly AiExtractionTarget[],
  sources: string | readonly AiSource[],
) {
  const schema = portableSchema(z.toJSONSchema(responseValidator(targets, sources))) as Record<
    string,
    unknown
  >;
  // Empty metadata and an empty citation list represent unsupported values.
  // Reserve nullable unions for field values; Claude limits unions per request.
  for (const entry of Object.values(
    schema.properties as Record<string, { properties: Record<string, unknown> }>,
  )) {
    entry.properties.evidence = {
      type: "string",
      description: "Exact supporting quote, at most 4000 characters; empty when unsupported.",
    };
    entry.properties.justification = {
      type: "string",
      description: "At most 1000 characters; empty when unsupported.",
    };
    entry.properties.sourceId =
      typeof sources === "string"
        ? { type: "string" }
        : { type: "string", enum: ["", ...new Set(sources.map((source) => source.id))] };
  }
  return schema;
}

function validateReply(
  reply: string,
  targets: readonly AiExtractionTarget[],
  sources: string | readonly AiSource[],
) {
  const entries = extractionObject(reply);
  for (const entry of Object.values(entries)) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      "conflict" in entry &&
      entry.conflict === true &&
      !("value" in entry)
    ) {
      Object.assign(entry, { value: null });
    }
  }
  const validated = responseValidator(targets, sources).safeParse(entries);
  if (!validated.success) {
    throw new AiResponseError(
      "The provider reply did not match the requested fields or value types.",
      {
        reason: "invalid_shape",
        issues: validated.error.issues.slice(0, 8).map((issue) => ({
          field: targets.find((target) => target.slug === issue.path[0])?.slug ?? "response",
          rule: issue.code,
        })),
      },
    );
  }
  return parseExtractionReply(JSON.stringify(entries), targets);
}

export type StructuredCompletion = (
  prompt: string,
  bound: AiCallBound,
  schema: Record<string, unknown>,
) => Promise<string>;

/** One repair attempt per batch. Never echo a rejected reply back to the model. */
export async function extractStructured(
  sources: string | readonly AiSource[],
  targets: readonly AiExtractionTarget[],
  complete: StructuredCompletion,
  maxTokens = EXTRACTION_BOUND.maxTokens,
) {
  const deadline = Date.now() + extractionTimeBudget(targets, sources);
  const batches = extractionBatches(targets, sources);
  async function extractBatch(batch: AiExtractionTarget[]) {
    const batchDeadline = Math.min(deadline, Date.now() + EXTRACTION_BOUND.timeoutMs);
    const schema = extractionSchema(batch, sources);
    const prompt = `${extractionPrompt(sources, batch)}\n\nResponse JSON Schema (all requested fields must be present; use value: null, empty metadata strings, citations: [], and conflict: false when unsupported):\n${JSON.stringify(schema)}`;
    let correction = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const bound = remainingCallBound(
        { maxTokens, timeoutMs: EXTRACTION_BOUND.timeoutMs },
        batchDeadline,
      );
      try {
        return validateReply(await complete(prompt + correction, bound, schema), batch, sources);
      } catch (error) {
        if (!(error instanceof AiResponseError) || error.reason === "refused" || attempt === 1)
          throw error;
        correction = `\nYour previous response could not be used (${error.reason}). ${error.issues ? `Fields and validation rules to correct: ${JSON.stringify(error.issues)}. ` : ""}Return a complete JSON object matching the schema, with every requested field, correctly typed values, and short exact supporting quotes. Use null for unsupported values. Do not add prose or extra properties.`;
      }
    }
    throw new AiResponseError("The provider did not return a usable response.");
  }
  const results: AiExtraction[][] = new Array(batches.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  // Two independent batches at a time, with one deadline for the whole extraction.
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (!failure && next < batches.length) {
        const index = next++;
        try {
          results[index] = await extractBatch(batches[index]!);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) {
    if (failure.error instanceof AiProviderError)
      failure.error.progress = {
        completedBatches: results.filter(Boolean).length,
        totalBatches: batches.length,
      };
    throw failure.error;
  }
  return results.flat();
}

export function remainingCallBound(bound: AiCallBound, deadline: number): AiCallBound {
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) throw new AiTimeoutError("The provider did not answer in time.");
  return { ...bound, timeoutMs };
}

function unionCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + unionCount(item), 0);
  const object = value as Record<string, unknown>;
  return (
    (Array.isArray(object.anyOf) || Array.isArray(object.type) ? 1 : 0) +
    Object.values(object).reduce<number>((sum, child) => sum + unionCount(child), 0)
  );
}

export function extractionBatches(
  targets: readonly AiExtractionTarget[],
  sources: string | readonly AiSource[],
) {
  const batches: AiExtractionTarget[][] = [];
  let batch: AiExtractionTarget[] = [];
  for (const target of targets) {
    if (
      batch.length &&
      (batch.length >= 12 || unionCount(extractionSchema([...batch, target], sources)) > 16)
    ) {
      batches.push(batch);
      batch = [];
    }
    batch.push(target);
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Each pair of batches gets one call window; even the largest catalog stops after 15 minutes. */
export function extractionTimeBudget(
  targets: readonly AiExtractionTarget[],
  sources: string | readonly AiSource[],
) {
  const rounds = Math.max(1, Math.ceil(extractionBatches(targets, sources).length / 2));
  return Math.min(rounds, 3) * EXTRACTION_BOUND.timeoutMs;
}

export function checkCompletionReason(reason: string, refusal = false) {
  if (["length", "max_tokens", "MAX_TOKENS"].includes(reason)) {
    throw new AiResponseError("The AI response reached its output limit before it finished.", {
      reason: "output_limit",
    });
  }
  if (
    refusal ||
    [
      "refusal",
      "content_filter",
      "SAFETY",
      "RECITATION",
      "BLOCKLIST",
      "PROHIBITED_CONTENT",
      "SPII",
    ].includes(reason)
  ) {
    throw new AiResponseError("The AI provider declined to analyze these sources.", {
      reason: "refused",
    });
  }
}
