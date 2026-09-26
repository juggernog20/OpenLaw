// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DocuSign driver (CTR-013's first connector, TECH-013's auth).
 *
 * Authentication is **JWT grant**, the service-integration flow: an
 * Administrator creates the DocuSign app and grants consent once, and
 * from then on this driver signs its own assertions with the stored RSA
 * key and mints access tokens server-to-server. No sender needs a
 * DocuSign seat, and a background sweep has no user context to borrow —
 * which is exactly why TECH-013 rejected per-user OAuth.
 *
 * The account is **discovered, not configured**. `/oauth/userinfo`
 * answers the integration user's default account, so the pane asks for
 * four values instead of five and cannot be given an account the user
 * cannot reach.
 *
 * Nothing in this file is reached by a test that touches the network.
 * The assertion assembly, the Connect HMAC check, and the payload
 * mapping are pure functions over their inputs, and the driver's own
 * suite holds them against known-good fixtures; the shared contract
 * suite runs the driver against a stub server that speaks DocuSign's
 * shapes.
 *
 * Outbound rules (TECH-030). No call follows a redirect. The discovered
 * `base_uri` must sit on DocuSign's own hosts. Every answer is read
 * under a byte ceiling and an idle deadline that runs across the whole
 * body, not only until the headers.
 */

import { createHmac, createPrivateKey, createSign, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import type { SigningEnvironment } from "@openlaw/db";
import { maxUploadBytes } from "../uploads.js";
import { BodyTooLargeError, boundedReadable, readBoundedBody } from "./bounded-body.js";
import {
  EnvelopeNotFoundError,
  EnvelopeAccessError,
  EnvelopeEditConflictError,
  SigningConfigError,
  SigningNotSubmittedError,
  SigningRefusedError,
  SigningTimeoutError,
  SigningUnavailableError,
  WebhookSignatureError,
  type ConnectionCheck,
  type EnvelopeState,
  type EnvelopeStatus,
  type SendEnvelopeInput,
  type PrepareEnvelopeInput,
  type SentEnvelope,
  type SigningProvider,
  type WebhookDelivery,
} from "./provider.js";

/** The stored connector row, as the driver needs it. */
export interface DocuSignConfig {
  environment: SigningEnvironment;
  integrationKey: string;
  apiUserId: string;
  /** RSA private key, PEM. */
  privateKey: string;
  /** The Connect HMAC secret deliveries are signed with. */
  webhookSecret: string;
}

/** Where each estate lives (TECH-013). */
const HOSTS: Record<SigningEnvironment, { auth: string; api: string }> = {
  demo: { auth: "https://account-d.docusign.com", api: "https://demo.docusign.net" },
  production: { auth: "https://account.docusign.com", api: "https://www.docusign.net" },
};

/**
 * The scopes JWT grant is consented for. `signature` covers sending,
 * voiding, and reading envelopes; `impersonation` is what makes the
 * assertion act as the integration user rather than as the app.
 */
const SCOPES = "signature impersonation";

/** An assertion's life. DocuSign caps it at an hour; ten minutes is
 * long enough for any one call and short enough that a leaked assertion
 * is nearly worthless. */
const ASSERTION_LIFETIME_SECONDS = 600;

/** The header DocuSign Connect signs each delivery with. */
export const CONNECT_SIGNATURE_HEADER = "x-docusign-signature-1";

/**
 * Default bound on one DocuSign call. It is an idle bound: the clock
 * restarts on every chunk that arrives, so a large executed copy that
 * keeps flowing is fine and a socket that stops sending is not.
 */
export const DEFAULT_DOCUSIGN_TIMEOUT_MS = 30_000;

/** The most JSON one DocuSign answer may carry. Answers are a few fields. */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** The most of a refusal body kept as an error cause. */
const MAX_REFUSAL_BYTES = 64 * 1024;

/** DocuSign's own hosts. A discovered `base_uri` may name nothing else. */
const DOCUSIGN_ESTATE = /(^|\.)docusign\.(net|com)$/i;

/**
 * The origin a discovered `base_uri` may send envelopes to, or a
 * configuration fault.
 *
 * The value comes off the userinfo answer, and every later call sends
 * the bearer token and the documents to it. Without this check, whoever
 * can shape that answer chooses where they go. Accepted: an `https`
 * origin on `docusign.net` or `docusign.com`, or one of the configured
 * host origins, which is how the contract suite points the driver at a
 * local stub. Exported so the suite can hold the rule on its own.
 */
export function checkedBaseUri(baseUri: string, trustedOrigins: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(baseUri);
  } catch {
    throw new SigningConfigError("DocuSign named an account base URI that is not a URL.");
  }
  if (trustedOrigins.includes(url.origin)) return url.origin;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !DOCUSIGN_ESTATE.test(url.hostname)
  ) {
    throw new SigningConfigError(
      "DocuSign named an account base URI outside its own hosts. " +
        "Envelopes are sent only to docusign.net and docusign.com.",
      { cause: url.host },
    );
  }
  return url.origin;
}

