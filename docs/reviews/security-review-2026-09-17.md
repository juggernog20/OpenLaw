# Pre-launch security review, 2026-09-17

Two independent reviews of the full OpenLaw surface at commit `879fbae2` plus the working tree.

- Review A: Claude Fable 5.1 workflow. 13 finders, one per surface area. Every finding was checked by two adversarial verifiers (code path, attacker) with an xhigh tie-breaker on a split. A completeness critic then named six gaps, and six more finders covered them. 166 agents, 63 + 8 unique findings verified, 66 confirmed, 5 refuted.
- Review B: Codex gpt-6-astra at xhigh effort, cold, same brief, read-only sandbox. 18 findings, plus a coverage table.

Raw artifacts: `~/.cache/openlaw-secreview/` (`codex-report.md`, `workflow-result-final.json`, `workflow-confirmed.md`, `brief.md`).

The five High findings from Review B and the three High findings from Review A were re-read by hand against the code before this report was written.

## Verdict

Hold launch until the six High findings are fixed. None is large. Four are a missing guard call or predicate, one is logger configuration, one is a bootstrap secret. Neither review substantiated SQL injection, command injection, XXE, stored XSS, or an unauthenticated data read. The access model is sound in its shape. The holes are at the seams: owner reassignment, portal-only routes that skip a shared predicate, and infrastructure trust (proxy IP, logs, first boot).

Codex said the same thing in its own words: "hold launch until the High findings are fixed and the deployment controls below are verified."

## Findings table

Severity is the merged rating after both reviews and the manual re-read. "A" and "B" say which review found it.

