// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run onboarding state (SET-004). Configuring steps read their
 * existing settings. Review reads its own mark because looking at a
 * seeded list changes none of those settings.
 *
 * Review also offers Start blank (the 2026-09-17 addendum): one call
 * that hard-deletes the seeded catalog and keeps the skeleton, so an
 * organization with its own vocabulary begins with empty lists.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  aiConnector,
  AUTH_MODES,
  autoDocs,
  contractStatuses,
  contractTypes,
  count,
  entityTypes,
  inArray,
  intakeLinks,
  isNull,
  knowledgeTypes,
  matterStatuses,
  matterTemplates,
  matterTypes,
  officerRoles,
  orgSettings,
  requestTypes,
  signingConnectors,
  users,
  type Db,
  type Transaction,
} from "@openlaw/db";
import { isCatalogRow, type StartBlankList } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import type { MailerResolver } from "../../lib/mailer.js";
import { getOrgSettings } from "../../lib/org-settings.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { contractStatusUsageCounts } from "../contract-statuses/routes.js";
import { contractTypeUsage } from "../contracts/type-usage.js";
import { entityTypeUsage } from "../entities/type-usage.js";
import { knowledgeTypeUsage } from "../knowledge-types/usage.js";
import { matterStatusUsageCounts } from "../matter-statuses/routes.js";
import { matterTypeUsage } from "../matters/type-usage.js";
import { officerRoleUsage } from "../officer-roles/usage.js";
import { requestTypeUsage } from "../requests/type-usage.js";

/** Wizard steps in order, excluding the welcome splash. */
export const ONBOARDING_STEPS = [
  "organization",
  "authentication",
  "portal",
  "email",
  "invites",
  "e-signature",
  "ai-analysis",
  "review",
] as const;

type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * The Settings pane that owns each step after the first run, so a
 * skipped step can name where it is finished (SET-001: one pane, one
 * address).
 *
 * Portal shares the Authentication pane's address. The DD-010 allowlist
 * and the magic-link toggle are two of that pane's controls, not a pane
 * of their own.
 *
 * Email links to the administrator relay settings after setup.
 */
const SETTINGS_PATHS: Record<OnboardingStep, string | null> = {
  organization: "/settings/general",
  authentication: "/settings/authentication",
  portal: "/settings/authentication",
  email: "/settings/email",
  invites: "/settings/users",
  "e-signature": "/settings/integrations/e-signature",
  "ai-analysis": "/settings/ai-analysis",
  // Review spans several panes, so no single Settings address owns it.
  review: null,
};

const StepSchema = z.object({
  /** Whether the step is configured, or Review has been acknowledged. */
  done: z.boolean(),
  /** The Settings pane that owns it, or null where none does. */
  settingsPath: z.string().nullable(),
});

export const StatusSchema = z.object({
  /**
   * Whether the wizard has been finished or skipped out of. The
   * `/welcome` guard and the home redirect both branch on this before
   * they fetch anything else, so it stays on the envelope.
   */
  completed: z.boolean(),
  steps: z.object({
    organization: StepSchema,
    authentication: StepSchema,
    portal: StepSchema,
    email: StepSchema,
    invites: StepSchema,
    "e-signature": StepSchema,
    "ai-analysis": StepSchema,
    review: StepSchema,
  }),
});

/** The status envelope, for the suite that reads it over HTTP. */
export type OnboardingStatus = z.infer<typeof StatusSchema>;

