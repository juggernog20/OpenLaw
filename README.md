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
pnpm dev        # run all apps in watch mode
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Day-to-day iteration runs the apps as local watch processes; everything E2E and every milestone acceptance runs against the built Compose stack (TECH-018):

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

## Deployment

`docker compose up` from a clean Linux VM is the whole story — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the quickstart, the reverse-proxy contract, upgrades, and backups.

## License

[AGPL-3.0-only](LICENSE)