| #   | Sev    | Finding                                                                                                                         | Found by |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| H1  | High   | Team member on a confidential Contract or Matter can make themselves Owner or Matter Manager, then clear the flag or add anyone | A, B     |
| H2  | High   | Portal Knowledge routes ignore the document Confidential flag                                                                   | B        |
| H3  | High   | First-run setup is an unauthenticated POST on a port published to every interface                                               | B        |
| H4  | High   | Sign-in rate limiter trusts a client-supplied X-Forwarded-For and falls back to one shared bucket                               | A, B     |
| H5  | High   | Set-password, magic-link and OIDC tokens land in request logs; failed Drizzle queries log full bind parameters                  | A, B     |
| H6  | High   | Portal approval packet streams a confidential primary document without the document audience predicate; a Member can self-ask   | A        |
| M1  | Medium | Password-setup completion runs Argon2 before it looks up the token                                                              | A, B     |
| M2  | Medium | Typed magic-link route calls auth.api directly and skips every rate limit (mail bomb)                                           | A, B     |
| M3  | Medium | Password-setup per-IP limiter keys on request.ip with no trustProxy, so 30 requests block password setup for the org            | A        |
| M4  | Medium | Entity obligations return a confidential Matter's number and title without Matter reach                                         | A        |
| M5  | Medium | Cross-record activity payloads carry confidential Matter, Contract and Entity names to readers of the open side                 | A        |
| M6  | Medium | Any Member reads Generation answers and downloads output for Contracts later made confidential                                  | A        |
| M7  | Medium | Auto-Doc template upload does not screen for attachedTemplate, DDE, OLE or external relationships                               | A        |
| M8  | Medium | Zip expanded-size guard trusts declared sizes; `[Content_Types].xml` inflates outside the V8 heap cap                           | A        |
| M9  | Medium | Advanced settings let an Administrator repoint storage, doc engine and BASE_URL; deployment cannot pin them                     | A        |
| M10 | Medium | Connector responses select outbound destinations: AI fetch follows redirects with the key; DocuSign `base_uri` is trusted       | A, B     |
| M11 | Medium | Comment-attachment preview triggers an uncached LibreOffice conversion per request; no SSE, upload or conversion budgets        | A, B     |
| M12 | Medium | Portal Generation and Request submission have no per-user cap; each spawns a worker thread, blob, conversion and email          | A, B     |
| M13 | Medium | Password reset and invite activation do not revoke existing sessions                                                            | A, B     |
| M14 | Medium | `/api/v1` mutations have no Origin or CSRF check; multipart routes rely on SameSite=Lax alone (same-site sibling origin attack) | A, B     |
| M15 | Medium | App port published on 0.0.0.0 by default; loopback is an optional override                                                      | A, B     |
| M16 | Medium | Connector reads buffer unbounded bytes or drop the deadline once the stream starts                                              | B        |
| L1  | Low    | Administrator accounts enumerable through `/sign-in/email` when password sign-in is disabled (401 vs 403)                       | A        |
| L2  | Low    | Any team member on a confidential Contract can hand its primary document to any Business User through an approval ask           | A        |
| L3  | Low    | Self-declared Department at Portal first run widens Auto-Doc audience                                                           | A        |
| L4  | Low    | Business User can add any active account to a non-confidential record, which opens its confidential Documents                   | A        |
| L5  | Low    | Queued Auto-Doc email ignores audience revocation between submit and delivery                                                   | B        |
| L6  | Low    | Anonymous magic-link request sets an unbounded display name on a JIT Business User                                              | A        |
| L7  | Low    | Magic-link and password-setup responses leak allowlist membership by timing                                                     | A        |
| L8  | Low    | Request title and description are unbounded and fan out to every Member's bell and email                                        | A        |
| L9  | Low    | Any signed-in user can enumerate the counterparty registry through the intake picker                                            | A        |
| L10 | Low    | Version download echoes the uploader-declared Content-Type                                                                      | A        |
| L11 | Low    | Business User can tell whether a Document id belongs to a Knowledge Item                                                        | A        |
| L12 | Low    | Sanitised email bodies keep relative hrefs that open on the app origin                                                          | A        |
| L13 | Low    | Auto-Doc template detection buffers and parses a whole DOCX on the API request thread                                           | A        |
| L14 | Low    | LibreOffice runs with default security profile: macro level, link updates and scripting not pinned                              | A        |
| L15 | Low    | Abandoned `/convert`, `/ocr`, `/extract` keep running to the sidecar's bound; only `/compare` is killed on disconnect           | A        |
| L16 | Low    | doc-engine container has a tmpfs cap but no memory or pids limit                                                                | A, B     |
| L17 | Low    | DOC_ENGINE_URL change is audited without its value                                                                              | A        |
| L18 | Low    | Compare output and OCR text buffered in the worker with no size ceiling                                                         | A        |
| L19 | Low    | Legacy `smtpUrl` form accepts raw nodemailer options (certificate checks off)                                                   | A        |
| L20 | Low    | Credential envelope keeps a permanent plaintext fallback, AAD is the column name only, key derived by unsalted SHA-256          | A        |
| L21 | Low    | Knowledge Markdown inline regex is quadratic; 100 KB of `[` freezes readers' tabs                                               | A        |
| L22 | Low    | AI extraction commits values, counterparty links and Key Dates before human review                                              | A        |
| L23 | Low    | SSE record scope checked once at connect; revoked reader keeps receiving activity prompts                                       | A, B     |
| L24 | Low    | No per-user or per-process cap on SSE connections                                                                               | A, B     |
| L25 | Low    | SPA ships no CSP; inline boot script blocks a strict one; no frame-ancestors from the app                                       | A, B     |
| L26 | Low    | Bundled Postgres uses `openlaw/openlaw` and the app connects as the cluster superuser                                           | A, B     |
| L27 | Low    | AUTH_SECRET has no strength check at boot                                                                                       | A        |
| L28 | Low    | No TLS guidance for external Postgres; pg connects in plaintext unless the URL says otherwise                                   | A        |
| L29 | Low    | Whole `.env` passed to app and worker; worker holds AUTH_SECRET it never needs                                                  | A        |
| L30 | Low    | App and worker lack the hardening the doc-engine has (cap_drop, no-new-privileges, read_only)                                   | A        |
| L31 | Low    | No request or connection timeout on the Fastify server                                                                          | A        |
| L32 | Low    | Cross-module search recomputes tsvectors and ts_headline on every call with no rate limit                                       | A        |
| L33 | Low    | Unauthenticated branding endpoint serves a ~7 MB logo with `no-store` on every navigation                                       | A        |
| L34 | Low    | Migration 0138 adds every Business Owner to Confidential teams, overriding 0109's gate, with no Legal-visible entry             | A        |
| L35 | Low    | Malformed SMTP_URL prints the relay password on stderr at boot                                                                  | A        |
| I1  | Info   | Relation and matter-link reads reveal how many confidential contracts a viewer cannot see                                       | A        |
| I2  | Info   | Portal record views name non-Portal-listed Entities, contrary to DD-027                                                         | A        |
| I3  | Info   | DOC-010 hard delete does not reach copies of the same bytes held outside the Document chain, nor `pgboss.job.output`            | A        |
| I4  | Info   | Raw worker and library error text stored and shown as Generation failure detail                                                 | A        |
| I5  | Info   | `/api/docs` and `/api/openapi.json` are unauthenticated                                                                         | A, B     |
| I6  | Info   | Demo seed shares one public password across every seeded staff account                                                          | A        |
| I7  | Info   | `pnpm audit`: one moderate advisory, dev-only (esbuild 0.18 via drizzle-kit)                                                    | A, B     |
| I8  | Info   | DocuSign driver keeps an unbounded provider response body in `cause`                                                            | A        |

