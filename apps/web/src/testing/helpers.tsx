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
import type { paths } from "@openlaw/api-client";
import type { LiveEvent } from "@openlaw/shared";
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
 * The browser channel used by route tests.
 *
 * Native EventSource reconnects without making a new object, so `open`
 * may be dispatched more than once. Tests use the same shape: `open()`
 * means the initial connection or a reconnect, and `emit()` delivers one
 * named frame through the shared channel.
 */
export interface EventSourceTestDouble {
  readonly url: string;
  readonly readyState: number;
  open(): void;
  emit(event: LiveEvent): void;
  /** Delivers one frame exactly as the wire would, JSON or not. */
  emitRaw(kind: string, data: string): void;
  close(): void;
}

/** Installs the one EventSource test double shared by web surface tests. */
export function stubEventSource(): EventSourceTestDouble[] {
  const sources: EventSourceTestDouble[] = [];

  class TestEventSource extends EventTarget implements EventSourceTestDouble {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;

    readonly CONNECTING = TestEventSource.CONNECTING;
    readonly OPEN = TestEventSource.OPEN;
    readonly CLOSED = TestEventSource.CLOSED;
    readonly url: string;
    readonly withCredentials: boolean;
    readyState = TestEventSource.CONNECTING;
    onopen: ((ev: Event) => unknown) | null = null;
    onmessage: ((ev: MessageEvent) => unknown) | null = null;
    onerror: ((ev: Event) => unknown) | null = null;

    constructor(url: string | URL, init?: EventSourceInit) {
      super();
      this.url = String(url);
      this.withCredentials = init?.withCredentials ?? false;
      sources.push(this);
    }

    open() {
      this.readyState = TestEventSource.OPEN;
      const event = new Event("open");
      this.onopen?.(event);
      this.dispatchEvent(event);
    }

    emit(event: LiveEvent) {
      this.emitRaw(event.kind, JSON.stringify(event));
    }

    emitRaw(kind: string, data: string) {
      this.dispatchEvent(new MessageEvent(kind, { data }));
    }

    close() {
      this.readyState = TestEventSource.CLOSED;
    }
  }

  vi.stubGlobal("EventSource", TestEventSource);
  return sources;
}

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

type AiResponse =
  paths["/api/v1/ai-connector"]["get"]["responses"]["200"]["content"]["application/json"];
type AiPreset = AiResponse["presets"][number]["preset"];
type AiProtocol = AiResponse["presets"][number]["protocol"];

/**
 * The server-owned provider presets (TECH-012), as the API answers
 * them. Copied rather than imported: the definitions live in the API
 * package and the web tests must not reach across that line.
 */
