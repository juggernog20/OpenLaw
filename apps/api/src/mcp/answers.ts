// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Creation Form answers for the generic create Tools (TECH-035: T10, T15).
 * The agent keys answers by rowRef. Native rows map to the service input
 * names; every other key is a Field slug. A refusal names each answer the
 * way the agent keyed it.
 */
import type { z } from "zod";
import { ToolError } from "./tool.js";

export function creationAnswerParser<Schema extends z.ZodType>(options: {
  /** The rowRef that carries the type. Its answer must match the typed argument. */
  typeRowRef: string;
  typeLabel: string;
  typeArgument: string;
  /** rowRef to service input name, for the native rows. */
  answerNames: Readonly<Record<string, string>>;
  schema: Schema;
}) {
  const { typeRowRef, typeLabel, typeArgument, answerNames, schema } = options;
  const rowRefs = new Map(Object.entries(answerNames).map(([rowRef, key]) => [key, rowRef]));
  function answerPath(path: readonly PropertyKey[]): string[] {
    const [head, ...rest] = path.map(String);
    if (head === undefined) return [];
    if (head === "customFields") return rest;
    return [rowRefs.get(head) ?? head, ...rest];
  }
  return (answers: Readonly<Record<string, unknown>>, typeId: string): z.output<Schema> => {
    const native: Record<string, unknown> = {};
    const custom: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (key === typeRowRef) {
        if (value !== typeId)
          throw new ToolError(
            "validation_error",
            `${typeLabel}: the answer must match ${typeArgument}.`,
          );
        continue;
      }
      if (Object.hasOwn(answerNames, key)) native[answerNames[key]!] = value;
      else custom[key] = value;
    }
    const parsed = schema.safeParse({ ...native, customFields: custom });
    if (!parsed.success)
      throw new ToolError(
        "validation_error",
        parsed.error.issues
          .map((issue) => `${answerPath(issue.path).join(".")}: ${issue.message}`)
          .join("; "),
      );
    return parsed.data;
  };
}
