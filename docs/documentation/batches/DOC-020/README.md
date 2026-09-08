# Administration guide verification

Three canonical guides cover C35–C37 for [#740](https://github.com/juggernog20/OpenLaw/issues/740): first-run setup, organization/users, and authentication/email. Author walkthroughs are complete. Independent technical review and the four scenario/role walkthroughs are also complete: V-C35 Administrator, V-C36 Administrator, and V-C37 Administrator plus operator responsibility. The catalog remains in feature review for DOC-025 acceptance and DOC-027 publication/export.

## Build and method

The unseeded `admin-onboarding` fixture runs immutable app source `6a8873dbda333fd9992eb77525d4bfa3f47af20d`, app image `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`, engine image `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7`, in project `openlaw-docs-b8e31260-admin-onboarding`. App/mail ports are 43321/48433; the draft Help preview uses 43324. No demo seed was applied: Avery Morgan was created through the first-account form. Rowan Lee is an invited colleague, Quinn Park a fictional Business User, and Taylor Moss a withdrawn invitation.

The separate unseeded `admin-email` fixture uses the same source/images in project `openlaw-docs-b8e31260-admin-email`, app/mail ports 43327/48434. Sage Cole is its first Administrator. Its unfinished welcome wizard permits actual email-pane checks through three recorded deployment phases. Original snapshots, base configuration, and volumes are retained. Each phase uses a separate immutable overlay, with the applied configuration hashes and actual application time recorded alongside the browser result. The complete stored relay existed before both environment phases. The owned Entity and Knowledge lab containers/networks were stopped without deleting volumes to make room; unrelated stacks and occupied ports were untouched.

OpenID Connect uses a dedicated local `oauth2-mock-server` 9.1.0 service: discovery, authorization, token, JWKS and userinfo are HTTP endpoints. The browser visits authorization and returns through OpenLaw's real callback. Both the token and userinfo assert the same fictional subject/email. This verifies OpenLaw's OIDC integration; the fixture does not test an external provider's client-secret or account policy. No SAML support or external provider certification is claimed. Mailpit receives real local SMTP messages without outbound delivery.

Browser actions operate the reader controls. API calls prepare the explicitly named offboarding records and corroborate saved state. Separate contexts represent each identity. Every result captures the guide hashes at its start, actual UTC timestamps around awaited actions, and the app build identity. These are agent walkthroughs, not human user studies or feature-owner approval. No screenshots are necessary for these text procedures.

## Author records

| Record                                             | Successful checks |
| -------------------------------------------------- | ----------------: |
| [setup](author-setup.json)                         |                 7 |
| [users](author-users.json)                         |                 6 |
| [auth](author-auth.json)                           |                 5 |
| [auth-complete](author-auth-complete.json)         |                 2 |
| [offboard-complete](author-offboard-complete.json) |                 2 |
| [email-env](author-email-env.json)                 |                 1 |
| [email-incomplete](author-email-incomplete.json)   |                 1 |
| [email-stored](author-email-stored.json)           |                 1 |
| [discovery-final](author-discovery-final.json)     |                 4 |

There are 29 successful author checks. The initial authentication record retains one failed browser-harness assertion: Playwright's `uncheck` expected an immediate state change from an asynchronously saved switch. The completion record uses a click and waits for the saved result, then verifies both Portal SSO and Administrator password recovery. A further failed attempt, retained only in the local run records, corrected an exact-text locator for the longer closed-link explanation; it is not represented as a passing result.

Setup checked mismatched passwords, corrected submission, unconfigured OIDC refusal, saved-domain persistence on reload, invalid and unreachable SMTP relays, successful replacement/test delivery, Clear relay, invite delivery, Finish and the completed-wizard redirect. The guide distinguishes a middle-step skip from finishing onboarding and does not describe the expanded M33 wizard absent from this baseline.

Users checked name/logo/timezone persistence, unsaved-name cancellation, the single available locale, last-Administrator demotion refusal and absent self-archive control, invalid/resend/revoke invitations, activation, denied administration for a Legal Team Member, live role changes, session revocation, archive sign-in refusal, and restore without reviving revoked sessions. Separately prepared Contract and Matter records demonstrated that archival retains their assigned person; their Owner and Matter Manager were then explicitly reassigned through record controls before another archival. Task, Obligation and Approval procedures link their existing guides rather than inventing a bulk transfer action.

Authentication checked built-in magic-link locking, domain additions/removal, actual allowed-domain Portal entry and denied-domain neutral responses without a session or email, failed OIDC discovery, registration, full staff SSO with role retention, provider update with a blank secret, failed-issuer rollback, secret replacement, Portal entry through SSO with magic links off, and Administrator password recovery. Email phases verified a read-only environment override with a real invitation from its sender, an incomplete environment relay overriding valid stored settings, and recovery to the stored sender after removing the override and recreating app/worker.

Help checks covered all three titles, focused headings/outline links, formal links, keyboard focus, three themes at 320/720/1440 CSS pixels and emulated 200 percent zoom, plus signed-out formal discovery with zero app API requests. The first-run title was searched from the unfiltered Help index; the other two also appeared in their page contexts. A completed instance redirects `/auth/setup` to sign-in, so first-run contextual discovery on a genuinely fresh instance remains for the independent reviewer. An earlier private discovery attempt mistakenly searched first-run within the unrelated General topic; the final run used the Help index to clear that filter.

Some author records predate narrow copy corrections: the explanation of automatic staff provisioning was removed, duplicate pending invitations were distinguished from active accounts, and the offboarding links now point directly to Matter setup and Entity Obligations. The records retain their actual hashes; the independent seat must use the final guide bytes.

Reviewer corrections landed after those records, checked against current app source. The allowed-domain list is read at every magic-link sign-in (`isEmailDomainAllowed` in `apps/api/src/lib/org-settings.ts`), so both guides now state that emptying it or removing a domain also stops existing Business Users, not only new ones. The invite Role choice is quoted as the visible label "Legal team member". The invite refusal for a pending address named with a different role, and for a Business User's address, is now described. The Users table Role control is recorded as offering the fourth `business_user` value that the invitation form withholds, and a role change is stated to apply on the target's next action. The `evidence/*.json` content hashes were recomputed for these bytes; their status stays `not-run`, so no verification is claimed for them.

## Independent review

A separate seat repeated the acceptance work on its own fixture. It read no author record as evidence: every claim below rests on its own browser actions. The unseeded `admin-review` fixture ran the same immutable source `6a8873dbda333fd9992eb77525d4bfa3f47af20d` and the same app and engine images in project `openlaw-docs-b8e31260-admin-review`, app/mail ports 43328/48435, local OpenID Connect on 43329 with its identity control on 43330, and the draft Help preview on 43331. `apps/web` is byte-identical between that commit and this branch head, so the preview renders the same application behaviour as the image while serving the current guide bytes.

The fixture had no users when this seat began, so first-run was walked properly: `/auth/setup` contextual Help was observed **before** any account existed, which a completed instance can no longer show. Devon Ashcroft was created through the first-account form. Priya Raman, Tomas Novak, Marisol Vega and Ingrid Sollberg are staff fixtures; Hannah Blum and Otto Lindqvist are Business Users on `northwind.example`; Rio Santos is an unapproved address that must not get in.

| Record                                           | Successful checks |
| ------------------------------------------------ | ----------------: |
| [setup](review-setup.json)                       |                 9 |
| [users](review-users.json)                       |                10 |
| [portal](review-portal.json)                     |                 7 |
| [offboarding](review-offboarding.json)           |                 7 |
| [authentication](review-authentication.json)     |                 4 |
| [oidc](review-oidc.json)                         |                12 |
| [email-env](review-email-env.json)               |                 2 |
| [email-incomplete](review-email-incomplete.json) |                 1 |
| [email-stored](review-email-stored.json)         |                 2 |
| [discovery](review-discovery.json)               |                 4 |
| [final-bytes](review-final-bytes.json)           |                 4 |
| [scope](review-scope.json)                       |                 9 |

There are 71 successful independent checks. Fifteen failed attempts are retained in the same records with their errors. Every one was this seat's own harness fault, not application behaviour: a `<select>` assumed where the app uses a searchable timezone combobox and a radio group for the invite Role; set-password field labels guessed before reading them; an emailed link asserted against the preview origin when it correctly carries the deployment `BASE_URL`; a role-menu poll issued from a session that the demotion had just stripped of Administrator rights; a provider poll that caught the delete-and-reinsert update mid-flight; a readiness probe that threw instead of retrying while the app restarted. Each was corrected and only the affected check retried. None is represented as a passing result.

### Deployment phases

Email states that exist only before the wizard is finished were exercised on this seat's own fixture through three immutable overlay files, recreating **only** the owned app and worker. The frozen snapshot, `source/.env` and base `overlay.json` hashes were verified before each phase and never modified.

| Phase        | Overlay sha256                                                     | Observed                                                                                                                               |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `env`        | `55d555a132d1099704fd5da7b8f6c469191b55e1b7ebab0e40da91d4e56f1e82` | Pane read-only, no Save relay or Clear relay, and a real invitation whose envelope From was the environment sender, not the stored one |
| `incomplete` | `ba55151ccfca66a9b666e9e65b9b8169c91b480deb1abd36a89c679d761599eb` | Source held at `env` with a null from address; no message at all despite a complete stored relay                                       |
| `stored`     | overlay removed                                                    | Pane returned to the app relay and delivered from the stored sender                                                                    |

Operator work here is a responsibility carried out with deployment tools and the authorized Administrator interface, not a separate application role.

### What the independent seat changed

Walking the corrected role paragraph turned up something the earlier source review had got wrong. The Users table role control renders only on `Active` rows. A Portal-created Business User reads as Active, so it can be promoted in place, but where no account sits behind that row the promotion leaves it reading **Invited**, without its role control, until that person uses the resent link to set a password. The supplemental scope run below narrows this further: the outcome turns on whether the account has ever been activated, not on it being a Business User. The guide sentence claiming a staff account can simply be returned to Portal-only access was therefore too broad. It now says "an active staff account" and describes the pending-invitation state. [final-bytes](review-final-bytes.json) re-walks the whole promote, resend, activate, revert cycle on a fresh Business User against the final guide bytes, so the corrected wording is verified rather than inferred.

Records written before that correction keep their own earlier article hashes. That provenance is deliberate: they show the bytes each run actually exercised.

### Supplemental scope checks

Two factual-scope questions were raised before merge and answered with one bounded run, [scope](review-scope.json), 9 checks. It is a supplement, not a rerun: the earlier records keep their own hashes and times, and none of their scenarios were re-executed.

The first question was how far removing an allowed domain actually reaches. `user.create.before` in `apps/api/src/auth/instance.ts` runs only for identities with no row yet, so the allowlist check on `/magic-link/verify` and `/sso/callback` never sees an account that already exists, while `magicLinkDenied` gates `/sign-in/magic-link` issuance for everybody. Walked on the fixture with an existing Business User holding both a magic-link history and a linked identity-provider account, removing the domain refused a new magic link, yet the session already held kept working, a link issued before the change and never used still opened the Portal, and a fresh single sign-on round trip in a clean context still reached the Portal. A never-seen address on the same removed domain was refused at the callback with no account created. So the list governs new entry and new link issuance; it does not revoke access. `first-run.md` had claimed OpenLaw "checks the list at every Portal sign-in", which overstated it, and now points at the authentication guide for the exact reach. That guide gained a paragraph separating what narrowing the list does from what it does not, and directs a reader wanting to end one person's access to archival or session revocation.

The second question was the promotion explanation, which asserted that a Business User has never set a password. `activated(userId)` in `apps/api/src/modules/users/routes.ts` counts any `accounts` row, including a linked OIDC account, so the premise does not hold for every Business User. Promoting one that had previously set a password left the row **Active** with its role control intact and no Resend invite offered. The instruction is now conditional on the row state a reader can see: **Active** means keep going, **Invited** means the promotion left a pending staff invitation to activate through the resent link, or through the identity provider where single sign-on is configured. The Active-only role-control observation is unchanged, and the already-recorded activation and role-reversal evidence carries the rest.

The fixture policy was restored at the end of the run: both allowed domains present, the provider scoped back to `helix.example`, and the mode back to Built-in.

One wording clarification followed, with no new walkthrough. The retained-link and single sign-on statements are now scoped explicitly to existing accounts, since `user.create.before` still applies the allowlist to a never-created identity redeeming its first link, so a reader cannot carry the existing-account observation over to first-time entry. The closing instruction now separates the two controls the offboarding record already distinguishes: archival prevents new sign-ins and revokes existing sessions, while **Revoke all sessions** ends sessions and leaves the account able to sign in again. It is recorded as `copyOnlyReview` on the authentication evidence with the prior content hash, not as a fresh scenario.

### Independent limits

Onboarding completion is instance-wide and irreversible, so one instance allows exactly one finishing action. This seat exercised **Set up later** on the final invitation step, the claim a reader is most likely to misread as a skip. **Finish** and the Welcome-step **Set up later** were not independently exercised here. Single sign-on was verified against a dedicated local OpenID Connect fixture with real discovery, authorization, token, JWKS and userinfo endpoints and a real callback; it is not certification of an external provider's client-secret handling or account policy, and it does not satisfy the real DocuSign and AI-provider verification DOC-022 requires. Evidence was taken on fixture commit `6a8873db` rather than the final app candidate, which DOC-025 reconciles.

## Compatibility and remaining checks

The later feature commits since `6a8873db` contain documentation/evidence and a removed unused Knowledge-read column plus comments/tests. No setup, user, authentication or email behavior changed; these records retain the actual older image identity. DOC-025 will reconcile against the final app candidate.

Independent technical review and fresh browser verification are pending, including a fresh first-account wizard. A separate unseeded `admin-review` fixture has been prepared with no users: app/mail 43328/48435, local OIDC 43329 and fixture identity control 43330. Its immutable manifest is `.documentation-labs/admin-review/lab.json`; it uses the same app/engine source as the author fixtures. The draft preview port reserved for it is 43331. The local OIDC fixture does not satisfy the separate real DocuSign/AI-provider verification requirements of DOC-022. Module and operator guide forward links will land in DOC-021 through DOC-024. The user will proofread once the complete suite is assembled.

The author static checks passed all 19 tasks; all 33 documentation/CI tooling tests and normal/preview documentation builds passed. The full uncached workspace suite passed all five tasks in 4m7.297s, including 2,890 API tests and 1,704 web tests, with no concurrent browser walkthroughs. CodeRabbit completed its single pass with five minor copy findings. The logo wording and Task-assignment wording were clarified, and the failed retry is identified as locally retained evidence. Its proposed change from the actual wizard label "Business-user portal" to "Business Portal" was not applied: reader instructions retain the visible label. Its request to turn the proofreader plan into a second-person command was not applied to this internal evidence record. Independent review and final commit CI remain pending.
