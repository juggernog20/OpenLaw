// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-026's build-generated documentation, validated and cached once per process.
 * The bundle path resolves from both src/mcp and dist/mcp.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DocumentationBundle } from "../../../../scripts/documentation/reader.mjs";
import { ToolError } from "./tool.js";

const strings = z.array(z.string());
const bundleSchema: z.ZodType<DocumentationBundle> = z.object({
  schemaVersion: z.number(),
  edition: z.object({
    id: z.string(),
    channel: z.enum(["development", "release"]),
    supportedAppVersion: z.string(),
    supportedAppCommit: z.string().nullable(),
    distributionCommit: z.string().nullable(),
    workingChanges: z.boolean(),
    publicationTarget: z.string(),
    contentDigest: z.string(),
  }),
  preview: z.boolean(),
  validationPending: z.boolean(),
  sections: z.array(z.object({ id: z.string(), title: z.string() })),
  contexts: strings,
  bindings: z.array(
    z.object({
      routes: strings,
      contexts: strings,
      surface: z.enum(["staff", "portal", "both", "formal"]),
      pilotEntry: z.boolean(),
    }),
  ),
  redirects: z.array(z.object({ from: z.string(), to: z.string() })),
  articles: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      section: z.string(),
      audiences: z.array(
        z.enum(["legal_team_member", "administrator", "contributor", "business_user", "operator"]),
      ),
      destinations: z.array(z.enum(["formal", "staff-help", "portal-help"])),
      contexts: strings,
      outline: z.array(z.object({ id: z.string(), text: z.string(), depth: z.number() })),
      html: z.object({
        formal: z.string(),
        "staff-help": z.string(),
        "portal-help": z.string(),
        standalone: z.string(),
      }),
      text: z.string(),
      unverified: z.boolean(),
      contentSha256: z.string(),
      assets: z.array(z.object({ path: z.string(), sha256: z.string() })),
    }),
  ),
  warnings: strings,
  report: z.object({
    required: z.number(),
    verified: z.number(),
    coverageRequired: z.number(),
    coverageVerified: z.number(),
  }),
});

export function parseDocumentationBundle(value: unknown): DocumentationBundle {
  const result = bundleSchema.safeParse(value);
  if (!result.success)
    throw new ToolError(
      "documentation_unavailable",
      "The documentation bundle is invalid. Rebuild the API.",
    );
  return result.data;
}

let bundle: DocumentationBundle | undefined;
export function documentationBundle(): DocumentationBundle {
  if (bundle) return bundle;
  let value: unknown;
  try {
    value = JSON.parse(
      readFileSync(new URL("../../dist/documentation.json", import.meta.url), "utf8"),
    );
  } catch {
    throw new ToolError(
      "documentation_unavailable",
      "The documentation bundle could not be read. Rebuild the API.",
    );
  }
  bundle = parseDocumentationBundle(value);
  return bundle;
}
