// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The web app's one reading of an RFC 9457 refusal (TECH-024, TECH-020).
 * Generated-client calls already carry a parsed problem beside their
 * Response; multipart calls carry the raw Response. A rejected request
 * carries neither, which is the network arm and never a refusal with an
 * empty sentence.
 */

/** The facts every failed request makes available to its caller. */
export interface Problem {
  detail: string | undefined;
  type: string | undefined;
  status: number | undefined;
  network: boolean;
}

/** A settings adapter's optional success data beside the same failure facts. */
export type ProblemResult<T> = Problem & { data?: T };

/** The part of an openapi-fetch answer needed to read a refusal. */
export interface OpenApiResult {
  error?: unknown;
  response: Response;
}

/** One own string field off an unknown problem body. */
function stringField(body: unknown, name: "detail" | "type"): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = Object.getOwnPropertyDescriptor(body, name)?.value as unknown;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(body: unknown, name: "status"): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = Object.getOwnPropertyDescriptor(body, name)?.value as unknown;
  return typeof value === "number" ? value : undefined;
}

function openApiResult(input: unknown): input is OpenApiResult {
  return (
    typeof input === "object" &&
    input !== null &&
    Object.getOwnPropertyDescriptor(input, "response")?.value instanceof Response
  );
}

/** Reads a body without consuming the Response a caller may still need. */
async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

/**
 * Normalizes a generated-client refusal, a raw fetch refusal, or a
 * request that received no response into the one problem shape.
 */
export async function problem(input: unknown): Promise<Problem> {
  if (input === undefined || input instanceof Error) {
    return { detail: undefined, type: undefined, status: undefined, network: true };
  }

  const response = input instanceof Response ? input : openApiResult(input) ? input.response : null;
  const body =
    input instanceof Response
      ? await responseBody(input)
      : openApiResult(input)
        ? input.error
        : input;
  return {
    detail: stringField(body, "detail"),
    type: stringField(body, "type"),
    status: response?.status ?? numberField(body, "status"),
    network: false,
  };
}
