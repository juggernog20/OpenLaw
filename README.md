# OpenLaw

Open-source, self-hosted legal operations platform: contract lifecycle management, matter management, legal intake, entity management, and knowledge for in-house legal teams.

> Status: pre-alpha. The product and technical decision records in [`docs/`](docs/) are the source of truth.

## Repository layout

```text
apps/api      Fastify REST API (OpenAPI-described)
apps/web      Vite + React SPA (staff app + requester portal)
apps/worker   Background jobs (pg-boss)
services/     Sidecar containers (doc-engine: LibreOffice + OCR)
packages/     Shared types and utilities
styles/       Theme substrate (Tailwind v4 CSS-first, three themes)
docs/         Product & decision records (DECISIONS*.md, PRODUCT.md, SCHEMA.md)
designs/      Pencil (.pen) design files
```

## Development

Requires Node ≥ 24 and pnpm.

> **Note on TypeScript:** `tsc` is TypeScript 7 (native compiler) via the `@typescript/native` alias, while the `typescript` package name resolves to Microsoft's TS 6 API compat shim so typescript-eslint keeps working. This is deliberate and temporary — see TECH-015 in [`docs/decision-records/DECISIONS-TECH-STACK.md`](docs/decision-records/DECISIONS-TECH-STACK.md) before touching either alias.

```sh
pnpm install
pnpm dev:hot    # the hot-reload loop: backing services in Docker, apps in watch mode
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

### The hot-reload loop

`pnpm dev:hot` is the day-to-day loop (TECH-018): Postgres, the doc engine, and Mailpit run as containers with their ports published to the host, and the three apps run as watch processes beside them. Browse it on **<http://localhost:5173>** — the Vite dev server. It proxies `/api` to the API on 3000, so the session cookie stays same-origin (TECH-008), and a saved `.tsx` reaches the browser without a reload.

| What                              | Where                                              |
| --------------------------------- | -------------------------------------------------- |
| Web (Vite, hot module reload)     | <http://localhost:5173> — **browse here**          |
| API (tsx watch, restarts on save) | <http://localhost:3000>                            |
| Mail — every link the app sends   | <http://localhost:8025> (Mailpit)                  |
| Postgres                          | `127.0.0.1:55432` — the built stack's own database |

Two things to know about it. Emailed links point at `http://localhost:3000`, because that is the origin the API is configured for; open one on 5173 by changing the port by hand. And uploaded files go to `.storage/` in the repo rather than to the stack's volume, which the container's user owns — so a file uploaded here is not visible to `pnpm stack`, or the other way round. The database _is_ the same one, so accounts and every record are shared.

### Seeding a demo instance

`pnpm seed:demo` fills a running dev loop with a whole fictional company, Helix Software Group: a legal team of twelve, thirty group entities, a contract pipeline across every stage, matters, an intake queue with triage history, and a knowledge library. It exists for design and UX review, where an empty instance tells you nothing and a hand-made record or two tells you almost as little.

```sh
docker compose -f compose.yml -f compose.dev.yml down -v   # start from nothing
pnpm dev:hot
pnpm seed:demo                          # about 180 contracts, 90 matters, 70 requests
pnpm seed:demo --scale medium           # a third of that, for faster reseeding
pnpm seed:demo --seed 42                # a different but equally repeatable instance
```

Sign in as `blair@helix.example` with `correct-horse-battery`. Every seeded person shares that password; the Business Users sign in through a magic link instead, which lands in Mailpit.

Everything goes through the HTTP API as the person who would have done it, so the instance has the activity entries, notifications and numbering a real one has, and nothing is written behind the app's back. The seed also runs its own OpenAI-compatible stand-in for the length of the run, so a slice of the contracts carry genuine CTR-008 Analysis runs with the Unverified marker on them. The connector is switched off when the run ends, because the stand-in dies with it.

E-signature is opt-in, because the DocuSign driver takes its host from the environment rather than from the connector row (TECH-013). Start the loop in stand-in mode and ask for the phase:

```sh
SIGNING_STANDIN=true DOCUSIGN_BASE_URL=http://127.0.0.1:8129 pnpm dev:hot
pnpm seed:demo --with-signing
```

That sends real Envelopes through the real driver: some still out, some signed with the executed copy pulled back onto the document chain, some declined, some voided. The connector is switched off at the end for the same reason as the AI one. To make signing work again while you review, run `node scripts/seed/signing-stub.mjs` and turn the connector back on in Settings.

It writes a lot and cleans up nothing. Point it at a database you are willing to lose. Dates are anchored to the day it runs, so deadlines stay overdue, due and upcoming however long ago you seeded. A heavy run takes two to three minutes on a laptop; the long pole is the seed waiting on the document queue, because an Analysis run cannot start until the text extraction it reads has finished.

`pnpm dev:infra` brings up only the containers, for when you start the watch processes yourself; `pnpm dev:infra:down` stops them. Ports move with `POSTGRES_PORT`, `DOC_ENGINE_PORT`, `MAILPIT_SMTP_PORT`. All of it is [`compose.hostdev.yml`](compose.hostdev.yml) plus [`scripts/dev-hot.sh`](scripts/dev-hot.sh), and none of it touches what a deployment runs.

Everything E2E and every milestone acceptance runs against the built Compose stack instead (TECH-018):

```sh
pnpm stack        # build, start, then follow the logs
pnpm stack:logs   # follow the logs of an already-running stack
pnpm stack:down   # stop it (add -v by hand to drop the pg volume)
```

`pnpm stack` leaves the containers running in the background, so Ctrl-C detaches from the logs rather than stopping the stack — the instance's accumulated state survives between sessions. All three wrap `docker compose -f compose.yml -f compose.dev.yml`.

The Playwright suite in [`e2e/`](e2e/) targets that stack's origin (`E2E_BASE_URL`, default `http://localhost:3000`) and needs no cleanup between runs — the instance's accumulated state is part of the point:

```sh
pnpm --filter @openlaw/e2e exec playwright install chromium   # once
pnpm e2e
```

## Continuous integration

Four workflows in [`.github/workflows/`](.github/workflows/). A fork gets the process along with the code — nothing here depends on a check that lives outside this repository.

| Workflow       | What it guards                                                                                                                                             | Blocking                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `ci.yml`       | Format, lint, typecheck, unit tests, the built-image E2E gate (TECH-018), and the upgrade-fidelity job that proves a populated install survives an upgrade | Yes                                 |
| `i18n.yml`     | `messages/en-US.json` still matches what the extractor writes (DES-013)                                                                                    | No — it reports on the pull request |
| `codeql.yml`   | Static analysis of the JavaScript and TypeScript                                                                                                           | Yes                                 |
| `security.yml` | Dependency review and secret scanning                                                                                                                      | Yes                                 |

Both stack gates have a local command: `pnpm e2e:local` for the browser suite, `pnpm upgrade-fidelity` for the upgrade job. Each runs in its own compose project, so neither touches the instance you develop against.

The i18n job is deliberately non-blocking. en-US is the only v1 locale and the `defaultMessage` at each call site is the runtime catalog, so a stale file breaks nothing today. It becomes the file translators work from the day a second locale ships, and the check is already running and quiet by then.

## Deployment

`docker compose up` from a clean Linux VM is the whole story — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the quickstart, the reverse-proxy contract, upgrades, and backups.

## License

[AGPL-3.0-only](LICENSE)
