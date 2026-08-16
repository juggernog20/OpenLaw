// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Route table. Guards are loaders: the home loader requires a session
 * (and forwards empty instances to first-run setup); the login/setup
 * loaders bounce visitors to wherever their state belongs, so no screen
 * can be reached in a state it cannot serve.
 */

import type { RouteObject } from "react-router";
import { AuthLayout } from "./routes/auth-layout";
import { ContractRecordPage, contractRecordLoader } from "./routes/contract-record";
import { ContractsPage, contractsLoader } from "./routes/contracts";
import { EntitiesPage, entitiesLoader } from "./routes/entities";
import { EntityRecordPage, entityRecordLoader } from "./routes/entity-record";
import { RouteErrorPage } from "./routes/error-page";
import { HomePage, homeLoader } from "./routes/home";
import { LinkExpiredPage } from "./routes/link-expired";
import { LoginPage, loginLoader } from "./routes/login";
import { SetPasswordPage } from "./routes/set-password";
import { SettingsLayout, settingsIndexLoader, settingsLoader } from "./routes/settings";
import { SettingsAppearancePage } from "./routes/settings-appearance";
import {
  SettingsApproverGroupsPage,
  settingsApproverGroupsLoader,
} from "./routes/settings-approver-groups";
import {
  SettingsContractFieldsPage,
  settingsContractFieldsLoader,
} from "./routes/settings-contract-fields";
import {
  SettingsContractStatusesPage,
  settingsContractStatusesLoader,
} from "./routes/settings-contract-statuses";
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
import { SettingsGeneralPage, settingsGeneralLoader } from "./routes/settings-general";
import { SettingsUsersPage, settingsUsersLoader } from "./routes/settings-users";
import {
  SettingsAuthenticationPage,
  settingsAuthenticationLoader,
} from "./routes/settings-authentication";
import { SettingsAuditLogPage, settingsAuditLogLoader } from "./routes/settings-audit-log";
import { SettingsProfilePage, settingsProfileLoader } from "./routes/settings-profile";
import { SetupPage, setupLoader } from "./routes/setup";
import { TwoFactorPage } from "./routes/two-factor";
import { TwoFactorEnrollPage, enrollLoader } from "./routes/two-factor-enroll";
import { WelcomePage, welcomeLoader } from "./routes/welcome";

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
    element: <ContractRecordPage />,
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
    element: <EntityRecordPage />,
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
        // #85: each type row opens its own editor screen (ST15).
        path: "matters/types/:typeId",
        loader: settingsMatterTypeEditorLoader,
        element: <SettingsMatterTypeEditorPage />,
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
        element: <SettingsContractTypeEditorPage />,
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
      { path: "entities", loader: settingsEntitiesIndexLoader, element: <></> },
      {
        // #97: no per-type editor screen — entity-scoped fields render
        // on every entity (ENT-001), so nothing attaches per type.
        path: "entities/types",
        loader: settingsEntityTypesLoader,
        element: <SettingsEntityTypesPage />,
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
      { path: "link-expired", element: <LinkExpiredPage /> },
    ],
  },
];
