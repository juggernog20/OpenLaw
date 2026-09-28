# Contributing to OpenLaw

OpenLaw is a self-hosted legal operations platform for small in-house legal teams. One maintainer runs it, and CodeRabbit reviews every pull request. This file tells you how a change gets from your checkout into a release.

## Start here

Read these three files before you write code:

- [`docs/decision-records/PRODUCT.md`](docs/decision-records/PRODUCT.md) says what OpenLaw is, who it is for, and what is out of scope.
- [`CONTEXT.md`](CONTEXT.md) is the glossary. It defines each domain term and lists the words to avoid.
- [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) is the build order and shows which milestones have shipped.

Work that the project has deferred on purpose is in [`docs/decision-records/FUTURE-FEATURES.md`](docs/decision-records/FUTURE-FEATURES.md). Check it before you propose a feature.

## Set up and run

You need Node 24 or later, pnpm, and a container engine that Testcontainers can use. Docker and rootless Podman both work. `mise.toml` pins the Node and pnpm versions.

```sh
pnpm install
pnpm dev:hot     # backing services in containers, apps in watch mode
pnpm test
```

The [README](README.md#development) has the details: the hot-reload loop, worktrees, the demo seed, the Compose stack, and the test runtime settings. It is the reference. This file does not repeat it.

## Branches and pull requests

- `dev` is the trunk. Branch off `dev`.
- Open your pull request against `dev`. Never target `main`. `main` receives releases only.
- Keep one topic per pull request.
- Fill in the pull request template. It asks for the change, the validation you ran, and the documentation impact.
- Merge one long-lived branch into another with a merge commit, not a squash. A squash leaves the source branch's commits unmerged, so the next merge between the same two branches conflicts.

## Checks

Run the local gate before you push:

```sh
pnpm check
```

It runs formatting, the secret scan, the contrast lint, the migration journal lint, the version lint, lint, typecheck, and the tests. `pnpm check:static` runs everything except the tests.

CI runs more than the local gate. It also runs OpenAPI regeneration, the browser E2E suite against images built from the real Dockerfiles, and an upgrade rehearsal. [`docs/CI.md`](docs/CI.md) describes each job and how to reproduce one. `pnpm e2e:local` and `pnpm upgrade-fidelity` run the two stack jobs on your machine.

## Code rules

- **SPDX header.** Each new source file starts with a `SPDX-License-Identifier: AGPL-3.0-only` comment on its first line.
- **Vocabulary.** Use the terms in `CONTEXT.md` in code, UI copy, tests and docs. A Request is not a ticket. An Entity is one of our own companies, never a Counterparty.
- **Decisions.** Record a new decision in the numbered files under [`docs/decision-records/`](docs/decision-records/). Each module has its own file, such as `DECISIONS-CONTRACTS.md` for `CTR-xxx` or `DECISIONS-DOCUMENTS.md` for `DOC-xxx`. Append a module decision there. System-wide product decisions go in `DECISIONS.md` as `DD-xxx`, design decisions in `DECISIONS-DESIGN.md` as `DES-xxx`, and stack decisions in `DECISIONS-TECH-STACK.md` as `TECH-xxx`. Do not create one file per decision. Mark a superseded decision as superseded, and do not delete it.
- **Migrations.** Add a table in the same change as the feature that uses it. Generate the migration with `pnpm --filter @openlaw/db generate`. After a migration lands on `dev`, never edit it. The app checks the hash of each applied migration at boot and refuses to start if one has changed. Write a new migration instead.
- **Messages.** `messages/en-US.json` is generated. Do not edit it by hand. Run `pnpm --filter @openlaw/web i18n:extract` after you change UI copy. Give `formatMessage` a literal message descriptor, because the extractor skips anything else.
- **OpenAPI.** `apps/api/openapi.json` and the client in `packages/api-client` are generated. Run `pnpm openapi` after you change an API route or schema, and commit both files.
- **Design.** UI work follows the `DES-xxx` records, including the WCAG 2.2 AA floor.

## Issues

Use GitHub Issues. Search first, and add to an existing issue if one fits. For a documentation problem, use the documentation template.

The maintainer triages each issue with one of five labels:

| Label             | Meaning                                       |
| ----------------- | --------------------------------------------- |
| `needs-triage`    | The maintainer has not evaluated it yet.      |
| `needs-info`      | The maintainer is waiting for the reporter.   |
| `ready-for-agent` | Fully specified. A coding agent can build it. |
| `ready-for-human` | Needs a person to build it.                   |
| `wontfix`         | The project will not act on it.               |

Do not report a security problem in a public issue. Follow [`SECURITY.md`](SECURITY.md).

## Coding agents

The [`.agents/`](.agents/) directory holds the guidance that coding agents read. The root `CLAUDE.md` loads `.agents/CLAUDE.md`. If you use an agent, point it at that directory. The files tell it how to use the glossary, the decision records, the issue tracker and the triage labels.

You are responsible for what your agent writes. Read the diff and run `pnpm check` before you open the pull request. CodeRabbit labels low-quality, unreviewed AI-generated pull requests as `slop`.

## License

OpenLaw is licensed under [AGPL-3.0-only](LICENSE). When you open a pull request, you agree that your contribution is licensed under AGPL-3.0-only too. There is no contributor license agreement.
