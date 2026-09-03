// SPDX-License-Identifier: AGPL-3.0-only

import {
  AiConfigError,
  AiResponseError,
  AiTimeoutError,
  AiUnavailableError,
  type AiExtraction,
  type AiExtractionTarget,
} from "./provider.js";

const MAX_REFUSAL_BYTES = 500;
/** A reply is a small JSON object of values; anything near this is not one. */
const MAX_REPLY_BYTES = 1_000_000;

/** How long one call may take and how many tokens the model may spend answering it. */
export interface AiCallBound {
  maxTokens: number;
  timeoutMs: number;
}

/**
 * A probe is one short exchange. The token cap is still generous because
 * reasoning models spend their thinking inside the same output budget, and
 * a 16-token cap leaves them nothing to answer with.
 */
export const PROBE_BOUND: AiCallBound = { maxTokens: 1024, timeoutMs: 30_000 };

/**
 * An extraction returns one value and one quote per field, after any
 * thinking, and may wait on a local model working through a long contract.
 */
export const EXTRACTION_BOUND: AiCallBound = { maxTokens: 8192, timeoutMs: 120_000 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimedOut(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "TimeoutError");
}

/** Adds a protocol path unless the configured URL already names its final endpoint. */
export function protocolUrl(baseUrl: string, path: string, finalSuffix: string): URL {
  const url = new URL(baseUrl);
  if (url.pathname.replace(/\/$/, "").endsWith(finalSuffix)) return url;
  const query = url.search;
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.search = query;
  return url;
}

function nestedReason(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) return null;
  for (const key of ["message", "detail", "error_description", "error"]) {
    const reason = nestedReason(value[key]);
    if (reason) return reason;
  }
  return null;
}

/** Reads the provider's own reason without copying an HTML error page into Settings. */
async function refusalReason(response: Response): Promise<string> {
  const reply = await readUpTo(response, MAX_REFUSAL_BYTES);
  if (!reply || reply.truncated) return response.statusText || `HTTP ${response.status}`;
  const raw = reply.raw;
  try {
    const reason = nestedReason(JSON.parse(raw));
    if (reason) return reason;
  } catch {
    // A short plain-text refusal is still the provider's useful reason.
  }
  const plain = raw.replace(/\s+/g, " ").trim();
  return plain || response.statusText || `HTTP ${response.status}`;
}

/** Reads at most `maxBytes` of the body, or says that it is longer and
 * stops. `null` is a response with no body at all. */
async function readUpTo(
  response: Response,
  maxBytes: number,
): Promise<{ raw: string; truncated: boolean } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let raw = "";
  let readBytes = 0;
  let truncated: boolean;
  try {
    while (readBytes <= maxBytes) {
      const part = await reader.read();
      if (part.done) {
        raw += decoder.decode();
        break;
      }
      const remaining = maxBytes + 1 - readBytes;
      const bytes = part.value.subarray(0, remaining);
      raw += decoder.decode(bytes, { stream: true });
      readBytes += bytes.byteLength;
      if (part.value.byteLength > bytes.byteLength) break;
    }
    truncated = readBytes > maxBytes;
    if (truncated) await reader.cancel();
  } finally {
    reader.releaseLock();
  }
  return { raw, truncated };
}

function transportReason(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error) return error.cause.message;
  return error instanceof Error ? error.message : String(error);
}

/** One bounded JSON request with the error split later worker jobs need. */
export async function postJson(
  url: URL,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (isTimedOut(signal, error)) {
      throw new AiTimeoutError("The provider did not answer in time.", { cause: error });
    }
    throw new AiUnavailableError(`The provider could not be reached. ${transportReason(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    let reason: string;
    try {
      reason = await refusalReason(response);
    } catch (error) {
      if (isTimedOut(signal, error)) {
        throw new AiTimeoutError("The provider did not answer in time.", { cause: error });
      }
      throw new AiUnavailableError(
        `The provider response could not be read. ${transportReason(error)}`,
        { cause: error },
      );
    }
    const message = reason || `The provider refused the request with HTTP ${response.status}.`;
    if (response.status === 429 || response.status >= 500) {
      throw new AiUnavailableError(message);
    }
    throw new AiConfigError(message);
  }
  let reply: { raw: string; truncated: boolean } | null;
  try {
    reply = await readUpTo(response, MAX_REPLY_BYTES);
  } catch (error) {
    if (isTimedOut(signal, error)) {
      throw new AiTimeoutError("The provider did not answer in time.", { cause: error });
    }
    throw new AiUnavailableError(
      `The provider response could not be read. ${transportReason(error)}`,
      { cause: error },
    );
  }
  if (reply?.truncated) {
    throw new AiResponseError(
      `The provider returned a reply longer than ${String(MAX_REPLY_BYTES)} bytes.`,
    );
  }
  try {
    return JSON.parse(reply?.raw ?? "") as unknown;
  } catch (error) {
    throw new AiResponseError("The provider returned a response that was not JSON.", {
      cause: error,
    });
  }
}

/** The common instruction all protocols carry in their own wire shape. */
export function extractionPrompt(text: string, targets: readonly AiExtractionTarget[]): string {
  const fields = targets.map((target) => `- ${target.slug}: ${target.prompt}`).join("\n");
  return [
    "Extract the requested contract fields.",
    "Return one JSON object keyed by the exact slug.",
    'Each value must be an object with "value" and an exact supporting "evidence" quote.',
    "Use null when the contract does not state a value. Return no prose.",
    "",
    "Fields:",
    fields,
    "",
    "Contract text:",
    text,
  ].join("\n");
}

/** Finds a JSON object in plain, fenced, or lightly narrated model output. */
export function parseExtractionReply(
  reply: string,
  targets: readonly AiExtractionTarget[],
): AiExtraction[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply)?.[1];
  const candidate = fenced ?? reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.trim());
  } catch (error) {
    throw new AiResponseError("The provider reply did not contain one JSON object.", {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new AiResponseError("The provider reply was not an object keyed by field slug.");
  }
  const answers: AiExtraction[] = [];
  for (const target of targets) {
    if (!(target.slug in parsed)) continue;
    const entry = parsed[target.slug];
    if (isRecord(entry) && "value" in entry) {
      answers.push({
        slug: target.slug,
        value: entry.value,
        ...(typeof entry.evidence === "string" ? { evidence: entry.evidence } : {}),
      });
    } else {
      // Weak compatible models sometimes return the scalar directly.
      // Keeping it lets the writer decide whether it fits the target.
      answers.push({ slug: target.slug, value: entry });
    }
  }
  return answers;
}

export function stringAt(value: unknown, path: readonly (string | number)[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return "";
      current = current[key];
    } else {
      if (!isRecord(current)) return "";
      current = current[key];
    }
  }
  return typeof current === "string" ? current : "";
}

export function requireReply(value: string): string {
  if (!value.trim()) throw new AiResponseError("The provider returned no text reply.");
  return value;
}
