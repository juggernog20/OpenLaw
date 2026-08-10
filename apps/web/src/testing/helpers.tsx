// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Route-test harness: a fetch stub standing in for the API (both the
 * typed /api/v1 surface and better-auth's /api/auth handler go through
 * global fetch), and a renderer that mounts the real route table at a
 * path. The API behaviors themselves are covered at the HTTP seam in
 * apps/api — these stubs only shape what this UI must react to.
 */

import { vi } from "vitest";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { IntlProvider } from "react-intl";
import { routes } from "../router";

export interface StubCall {
  method: string;
  url: URL;
  body: unknown;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "Error", status, detail }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

/**
 * Installs a global fetch stub. The handler answers per call; returning
 * undefined makes the test fail loudly instead of hitting the network.
 */
export function stubFetch(handler: (call: StubCall) => Response | undefined) {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(href, "http://localhost:3000");
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    let body: unknown;
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof raw === "string" && raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const response = handler({ method, url, body });
    if (!response) {
      throw new Error(`Unstubbed fetch in test: ${method} ${url.pathname}`);
    }
    return response;
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

/** The three answers every guard consults, plus per-test overrides. */
export interface ApiState {
  signedIn?: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    /** Defaults to "light" — only the theme tests set it. */
    theme?: string;
  } | null;
  needsSetup?: boolean;
  methods?: {
    mode: "built_in" | "oidc";
    magicLinkEnabled: boolean;
    /** Defaults to true — only the dead-affordance tests wire it off. */
    emailConfigured?: boolean;
    ssoProviderId: string | null;
  };
  /** Defaults to completed, so guard tests land on home, not the wizard. */
  onboarding?: { completed: boolean; emailConfigured: boolean };
  /** Defaults to env-pinned — the wizard's email step reads it (#37). */
  emailSettings?: { source: "env" | "app" | "unset"; fromAddress: string | null };
  extra?: (call: StubCall) => Response | undefined;
}

export function stubApi(state: ApiState) {
  return stubFetch((call) => {
    const fromExtra = state.extra?.(call);
    if (fromExtra) return fromExtra;
    if (call.url.pathname === "/api/v1/me" && call.method === "GET") {
      return state.signedIn
        ? json(200, {
            user: { ...state.signedIn, theme: state.signedIn.theme ?? "light" },
            session: { id: "sess-1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
          })
        : problem(401, "Authentication required.");
    }
    if (call.url.pathname === "/api/v1/auth/setup" && call.method === "GET") {
      return json(200, { needsSetup: state.needsSetup ?? false });
    }
    if (call.url.pathname === "/api/v1/auth/methods" && call.method === "GET") {
      const methods = state.methods ?? {
        mode: "built_in" as const,
        magicLinkEnabled: true,
        ssoProviderId: null,
      };
      return json(200, { ...methods, emailConfigured: methods.emailConfigured ?? true });
    }
    if (call.url.pathname === "/api/v1/onboarding" && call.method === "GET") {
      return json(200, state.onboarding ?? { completed: true, emailConfigured: true });
    }
    if (call.url.pathname === "/api/v1/email-settings" && call.method === "GET") {
      return json(
        200,
        state.emailSettings ?? { source: "env", fromAddress: "OpenLaw <openlaw@example.com>" },
      );
    }
    return undefined;
  });
}

export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <IntlProvider locale="en-US" defaultLocale="en-US">
      <RouterProvider router={router} />
    </IntlProvider>,
  );
  return { router, view };
}
