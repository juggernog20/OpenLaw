// SPDX-License-Identifier: AGPL-3.0-only

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { IntlProvider } from "react-intl";

import "@fontsource-variable/inter";
import "../../../styles/globals.css";

import { routes } from "./router";

// en-US is the only v1 locale (DES-013): defaultMessage in code is the
// catalog at runtime; `pnpm i18n:extract` emits messages/en-US.json as
// the artifact future locales are translated from.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <RouterProvider router={createBrowserRouter(routes)} />
    </IntlProvider>
  </StrictMode>,
);
