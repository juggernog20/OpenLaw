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
 */

import { createHmac, createPrivateKey, createSign, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { SigningEnvironment } from "@openlaw/db";
import {
  EnvelopeNotFoundError,
  SigningConfigError,
  SigningRefusedError,
  SigningTimeoutError,
  SigningUnavailableError,
  WebhookSignatureError,
  type ConnectionCheck,
  type EnvelopeState,
  type EnvelopeStatus,
  type SendEnvelopeInput,
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

/** Default bound on one DocuSign call. */
export const DEFAULT_DOCUSIGN_TIMEOUT_MS = 30_000;

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
 * DocuSign's envelope statuses, mapped onto CTR-013's four. Anything
 * else — `created`, `deleted` — is not a state the record tracks.
 *
 * A `Map`, not an object literal: the key comes off a webhook body, and
 * an object lookup answers `constructor` and `toString` from the
 * prototype. That would turn a forged delivery into a status.
 */
const STATUS_MAP: ReadonlyMap<string, EnvelopeStatus> = new Map([
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
    ...(reason !== undefined ? { reason } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  };
}

/** What a driver instance may vary. */
export interface DocuSignDriverOptions {
  /** Bound on one call. */
  timeoutMs?: number;
  /** Overrides both hosts. The contract suite points them at a stub. */
  hosts?: { auth: string; api: string };
  /** Now, in milliseconds — fixed by the assertion suite. */
  clock?: () => number;
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
  private readonly timeoutMs: number;
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
    this.timeoutMs = options.timeoutMs ?? DEFAULT_DOCUSIGN_TIMEOUT_MS;
    this.clock = options.clock ?? Date.now;
  }

  /** One request, with the transient/terminal split applied to its answer. */
  private async call(
    url: string,
    init: Omit<RequestInit, "headers" | "signal"> & {
      headers?: Record<string, string>;
      token?: string;
    },
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
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      relayFetchError(error);
    }
    if (response.ok) return response;
    // 401/403 is the credential answer, 404 is a missing envelope, and
    // every other 4xx is DocuSign saying no to this request — all
    // terminal. 5xx and 429 are the provider's own trouble, which a
    // retry heals.
    const body = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new SigningConfigError(
        "DocuSign refused the connector's credentials. Check the integration key, the user ID, " +
          "the RSA key, and that consent has been granted.",
        { cause: body },
      );
    }
    if (response.status === 404) {
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

  /** One JWT-grant exchange. */
  private async mintAccessToken(now: number): Promise<string> {
    const assertion = buildJwtAssertion({
      integrationKey: this.config.integrationKey,
      apiUserId: this.config.apiUserId,
      privateKey: this.config.privateKey,
      audience: new URL(this.hosts.auth).host,
      now,
    });
    let response: Response;
    try {
      response = await this.call(`${this.hosts.auth}/oauth/token`, {
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
    const body = readObject(await response.json().catch(() => null));
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

  /** One userinfo round trip. */
  private async discoverAccount(): Promise<AccountInfo> {
    const token = await this.accessToken();
    const response = await this.call(`${this.hosts.auth}/oauth/userinfo`, { token });
    const body = readObject(await response.json().catch(() => null));
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
      baseUri,
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

  async sendEnvelope(input: SendEnvelopeInput): Promise<SentEnvelope> {
    const [token, url, bytes] = await Promise.all([
      this.accessToken(),
      this.envelopesUrl(),
      collect(input.document),
    ]);
    const response = await this.call(url, {
      method: "POST",
      token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildEnvelopeDefinition(input, bytes)),
    });
    const body = readObject(await response.json().catch(() => null));
    const providerEnvelopeId = body && readString(body, "envelopeId");
    if (!providerEnvelopeId) {
      throw new SigningRefusedError("DocuSign accepted the envelope but named no id for it.");
    }
    return { providerEnvelopeId };
  }

  async voidEnvelope(providerEnvelopeId: string, reason: string): Promise<void> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    await this.call(`${url}/${encodeURIComponent(providerEnvelopeId)}`, {
      method: "PUT",
      token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "voided", voidedReason: reason }),
    });
  }

  async readEnvelope(providerEnvelopeId: string): Promise<EnvelopeState> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    const response = await this.call(`${url}/${encodeURIComponent(providerEnvelopeId)}`, { token });
    const body = readObject(await response.json().catch(() => null)) ?? {};
    const rawStatus = readString(body, "status");
    const status = rawStatus ? mapEnvelopeStatus(rawStatus) : undefined;
    if (!status) {
      throw new SigningRefusedError(
        `DocuSign reports a status we do not track: ${rawStatus ?? "none"}.`,
      );
    }
    const reason = readString(body, "voidedReason") ?? readString(body, "declinedReason");
    const completedAt =
      readDate(body.completedDateTime) ??
      readDate(body.voidedDateTime) ??
      readDate(body.declinedDateTime);
    return {
      status,
      ...(reason !== undefined ? { reason } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
  }

  async fetchExecutedDocument(providerEnvelopeId: string): Promise<Readable> {
    const [token, url] = await Promise.all([this.accessToken(), this.envelopesUrl()]);
    // `combined` is the signed paper plus its certificate of
    // completion, which is the copy CTR-014 pins: the certificate is
    // the evidence the signatures happened.
    const response = await this.call(
      `${url}/${encodeURIComponent(providerEnvelopeId)}/documents/combined`,
      { token },
    );
    if (!response.body) {
      throw new SigningRefusedError("DocuSign returned no executed document for that envelope.");
    }
    return Readable.fromWeb(response.body);
  }

  verifyWebhook(body: Buffer, headers: Readonly<Record<string, string>>): WebhookDelivery {
    if (!verifyConnectSignature(body, headers, this.config.webhookSecret)) {
      throw new WebhookSignatureError("The delivery is not signed by this install's Connect key.");
    }
    return parseConnectDelivery(body);
  }
}

/** Everything a stream yields, as one buffer. */
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
): Record<string, unknown> {
  return {
    emailSubject: input.subject,
    status: "sent",
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
      })),
    },
  };
}

/** Builds the DocuSign driver for one stored connector. */
export function createDocuSignProvider(
  config: DocuSignConfig,
  options: DocuSignDriverOptions = {},
): SigningProvider {
  return new DocuSignProvider(config, options);
}
