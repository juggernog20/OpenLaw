# Administration guide verification

Three canonical guides cover C35–C37 for [#740](https://github.com/juggernog20/OpenLaw/issues/740): first-run setup, organization/users, and authentication/email. Author walkthroughs are complete. Independent technical review and the four required scenario/role walkthroughs remain pending. The catalog remains in feature review for DOC-025 acceptance and DOC-027 publication/export.

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

## Compatibility and remaining checks

The later feature commits since `6a8873db` contain documentation/evidence and a removed unused Knowledge-read column plus comments/tests. No setup, user, authentication or email behavior changed; these records retain the actual older image identity. DOC-025 will reconcile against the final app candidate.

Independent technical review and fresh browser verification are pending, including a fresh first-account wizard. A separate unseeded `admin-review` fixture has been prepared with no users: app/mail 43328/48435, local OIDC 43329 and fixture identity control 43330. Its immutable manifest is `.documentation-labs/admin-review/lab.json`; it uses the same app/engine source as the author fixtures. The draft preview port reserved for it is 43331. The local OIDC fixture does not satisfy the separate real DocuSign/AI-provider verification requirements of DOC-022. Module and operator guide forward links will land in DOC-021 through DOC-024. The user will proofread once the complete suite is assembled.

The author static checks passed all 19 tasks; all 33 documentation/CI tooling tests and normal/preview documentation builds passed. The full uncached workspace suite passed all five tasks in 4m7.297s, including 2,890 API tests and 1,704 web tests, with no concurrent browser walkthroughs. CodeRabbit completed its single pass with five minor copy findings. The logo wording and Task-assignment wording were clarified, and the failed retry is identified as locally retained evidence. Its proposed change from the actual wizard label "Business-user portal" to "Business Portal" was not applied: reader instructions retain the visible label. Its request to turn the proofreader plan into a second-person command was not applied to this internal evidence record. Independent review and final commit CI remain pending.