/** Reads current configuration and the Review mark. */
async function readStatus(app: {
  db: Db;
  resolveMailer: MailerResolver;
}): Promise<OnboardingStatus> {
  const [settings, resolved, [userRows], [signing], [ai]] = await Promise.all([
    getOrgSettings(app.db),
    app.resolveMailer(),
    app.db.select({ value: count() }).from(users),
    app.db.select({ id: signingConnectors.id }).from(signingConnectors).limit(1),
    app.db.select({ id: aiConnector.id }).from(aiConnector).limit(1),
  ]);

  // Written out step by step rather than assembled from a list, so the
  // compiler checks that every step the schema names is answered.
  const state = (step: OnboardingStep, done: boolean) => ({
    done,
    settingsPath: SETTINGS_PATHS[step],
  });

  return {
    completed: settings.onboardingCompletedAt !== null,
    steps: {
      organization: state("organization", settings.name.trim() !== ""),
      // `auth_mode` is NOT NULL and defaults to built_in, so this is
      // always true. That is the honest answer: built-in sign-in works
      // on a fresh install and nothing about it is outstanding, so the
      // step never reaches the checklist card.
      authentication: state("authentication", AUTH_MODES.includes(settings.authMode)),
      // An empty allowlist admits nobody, so an untouched portal is not
      // a configured one.
      portal: state("portal", settings.allowedEmailDomains.length > 0),
      // The resolved mailer, so an environment-pinned relay counts
      // exactly as an app-saved one does (TECH-011: the environment
      // wins, and either way the instance can send).
      email: state("email", resolved.mailer.configured),
      // No user is seeded and setup creates the first Administrator, so
      // a second row is somebody who was invited, signed in or not.
      invites: state("invites", (userRows?.value ?? 0) > 1),
      "e-signature": state("e-signature", signing !== undefined),
      "ai-analysis": state("ai-analysis", ai !== undefined),
      review: state("review", settings.onboardingReviewedTypesAt !== null),
    },
  };
}

/** What Start blank needs to know about a row: is it seed, and is it skeleton. */
interface CatalogRow {
  id: string;
  slug: string;
  isSystemDefault: boolean;
}

/**
 * One list Start blank empties. `counts` is the SET-003 live-usage
 * number the list's Settings pane already shows, plus the references
 * that pane does not count but a hard delete would hit: a matter
 * template on a matter type (its FK has no cascade), an Auto-Doc target
 * on a contract type, and an intake link on a request type (both would
 * be silently demoted or cascaded). A row any of these point at is in
 * use, and the call refuses rather than losing or breaking a record.
 */
interface CatalogList {
  key: StartBlankList;
  /** The list as the refusal names it, so the dialog can say which one blocks. */
  label: string;
  rows(tx: Transaction): Promise<CatalogRow[]>;
  counts(tx: Transaction, ids: string[]): Promise<Map<string, number>>;
  remove(tx: Transaction, ids: string[]): Promise<void>;
}

/** Adds per-id counts from several sources into one map. */
function sumCounts(...maps: Map<string, number>[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const map of maps) {
    for (const [id, n] of map) total.set(id, (total.get(id) ?? 0) + n);
  }
  return total;
}

async function matterTemplateCounts(tx: Transaction, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await tx
    .select({ id: matterTemplates.matterTypeId, n: count() })
    .from(matterTemplates)
    .where(inArray(matterTemplates.matterTypeId, ids))
    .groupBy(matterTemplates.matterTypeId);
  return new Map(rows.map((row) => [row.id, row.n]));
}

async function autoDocTargetCounts(tx: Transaction, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await tx
    .select({ id: autoDocs.targetContractTypeId, n: count() })
    .from(autoDocs)
    .where(inArray(autoDocs.targetContractTypeId, ids))
    .groupBy(autoDocs.targetContractTypeId);
  return new Map(rows.flatMap((row) => (row.id === null ? [] : [[row.id, row.n] as const])));
}

async function intakeLinkCounts(tx: Transaction, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await tx
    .select({ id: intakeLinks.requestTypeId, n: count() })
    .from(intakeLinks)
    .where(inArray(intakeLinks.requestTypeId, ids))
    .groupBy(intakeLinks.requestTypeId);
  return new Map(rows.flatMap((row) => (row.id === null ? [] : [[row.id, row.n] as const])));
}

/**
 * The eight lists, in the order the dialog names them. Every row is
 * read `for update`, so a rename or an archive racing this call waits
 * for it. The per-type Field attachments (`matter_type_fields` and its
 * siblings) and a contract type's default people cascade with the type
 * row, so nothing here deletes them by hand.
 */
