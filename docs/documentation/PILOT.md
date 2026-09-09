# Intake guide pilot

Task: [#728](https://github.com/juggernog20/OpenLaw/issues/728). The pilot follows one
Contract-targeting form across Administrator, Business User, and Legal Team Member
sessions. Its four canonical articles are still in review, and their full
C09/C12/C13/C40 scenarios remain unverified. The TECH-027 publication record makes
them available in the development app with a validation-in-progress article badge. That
availability is not verification. Passing this bounded pilot does not complete those
coverage groups.

## Articles and handoff

| Canonical article                                                    | Pilot scope                                                                                                                        | Owning batch and remaining coverage                                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Configure request types and forms](../user-guides/request-forms.md) | Create a Contract-targeting form with a required Field                                                                             | DOC-021 / #741: Matter and no-target configuration, guidance links, archive/target changes, and full V-C40 checks                    |
| [Submit a Request to Legal](../user-guides/submit-request.md)        | Required-field refusal, one successful PDF attachment, saved answers, and a Portal reply                                           | DOC-012 / #732: guidance variants, partial upload failure and recovery, full V-C09; follow-up and Knowledge remain separate articles |
| [Assign and triage Requests](../user-guides/triage-requests.md)      | Review, assign, and comment before conversion                                                                                      | DOC-013 / #733: reassignment/clearing, other eligible readers, Resolve, historical declined outcomes, races, and full V-C12          |
| [Convert a Request to a Contract](../user-guides/convert-request.md) | Selected Contract type, carried Field, promoted Document, Legal Only, Working Team and Full Thread visibility; Portal continuation | DOC-013 / #733: Matter path, module-only and archived targets/references, required gaps, non-carrying Fields, races, and full V-C13  |

Extend these files and retain their IDs. The conversion title is deliberately
limited to the Contract path until DOC-013 adds and verifies the Matter instructions.
Catalog ownership has not moved to the pilot. Do not create duplicate pilot articles
or mark a whole article verified from the subset evidence below.

## Committed application and fictional data

The isolated `pilot` lab uses app commit
`d1d098ba9f4ba6557a542857d530446b76b1847c`, after Help merged. It was created on
September 7, 2026 at 01:59 UTC and seeded with Helix light profile, random seed 7.
Its Docker project is `openlaw-docs-b8e31260-pilot`; app port 43301 and Mailpit port
48426 bind to loopback. AI is disabled and signing is unconfigured. The existing
authoring lab and the user's development stack are separate.

Daniel Okafor configures the form, Jonas Weber submits through a fresh Portal magic
link, and Nadia Haddad triages it. Each has a separate browser context. The MSA type
already has the Owning department Field; the pilot form collects it as required.
Examples use Procurement, fictional Northstar evaluation terms, and a generated
one-page PDF. Each replay gives the form and Request a unique suffix. Failed harness
attempts left their own fictional records; the evidence names the successful run.

Use [VALIDATION.md](VALIDATION.md) for lab creation, account entry and Mailpit use.
No cookies, magic links, private lab configuration, or raw browser traces belong
in this directory. The sanitized records below contain no authentication material.

## Author checks

[Author walkthrough](pilot/author-walkthrough.json) records the actual article hashes,
app commit, roles, times and results. The successful run follows Settings entry,
form creation and required-field configuration; refuses missing answers; submits
the Request and PDF; assigns triage; posts Full Thread, Working Team and Legal Only comments;
converts; opens the Contract's Fields and Documents sections; and downloads the
promoted Document Version. Its bytes match the original PDF. The Contract's Owner
remains unset, the decided Request leaves the Inbox, and the Business User's direct
staff Contract link returns to the Portal. The original Portal Request retains its
Full Thread conversation and excludes the Working Team and Legal Only notes.

[Author discovery](pilot/author-discovery.json) records four actual queries and their
answers: form target, submit request, assign request, and convert request. The
appropriate header Help topics, section focus and formal-documentation links work.
All four articles fit Light, Dark and Warm at 1440 and 320 CSS pixels. The signed-out
formal index contains all four drafts and makes no API request. Search stays local.

Discovery used a Vite development preview of the working Markdown at port 43310,
with unchanged app source and a proxy to the committed lab. This is preview evidence,
not evidence of normal publication, release compatibility, a human user study, or
the complete shared V-HELP acceptance suite.

## Review and independent walkthrough

Both review seats have run for the bounded pilot. The feature owner's human technical
review is still pending, and the full owning-batch scenarios remain unverified. Keep
the articles in review until those pass, even though the pilot subset passes.

### Agent technical verification

On September 7, 2026 the Fable review seat checked every quoted control label and
behavioral claim in the four drafts against the app source at commit
`d1d098ba9f4ba6557a542857d530446b76b1847c` and its message catalog. Two steps named
a control loosely. The triage guide now says select Comments and use the comment box.
The submission guide now names the Attach new files to a reply link and the Reply to
Legal composer. These are copy-only corrections. No action, prerequisite, result or
meaning changed, so the author records above stand for the tested bytes. This check
is an agent source check, not the feature owner's technical review.

### Independent agent walkthrough

