// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Cursor pages and named service failures for TECH-035's MCP response budget.
 * Count both structured content and its text copy against the wire limit.
 */
import { z } from "zod";
import { HttpError } from "../lib/problem.js";
import { ToolError } from "./tool.js";

// Both structuredContent and its escaped text copy must fit the Client's 64 KiB limit.
export const RESULT_BYTE_BUDGET = 30_000;
export const pageInput = {
  cursor: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(100).default(25),
};
function responseBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify({
      structuredContent: value,
      content: [{ type: "text", text: JSON.stringify(value) }],
    }),
  );
}
export function bounded<T>(value: T): T {
  if (
    Buffer.byteLength(JSON.stringify(value)) > RESULT_BYTE_BUDGET ||
    responseBytes(value) > 64_000
  )
    throw new ToolError(
      "result_too_large",
      "This result exceeds the Tool byte budget. Narrow the selection or use a smaller page.",
    );
  return value;
}
export function boundedPage<T>(
  items: T[],
  limit: number,
  cursorOf: (item: T) => string,
  following: string | null = null,
) {
  const page: T[] = [];
  for (const item of items.slice(0, limit)) {
    if (
      Buffer.byteLength(JSON.stringify([...page, item])) > RESULT_BYTE_BUDGET - 1000 ||
      responseBytes([...page, item]) > 62_000
    )
      break;
    page.push(item);
  }
  if (!page.length && items.length)
    throw new ToolError("result_too_large", "One entry exceeds the Tool byte budget.");
  return {
    items: page,
    nextCursor: page.length < items.length ? cursorOf(page.at(-1)!) : following,
  };
}
export async function serviceResult<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError && (error.statusCode < 500 || error.expose)) {
      const code =
        error.type !== "about:blank"
          ? error.type.split(":").at(-1)!.replaceAll("-", "_")
          : ((
              {
                400: "validation_error",
                403: "forbidden",
                404: "not_found",
                409: "conflict",
                422: "validation_error",
                503: "unavailable",
              } as Record<number, string>
            )[error.statusCode] ?? "operation_refused");
      throw new ToolError(code, error.message);
    }
    throw error;
  }
}
