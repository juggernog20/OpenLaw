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
