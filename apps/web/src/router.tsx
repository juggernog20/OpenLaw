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
import { SetupPage, setupLoader } from "./routes/setup";
import { TwoFactorPage } from "./routes/two-factor";
import { TwoFactorEnrollPage, enrollLoader } from "./routes/two-factor-enroll";

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
