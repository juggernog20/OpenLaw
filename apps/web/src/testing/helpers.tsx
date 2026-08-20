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

/**
 * An RFC 9457 refusal. `type` defaults to `about:blank`, which is what
 * the API sends for every refusal a client prints; pass it only for the
 * few a client is expected to branch on.
 */
export function problem(status: number, detail: string, type = "about:blank"): Response {
  return new Response(JSON.stringify({ type, title: "Error", status, detail }), {
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
    // And who has been asked to sign it off (M14/3). Empty by default
    // for the same reason: a record nobody has asked about yet is the
    // ordinary case, and only the suites about the roster supply one.
    if (/^\/api\/v1\/contracts\/\d+\/approvals$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { approvals: [] });
    }
    // And what paper it has sent out for signature (M15/2). The default
    // is the zero-config install CTR-013 promises: no connector, no
    // envelope, and therefore no send control anywhere on the record.
    // Only the suites about signing supply one.
    if (/^\/api\/v1\/contracts\/\d+\/envelopes$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { envelopes: [], signingConfigured: false, primaryDocument: null });
    }
    // And every date on it (M16/3, CTR-009). Empty by default for the
    // roster's reason: a record with no key dates and no term dates is
    // the ordinary case, and only the suites about the deadline surface
    // supply one.
    if (/^\/api\/v1\/contracts\/\d+\/key-dates$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { deadlines: [] });
    }
    // And every task on it (M17/1, CTR-017). Empty by default for the
    // roster's reason: a record with no tasks is the ordinary case, and
    // only the suites about the checklist supply one.
    if (/^\/api\/v1\/contracts\/\d+\/tasks$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { tasks: [], doneCount: 0, totalCount: 0 });
    }
    // And every relation on it (M17/2, CTR-015). Empty by default for
    // the roster's reason: a record with no relations is the ordinary
    // case, and only the suites about the relations surface supply one.
    if (/^\/api\/v1\/contracts\/\d+\/relations$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { parentChain: [], children: [], links: [] });
    }
    // And this person's saved list views (DD-019). None by default, which
    // is what a fresh install has — the built-in layout is code, not a
    // seeded row. Only the suites about views supply any. Without this the
    // read would throw and be swallowed by `readViews`, which is the right
    // production behaviour and a bad thing for a test to lean on.
    if (call.url.pathname === "/api/v1/list-views" && call.method === "GET") {
      return json(200, { views: [] });
    }
    // The shell's bell reads its badge on mount and on every navigation
    // (NOT-005, M18/2), so every authenticated route hits this. Zero by
    // default, which is what a fresh install answers; only the bell's
    // own suite supplies a number, through `extra`.
    if (call.url.pathname === "/api/v1/notifications/unread-count" && call.method === "GET") {
      return json(200, { unread: 0 });
    }
    // And the centre's first page when it opens. Empty by default for
    // the badge's reason.
    if (call.url.pathname === "/api/v1/notifications" && call.method === "GET") {
      return json(200, { notifications: [], nextCursor: null });
    }
    // What the portal home offers (M20/3, INT-001). Empty by default,
    // which is what a route test that is not about the portal needs:
    // the two reads run on every portal render, and only the portal's
    // own suite supplies rows, through `extra`.
    if (call.url.pathname === "/api/v1/portal/request-types" && call.method === "GET") {
      return json(200, { requestTypes: [] });
    }
    if (call.url.pathname === "/api/v1/portal/intake-links" && call.method === "GET") {
      return json(200, { intakeLinks: [] });
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