## High findings

### H1. Owner and Matter Manager reassignment is not treated as an audience change

Locations: `apps/api/src/modules/contracts/routes.ts:2422`, `apps/api/src/modules/matters/routes.ts:1046`, `apps/api/src/lib/contract-access.ts:363`, `apps/api/src/lib/matter-access.ts:92`.

Attacker: a Legal Team Member with a team row on a confidential Contract or Matter who is not its creator, Owner, or an Administrator.

Scenario. Step 1: `PATCH /api/v1/contracts/42` with `{"managerId":"<own id>"}`. The reader guard passes on role, `lockedContract` passes because the caller is on the team, and the `managerId` branch never calls `assertMayChangeTeam`. Step 2: `PATCH /api/v1/contracts/42` with `{"isConfidential":false}`. `confidentialityWrite` now returns `allowed` through `standing.isOwner`. The record is open to every Member. Variant: step 1 with an outsider's id puts that person inside the wall in one request. Same two steps on `PATCH /api/v1/matters/:number`. The team routes already guard this (`assertMayChangeTeam` at contracts/routes.ts:1512, matter routes at 1308 and 1358), so this is a missed check, not a design choice. The two fields cannot be combined in one body; the flag check reads the pre-patch manager.

Fix. In the contracts `managerId` branch call `assertMayChangeTeam(tx, current, request.user)` before `lockedUser`. In the matters route call `assertAudienceActor` with the existing Matter wording when `target.isConfidential`. Add tests beside the CTR-023 roster tests: an on-team Member sends `managerId` for self and for an outsider on a walled record and expects 403. Consider a `confidentiality_set` style activity entry when the Owner of a confidential record changes, since CTR-022 says each audience change gets its own audit action.

### H2. Portal Knowledge routes ignore the document Confidential flag

Locations: `apps/api/src/modules/portal/routes.ts:357` and `:426`, `apps/api/src/modules/documents/routes.ts:2721` and `:4765`.

Attacker: any signed-in user, including a Business User.

Scenario. An Administrator or the uploader flags a document on a published, Everyone-audience Knowledge item confidential. `documentAudienceScope` then hides it from staff reads. The portal listing filters only `knowledgeItemId` and `archivedAt`, so `GET /api/v1/portal/knowledge/:id` returns its title, filename and version, and `GET .../documents/:documentId/download` returns the bytes. No id guessing is needed because the listing supplies the id.

Fix. Add `documentAudienceScope(db, user)` to both portal Knowledge queries. If Knowledge paper is meant to have no separate confidentiality, refuse the flag server-side for `knowledge_item` owners and record that in DECISIONS-KNOWLEDGE.md.

### H3. First-run setup can be claimed by any network client

Locations: `apps/api/src/modules/auth/routes.ts:363`, `compose.yml:100`.

Attacker: anyone who can reach port 3000 before the operator finishes setup.

Scenario. `POST /api/v1/auth/setup` needs no secret, no session, and no local-client check. The advisory lock makes exactly one caller win, but not the right one. Compose publishes `0.0.0.0:3000` by default and Docker inserts its rule ahead of ufw.

Fix. Print a one-time bootstrap token to the container log at first boot and require it in the setup body, or provide a CLI setup path. Publish on `127.0.0.1` by default (see M15).