const CATALOG_LISTS: readonly CatalogList[] = [
  {
    key: "matter_type",
    label: "Matter types",
    rows: (tx) =>
      tx
        .select({
          id: matterTypes.id,
          slug: matterTypes.slug,
          isSystemDefault: matterTypes.isSystemDefault,
        })
        .from(matterTypes)
        .for("update"),
    counts: async (tx, ids) =>
      sumCounts(await matterTypeUsage.counts(tx, ids), await matterTemplateCounts(tx, ids)),
    remove: async (tx, ids) => {
      await tx.delete(matterTypes).where(inArray(matterTypes.id, ids));
    },
  },
  {
    key: "matter_status",
    label: "Matter statuses",
    rows: (tx) =>
      tx
        .select({
          id: matterStatuses.id,
          slug: matterStatuses.slug,
          isSystemDefault: matterStatuses.isSystemDefault,
        })
        .from(matterStatuses)
        .for("update"),
    counts: matterStatusUsageCounts,
    remove: async (tx, ids) => {
      await tx.delete(matterStatuses).where(inArray(matterStatuses.id, ids));
    },
  },
  {
    key: "contract_type",
    label: "Contract types",
    rows: (tx) =>
      tx
        .select({
          id: contractTypes.id,
          slug: contractTypes.slug,
          isSystemDefault: contractTypes.isSystemDefault,
        })
        .from(contractTypes)
        .for("update"),
    counts: async (tx, ids) =>
      sumCounts(await contractTypeUsage.counts(tx, ids), await autoDocTargetCounts(tx, ids)),
    remove: async (tx, ids) => {
      await tx.delete(contractTypes).where(inArray(contractTypes.id, ids));
    },
  },
  {
    key: "contract_status",
    label: "Contract statuses",
    rows: (tx) =>
      tx
        .select({
          id: contractStatuses.id,
          slug: contractStatuses.slug,
          isSystemDefault: contractStatuses.isSystemDefault,
        })
        .from(contractStatuses)
        .for("update"),
    counts: contractStatusUsageCounts,
    remove: async (tx, ids) => {
      await tx.delete(contractStatuses).where(inArray(contractStatuses.id, ids));
    },
  },
  {
    key: "entity_type",
    label: "Entity types",
    rows: (tx) =>
      tx
        .select({
          id: entityTypes.id,
          slug: entityTypes.slug,
          isSystemDefault: entityTypes.isSystemDefault,
        })
        .from(entityTypes)
        .for("update"),
    counts: (tx, ids) => entityTypeUsage.counts(tx, ids),
    remove: async (tx, ids) => {
      await tx.delete(entityTypes).where(inArray(entityTypes.id, ids));
    },
  },
  {
    key: "officer_role",
    label: "Officer roles",
    rows: (tx) =>
      tx
        .select({
          id: officerRoles.id,
          slug: officerRoles.slug,
          isSystemDefault: officerRoles.isSystemDefault,
        })
        .from(officerRoles)
        .for("update"),
    counts: (tx, ids) => officerRoleUsage.counts(tx, ids),
    remove: async (tx, ids) => {
      await tx.delete(officerRoles).where(inArray(officerRoles.id, ids));
    },
  },
  {
    key: "knowledge_type",
    label: "Knowledge types",
    rows: (tx) =>
      tx
        .select({
          id: knowledgeTypes.id,
          slug: knowledgeTypes.slug,
          isSystemDefault: knowledgeTypes.isSystemDefault,
        })
        .from(knowledgeTypes)
        .for("update"),
    counts: (tx, ids) => knowledgeTypeUsage.counts(tx, ids),
    remove: async (tx, ids) => {
      await tx.delete(knowledgeTypes).where(inArray(knowledgeTypes.id, ids));
    },
  },
  {
    key: "request_type",
    label: "Request types",
    rows: (tx) =>
      tx
        .select({
          id: requestTypes.id,
          slug: requestTypes.slug,
          isSystemDefault: requestTypes.isSystemDefault,
        })
        .from(requestTypes)
        .for("update"),
    counts: async (tx, ids) =>
      sumCounts(await requestTypeUsage.counts(tx, ids), await intakeLinkCounts(tx, ids)),
    remove: async (tx, ids) => {
      await tx.delete(requestTypes).where(inArray(requestTypes.id, ids));
    },
  },
];

