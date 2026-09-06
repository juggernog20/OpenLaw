# CI checks

Every PR and every push to `dev` or `main` runs static checks, the complete API
and web test suites, OpenAPI regeneration, browser E2E and an upgrade rehearsal.
Manual runs use the same coverage. The i18n and security workflows remain separate.

API and web tests each run in two Vitest shards, on separate runners. Each file
belongs to one shard; assertions and per-file isolation are unchanged. The API
retains its per-suite PostgreSQL containers. The existing **Lint, typecheck, test**
status aggregates static checks and all four shards, and fails if any prerequisite
fails, is cancelled or is skipped. E2E, OpenAPI and upgrade retain their separate
check names. Require all four statuses if enforcing them through branch protection.

`pnpm check` still runs the complete local check. `pnpm check:static` runs formatting,
secret scanning, contrast, migration-journal and version checks, lint and typecheck.
`pnpm test:ci-tools` tests upgrade-baseline selection against temporary Git repositories.
To reproduce one shard:

```sh
pnpm exec turbo run test --filter=@openlaw/web -- --shard=1/2
```

When adding a workspace with a `test` script, add it to the CI test matrix as well.
When changing the shard count, update both the matrix and the shard denominator.

## Caches and images

The workspace setup action persists `.turbo/cache`, separately for each job, with
Node-version and commit-specific keys and restore prefixes. Turbo checks task hashes
after restoration. Builds, lint and typecheck can be replayed; tests have caching
disabled because their container dependencies are not fully described by task hashes.
Tests run on every candidate, even when all build outputs are restored.

Buildx imports Docker layers from Actions caches. E2E writes the candidate app and
doc-engine caches; API shards and the upgrade candidate read them. The upgrade job
writes separate baseline caches. Each build still evaluates the checked-out source
through the real Dockerfile. Bake reads the same two Compose files as deployment
testing, builds the app and doc-engine, and loads the images into Docker. The worker
uses the app image; Compose starts with `--no-build` so it runs those built images.

API shards set `DOC_ENGINE_TEST_IMAGE` to the locally built sidecar. Turbo declares
that variable so strict environment filtering does not discard it. Local tests
without the variable continue to build the sidecar themselves.

Cache misses affect speed only. Cache mounts inside Docker are not persisted by
this configuration. Cache scope versions can be bumped to discard old entries;
retention and GitHub's repository cache limit determine how much survives between runs.

## Upgrade baseline

The baseline is resolved to an immutable SHA before checkout. The newest stable
`vMAJOR.MINOR.PATCH` tag distinct from the candidate wins. Before a release exists,
PRs use their recorded base SHA and pushes use the event's previous SHA. A manual
run uses `origin/dev`, or the candidate's first parent when dev is the candidate.
No rehearsal silently compares a commit with itself.

Local `pnpm upgrade-fidelity` uses the same selector and the locally fetched tags
and `origin/dev`; fetch first when those refs are stale. `BASELINE=<ref>` explicitly
selects a local baseline, but cannot select the candidate itself. A repository with
no distinct baseline fails selection rather than claiming to have tested an upgrade.

## Measuring changes

Each test shard uploads a seven-day `timings-*` artifact containing Turbo's run
summary. Actions records the separate preparation and test steps, and the upgrade
job summary records the two revisions. Compare the slowest required job across
several cold and warm runs on the same runner class. Sharding reduces elapsed time
by allocating more runners; it does not promise a proportional reduction in total
runner time.