### H4. Sign-in rate limiter is keyed on a spoofable header, or on nothing

Locations: `apps/api/src/auth/instance.ts:231`, `apps/api/src/auth/handler.ts:34`, `apps/api/src/index.ts:280`, `docs/DEPLOYMENT.md:134`.

Attacker: anyone who reaches the app through the documented nginx recipe or directly on the published port.

Scenario. better-auth 1.7.5 trusts a single-value `X-Forwarded-For` when `advanced.ipAddress.trustedProxies` is unset. The auth handler forwards every inbound header. So `POST /api/auth/sign-in/email` with a fresh `X-Forwarded-For: 10.0.0.N` per request lands in a new bucket each time, and there is no per-account lockout on password sign-in (the lockout only covers the TOTP challenge). Any staff or Administrator password can be guessed at line speed. In the other direction, with the nginx recipe (which sets only `Host`) production requests carry no forwarded address, `getIP` returns null, and every client shares the `no-trusted-ip` bucket. Three requests per ten seconds to each of `/sign-in/email`, `/sign-in/magic-link`, `/sign-in/sso` and `/two-factor/verify-totp` locks the whole org out of every sign-in method. The Caddy recipe is mostly safe from the spoof because Caddy 2.7+ overwrites untrusted `X-Forwarded-For`. Codex confirmed both behaviours with an in-memory probe of the installed library.

Fix. Add a `TRUSTED_PROXIES` env value. Pass it to better-auth as `advanced.ipAddress.trustedProxies` with `ipAddressHeaders: ["x-forwarded-for"]`, and to Fastify as `trustProxy`. Add a per-account failure counter on `/sign-in/email` using the `twoFactors.failedVerificationCount` pattern. Fix the nginx example to overwrite `X-Forwarded-For` and set `X-Forwarded-Proto`. Warn at boot when NODE_ENV is production and no trusted proxy is set.

### H5. Secrets in logs

Locations: `apps/api/src/index.ts:280` (`{ logger: true }`), `apps/api/src/app.ts:458`, `apps/api/src/auth/instance.ts:298`, `apps/api/src/pipeline/text-extraction.ts:291` and `:381`, `apps/api/src/lib/mailer.ts:43`.

Attacker: whoever reads the container log, the log shipper, or a backup of the log volume.

Scenario, three parts. First, the default Fastify request serializer logs `req.url` with its query string. The set-password email links `/auth/set-password?token=...`, valid for one hour, and the SPA fallback logs that GET before the user submits the form, so a log reader can redeem the token first. Magic-link verify and the OIDC callback log their token and code too, though both are consumed within seconds. Codex confirmed this with a probe of the installed Fastify. Second, any failed Drizzle write logs its full bind parameters through pino's `err` serializer; a Legal Team Member can trigger it on demand with a PDF whose text layer holds U+0000 (Postgres refuses with 22021, the job retries twice, and pg-boss persists the whole document text in `pgboss.job.output`). Third, a malformed SMTP_URL prints the relay password on stderr at boot.

Fix. Configure the logger with a `req` serializer that drops the query string and a `redact` list for `err.params`, `err.query`, cookies and authorization. Add a `loggable(error)` helper that never emits a DrizzleQueryError's message, and rethrow plain errors from pipeline handlers so pg-boss stores nothing sensitive. Strip U+0000 before every text write and treat 22021 as terminal. Move the set-password token to the URL fragment so neither the app nor the proxy logs it.

### H6. Portal approval packet streams a confidential primary document without the document audience predicate

Locations: `apps/api/src/modules/portal/approvals.ts:109`, `apps/api/src/modules/contract-approvals/routes.ts:262`.

Attacker: a Legal Team Member outside the audience of a confidential primary document on an open Contract; or any approver, staff or Business User, on such a Contract.

Scenario. `GET /documents/:id/versions/:v/download` refuses the outsider because `documentAudienceScope` applies. But `POST /contracts/42/approvals` with `{"approverIds":["<own id>"]}` succeeds: `reachedContract` passes because the Contract itself is open, and `assertInAudience` is called without `confidentialDocument: true`. Then `GET /portal/approvals/:id/document` and `/preview` stream the bytes; `primaryDocument()` takes no viewer and applies no scope. DECISIONS-CONTRACTS.md:584 grants approvers the Contract title and current primary Document, and Codex read that as intentional. That decision never mentions a document flagged confidential under DOC-008, and the self-ask path is not a product intention.

