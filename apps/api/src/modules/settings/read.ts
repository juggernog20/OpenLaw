// SPDX-License-Identifier: AGPL-3.0-only
/** Organization settings reuse the pane readers and secret masking (SET-002, SET-014). */
import type { FastifyInstance } from "fastify";
import { authenticationPolicy } from "../../auth/authentication-policy.js";
import { getOrgSettings } from "../../lib/org-settings.js";
import { readAllowedDomains, readSsoProviders } from "../auth/routes.js";
import {
  readOrgBranding,
  readOrgGeneral,
  readOrgNotifications,
  readReminderOffsets,
} from "../org/routes.js";
import { readCurrencies } from "../org/currencies.js";
import { readEmailSettings } from "../email-settings/routes.js";
import { readAiSettings } from "../ai-connector/routes.js";
import { readSigningSettings } from "../signing-connector/routes.js";
import { readMcpSettings } from "../mcp-settings/routes.js";
import { createReachabilityCheck, type ResolveIpv4 } from "../mcp-settings/reachability.js";
import { readAdvancedSettings } from "../advanced-settings/routes.js";
import { sectionIds, type AdvancedRuntime } from "../advanced-settings/config.js";

export const organizationSections = [
  "general",
  "branding",
  "notifications",
  "reminder_offsets",
  "currencies",
  "email",
  "ai_analysis",
  "e_signature",
  "mcp",
  "authentication",
  "advanced",
] as const;
export type OrganizationSection = (typeof organizationSections)[number];

export function organizationSettingsReader(
  app: FastifyInstance,
  runtime: AdvancedRuntime,
  resolveIpv4?: ResolveIpv4,
) {
  const check = createReachabilityCheck(app.baseUrl, resolveIpv4);
  return async (section: OrganizationSection) => {
    switch (section) {
      case "general":
        return readOrgGeneral(app.db);
      case "branding":
        return readOrgBranding(app.db);
      case "notifications":
        return readOrgNotifications(app.db);
      case "reminder_offsets":
        return readReminderOffsets(app.db);
      case "currencies":
        return readCurrencies(app.db, "administrator");
      case "email":
        return readEmailSettings(app.resolveMailer);
      case "ai_analysis":
        return readAiSettings(app.db);
      case "e_signature":
        return readSigningSettings(app.db, "docusign", app.baseUrl);
      case "mcp":
        return readMcpSettings(app.db, app.baseUrl, check);
      case "authentication":
        return {
          policy: authenticationPolicy(await getOrgSettings(app.db)),
          ...(await readAllowedDomains(app.db)),
          ...(await readSsoProviders(app.db)),
        };
      case "advanced":
        return Object.fromEntries(
          await Promise.all(
            sectionIds.map(async (id) => [id, await readAdvancedSettings(app.db, runtime, id)]),
          ),
        );
    }
  };
}
