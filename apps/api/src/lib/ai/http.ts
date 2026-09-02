// SPDX-License-Identifier: AGPL-3.0-only

import {
  AiConfigError,
  AiResponseError,
  AiTimeoutError,
  AiUnavailableError,
  type AiExtraction,
  type AiExtractionTarget,
} from "./provider.js";

const AI_CALL_TIMEOUT_MS = 30_000;

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
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "detail", "error_description", "error"]) {
    const reason = nestedReason(record[key]);
    if (reason) return reason;
  }
  return null;
}

/** Reads the provider's own reason without copying an HTML error page into Settings. */
async function refusalReason(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const reason = nestedReason(JSON.parse(raw));
    if (reason) return reason;
  } catch {
    // A short plain-text refusal is still the provider's useful reason.
  }
  const plain = raw.replace(/\s+/g, " ").trim();
  return plain && plain.length <= 500 ? plain : response.statusText || `HTTP ${response.status}`;
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
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new AiTimeoutError("The provider did not answer in time.", { cause: error });
    }
    throw new AiUnavailableError(`The provider could not be reached. ${transportReason(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    const reason = await refusalReason(response);
    const message = reason || `The provider refused the request with HTTP ${response.status}.`;
    if (response.status === 429 || response.status >= 500) {
      throw new AiUnavailableError(message);
    }
    throw new AiConfigError(message);
  }
  try {
    return await response.json();
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiResponseError("The provider reply was not an object keyed by field slug.");
  }
  const object = parsed as Record<string, unknown>;
  const answers: AiExtraction[] = [];
  for (const target of targets) {
    if (!(target.slug in object)) continue;
    const entry = object[target.slug];
    if (entry && typeof entry === "object" && !Array.isArray(entry) && "value" in entry) {
      const record = entry as Record<string, unknown>;
      answers.push({
        slug: target.slug,
        value: record.value,
        ...(typeof record.evidence === "string" ? { evidence: record.evidence } : {}),
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
      if (!current || typeof current !== "object") return "";
      current = (current as Record<string, unknown>)[key];
    }
  }
  return typeof current === "string" ? current : "";
}

export function requireReply(value: string): string {
  if (!value.trim()) throw new AiResponseError("The provider returned no text reply.");
  return value;
}