Fix. Give `primaryDocument()` the viewer and add `documentAudienceScope`. In `assertInAudience`, pass `confidentialDocument: true` when the primary document is flagged, so the requester gets the existing 422 up front. Decide in DECISIONS-CONTRACTS.md whether a Business User approver may ever receive a confidential primary document. Consider refusing `approverIds` that contain the requester.

## Medium findings

### M1. Argon2 before token lookup

`apps/api/src/modules/auth/authentication-policy-routes.ts:209`. `POST /auth/password-setup/complete` hashes the password (19 MiB, t=2) before selecting the verification row, with no limiter on `/api/v1`. Anonymous CPU and memory burn. Fix: look up and lock the token first, hash only on a live one, and put the route behind the shared auth limiter from M2.

### M2. Typed magic-link route skips every rate limit

`apps/api/src/modules/auth/routes.ts:1172`. `app.auth.api.signInMagicLink` bypasses better-auth's HTTP limiter; the route has none of its own. One email and one verification row per call, to any allowed address, from the org's relay. Fix: extract the password-setup counter into a shared helper (3 per email, 30 per IP per 15 minutes) and apply it here; keep the uniform 202.

### M3. Password-setup limiter keys on the proxy's address

`apps/api/src/modules/auth/authentication-policy-routes.ts:112`. Without `trustProxy`, `request.ip` is the proxy for everyone, so 31 anonymous requests lock password setup and reset for the org for 15 minutes. Fix: `trustProxy` from `TRUSTED_PROXIES` (H4); until then, fail open on the IP scope.

### M4. Entity obligations leak a confidential Matter's title

`apps/api/src/modules/entities/obligation-routes.ts:144`. The projection left-joins `matters` with no `matterTeamScope`; `GET /entities/:id/obligations` and `/entities/calendar` return `matter.number` and `matter.title` for a Matter the viewer gets 404 on. Fix: add the scope to the join and emit `{ restricted: true }` like `entities/linked-records.ts`.

### M5. Activity payloads carry the far side's name

`apps/api/src/modules/activity/routes.ts:348`. `matter.relation_added`, `matter.parent_set`, `contract.relation_*`, `contract.parent_*` and `entity_holding.*` store the related record's number and title in the payload of the open record's feed; the projection returns it unchanged. Fix: one `redactUnreachedReferences` helper applied in the activity feed, the audit log and its CSV.

### M6. Generation reads ignore the created Contract's audience

`apps/api/src/modules/auto-docs/generations.ts:132`. `generationQuery` selects the generation row unconditionally and only left-joins the Contract with scope, so `answers`, `displayValues`, and the docx/pdf downloads stay readable by every Member after the Contract goes confidential; filings can copy the output onto the Member's own record. Fix: a `generationReachScope` predicate on read, list, retry and filing source.

### M7. Template upload does not screen dangerous DOCX parts

`apps/api/src/modules/auto-docs/forms.ts:325`. Detection reads only `w:t` text. `attachedTemplate` with an external target, `DDEAUTO` field codes, OLE links and macro-enabled parts pass through the fill unchanged and the org emails the result to Business Users from its own SMTP. Fix: `screenDocxPackage()` in `docx-package.ts` that refuses external relationships (except hyperlinks), vba and OLE content types, and DDE/INCLUDE field instructions.

### M8. Zip guard trusts declared sizes

`apps/api/src/lib/auto-doc-fill/render.ts:113`. The 32 MiB check sums central-directory sizes; PizZip inflates `[Content_Types].xml` in full before comparing, and typed-array memory is outside the worker's 256 MB heap cap. Fix: verify every entry with bounded `inflateRawSync` at upload and again before the fill; cap entry count.

### M9. Advanced settings repoint storage, doc engine and BASE_URL

`apps/api/src/modules/advanced-settings/config.ts:79`. Saved values override the deployment environment; `http` is accepted; the change is audited without values. A hijacked Administrator session redirects every future upload to an attacker's S3 or Azure endpoint after the next restart. Fix: any key set non-empty in the baseline is pinned; require `https` unless on an allow list; log old and new hosts; step-up auth on these PUTs.