export const onboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/onboarding",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getOnboardingStatus",
        summary:
          "First-run onboarding state (SET-004): whether the wizard is " +
          "finished, and for each of its steps whether the thing it " +
          "configures is configured and which Settings pane owns it",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    () => readStatus(app),
  );

  app.post(
    "/onboarding/reviewed",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "reviewOnboardingTypes",
        summary: "Mark the seeded types reviewed (SET-004); one-way and idempotent",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    async () => {
      const settings = await getOrgSettings(app.db);
      if (settings.onboardingReviewedTypesAt === null) {
        await app.db
          .update(orgSettings)
          .set({ onboardingReviewedTypesAt: new Date() })
          .where(isNull(orgSettings.onboardingReviewedTypesAt));
      }
      return readStatus(app);
    },
  );

  app.post(
    "/onboarding/start-blank",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "startOnboardingBlank",
        summary:
          "Start blank (SET-004): hard-delete the seeded catalog in one " +
          "transaction, keep the skeleton, default Fields, and reminder " +
          "offsets, mark the seeded types reviewed, and log one " +
          "`settings.catalog_cleared` entry per emptied list; 409 once " +
          "onboarding is complete, when a list holds a user-created " +
          "row, or when a removable row is in use",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        // The singleton row lock serializes two Start blank calls and a
        // concurrent completion: whichever lands second reads the
        // other's state.
        const [settings] = await tx.select().from(orgSettings).limit(1).for("update");
        if (!settings) throw new Error("org_settings is not seeded.");
        if (settings.onboardingCompletedAt !== null) {
          throw httpError(409, "Instance setup is complete. Manage each list in Settings.", {
            type: "/problems/onboarding-complete",
          });
        }
        for (const list of CATALOG_LISTS) {
          const rows = await list.rows(tx);
          // A row an Administrator added is data this call must not
          // touch, and a catalog someone has already shaped is not one
          // to wipe: refuse and name the list (SET-004).
          const custom = rows.filter((row) => !row.isSystemDefault).length;
          if (custom > 0) {
            throw httpError(
              409,
              `${list.label} already holds ${custom === 1 ? "1 row" : `${custom} rows`} you added. ` +
                "Remove them first, or keep the seeded lists.",
              { type: "/problems/catalog-has-custom-rows", extensions: { list: list.key } },
            );
          }
          const catalog = rows.filter((row) => isCatalogRow(list.key, row));
          const counts = await list.counts(
            tx,
            catalog.map((row) => row.id),
          );
          const inUse = catalog.filter((row) => (counts.get(row.id) ?? 0) > 0).length;
          if (inUse > 0) {
            throw httpError(
              409,
              `${list.label} has ${inUse === 1 ? "1 seeded row" : `${inUse} seeded rows`} in use. ` +
                "Move those records first, or keep the seeded lists.",
              { type: "/problems/catalog-in-use", extensions: { list: list.key } },
            );
          }
          if (catalog.length === 0) continue;
          await list.remove(
            tx,
            catalog.map((row) => row.id),
          );
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "settings.catalog_cleared",
            visibility: "admin_only",
            payload: { list: list.key, removed: catalog.length },
          });
        }
        // The same mark POST /onboarding/reviewed writes: the checklist's
        // Review row is done and never nags.
        await tx
          .update(orgSettings)
          .set({ onboardingReviewedTypesAt: new Date() })
          .where(isNull(orgSettings.onboardingReviewedTypesAt));
      });
      return readStatus(app);
    },
  );

  app.post(
    "/onboarding/complete",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "completeOnboarding",
        summary:
          "Mark first-run onboarding finished (SET-004); idempotent, and " +
          "never reversed — the wizard is first-run only",
        tags: ["onboarding"],
        response: { 200: StatusSchema, default: problemResponse },
      },
    },
    async () => {
      // getOrgSettings throws if the seeded singleton is missing, so a
      // broken instance can never be reported as onboarded.
      const settings = await getOrgSettings(app.db);
      if (settings.onboardingCompletedAt === null) {
        const { mailer } = await app.resolveMailer();
        if (!mailer.configured) {
          throw httpError(409, "Configure outbound email before finishing instance setup.", {
            type: "/problems/email-setup-required",
          });
        }
        // Only a NULL timestamp is written, so the recorded completion
        // time is always the first one — repeat calls change nothing.
        await app.db
          .update(orgSettings)
          .set({ onboardingCompletedAt: new Date() })
          .where(isNull(orgSettings.onboardingCompletedAt));
      }
      return readStatus(app);
    },
  );
};
