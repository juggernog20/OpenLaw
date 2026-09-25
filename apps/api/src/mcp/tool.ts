// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Transport-independent Tool contracts and named failures for TECH-035's register.
 * Tool modules depend on this leaf without importing the initialized register.
 */
import type { OrganizationSection } from "../modules/settings/read.js";
import type { z } from "zod";
import type { AppDeps } from "../app.js";
import type { Db, UserRole } from "@openlaw/db";
import type { McpToolset } from "@openlaw/shared";
import type { AuthenticatedUser } from "../auth/user.js";
import type { GenerationSubmission } from "../modules/auto-docs/generations.js";
import type { uploadInput } from "./documents.js";

export interface Grant {
  role: UserRole;
  toolsets: readonly string[];
  scope: "read" | "write";
}
export interface ToolContext extends Pick<AppDeps, "notifier" | "jobs" | "resolveAiProvider"> {
  db: Db;
  user: AuthenticatedUser;
  grant: Grant;
  credentialId: string;
  clientName: string;
  organizationName: string;
  baseUrl: string;
  readOrganizationSettings?: (section: OrganizationSection) => Promise<Record<string, unknown>>;
  generateAutoDoc?: (id: string, submission: GenerationSubmission) => Promise<unknown>;
  prepareDocumentUpload?: (
    input: z.infer<typeof uploadInput>,
    context: ToolContext,
  ) => Promise<{
    uploadUrl: string;
    headers: Record<string, string>;
    versionId: string;
    documentId: string;
    expiresAt: string;
    maxUploadBytes: number;
  }>;
}
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodObject;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: false;
    idempotentHint: boolean;
  };
  toolset: McpToolset | "guide";
  kind: "read" | "write" | "destr";
  legalUser: "always" | "on" | "off";
  businessUser: "always" | "on" | "off";
  run: (input: Record<string, unknown>, context: ToolContext) => Promise<Record<string, unknown>>;
}
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