### M10. Connectors select outbound destinations

`apps/api/src/lib/ai/http.ts:134`, `apps/api/src/lib/signing/docusign.ts:349` and `:464`, `apps/api/src/modules/ai-connector/routes.ts:114`. AI requests follow redirects with the API key; the connector test echoes upstream error bodies; DocuSign account discovery accepts any non-empty `base_uri` and sends the bearer token and documents there. Fix: `redirect: "error"` on every connector fetch (models.ts already does), allowlist the DocuSign estate, do not echo upstream bodies.

### M11. Per-request conversions and unbounded live connections

`apps/api/src/modules/comments/routes.ts:1661`, `apps/api/src/lib/event-hub.ts:64`, `services/doc-engine/src/server.ts:305`. A comment-attachment preview calls `convertToPdf` on every GET with no cache and no admission control; SSE subscribers are an unbounded set. Fix: cache renditions, put conversions behind a bounded semaphore, cap SSE per user and per process, add container CPU, memory and pids limits.

### M12. Portal write paths have no per-user cap

`apps/api/src/modules/auto-docs/generations.ts:318`, `apps/api/src/modules/requests/routes.ts:390`. Each Generation spawns a fresh worker thread, a blob, a PDF conversion and an email; each Request fans out to every Member. DEPLOYMENT.md delegates this to the proxy, which cannot key on the account. Fix: fill concurrency semaphore, pending-Generation cap per person, Request count and byte quota per person.

### M13. Password reset keeps old sessions alive

`apps/api/src/auth/instance.ts:288`. `revokeSessionsOnPasswordReset` is not set; a stolen cookie survives the victim's recovery. Fix: set it, and close that user's SSE subscriptions on reset.

### M14. No Origin or CSRF check on `/api/v1` mutations

`apps/api/src/auth/guards.ts:56`, `apps/api/src/modules/comments/routes.ts:941`. SameSite=Lax stops cross-site POSTs, and JSON needs a preflight. Neither covers a same-site sibling origin (`other.example.com`) posting a multipart form to `/api/v1/comments` or an upload route with the victim's cookie. Fix: one preHandler that refuses unsafe methods whose `Origin` (or `Sec-Fetch-Site`) is not the configured BASE_URL origin, exempting the webhook and auth handler.

### M15. Listener published on all interfaces

`compose.yml:100`. `0.0.0.0:3000` by default; Docker bypasses ufw. This is what makes H3 and H4 reachable around the proxy. Fix: `"${APP_BIND:-127.0.0.1}:${PORT:-3000}:3000"`, document `APP_BIND` for a proxy on another host.

### M16. Unbounded connector reads

`apps/api/src/modules/auto-docs/generations.ts:212`, `apps/api/src/pipeline/generation-delivery.ts:152`, `apps/api/src/lib/signing/docusign.ts:364` and `:586`. Template and attachment reads buffer whatever storage returns; DocuSign responses use unrestricted `text()`/`json()`; the executed-copy timer is cleared once the stream starts. Fix: count bytes as they arrive against the configured ceiling; keep an idle deadline through the whole stream.

## Low and Info findings

Titles and locations are in the table above. The full scenario and fix for each is in `~/.cache/openlaw-secreview/workflow-confirmed.md` and `codex-report.md`. The ones worth a ticket before launch:

- L2, L3, L4: three portal-side ways to widen an audience by one person (approval ask to any Business User, self-declared Department, adding any account to an open record). Each is inside the decided product model but none is logged as an audience change.
- L14: pin LibreOffice's macro security level and disable link updates in the sidecar's user profile.
- L20: the credential envelope's plaintext fallback should be removed once every install has resealed; use the row id in the AAD.
- L22: AI-extracted values land in fields before review; the `ai_unverified` marker exists, so the fix is a UI review gate, not new storage.
- L26: generate the Postgres password at first boot and give the app a non-superuser role.
- L34: the 0138 backfill deserves a Legal-visible activity entry and an upgrade note.

## Refuted

Verifiers killed five workflow findings. Recorded so nobody re-raises them:

