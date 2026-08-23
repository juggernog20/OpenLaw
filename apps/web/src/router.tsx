// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Route table. Guards are loaders: the home loader requires a session
 * (and forwards empty instances to first-run setup); the login/setup
 * loaders bounce visitors to wherever their state belongs, so no screen
 * can be reached in a state it cannot serve.
 *
 * A parameterised route wraps its screen in `KeyedByParam` — see the
 * comment there for why the screen must remount when its record does.
 */

import { Fragment, type ReactNode } from "react";
import { useParams, type RouteObject } from "react-router";
import { AuthLayout } from "./routes/auth-layout";
import { ContractRecordPage, contractRecordLoader } from "./routes/contract-record";
import { ContractsPage, contractsLoader } from "./routes/contracts";
import { MattersPage, mattersLoader } from "./routes/matters";
import { MatterRecordPage, matterRecordLoader } from "./routes/matter-record";
import { EntitiesPage, entitiesLoader } from "./routes/entities";
import { EntityRecordPage, entityRecordLoader } from "./routes/entity-record";
import { RouteErrorPage } from "./routes/error-page";
import { HomePage, homeLoader } from "./routes/home";
import { InboxPage, inboxLoader } from "./routes/inbox";
import { InboxRequestPage, inboxRequestLoader } from "./routes/inbox-request";
import { LinkExpiredPage, linkExpiredLoader } from "./routes/link-expired";
import { LoginPage, loginLoader } from "./routes/login";
import { PortalHomePage, portalHomeLoader } from "./routes/portal";
import { PortalRequestFormPage, portalRequestFormLoader } from "./routes/portal-request-form";
import { PortalRequestPage, portalRequestLoader } from "./routes/portal-request";
import { PortalEntryPage, portalEntryLoader } from "./routes/portal-entry";
import { PortalSettingsPage, portalSettingsLoader } from "./routes/portal-settings";
import { SetPasswordPage } from "./routes/set-password";
import { SettingsLayout, settingsIndexLoader, settingsLoader } from "./routes/settings";
import { SettingsAppearancePage } from "./routes/settings-appearance";
import {
  SettingsNotificationsPage,
  settingsNotificationsLoader,
} from "./routes/settings-notifications";
import { SettingsRemindersPage, settingsRemindersLoader } from "./routes/settings-reminders";
import {
  SettingsApproverGroupsPage,
  settingsApproverGroupsLoader,
} from "./routes/settings-approver-groups";
import {
  SettingsContractFieldsPage,
  SettingsMatterFieldsPage,
  settingsContractFieldsLoader,
  settingsMatterFieldsLoader,
} from "./routes/settings-contract-fields";
import {
  SettingsContractStatusesPage,
  settingsContractStatusesLoader,
} from "./routes/settings-contract-statuses";
import {
  SettingsMatterStatusesPage,
  settingsMatterStatusesLoader,
} from "./routes/settings-matter-statuses";
import {
  SettingsContractTypeEditorPage,
  settingsContractTypeEditorLoader,
} from "./routes/settings-contract-type-editor";
import {
  SettingsContractTypesPage,
  settingsContractsIndexLoader,
  settingsContractTypesLoader,
} from "./routes/settings-contract-types";
import {
  SettingsEntityTypesPage,
  settingsEntitiesIndexLoader,
  settingsEntityTypesLoader,
} from "./routes/settings-entity-types";
import {
  SettingsMatterTypeEditorPage,
  settingsMatterTypeEditorLoader,
} from "./routes/settings-matter-type-editor";
import {
  SettingsMatterTypesPage,
  settingsMattersIndexLoader,
  settingsMatterTypesLoader,
} from "./routes/settings-matter-types";
import {
  SettingsRequestTypesPage,
  settingsIntakeIndexLoader,
  settingsRequestTypesLoader,
} from "./routes/settings-request-types";
import {
  SettingsRequestTypeEditorPage,
  settingsRequestTypeEditorLoader,
} from "./routes/settings-request-type-editor";
import { SettingsIntakeLinksPage, settingsIntakeLinksLoader } from "./routes/settings-intake-links";
import { SettingsGeneralPage, settingsGeneralLoader } from "./routes/settings-general";
import { SettingsUsersPage, settingsUsersLoader } from "./routes/settings-users";
import {
  SettingsAuthenticationPage,
  settingsAuthenticationLoader,
} from "./routes/settings-authentication";
import { SettingsAuditLogPage, settingsAuditLogLoader } from "./routes/settings-audit-log";
import {
  SettingsESignaturePage,
  settingsESignatureLoader,
  settingsIntegrationsIndexLoader,
} from "./routes/settings-e-signature";
import { SettingsProfilePage, settingsProfileLoader } from "./routes/settings-profile";
import { SetupPage, setupLoader } from "./routes/setup";
import { TwoFactorPage } from "./routes/two-factor";
import { TwoFactorEnrollPage, enrollLoader } from "./routes/two-factor-enroll";
import { WelcomePage, welcomeLoader } from "./routes/welcome";