/** Base64url without padding, as a JWS wants it. */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Builds and signs the RS256 JWT assertion TECH-013's grant exchanges
 * for an access token.
 *
 * Exported because it is the half of the driver worth proving on its
 * own: the claim set is what DocuSign refuses or accepts, and a suite
 * can decode this string and read every claim without a network.
 *
 * Throws {@link SigningConfigError} when the stored key is not a usable
 * RSA private key — the one configuration fault that shows up here
 * rather than at the provider.
 */
export function buildJwtAssertion(input: {
  integrationKey: string;
  apiUserId: string;
  privateKey: string;
  /** The auth host, which is also the assertion's audience, without its scheme. */
  audience: string;
  /** Now, as milliseconds since the epoch. Passed in so a test can fix it. */
  now: number;
}): string {
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(input.privateKey);
  } catch (error) {
    throw new SigningConfigError(
      "The stored RSA private key could not be read. Paste the key DocuSign issued, " +
        "including its BEGIN and END lines.",
      { cause: error },
    );
  }
  if (key.asymmetricKeyType !== "rsa") {
    throw new SigningConfigError(
      "The stored private key is not an RSA key. DocuSign's JWT grant signs with RSA.",
    );
  }
  const issuedAt = Math.floor(input.now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: input.integrationKey,
      sub: input.apiUserId,
      aud: input.audience,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
      scope: SCOPES,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key);
  return `${header}.${payload}.${base64url(signature)}`;
}

/**
 * Whether a Connect delivery carries a signature made with `secret`.
 *
 * DocuSign sends one or more `x-docusign-signature-N` headers, each a
 * base64 HMAC-SHA256 of the exact request body. Any one of them
 * matching is enough — a rotation window sends both the old and the new
 * — and the comparison is constant-time, because a timing oracle on
 * this check is a forged status change.
 *
 * Exported so the driver's suite can hold it against known-good
 * fixtures without a driver instance.
 */
export function verifyConnectSignature(
  body: Buffer,
  headers: Readonly<Record<string, string>>,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  for (const [name, value] of Object.entries(headers)) {
    if (!name.toLowerCase().startsWith("x-docusign-signature-")) continue;
    const offered = Buffer.from(value, "base64");
    // Lengths differ, so this is not a match — and comparing buffers of
    // different lengths throws rather than answering false.
    if (offered.length !== expected.length) continue;
    if (timingSafeEqual(offered, expected)) return true;
  }
  return false;
}

/**
 * DocuSign's envelope statuses, mapped onto CTR-013's. `created` is a
 * draft (#1171). Anything else — `deleted`, `correct` — is not a state
 * the record tracks.
 *
 * A `Map`, not an object literal: the key comes off a webhook body, and
 * an object lookup answers `constructor` and `toString` from the
 * prototype. That would turn a forged delivery into a status.
 */
const STATUS_MAP: ReadonlyMap<string, EnvelopeStatus> = new Map([
  // DocuSign's name for a draft: created, and not yet sent (#1171).
  ["created", "draft"],
  ["sent", "sent"],
  ["delivered", "sent"],
  ["signed", "signed"],
  ["completed", "signed"],
  ["declined", "declined"],
  ["voided", "voided"],
] as const);

/** The CTR-013 status behind one DocuSign status, or undefined. */
export function mapEnvelopeStatus(docusignStatus: string): EnvelopeStatus | undefined {
  return STATUS_MAP.get(docusignStatus.toLowerCase());
}

/** A date DocuSign sent, or undefined when it sent none or nonsense. */
function readDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** A string field of an unknown object, when it is one. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** An object field of an unknown object, when it is one. */
function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Reduces one Connect delivery body to the envelope facts the record
 * needs. Exported for the driver's own suite; the shape is DocuSign's
 * JSON "envelope" event.
 *
 * Throws {@link WebhookSignatureError} for a body that is not one — the
 * route answers a malformed delivery exactly as it answers a forged
 * one, so an attacker learns nothing from which it was.
 */