[Independent walkthrough](pilot/independent-walkthrough.json) records the Fable
review seat's own run on September 7, 2026, from 02:47 to 02:58 UTC. It is a
different agent from the author. It read the four guides and wrote its own browser
steps against the same committed lab, with a fresh uniquely named form and Request
and separate Administrator, Business User and Legal Team Member contexts. Every
pilot outcome passed: the saved form configuration, the required-field refusal, the
PDF attachment, assignment, the three comment tiers, the carried Field, the retained
Request Description, the byte-identical promoted Document Version, the Contract
comments, the Inbox removal, the Portal continuation at the same R- address, and the
staff-access refusal. Discovery through the header Help topics, local search, section
focus and the formal reader passed for all four articles, and the signed-out formal
index listed all four with no API request.

The walkthrough found one prose error. The conversion guide told the reader to edit
Priority in the dialog and said a configured Contract type is already selected. The
dialog shows both as fixed text. The guide now says the dialog does not change
Priority and that a configured type cannot be changed there. The record holds the
tested and the corrected convert-request hashes. It is an agent walkthrough, not a
human user study, and it does not stand in for the feature owner's approval.

The author discovery checks used a draft preview at `http://127.0.0.1:43310`. It is
not a durable service. Recreate it from the repository root with Node and installed
workspace dependencies:

```sh
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = process.cwd();
const require = createRequire(resolve(root, 'apps/web/package.json'));
process.env.OPENLAW_DOCS_PREVIEW = 'true';
process.env.OPENLAW_DOCS_FIXTURE = 'false';
const { createServer } = await import(require.resolve('vite'));
const server = await createServer({
  root: resolve(root, 'apps/web'),
  configFile: resolve(root, 'apps/web/vite.config.ts'),
  server: {
    host: '127.0.0.1', port: 43310, strictPort: true,
    proxy: { '/api': {
      target: 'http://127.0.0.1:43301',
      headers: { origin: 'http://127.0.0.1:43301' }
    } }
  }
});
await server.listen();
JS
```

This fails if the preview port is occupied. Stop only the owned preview process
when finished. The lab stays on its committed source; do not edit its snapshot or
deployment configuration to inject draft guides.

## Rework and template changes

- The Settings entry needed the profile-menu step. Creating a request type uses
  its row's Edit control; the display name is not an editor link.
- The confirmation says Open request. The Portal composer says Reply to Legal and
  Send; the legal-side composer says New comment and Comment.
- Comment audience controls use Full thread and Legal only. Prose still uses the
  glossary's Full Thread and Legal Only names for the concepts.
- Carried answers are in the Contract's Fields section, and its paper is in Documents.
- A Legal Team Member should not be instructed to become the Requester to complete
  their procedure. Describe the other role's outcome, or name a separate actor.
- The conversion dialog shows Priority and a configured Contract type as fixed text.
  A guide must not tell the reader to edit a value the dialog only states.
- The comment composer opens with Working team selected. The triage guide's explicit
  Full thread instruction and audience warning are necessary, not optional.

The how-to template now asks for the complete entry path, exact saved-state check,
and named actor for a role handoff. Harness repairs for asynchronous saves, router
completion, hidden radio inputs, and selected option assertions are recorded as
automation work, not user task difficulty. One rapid-navigation attempt lost an
Assign dialog while the page changed; the successful run reads the Request and
downloads its attachment before assignment. This is an unresolved timing observation,
not an established cause or a reason to claim a reader needs a fixed delay. Related
navigation investigation: [#751](https://github.com/juggernog20/OpenLaw/issues/751).

## Effort and remaining estimate

The authoring, source/UI reconnaissance, lab preparation and harness revision window
ran from 01:59 to 02:22 UTC on September 7, about 23 minutes. Those activities
overlapped; separate productive-time totals were not instrumented. The successful
automated walkthrough and query timings are in the records. They exclude reading,
writing and review, so they are not estimates of human task time or writing throughput.
The review seat's measured effort follows. The agent source check and its copy
corrections ran from the pilot commit at 02:31 UTC to the fix commit at 02:43 UTC,
about 12 minutes. The independent walkthrough ran from 02:47 to 02:58 UTC, about 10
minutes, of which the browser stages used about four minutes; three of those minutes
were selector timeouts in the reviewer's own script. Evidence writing and this
update were not instrumented. Integration timing is recorded when the task merges.

There are 52 untouched articles, four draft expansions, and 16 remaining writing
batches (DOC-009–024). The unchanged full registry has 58 scenarios and 131
role/method combinations, including the shared Help/offline checks. No combination
is credited as fully verified by this pilot.

For capacity planning, use the following provisional allowances, not a promised
completion date or an extrapolation from the automated replay:

| Work remaining                                        | Allowance           | Basis and uncertainty                                                                                  |
| ----------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| Source checking, authoring and revision               | 35–60 focused hours | 52 new articles plus four expansions; analysis, signing and operations need more setup than this pilot |
| Independent article walkthroughs and technical review | 20–40 focused hours | Separate actors, negative cases and provider/operator environments; the author cannot fill this seat   |
| Batch integration and review fixes                    | 8–16 focused hours  | 16 sequential PRs, two review passes per batch, checks and fixes                                       |
| Complete acceptance, maintenance and publication      | 8–16 focused hours  | DOC-025–027, retained export and full coverage audit                                                   |

The resulting 71–132 focused hours are a planning allowance. External-account waits,
reviewer availability and CI queue time are additional elapsed time. Re-estimate
after DOC-009 and DOC-013 provide a complete ordinary batch and the remaining intake
variants. Do not assign calendar dates until owners, reviewer capacity and target
release are fixed. Real provider access remains unconfirmed for DOC-022.