/**
 * Remounts a parameterised route's screen when the record it names
 * changes (#372).
 *
 * React Router keeps a route mounted while only its params move, so a
 * screen that seeds `useState` from loader data goes on showing — and
 * writing to — the record it was first opened with, at a URL that names
 * a different one. Keying the subtree by the parameter makes the change
 * a remount, which reseeds every piece of state at once, including any
 * a later change adds.
 *
 * Key by the parameter that names the record, never by one that names a
 * view of it: `/contracts/:contractNumber/:tab?` keys on the number, so
 * moving between that record's tabs still keeps its loaded state.
 */
function KeyedByParam({ name, children }: { name: string; children: ReactNode }) {
  const params = useParams();
  return <Fragment key={params[name]}>{children}</Fragment>;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    loader: homeLoader,
    element: <HomePage />,
    errorElement: <RouteErrorPage />,
    // Guards run before first paint; a blank canvas beats a flash of the
    // wrong screen.
    hydrateFallbackElement: <></>,
  },
  {
    // The Inbox (INT-006, INT-007): nav slot one, and the queue of
    // Requests whose fate is undecided. Its loader admits Member+ only
    // and bounces everyone else home — triage stays legal's.
    path: "/inbox",
    loader: inboxLoader,
    element: <InboxPage />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // One Request as triage reads it (INT-006, INT-007), addressed by
    // the R-### reference the Inbox row links on. A Request opened from
    // the queue stays under it, exactly as a contract sits under
    // `/contracts`; the portal keeps its own address for the same row.
    path: "/inbox/:number",
    loader: inboxRequestLoader,
    element: (
      <KeyedByParam name="number">
        <InboxRequestPage />
      </KeyedByParam>
    ),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    path: "/matters",
    loader: mattersLoader,
    element: <MattersPage />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    path: "/matters/:matterNumber",
    loader: matterRecordLoader,
    element: (
      <KeyedByParam name="matterNumber">
        <MatterRecordPage />
      </KeyedByParam>
    ),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // The M8 Contracts destination; its loader admits Member+ only and
    // bounces everyone else home.
    path: "/contracts",
    loader: contractsLoader,
    element: <ContractsPage />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // One contract's record page, addressed by its CTR-003 number —
    // the reference people quote is what the URL carries. The optional
    // trailing segment is the DES-032 section tab; the bare address is
    // the Overview, so an existing link to a contract still opens one.
    path: "/contracts/:contractNumber/:tab?",
    loader: contractRecordLoader,
    element: (
      <KeyedByParam name="contractNumber">
        <ContractRecordPage />
      </KeyedByParam>
    ),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // The M7 Entities registry (ENT-001); its loader admits Member+
    // only (ENT-004) and bounces everyone else home.
    path: "/entities",
    loader: entitiesLoader,
    element: <EntitiesPage />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // #99: one entity's record page — the identity card with DES-017
    // per-field edits, archive, and restore. Member+ only (ENT-004).
    path: "/entities/:entityId",
    loader: entityRecordLoader,
    element: (
      <KeyedByParam name="entityId">
        <EntityRecordPage />
      </KeyedByParam>
    ),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // SET-004 first-run wizard; its loader admits only an Administrator
    // on an instance whose onboarding is still open.
    path: "/welcome",
    loader: welcomeLoader,
    element: <WelcomePage />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
  },
  {
    // SET-001: the one settings destination; every pane is a routable
    // URL so later modules can deep-link into a section.
    path: "/settings",
    loader: settingsLoader,
    element: <SettingsLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
    children: [
      // The empty element never renders — the loader always redirects —
      // but its absence would make the router warn on every match.
      { index: true, loader: settingsIndexLoader, element: <></> },
      { path: "profile", loader: settingsProfileLoader, element: <SettingsProfilePage /> },
      { path: "appearance", element: <SettingsAppearancePage /> },
      {
        // #320: the ST3 pane, every signed-in person's own. No role
        // gate — a preference is addressed to one person, and the
        // API answers only for the signed-in one.
        path: "notifications",
        loader: settingsNotificationsLoader,
        element: <SettingsNotificationsPage />,
      },
      // SET-002: the loaders bounce non-Administrators; the API's own
      // role gate stands behind them.
      { path: "general", loader: settingsGeneralLoader, element: <SettingsGeneralPage /> },
      { path: "users", loader: settingsUsersLoader, element: <SettingsUsersPage /> },
      {
        path: "authentication",
        loader: settingsAuthenticationLoader,
        element: <SettingsAuthenticationPage />,
      },
      {
        // #133: the DD-017 audit log, beside Authentication in the
        // Security group. Administrator-only (SET-002).
        path: "audit-log",
        loader: settingsAuditLogLoader,
        element: <SettingsAuditLogPage />,
      },
      // Each section URL forwards to its first pane, so the rail's
      // entries and deep links share one canonical address.
      { path: "matters", loader: settingsMattersIndexLoader, element: <></> },
      {
        path: "matters/types",
        loader: settingsMatterTypesLoader,
        element: <SettingsMatterTypesPage />,
      },
      {
        path: "matters/statuses",
        loader: settingsMatterStatusesLoader,
        element: <SettingsMatterStatusesPage />,
      },
      {
        path: "matters/fields",
        loader: settingsMatterFieldsLoader,
        element: <SettingsMatterFieldsPage />,
      },
      {
        // #85: each type row opens its own editor screen (ST15).
        path: "matters/types/:typeId",
        loader: settingsMatterTypeEditorLoader,
        element: (
          <KeyedByParam name="typeId">
            <SettingsMatterTypeEditorPage />
          </KeyedByParam>
        ),
      },
      { path: "contracts", loader: settingsContractsIndexLoader, element: <></> },
      {
        path: "contracts/types",
        loader: settingsContractTypesLoader,
        element: <SettingsContractTypesPage />,
      },
      {
        // #84: each type row opens its own editor screen (ST16).
        path: "contracts/types/:typeId",
        loader: settingsContractTypeEditorLoader,
        element: (
          <KeyedByParam name="typeId">
            <SettingsContractTypeEditorPage />
          </KeyedByParam>
        ),
      },
      {
        path: "contracts/statuses",
        loader: settingsContractStatusesLoader,
        element: <SettingsContractStatusesPage />,
      },
      {
        path: "contracts/fields",
        loader: settingsContractFieldsLoader,
        element: <SettingsContractFieldsPage />,
      },
      {
        // #231: the CTR-012 approver-group templates.
        path: "contracts/approver-groups",
        loader: settingsApproverGroupsLoader,
        element: <SettingsApproverGroupsPage />,
      },
      // #353: the Intake section, Request types its first pane (INT-002).
      { path: "intake", loader: settingsIntakeIndexLoader, element: <></> },
      {
        path: "intake/request-types",
        loader: settingsRequestTypesLoader,
        element: <SettingsRequestTypesPage />,
      },
      {
        // #354: each request type opens its own editor screen (ST14).
        path: "intake/request-types/:typeId",
        loader: settingsRequestTypeEditorLoader,
        element: (
          <KeyedByParam name="typeId">
            <SettingsRequestTypeEditorPage />
          </KeyedByParam>
        ),
      },
      {
        // #356: the INT-004 deflection links (ST13). "links" rather
        // than "deflection-links": the section already says Intake.
        path: "intake/links",
        loader: settingsIntakeLinksLoader,
        element: <SettingsIntakeLinksPage />,
      },
      { path: "entities", loader: settingsEntitiesIndexLoader, element: <></> },
      {
        // #97: no per-type editor screen — entity-scoped fields render
        // on every entity (ENT-001), so nothing attaches per type.
        path: "entities/types",
        loader: settingsEntityTypesLoader,
        element: <SettingsEntityTypesPage />,
      },
      {
        // #322: Organization · Notifications — the NOT-004 reminder
        // lead times. Named for what it holds, because the Personal
        // pane above already owns /settings/notifications.
        path: "reminders",
        loader: settingsRemindersLoader,
        element: <SettingsRemindersPage />,
      },
      // #245: the Integrations section, E-signature its first pane
      // (SET-007, superseding CTR-013's Contracts-tab placement).
      { path: "integrations", loader: settingsIntegrationsIndexLoader, element: <></> },
      {
        path: "integrations/e-signature",
        loader: settingsESignatureLoader,
        element: <SettingsESignaturePage />,
      },
    ],
  },
  {
    path: "/auth",
    element: <AuthLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
    children: [
      { path: "login", loader: loginLoader, element: <LoginPage /> },
      { path: "two-factor", element: <TwoFactorPage /> },
      { path: "two-factor/enroll", loader: enrollLoader, element: <TwoFactorEnrollPage /> },
      { path: "set-password", element: <SetPasswordPage /> },
      { path: "setup", loader: setupLoader, element: <SetupPage /> },
      { path: "link-expired", loader: linkExpiredLoader, element: <LinkExpiredPage /> },
    ],
  },
  {
    // The Portal (INT-001, #376): its own route tree in the same SPA,
    // wearing its own chrome and sharing the session model. It is
    // deliberately not a child of the staff shell — no nav, no activity
    // bar, and no role floor beyond holding a session, because Member+
    // staff submit Requests here too.
    path: "/portal",
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <></>,
    children: [
      { index: true, loader: portalHomeLoader, element: <PortalHomePage /> },
      // The front door. Its own address rather than the portal home in a
      // signed-out costume, so the emailed link, the dead-link page, and
      // the sign-out redirect all name one place.
      { path: "enter", loader: portalEntryLoader, element: <PortalEntryPage /> },
      // The lightweight settings surface NOT-001 promised a business
      // user (M20/9): NOT-002's group 5 and nothing else, reached from
      // the gear in the portal header.
      { path: "settings", loader: portalSettingsLoader, element: <PortalSettingsPage /> },
      // One request type's form, addressed by the slug the picker
      // links on (INT-002). A slug that names nothing, or names an
      // archived type, lands back on the home — see the loader.
      {
        path: "new/:slug",
        loader: portalRequestFormLoader,
        element: (
          <KeyedByParam name="slug">
            <PortalRequestFormPage />
          </KeyedByParam>
        ),
      },
      // One of the caller's own Requests, addressed by its R-###
      // number — the reference a requester quotes and the one the row
      // links on. A number that is not theirs lands back on the home,
      // where their own list is (DD-013).
      {
        path: "requests/:number",
        loader: portalRequestLoader,
        element: (
          <KeyedByParam name="number">
            <PortalRequestPage />
          </KeyedByParam>
        ),
      },
    ],
  },
];