const AI_PRESETS: AiResponse["presets"] = [
  {
    preset: "anthropic",
    label: "Anthropic",
    protocol: "anthropic_messages",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "openai",
    label: "OpenAI",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "azure_openai",
    label: "Azure OpenAI",
    protocol: "openai_chat_completions",
    baseUrl: null,
    defaultModel: "gpt-5.6-luna",
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
  {
    preset: "gemini",
    label: "Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.6-flash",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "openrouter",
    label: "OpenRouter",
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "~openai/gpt-latest",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    preset: "ollama",
    label: "Ollama",
    protocol: "openai_chat_completions",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    requiresApiKey: false,
    requiresBaseUrl: false,
  },
  {
    preset: "custom",
    label: "Custom endpoint",
    protocol: "openai_chat_completions",
    baseUrl: null,
    defaultModel: "",
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
];

/** The wizard's configuring steps, as `GET /api/v1/onboarding` names
 * them. The welcome splash configures nothing, so it has no entry. */
const ONBOARDING_STEPS = [
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
 * The Settings pane that owns each step, as the route answers it. Email
 * has none: no pane edits an SMTP relay (TECH-011). The Record type is
 * what keeps this table complete as the step list grows.
 */
const ONBOARDING_SETTINGS_PATHS: Record<OnboardingStep, string | null> = {
  organization: "/settings/general",
  authentication: "/settings/authentication",
  portal: "/settings/authentication",
  email: null,
  invites: "/settings/users",
  "e-signature": "/settings/integrations/e-signature",
  "ai-analysis": "/settings/ai-analysis",
  review: null,
};

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
  /**
   * Defaults to completed with every step done, so guard tests land on
   * home rather than the wizard and no setup checklist is outstanding.
   * A step left out of `steps` is done.
   */
  onboarding?: { completed: boolean; steps?: Partial<Record<OnboardingStep, boolean>> };
  /** Defaults to env-pinned — the wizard's email step reads it (#37). */
  emailSettings?: { source: "env" | "app" | "unset"; fromAddress: string | null };
  /** Defaults to an unnamed organization, as a fresh install holds. */
  orgGeneral?: {
    name: string;
    logo: string | null;
    defaultLocale: "en-US";
    defaultTimezone: string;
  };
  /**
   * The DocuSign connector the wizard's E-signature step reads (#698).
   * Defaults to the zero-config install CTR-013 promises: no connector,
   * and the manual hand-off is the path. Only the suites about signing
   * supply one.
   */
  signingConnector?: {
    environment: "demo" | "production";
    integrationKey: string;
    apiUserId: string;
    /** Defaults to on; set false for a configured connector that was turned off. */
    enabled?: boolean;
    disabledAt?: string | null;
  };
  /**
   * The AI connector the wizard's AI analysis step reads (#699).
   * Defaults to none, which is what a fresh install holds: no Contract
   * analysis runs and every Field stays manual. Only the suites about
   * AI analysis supply one.
   */
  aiConnector?: {
    preset: AiPreset;
    protocol: AiProtocol;
    baseUrl: string | null;
    model: string;
    /** Defaults to true; the write-only key is never answered. */
    hasApiKey?: boolean;
    /** Defaults to on; set false for a configured connector that was turned off. */
    enabled?: boolean;
    disabledAt?: string | null;
  };
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
    // Opening a Version after the first probes for an already-requested
    // comparison so the panel can show its count without starting work.
    // Absent is the ordinary answer outside the comparison suites.
    if (
      /^\/api\/v1\/documents\/[^/]+\/comparisons$/.test(call.url.pathname) &&
      call.method === "GET"
    ) {
      return json(200, { comparison: null });
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
    // Matter Key dates use the same empty-by-default record-loader
    // fixture. Their own route suite supplies the lifecycle states.
    if (/^\/api\/v1\/matters\/\d+\/key-dates$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { deadlines: [] });
    }
    // Matter Tasks are likewise an empty-by-default record seam. The
    // routed checklist suite supplies assigned and ordered rows.
    if (/^\/api\/v1\/matters\/\d+\/tasks$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { tasks: [], doneCount: 0, totalCount: 0 });
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
    // MTR-015's sibling surface has one immediate parent and an
    // undirected related list. Empty is the ordinary standalone Matter.
    if (/^\/api\/v1\/matters\/\d+\/relations$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { parent: null, children: [], related: [] });
    }
    // MTR-007's two views of one Contract.matter_id. Standalone and no
    // linked Contracts are the ordinary defaults; route suites about
    // the link supply their own rows through `extra`.
    if (/^\/api\/v1\/contracts\/\d+\/matter$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { matter: null });
    }
    if (/^\/api\/v1\/matters\/\d+\/contracts$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { contracts: [] });
    }
    // And this person's saved list views (DD-019). None by default, which
    // is what a fresh install has — the built-in layout is code, not a
    // seeded row. Only the suites about views supply any. Without this the
    // read would throw and be swallowed by `readViews`, which is the right
    // production behaviour and a bad thing for a test to lean on.
    if (call.url.pathname === "/api/v1/list-views" && call.method === "GET") {
      return json(200, { views: [] });
    }
    // Knowledge is a Member+ shell destination. Its empty library,
    // folder tree, filters, and create form are the ordinary defaults;
    // route suites about populated records override them through extra.
    if (call.url.pathname === "/api/v1/knowledge" && call.method === "GET") {
      return json(200, { knowledgeItems: [], nextCursor: null });
    }
    if (call.url.pathname === "/api/v1/knowledge/folders" && call.method === "GET") {
      return json(200, { folders: [] });
    }
    if (call.url.pathname === "/api/v1/knowledge/type-options" && call.method === "GET") {
      return json(200, { knowledgeTypes: [] });
    }
    if (call.url.pathname === "/api/v1/knowledge/options" && call.method === "GET") {
      return json(200, { authors: [] });
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
    // M25's global search runs from the staff shell. An empty answer is
    // the ordinary fresh-install state; search surface suites replace
    // it through `extra` before this default runs.
    if (call.url.pathname === "/api/v1/search" && call.method === "GET") {
      return json(200, { results: [], nextCursor: null });
    }
    // M29's state summary. Empty is the ordinary fresh-user answer, so
    // every shell test keeps using the same default fixture; Home's own
    // suite replaces it through `extra`.
    if (call.url.pathname === "/api/v1/home" && call.method === "GET") {
      return json(200, { sections: [] });
    }
    // M26's flat repository. A fresh install has no Documents, and only
    // the destination's own suite replaces this answer through `extra`.
    if (call.url.pathname === "/api/v1/documents" && call.method === "GET") {
      return json(200, { documents: [], nextCursor: null });
    }
    // M26's viewer-scoped filter candidates. Empty by default so route
    // tests outside the destination do not have to name repository data.
    if (call.url.pathname === "/api/v1/documents/options" && call.method === "GET") {
      return json(200, { counterparties: [], uploaders: [], records: [] });
    }
    // M27's Entity registry filter candidates. Empty is the ordinary
    // fresh-install answer; the destination's filter suite supplies rows.
    if (call.url.pathname === "/api/v1/entities/list-options" && call.method === "GET") {
      return json(200, { jurisdictions: [], majorityOwners: [] });
    }
    // The portal's own bell, which every portal render reads on mount
    // and on every navigation (NOT-001, M20/9). Zero and empty by
    // default, exactly as the staff bell's two reads above; only the
    // portal bell's own suite supplies rows, through `extra`.
    if (
      call.url.pathname === "/api/v1/portal/notifications/unread-count" &&
      call.method === "GET"
    ) {
      return json(200, { unread: 0 });
    }
    if (call.url.pathname === "/api/v1/portal/notifications" && call.method === "GET") {
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
    // And the caller's own Requests (M20/5, DD-013), which the home
    // reads on every render. Empty by default for the two reads above's
    // reason; only the my-requests suite supplies rows, through `extra`.
    if (call.url.pathname === "/api/v1/portal/requests" && call.method === "GET") {
      return json(200, { requests: [] });
    }
    // What the staff request detail's Convert dialog draws (#420): the
    // live contract types with the fields each attaches, and the Entity
    // registry. Both reads run on every render of `/inbox/{number}`, so
    // they default to empty here for the portal reads' reason — a suite
    // that is not about conversion should not have to answer them, and
    // the one that is supplies rows through `extra`.
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, {
        contractTypes: [],
        contractStatuses: [],
        users: [],
        approverGroups: [],
      });
    }
    if (call.url.pathname === "/api/v1/matters/options" && call.method === "GET") {
      return json(200, { matterTypes: [], matterStatuses: [], users: [] });
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    // M27/6's destination opens on the cross-Entity compliance calendar.
    // Empty is the blank-start state ENT-006 promises; only calendar
    // route suites replace it through `extra`.
    if (call.url.pathname === "/api/v1/entities/calendar" && call.method === "GET") {
      return json(200, { obligations: [] });
    }
    if (call.url.pathname === "/api/v1/entities/obligation-options" && call.method === "GET") {
      return json(200, { users: [], matters: [] });
    }
    if (call.url.pathname === "/api/v1/entities/officer-roles" && call.method === "GET") {
      return json(200, { officerRoles: [], users: [] });
    }
    if (/^\/api\/v1\/entities\/[^/]+\/officers$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { officers: [] });
    }
    if (/^\/api\/v1\/entities\/[^/]+\/holdings$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { owners: [], owned: [], warnings: [] });
    }
    if (
      /^\/api\/v1\/entities\/[^/]+\/registrations$/.test(call.url.pathname) &&
      call.method === "GET"
    ) {
      return json(200, { registrations: [] });
    }
    if (
      /^\/api\/v1\/entities\/[^/]+\/obligations$/.test(call.url.pathname) &&
      call.method === "GET"
    ) {
      return json(200, { obligations: [] });
    }
    if (
      /^\/api\/v1\/entities\/[^/]+\/linked-record-counts$/.test(call.url.pathname) &&
      call.method === "GET"
    ) {
      return json(200, { contracts: 0, matters: 0 });
    }
    if (
      /^\/api\/v1\/entities\/[^/]+\/(contracts|matters)$/.test(call.url.pathname) &&
      call.method === "GET"
    ) {
      return json(200, { records: [] });
    }
    if (
      /^\/api\/v1\/entities\/[^/]+\/documents$/.test(call.url.pathname) &&
      call.method === "GET"
    ) {
      return json(200, { documents: [], nextCursor: null });
    }
    if (/^\/api\/v1\/entities\/[^/]+\/folders$/.test(call.url.pathname) && call.method === "GET") {
      return json(200, { folders: [] });
    }
    if (call.url.pathname === "/api/v1/onboarding" && call.method === "GET") {
      const onboarding: NonNullable<ApiState["onboarding"]> = state.onboarding ?? {
        completed: true,
      };
      return json(200, {
        completed: onboarding.completed,
        steps: Object.fromEntries(
          ONBOARDING_STEPS.map((step) => [
            step,
            {
              done: onboarding.steps?.[step] ?? true,
              settingsPath: ONBOARDING_SETTINGS_PATHS[step],
            },
          ]),
        ),
      });
    }
    // Review reads these catalogues on arrival, including after first-run setup.
    if (call.method === "GET") {
      const lists = {
        "/api/v1/matter-types": { matterTypes: [] },
        "/api/v1/matter-statuses": { matterStatuses: [] },
        "/api/v1/contract-types": { contractTypes: [] },
        "/api/v1/contract-statuses": { contractStatuses: [] },
        "/api/v1/entity-types": { entityTypes: [] },
        "/api/v1/officer-roles": { officerRoles: [] },
        "/api/v1/knowledge/types": { knowledgeTypes: [] },
        "/api/v1/request-types": { requestTypes: [] },
        "/api/v1/fields": { fields: [] },
        "/api/v1/org/reminder-offsets": { offsets: [7, 1, 0] },
      } satisfies {
        [
          P in
            | "/api/v1/matter-types"
            | "/api/v1/matter-statuses"
            | "/api/v1/contract-types"
            | "/api/v1/contract-statuses"
            | "/api/v1/entity-types"
            | "/api/v1/officer-roles"
            | "/api/v1/knowledge/types"
            | "/api/v1/request-types"
            | "/api/v1/fields"
            | "/api/v1/org/reminder-offsets"
        ]: paths[P]["get"]["responses"][200]["content"]["application/json"];
      };
      const list = Object.entries(lists).find(([path]) => path === call.url.pathname);
      if (list) return json(200, list[1]);
    }
    // The wizard's Organization step and the General pane read the same
    // row. Unnamed by default, which is what a fresh install holds.
    if (call.url.pathname === "/api/v1/org/general" && call.method === "GET") {
      return json(200, {
        general: state.orgGeneral ?? {
          name: "",
          logo: null,
          defaultLocale: "en-US",
          defaultTimezone: "UTC",
        },
      });
    }
    // The wizard's E-signature step and the Integrations pane read the
    // same connector. Unconfigured by default, as a fresh install is.
    if (call.url.pathname === "/api/v1/signing-connectors/docusign" && call.method === "GET") {
      const saved = state.signingConnector;
      return json(200, {
        connector: {
          // DocuSign is the one adapter v1 ships (CTR-013), so the
          // answer names it rather than echoing back the path.
          provider: "docusign",
          configured: saved !== undefined,
          enabled: saved?.enabled ?? saved !== undefined,
          disabledAt: saved?.disabledAt ?? null,
          environment: saved?.environment ?? null,
          integrationKey: saved?.integrationKey ?? null,
          apiUserId: saved?.apiUserId ?? null,
          hasPrivateKey: saved !== undefined,
          hasWebhookSecret: saved !== undefined,
          webhookUrl: "http://localhost:3000/api/v1/signing/docusign/webhook",
          updatedAt: saved === undefined ? null : "2026-08-16T09:00:00.000Z",
        },
      });
    }
    // The wizard's AI analysis step and the AI analysis pane read the
    // same connector, and the preset list is server-owned (TECH-012).
    // Unconfigured by default, as a fresh install is.
    if (call.url.pathname === "/api/v1/ai-connector" && call.method === "GET") {
      const saved = state.aiConnector;
      return json(200, {
        connector: {
          configured: saved !== undefined,
          enabled: saved?.enabled ?? saved !== undefined,
          preset: saved?.preset ?? null,
          protocol: saved?.protocol ?? null,
          baseUrl: saved?.baseUrl ?? null,
          hasApiKey: saved === undefined ? false : (saved.hasApiKey ?? true),
          model: saved?.model ?? null,
          disabledAt: saved?.disabledAt ?? null,
          updatedAt: saved === undefined ? null : "2026-08-16T09:00:00.000Z",
        },
        presets: AI_PRESETS,
      });
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
