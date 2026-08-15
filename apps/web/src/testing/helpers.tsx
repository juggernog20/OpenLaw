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
 * What a stubbed call answers.
 *
 * A promise is an answer too: a suite that has to see what a client does
 * while several requests are in flight — a bounded upload pool, say —
 * holds the answers open and releases them by hand. Returning undefined
 * makes the test fail loudly instead of hitting the network.
 */
export type StubAnswer = Response | Promise<Response> | undefined;

/**
 * Installs a global fetch stub. The handler answers per call; returning
 * undefined makes the test fail loudly instead of hitting the network.
 */
export function stubFetch(handler: (call: StubCall) => StubAnswer) {
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
    } else if (raw instanceof FormData) {
      // A multipart upload, handed over as it was built. The one caller
      // that sends one (a document upload) asserts on the fields beside
      // the file, so the form has to survive the stub rather than be
      // flattened into a string it never was.
      body = raw;
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
    /** Defaults to null (initials) — only the avatar tests set it. */
    image?: string | null;
    /** Defaults to null (browser-detected) — only the timezone tests set it. */
    timezone?: string | null;
    /** Defaults to false — only the two-factor tests set it. */
    twoFactorEnabled?: boolean;
    /** Defaults to true (a credential account exists) — SSO-only tests unset it. */
    hasPassword?: boolean;
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
  extra?: (call: StubCall) => StubAnswer;
}

export function stubApi(state: ApiState) {
  return stubFetch((call) => {
    const fromExtra = state.extra?.(call);
    if (fromExtra) return fromExtra;
    if (call.url.pathname === "/api/v1/me" && call.method === "GET") {
      return state.signedIn
        ? json(200, {
            // Only the fields the real endpoint's contract carries — the
            // stub-only knobs (twoFactorEnabled, hasPassword) stay out.
            user: {
              id: state.signedIn.id,
              email: state.signedIn.email,
              displayName: state.signedIn.displayName,
              role: state.signedIn.role,
              theme: state.signedIn.theme ?? "light",
              image: state.signedIn.image ?? null,
              timezone: state.signedIn.timezone ?? null,
            },
            session: { id: "sess-1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
          })
        : problem(401, "Authentication required.");
    }
    if (call.url.pathname === "/api/v1/auth/setup" && call.method === "GET") {
      return json(200, { needsSetup: state.needsSetup ?? false });
    }
    // The Profile pane's loader reads better-auth's own surfaces: the
    // session (for the two-factor flag) and the linked accounts (for
    // the password credential and its last-changed stamp).
    if (call.url.pathname === "/api/auth/get-session" && call.method === "GET") {
      if (!state.signedIn) return json(200, null);
      return json(200, {
        session: { id: "sess-1", expiresAt: new Date(Date.now() + 60_000).toISOString() },
        user: {
          id: state.signedIn.id,
          email: state.signedIn.email,
          name: state.signedIn.displayName,
          image: state.signedIn.image ?? null,
          twoFactorEnabled: state.signedIn.twoFactorEnabled ?? false,
        },
      });
    }
    if (call.url.pathname === "/api/auth/list-accounts" && call.method === "GET") {
      if (!state.signedIn) return problem(401, "Authentication required.");
      if (state.signedIn.hasPassword === false) return json(200, []);
      return json(200, [
        {
          id: "acc-1",
          providerId: "credential",
          accountId: state.signedIn.id,
          createdAt: "2026-05-02T12:00:00Z",
          updatedAt: "2026-05-02T12:00:00Z",
          scopes: [],
        },
      ]);
    }
    if (call.url.pathname === "/api/v1/auth/methods" && call.method === "GET") {
      const methods = state.methods ?? {
        mode: "built_in" as const,
        magicLinkEnabled: true,
        ssoProviderId: null,
      };
      return json(200, { ...methods, emailConfigured: methods.emailConfigured ?? true });
    }
    // A contract record reads its paper (M11/2). Empty by default, so
    // every suite that is not about documents needs no stub of its own;
    // the ones that are supply rows through `extra`, which runs first.
    if (/^\/api\/v1\/contracts\/\d+\/documents$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { documents: [], nextCursor: null });
    }
    // And how that paper is filed (M13/2). Empty by default for the
    // documents read's reason: a record with no folders is the ordinary
    // case, and only the suites that are about the tree supply one.
    if (/^\/api\/v1\/contracts\/\d+\/folders$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { folders: [] });
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