- pdf.js eval-based PostScript compilation: pdfjs-dist 6.3.289 is not affected by CVE-2024-4367 and `isEvalSupported` is not reachable with attacker PDFs through the viewer as mounted.
- Sidecar stderr shown to staff as comparison failure text: the text is bounded and holds no secret.
- Anonymous intake text reaching every Member's bell: intake links require a session in this tree; the finder's premise was wrong. Codex noted the same: "the anonymous-intake premise does not match this tree."
- Compiled product manual reachable without a session: by design.
- Legal-tagged Fields shown on Portal request forms, and re-tagging a Field from Legal to Business exposing values: the tag is enforced at attach time and re-tagging is an Administrator action inside the decided model.

## Where the two reviews disagreed

- H6 (approval packet): Codex read DECISIONS-CONTRACTS.md:584 as an intentional grant and did not report it. The workflow's verifiers confirmed the document-flag gap and the self-ask path. Kept as High because the decision does not cover DOC-008 flags.
- H4 severity: Codex rated the XFF issue Medium; the workflow rated it High because password sign-in has no per-account lockout at all. Kept High.
- M1: Codex rated Argon2-before-lookup High; the workflow rated it Medium. Kept Medium: it is a CPU DoS, not a data read.
- H2 (portal Knowledge): workflow finders did not find it. Codex did. Verified by hand.
- H3 (setup claim): workflow named it only as a follow-up under M15. Codex reported it as a finding. Verified by hand.

## Checked and found clean

Both reviews agree on these. "Clean" means no substantiated defect on the reviewed path.

- Authentication: public sign-up disabled, Argon2id, hashed verification identifiers and magic-link tokens, 2FA enforcement in both the typed guard and the better-auth before-hook, admin plugin surface closed, SSO management admin-gated, JIT provisioning restricted to Business Users on allowed domains, archived users refused at session mint and on every guard.
- SQL: all 116 raw `sql` fragments read; user values are bound; sort and operator fragments come from constants.
- XSS: HTML and SVG never previewed inline; previews carry `default-src 'none'; sandbox` and `nosniff`; email bodies go through an allowlist sanitizer; comments render as text; the two `dangerouslySetInnerHTML` sites are compiled documentation and a generated TOTP QR.
- DOCX and XML: bounded part expansion, no external entity resolution, restricted docxtemplater resolver, isolated worker with timeout (subject to M7 and M8).
- Doc engine: argument arrays not shell, format validation, process timeouts, scratch cleanup, read-only container, cap_drop ALL, no-new-privileges, internal network with no route to Postgres.
- Webhooks: HMAC-SHA256 over the raw body, constant-time compare, locked row transitions that ignore replays.
- Storage: restricted key segments, traversal refused, local driver resolves beneath its root, no public signed URLs.
- Secrets at rest: AES-256-GCM with random nonces, key required and length-checked at boot, rotation with reseal, OAuth tokens encrypted (subject to L20).
- Web: no session token in web storage; login redirects are fixed internal paths; no source maps or hostnames in the bundle.

## Pre-launch checklist

1. Fix H1, H2, H6 (three guard calls and two predicates) and add the role-matrix tests each fix names.
2. Fix H4 and M3 together: `TRUSTED_PROXIES` into better-auth and Fastify, per-account sign-in lockout, nginx recipe corrected.
3. Fix H5: logger serializer and redact list, `loggable()` helper, NUL stripping, token in the URL fragment.
4. Fix H3 and M15: bootstrap token on first boot, loopback bind by default.
5. M1, M2: shared auth limiter on the typed routes; hash after lookup.
6. M13: `revokeSessionsOnPasswordReset: true`.
7. M14: one Origin check preHandler on `/api/v1` unsafe methods.
8. M4, M5, M6: three reach predicates on side-door reads.
9. M7, M8: DOCX screening at upload and bounded inflate.
10. M9, M10, M16: pin deployment-set advanced settings, `redirect: "error"` on connectors, DocuSign estate allowlist, byte counting on reads.
11. M11, M12: rendition cache, conversion semaphore, per-person portal quotas, SSE caps, container resource limits.
12. Record the audience-widening decisions (L2, L3, L4, L34, H6's Business User approver case) in the decision records so the next reviewer does not re-open them.
