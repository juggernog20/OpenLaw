// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Route table. Guards are loaders: the home loader requires a session
 * (and forwards empty instances to first-run setup); the login/setup
 * loaders bounce visitors to wherever their state belongs, so no screen
 * can be reached in a state it cannot serve.
 */

import type { RouteObject } from "react-router";
import { AuthLayout } from "./routes/auth-layout";
import { RouteErrorPage } from "./routes/error-page";
import { HomePage, homeLoader } from "./routes/home";
import { LinkExpiredPage } from "./routes/link-expired";
import { LoginPage, loginLoader } from "./routes/login";
import { SetPasswordPage } from "./routes/set-password";
import { SettingsLayout, settingsIndexLoader, settingsLoader } from "./routes/settings";
import { SettingsAppearancePage } from "./routes/settings-appearance";
import {
  SettingsContractFieldsPage,
  settingsContractFieldsLoader,
} from "./routes/settings-contract-fields";
import {
  SettingsContractStatusesPage,
  settingsContractStatusesLoader,
} from "./routes/settings-contract-statuses";
import {
  SettingsContractTypesPage,
  settingsContractsIndexLoader,
  settingsContractTypesLoader,
} from "./routes/settings-contract-types";
import { SettingsGeneralPage, settingsGeneralLoader } from "./routes/settings-general";
import { SettingsUsersPage, settingsUsersLoader } from "./routes/settings-users";
import {
  SettingsAuthenticationPage,
  settingsAuthenticationLoader,
} from "./routes/settings-authentication";
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
      // The section URL forwards to its first pane, so the rail's
      // Contracts entry and deep links share one canonical address.
      { path: "contracts", loader: settingsContractsIndexLoader, element: <></> },
      {
        path: "contracts/types",
        loader: settingsContractTypesLoader,
        element: <SettingsContractTypesPage />,
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