export function parseConnectDelivery(body: Buffer): WebhookDelivery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new WebhookSignatureError("The delivery body is not JSON.");
  }
  const root = readObject(parsed);
  const data = root && readObject(root.data);
  const envelope = data && readObject(data.envelopeSummary);
  const providerEnvelopeId = data && readString(data, "envelopeId");
  const rawStatus = envelope && readString(envelope, "status");
  if (!providerEnvelopeId || !rawStatus) {
    throw new WebhookSignatureError("The delivery body is not a DocuSign envelope event.");
  }
  const status = mapEnvelopeStatus(rawStatus);
  if (!status) {
    throw new WebhookSignatureError(`The delivery reports a status we do not track: ${rawStatus}.`);
  }
  const reason = readString(envelope, "voidedReason") ?? readString(envelope, "declinedReason");
  const completedAt =
    readDate(envelope.completedDateTime) ??
    readDate(envelope.voidedDateTime) ??
    readDate(envelope.declinedDateTime);
  return {
    providerEnvelopeId,
    status,
    ...(readDate(envelope.sentDateTime) ? { sentAt: readDate(envelope.sentDateTime)! } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

/** What a driver instance may vary. */
export interface DocuSignDriverOptions {
  /** Idle bound on one call: the longest wait for headers or for the next chunk. */
  timeoutMs?: number;
  /** Overrides both hosts. The contract suite points them at a stub. */
  hosts?: { auth: string; api: string };
  /** Now, in milliseconds — fixed by the assertion suite. */
  clock?: () => number;
  /** The most bytes an executed copy may carry. Defaults to the upload ceiling. */
  maxDocumentBytes?: number;
}

/** One minted access token and when it stops being usable. */
interface AccessToken {
  value: string;
  expiresAtMs: number;
}

/** The account the integration user sends under, discovered once. */
interface AccountInfo {
  accountId: string;
  accountName: string;
  baseUri: string;
  userEmail: string;
}

/** Turns a fetch failure into the right side of the transient split. */
function relayFetchError(error: unknown): never {
  if (error instanceof Error && error.name === "TimeoutError") {
    throw new SigningTimeoutError("DocuSign did not answer in time.");
  }
  throw new SigningUnavailableError("DocuSign could not be reached.", { cause: error });
}

/**
 * Turns a failure while reading a body into the right side of the
 * split. The ceiling is terminal: the same envelope answers the same
 * bytes next time. A stall is a timeout, and anything else is the
 * transport.
 */
function relayBodyError(error: unknown, what: string): Error {
  if (error instanceof BodyTooLargeError) {
    return new SigningRefusedError(
      `DocuSign answered with ${what} larger than ${String(error.maxBytes)} bytes.`,
    );
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new SigningTimeoutError("DocuSign stopped sending before the answer was complete.");
  }
  return new SigningUnavailableError("DocuSign could not be read.", { cause: error });
}

/**
 * One idle deadline for one call. `touch` restarts the clock; the
 * caller does so on every chunk. `clear` stops it once the body is
 * consumed. `unref` keeps the timer out of the event loop's reasons to
 * stay open, so a worker shutting down never waits on a request that
 * already answered.
 */
interface IdleDeadline {
  signal: AbortSignal;
  touch: () => void;
  clear: () => void;
}

function idleDeadline(timeoutMs: number): IdleDeadline {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  const touch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // The name is what `relayFetchError` and `relayBodyError` read to
      // put this on the transient side, and it must keep meaning that.
      controller.abort(new DOMException("DocuSign did not answer in time.", "TimeoutError"));
    }, timeoutMs).unref();
  };
  touch();
  return {
    signal: controller.signal,
    touch,
    clear: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * The DocuSign driver. One instance holds one connector's credentials
 * and caches the token it mints from them, so a burst of calls costs
 * one grant exchange rather than one each. It is built per resolution
 * (the mailer-resolver pattern), so a rotated credential is picked up
 * by the next call rather than by a restart.
 */
class DocuSignProvider implements SigningProvider {
  readonly provider = "docusign" as const;
  readonly environment: SigningEnvironment;

  private readonly config: DocuSignConfig;
  private readonly hosts: { auth: string; api: string };
  /** The origins a discovered `base_uri` may name besides DocuSign's own. */
  private readonly trustedOrigins: readonly string[];
  private readonly timeoutMs: number;
  private readonly maxDocumentBytes: number;
  private readonly clock: () => number;
  private token: AccessToken | null = null;
  private account: AccountInfo | null = null;
  /** The grant exchange currently in flight, so overlapping callers
   * share one rather than each running their own. */
  private tokenExchange: Promise<string> | null = null;
  /** The account discovery currently in flight, for the same reason. */
  private accountLookup: Promise<AccountInfo> | null = null;

  constructor(config: DocuSignConfig, options: DocuSignDriverOptions = {}) {
    this.config = config;
    this.environment = config.environment;
    this.hosts = options.hosts ?? HOSTS[config.environment];
    this.trustedOrigins = [new URL(this.hosts.auth).origin, new URL(this.hosts.api).origin];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DOCUSIGN_TIMEOUT_MS;
    this.maxDocumentBytes = options.maxDocumentBytes ?? maxUploadBytes(process.env.MAX_UPLOAD_MB);
    this.clock = options.clock ?? Date.now;
  }

  /**
   * One request, with the transient/terminal split applied to its
   * answer. The response is returned unread. The caller reads it under
   * the same deadline, so the clock keeps running across the body.
   *
   * The request never follows a redirect. A redirect is the far side
   * choosing where the bearer token goes next.
   */
  private async request(
    url: string,
    init: Omit<RequestInit, "headers" | "signal" | "redirect"> & {
      headers?: Record<string, string>;
      token?: string;
    },
    deadline: IdleDeadline,
  ): Promise<Response> {
    const { token, ...rest } = init;
    let response: Response;
    try {
      response = await fetch(url, {
        ...rest,
        headers: {
          ...rest.headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: deadline.signal,
        redirect: "error",
      });
    } catch (error) {
      relayFetchError(error);
    }
    if (response.ok) return response;
    // The error code is read first, because DocuSign says the same
    // thing under more than one status: an edit lock and a wrong status
    // arrive as 400, a permission fault as 403. A 403 on an envelope
    // path is that envelope's permissions, not the credentials, which
    // is a different remedy. 401/403 elsewhere is the credential
    // answer, 404 is a missing envelope, and every other 4xx is
    // DocuSign saying no to this request — all terminal. 5xx and 429
    // are the provider's own trouble, which a retry heals. The refusal
    // body is kept as a bounded cause only.
    const body = await readBoundedBody(response.body, {
      maxBytes: MAX_REFUSAL_BYTES,
      onChunk: deadline.touch,
    })
      .then((bytes) => bytes.toString("utf8"))
      .catch(() => "");
    let code: string | undefined;
    try {
      code = readString(readObject(JSON.parse(body)) ?? {}, "errorCode")?.toUpperCase();
    } catch {
      /* An empty refusal still has its HTTP status. */
    }
    if (code === "EDIT_LOCK_ENVELOPE_LOCKED" || code === "ENVELOPE_LOCKED")
      throw new EnvelopeEditConflictError("locked");
    if (code === "ENVELOPE_INVALID_STATUS") throw new EnvelopeEditConflictError("not_draft");
    if (
      (response.status === 403 && /\/envelopes\/[^/]+/.test(new URL(url).pathname)) ||
      code === "USER_LACKS_PERMISSIONS" ||
      code === "ENVELOPE_ACCESS_DENIED"
    )
      throw new EnvelopeAccessError(
        "The Signing user cannot access this Envelope. Ask an Administrator to check its permissions.",
      );
    if (response.status === 401 || response.status === 403) {
      throw new SigningConfigError(
        "DocuSign refused the connector's credentials. Check the integration key, the user ID, " +
          "the RSA key, and that consent has been granted.",
        { cause: body },
      );
    }
    if (response.status === 404 || code === "ENVELOPE_DOES_NOT_EXIST") {
      throw new EnvelopeNotFoundError("DocuSign does not know that envelope.");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SigningUnavailableError(`DocuSign answered ${response.status}.`, { cause: body });
    }
    throw new SigningRefusedError(`DocuSign refused the request (${response.status}).`, {
      cause: body,
    });
  }

  /**
   * One call whose answer is JSON, read whole under a byte ceiling.
   * An empty body or one that is not JSON answers `null`, which every
   * caller treats as a missing field.
   */
  private async callJson(
    url: string,
    init: Parameters<DocuSignProvider["request"]>[1] = {},
  ): Promise<unknown> {
    const deadline = idleDeadline(this.timeoutMs);
    try {
      const response = await this.request(url, init, deadline);
      let bytes: Buffer;
      try {
        bytes = await readBoundedBody(response.body, {
          maxBytes: MAX_JSON_BYTES,
          onChunk: deadline.touch,
        });
      } catch (error) {
        throw relayBodyError(error, "an answer");
      }
      if (bytes.length === 0) return null;
      try {
        return JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        return null;
      }
    } finally {
      deadline.clear();
    }
  }

  /**
   * One call whose answer is handed on as a stream. The idle deadline
   * keeps running across the whole transfer and restarts on every chunk,
   * and the bytes are counted against the document ceiling as they
   * pass. The executed-copy job meters the same stream against the same
   * ceiling; this is the driver's own backstop, so a connector cannot
   * stream past what the install accepts whatever consumes it.
   */
  private async callStream(
    url: string,
    init: Parameters<DocuSignProvider["request"]>[1],
  ): Promise<Readable> {
    const deadline = idleDeadline(this.timeoutMs);
    let response: Response;
    try {
      response = await this.request(url, init, deadline);
    } catch (error) {
      deadline.clear();
      throw error;
    }
    if (!response.body) {
      deadline.clear();
      throw new SigningRefusedError("DocuSign returned no executed document for that envelope.");
    }
    const stream = boundedReadable(response.body, {
      maxBytes: this.maxDocumentBytes,
      onChunk: deadline.touch,
      mapError: (error) => relayBodyError(error, "an executed copy"),
    });
    stream.once("close", deadline.clear);
    return stream;
  }

  /**
   * A usable access token, minted through the JWT grant when needed.
   *
   * The in-flight exchange is held, not just its result: `sendEnvelope`
   * asks for the token and the account at once, so two overlapping
   * calls would otherwise each run a grant exchange. The handle is
   * cleared either way, so a failed exchange is retried rather than
   * remembered.
   */
  private accessToken(): Promise<string> {
    const now = this.clock();
    // Refreshed a minute early, so a token cannot expire between the
    // check and the call it was fetched for.
    if (this.token && this.token.expiresAtMs - 60_000 > now) {
      return Promise.resolve(this.token.value);
    }
    this.tokenExchange ??= this.mintAccessToken(now).finally(() => {
      this.tokenExchange = null;
    });
    return this.tokenExchange;
  }

  private async mintAccessToken(now: number): Promise<string> {
    const assertion = buildJwtAssertion({
      integrationKey: this.config.integrationKey,
      apiUserId: this.config.apiUserId,
      privateKey: this.config.privateKey,
      audience: new URL(this.hosts.auth).host,
      now,
    });
    let answer: unknown;
    try {
      answer = await this.callJson(`${this.hosts.auth}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });
    } catch (error) {
      // The grant endpoint refuses bad credentials with 400
      // `invalid_grant` and an unconsented integration with 400
      // `consent_required` — both are the connector being wrong, not
      // one request being wrong, so they answer as a configuration
      // fault whatever the status code says.
      if (error instanceof SigningRefusedError) {
        throw new SigningConfigError(
          "DocuSign refused the connector's credentials. Check the integration key, the user ID, " +
            "and the RSA key, and grant consent to the integration once from the DocuSign console.",
          { cause: error },
        );
      }
      throw error;
    }
    const body = readObject(answer);
    const value = body && readString(body, "access_token");
    if (!value) {
      throw new SigningConfigError("DocuSign returned no access token for the JWT grant.");
    }
    const lifetime = typeof body.expires_in === "number" ? body.expires_in : 3600;
    this.token = { value, expiresAtMs: now + lifetime * 1000 };
    return value;
  }

  /** The account the integration user sends under, discovered once —
   * and, while the discovery is in flight, discovered only once. */
  private accountInfo(): Promise<AccountInfo> {
    if (this.account) return Promise.resolve(this.account);
    this.accountLookup ??= this.discoverAccount().finally(() => {
      this.accountLookup = null;
    });
    return this.accountLookup;
  }

  private async discoverAccount(): Promise<AccountInfo> {
    const token = await this.accessToken();
    const body = readObject(await this.callJson(`${this.hosts.auth}/oauth/userinfo`, { token }));
    const accounts = body && Array.isArray(body.accounts) ? body.accounts : [];
    // The default account, else the first one — an integration user
    // with no account cannot send, so that is a credential fault.
    const chosen =
      accounts.map(readObject).find((account) => account?.is_default === true) ??
      readObject(accounts[0]);
    const accountId = chosen && readString(chosen, "account_id");
    const baseUri = chosen && readString(chosen, "base_uri");
    if (!chosen || !accountId || !baseUri) {
      throw new SigningConfigError(
        "The DocuSign user has no account this integration can send on.",
      );
    }
    this.account = {
      accountId,
      accountName: readString(chosen, "account_name") ?? accountId,
      baseUri: checkedBaseUri(baseUri, this.trustedOrigins),
      userEmail: (body && readString(body, "email")) ?? this.config.apiUserId,
    };
    return this.account;
  }

  /** The REST base for this account's envelopes. */
  private async envelopesUrl(): Promise<string> {
    const account = await this.accountInfo();
    return `${account.baseUri}/restapi/v2.1/accounts/${account.accountId}/envelopes`;
  }

  async testConnection(): Promise<ConnectionCheck> {
    const account = await this.accountInfo();
    return {
      accountId: account.accountId,
      accountName: account.accountName,
      userEmail: account.userEmail,
    };
  }

  async prepareEnvelope(input: PrepareEnvelopeInput): Promise<SentEnvelope> {
    return this.createEnvelope(input, true);
  }

  async launchEnvelope(providerEnvelopeId: string, returnUrl: string): Promise<string> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    const body = readObject(
      await this.callJson(`${url}/${encodeURIComponent(providerEnvelopeId)}/views/sender`, {
        method: "POST",
        token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSenderViewRequest(returnUrl)),
      }),
    );
    const launchUrl = body && readString(body, "url");
    if (!launchUrl) throw new SigningUnavailableError("DocuSign returned no sender session.");
    return launchUrl;
  }

  async sendEnvelope(input: SendEnvelopeInput): Promise<SentEnvelope> {
    return this.createEnvelope(input, false);
  }

  private async createEnvelope(
    input: SendEnvelopeInput | PrepareEnvelopeInput,
    draft: boolean,
  ): Promise<SentEnvelope> {
    const [token, url, bytes] = await Promise.all([
      this.accessToken(),
      this.envelopesUrl(),
      collect(input.document),
    ]).catch((error: unknown) => {
      throw new SigningNotSubmittedError("DocuSign creation was not submitted.", { cause: error });
    });
    const body = readObject(
      await this.callJson(url, {
        method: "POST",
        token,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildEnvelopeDefinition(input, bytes, draft)),
      }),
    );
    const providerEnvelopeId = body && readString(body, "envelopeId");
    if (!providerEnvelopeId) {
      throw new SigningUnavailableError("DocuSign accepted the envelope but named no id for it.");
    }
    return { providerEnvelopeId };
  }

  async findEnvelope(transactionId: string): Promise<SentEnvelope | null> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    const body = readObject(
      await this.callJson(`${url}?transaction_ids=${encodeURIComponent(transactionId)}`, { token }),
    );
    if (!body || !Array.isArray(body.envelopes)) {
      throw new SigningUnavailableError("DocuSign returned no usable transaction lookup.");
    }
    if (body.envelopes.length === 0) return null;
    const match = readObject(body.envelopes[0]);
    const providerEnvelopeId = match && readString(match, "envelopeId");
    if (
      body.envelopes.length !== 1 ||
      !providerEnvelopeId ||
      (match &&
        readString(match, "transactionId") !== undefined &&
        readString(match, "transactionId") !== transactionId)
    ) {
      throw new SigningUnavailableError("DocuSign returned ambiguous transaction evidence.");
    }
    return { providerEnvelopeId };
  }

  async voidEnvelope(providerEnvelopeId: string, reason: string): Promise<void> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    await this.callJson(`${url}/${encodeURIComponent(providerEnvelopeId)}`, {
      method: "PUT",
      token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "voided", voidedReason: reason }),
    });
  }

  async readEnvelope(providerEnvelopeId: string): Promise<EnvelopeState> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    const body =
      readObject(
        await this.callJson(`${url}/${encodeURIComponent(providerEnvelopeId)}?include=folders`, {
          token,
        }),
      ) ?? {};
    const rawStatus = readString(body, "status");
    const status = rawStatus ? mapEnvelopeStatus(rawStatus) : undefined;
    if (!status) {
      throw new SigningRefusedError(
        `DocuSign reports a status we do not track: ${rawStatus ?? "none"}.`,
      );
    }
    // Folder membership and unsent state come from one provider observation.
    // Missing results, reserved deletedDateTime, and browser events prove nothing.
    const discarded =
      status === "draft" &&
      !readString(body, "sentDateTime") &&
      Array.isArray(body.folders) &&
      body.folders.some(
        (folder: unknown) =>
          readString(readObject(folder) ?? {}, "type")?.toLowerCase() === "recyclebin",
      );
    const reason = readString(body, "voidedReason") ?? readString(body, "declinedReason");
    const completedAt =
      readDate(body.completedDateTime) ??
      readDate(body.voidedDateTime) ??
      readDate(body.declinedDateTime);
    return {
      status: discarded ? "discarded" : status,
      ...(readDate(body.sentDateTime) ? { sentAt: readDate(body.sentDateTime)! } : {}),
      ...(reason !== undefined ? { reason } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
  }

  async fetchExecutedDocument(providerEnvelopeId: string): Promise<Readable> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    // `combined` is the signed paper plus its certificate of
    // completion, which is the copy CTR-014 pins: the certificate is
    // the evidence the signatures happened.
    return this.callStream(`${url}/${encodeURIComponent(providerEnvelopeId)}/documents/combined`, {
      token,
    });
  }

  verifyWebhook(body: Buffer, headers: Readonly<Record<string, string>>): WebhookDelivery {
    if (!verifyConnectSignature(body, headers, this.config.webhookSecret)) {
      throw new WebhookSignatureError("The delivery is not signed by this install's Connect key.");
    }
    return parseConnectDelivery(body);
  }
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/**
 * The DocuSign envelope definition for one send. Exported for the
 * driver's own payload-mapping suite: what goes on the wire is worth
 * asserting without a wire.
 *
 * Every signer is recipient `routingOrder: 1`, which is DocuSign's way
 * of saying "all at once" — v1 asks everyone in parallel. The anchor
 * string is DocuSign's own convention for placing a signature tab
 * where the paper says to sign. When the paper does not say,
 * `anchorIgnoreIfNotPresent` drops the tab and DocuSign falls back to
 * free-form signing: the signer places their own signature.
 */
/** The extension of a file name, or `pdf` when it carries none — a
 * name with no dot must not send its whole self as the extension. */
function fileExtensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1) : "pdf";
}

export function buildEnvelopeDefinition(
  input: SendEnvelopeInput,
  document: Buffer,
  draft = false,
): Record<string, unknown> {
  return {
    emailSubject: input.subject,
    status: draft ? "created" : "sent",
    ...(draft ? { messageLock: "true", recipientsLock: "true" } : {}),
    ...("transactionId" in input ? { transactionId: input.transactionId } : {}),
    documents: [
      {
        documentId: "1",
        name: input.fileName,
        fileExtension: fileExtensionOf(input.fileName),
        documentBase64: document.toString("base64"),
      },
    ],
    recipients: {
      signers: input.signers.map((signer, index) => ({
        recipientId: String(index + 1),
        routingOrder: "1",
        name: signer.name,
        email: signer.email,
        ...(draft
          ? {}
          : {
              tabs: {
                signHereTabs: [
                  {
                    documentId: "1",
                    anchorString: "/sig/",
                    anchorUnits: "pixels",
                    anchorXOffset: "0",
                    anchorYOffset: "0",
                    anchorIgnoreIfNotPresent: "true",
                  },
                ],
              },
            }),
      })),
    },
  };
}

export function buildSenderViewRequest(returnUrl: string) {
  return {
    viewAccess: "envelope",
    returnUrl,
    settings: {
      startingScreen: "Tagger",
      sendButtonAction: "send",
      showBackButton: "false",
      showHeaderActions: "false",
      showDiscardAction: "true",
      recipientSettings: { showEditRecipients: "false" },
      documentSettings: {
        showEditDocuments: "false",
        showEditDocumentVisibility: "false",
        showEditPages: "false",
      },
      taggerSettings: { paletteSections: "default" },
    },
  };
}

export function createDocuSignProvider(
  config: DocuSignConfig,
  options: DocuSignDriverOptions = {},
): SigningProvider {
  return new DocuSignProvider(config, options);
}
