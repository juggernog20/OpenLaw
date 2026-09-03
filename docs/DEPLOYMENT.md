# Deploying OpenLaw

The blessed path is Docker Compose (TECH-005): one documented `docker compose up` from a clean Linux VM to the first-run setup screen. The stack today is four services — the app (API + built SPA in one container, TECH-017), the background worker (the same image, a different command, TECH-007), Postgres, and the doc-engine sidecar — and grows a service only when a feature needs it.

## Requirements

- A Linux host with Docker Engine and the Compose plugin
- Outbound SMTP if you want email flows (invites, magic links) — see [Email](#email)
- A reverse proxy for TLS in any real deployment — see [the proxy contract](#reverse-proxy-contract)

## Quickstart

```bash
git clone https://github.com/juggernog20/OpenLaw.git
cd OpenLaw
cp .env.example .env
# set the two required secrets — a different value for each:
sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env
docker compose up -d
```

Then open `http://<host>:3000` — a fresh install lands on first-run setup, where you create the initial Administrator.

`OPENLAW_SECRET_KEY` encrypts the credentials your Administrators later save in Settings. Before you set up a backup job, read [The credential encryption key](#the-credential-encryption-key) — the one mistake that undoes it is storing the key in the same archive as the database dump.

`compose.yml` references the release image and carries a `build:` context, so the same file works before any release exists: Compose builds the image locally when it isn't present.

## Configuration

All configuration is environment variables in `.env`; [`.env.example`](../.env.example) documents every one. The short version:

| Variable                      | Required | Meaning                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                 | yes      | Session signing + at-rest crypto for 2FA material and stored OIDC tokens. Changing it signs everyone out and breaks enrolled 2FA — put the old value back, or every enrolled user re-enrols. The stored OIDC tokens stop being readable as well, and that costs nothing: the next SSO sign-in writes fresh ones. |
| `OPENLAW_SECRET_KEY`          | yes      | Encrypts the credentials saved in Settings — the DocuSign key, the Connect secret, the SMTP relay URL, the SSO client secret, and the AI provider key. Keep it out of the database backup — see [The credential encryption key](#the-credential-encryption-key).                                                 |
| `OPENLAW_SECRET_KEY_PREVIOUS` | no       | The retiring key while `OPENLAW_SECRET_KEY` is being rotated. Set it for one boot, then remove it — see [The credential encryption key](#the-credential-encryption-key).                                                                                                                                         |
| `DATABASE_URL`                | no       | Unset = the bundled Postgres. Set for external/managed Postgres (TECH-004 — equally supported).                                                                                                                                                                                                                  |
| `BASE_URL`                    | in prod  | The public origin (e.g. `https://legal.example.com`). Emailed links and OIDC callbacks point here, and the auth layer checks request origins against it.                                                                                                                                                         |
| `SMTP_URL` / `SMTP_FROM`      | no       | Outbound email; setting `SMTP_URL` pins SMTP to the environment, overriding anything saved in the app (see [Email](#email)). Unset = configurable in the app; with neither, email flows report "unconfigured" instead of sending.                                                                                |
| `STORAGE_DRIVER`              | no       | Where uploaded files go (DOC-009): `local` (the default — a directory, no extra service), `s3` (an S3-compatible object store), or `azure-blob` (Azure Blob Storage). See [Files](#files).                                                                                                                       |
| `STORAGE_PATH`                | no       | The `local` driver's root. Defaults to `/var/lib/openlaw/files`, the mount point of the `openlaw-files` named volume. Keep the default under Compose — see [Files](#files).                                                                                                                                      |
| `S3_*`                        | no       | The `s3` driver's bucket, endpoint, region, addressing, and credentials. Required when `STORAGE_DRIVER=s3` — see [Files](#files).                                                                                                                                                                                |
| `AZURE_BLOB_*`                | no       | The `azure-blob` driver's container, account, key, and endpoint. Required when `STORAGE_DRIVER=azure-blob` — see [Files](#files).                                                                                                                                                                                |
| `MAX_UPLOAD_MB`               | no       | Caps each upload, in whole MB. Defaults to 100. Raise your reverse proxy's body limit to match when you raise this — see [Files](#files).                                                                                                                                                                        |
| `DOC_ENGINE_URL`              | no       | Where the doc engine answers (TECH-010). Unset = the bundled `doc-engine` service on the compose network. Set it only to point at an engine you run yourself — see [The doc engine](#the-doc-engine).                                                                                                            |
| `DOC_ENGINE_TIMEOUT_MS`       | no       | How long one call to the doc engine may take before it is abandoned. Defaults to 300000 (five minutes).                                                                                                                                                                                                          |
| `DOC_ENGINE_TMPFS_SIZE`       | no       | Compose only. Scratch space for the doc engine's read-only container, as a RAM-backed tmpfs. Defaults to `2g` — see [The doc engine](#the-doc-engine).                                                                                                                                                           |
| `PORT`                        | no       | The published host port (the container always listens on 3000 internally).                                                                                                                                                                                                                                       |

## Reverse proxy contract

The stack serves plain HTTP on one port and ships no proxy (TECH-017): TLS and the public hostname belong to _your_ ingress. Any proxy works if it honors this contract:

1. **Terminate TLS** and forward to the app port (default `3000`).
2. **Set `BASE_URL`** in `.env` to the public origin the proxy serves.
3. **Pass `Origin` and `Host` through unmodified** — the auth layer's CSRF protection compares the `Origin` header against `BASE_URL` (TECH-008); a proxy that rewrites or strips it breaks sign-in.
4. **No path rewriting.** The app owns the whole path space; serve it at the domain root.
5. **Don't buffer `/api/events`.** Live surfaces use Server-Sent Events (TECH-009); response buffering turns them into nothing.
6. **Allow a request body at least as large as `MAX_UPLOAD_MB`.** File uploads stream through the app (DOC-012); a proxy with a smaller body limit refuses them first, with its own error instead of the app's.

Everything else — HTTP/2, compression, request logging — is your choice.

### Your proxy owns the security response headers

The app sets only the headers that are about the bytes one route returns: `nosniff` on every file download, and a locked-down `Content-Security-Policy` on the routes that render an uploaded file inline. Those protect you from other people's uploads and the app is the only thing that knows which responses those are.

**The origin-wide headers are yours**, because they are claims about the public origin — which you configured and the app knows only as a `BASE_URL` string. Add them at the proxy:

| Header                      | Suggested value                       | Why                                                                                                            |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | The app has no TLS and cannot honestly assert this. Add it once you are sure the whole hostname is HTTPS-only. |
| `X-Frame-Options`           | `DENY`                                | Nothing in OpenLaw is meant to be framed by another site.                                                      |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`     | Record URLs carry contract numbers; they should not leave in a `Referer` to somewhere else.                    |
| `X-Content-Type-Options`    | `nosniff`                             | The app already sets this on downloads. Setting it origin-wide is harmless and covers the rest.                |

OpenLaw ships no `helmet`-style header middleware on purpose. It runs as one upstream behind your ingress, and a second weaker copy of these headers behind yours is two sources of truth that disagree the moment you tune one (TECH-017's 2026-08-21 addendum).

### Rate limiting is yours too, except sign-in

Sign-in has its own limiter inside the app, because it protects a credential rather than a resource and the counter has to be the one the auth layer keeps. `AUTH_RATE_LIMIT=off` turns it off; that switch belongs to the test overlay and the app warns loudly at boot when it is set. **Never set it on a real deployment.**

Everything else is unlimited by the app and should be limited by you. What to bound, in the order it matters:

1. **The portal's open write addresses** — magic-link request, Request submission, attachment upload, and reply. These are reachable by every Business User on an allowed domain, and nothing in the app caps how many Requests one account may raise or how many bytes they may put on disk in total. This is the gap worth closing first if your portal is exposed.
2. **The sign-in and password-reset paths**, as a second layer in front of the app's own.
3. **Everything under `/api`**, as a broad ceiling — generous enough that a person clicking through the app never meets it.

The right numbers depend on your instance: how many people use it, and how much disk you are willing to give the portal. There is no default worth shipping, which is why the app ships none. A per-IP bucket at your proxy — nginx's `limit_req_zone`, Caddy's `rate_limit` — is the usual shape.

### Example: Caddy

Caddy meets the contract with nothing but a site address (automatic HTTPS, no buffering that breaks SSE, headers passed through by default). The `header` block adds the origin-wide security headers from the section above, and Caddy sets HSTS itself whenever it manages the certificate:

```caddy
legal.example.com {
    header {
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        X-Content-Type-Options nosniff
    }
    reverse_proxy localhost:3000
}
```

With `BASE_URL=https://legal.example.com` in `.env`, that is the whole configuration.

### Example: nginx

```nginx
server {
    listen 443 ssl;
    server_name legal.example.com;
    # ... ssl_certificate / ssl_certificate_key ...

    # The origin-wide security headers (see above). `always` so they
    # ride error responses too. Add HSTS once the whole hostname is
    # HTTPS-only — it is hard to take back.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        # Origin is passed through untouched by default — do not override it.
    }

    location /api/events {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_buffering off;      # SSE (TECH-009)
        proxy_read_timeout 24h;
    }
}
```

## External or managed Postgres

Set `DATABASE_URL` in `.env` to any reachable PostgreSQL 16+ and the app uses it instead of the bundled container. The bundled `postgres` service starts anyway (harmlessly idle); stop it with `docker compose stop postgres` or ignore it. It is never published to the host network either way.

## Files

Uploaded files are written through one storage driver (DOC-009, TECH-014), chosen by `STORAGE_DRIVER`. There are three.

The store holds more than what people upload. A Word document or a PowerPoint deck is converted to a PDF so it can be read in the app (DOC-004), and that rendition is written beside the original under `renditions/`. Back it up with everything else — it is cheaper than converting the whole repository again — but nothing is lost if it goes: a rendition is made from its source, and the source is what the download and the record always answer.

### The local filesystem driver (the default)

Files are stored on disk — no object store, no extra service. The stack mounts the `openlaw-files` named volume at `STORAGE_PATH` (default `/var/lib/openlaw/files`), so files survive `docker compose down`, image upgrades, and rebuilds, exactly like the database volume. (`docker compose down -v` deletes both — don't.)

The directory appears with the first upload; an install that stores nothing creates nothing.

Point `STORAGE_PATH` somewhere else only outside Compose. Under Compose the volume follows the variable, but the image prepares only the default path for the container's unprivileged `node` user, so another path mounts as root-owned and uploads fail.

### The S3-compatible driver

Set `STORAGE_DRIVER=s3` to keep files in an object store instead — AWS S3, MinIO, Ceph, Cloudflare R2, DigitalOcean Spaces, or anything else that speaks the same API.

| Variable                                    | Meaning                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3_BUCKET`                                 | Required. The bucket every file is stored in. **It must already exist** — OpenLaw never creates one.                                                           |
| `S3_ENDPOINT`                               | The store's URL. Leave it unset for AWS S3 itself.                                                                                                             |
| `S3_REGION`                                 | What requests are signed for. Defaults to `us-east-1`; a MinIO-class store ignores it.                                                                         |
| `S3_FORCE_PATH_STYLE`                       | `true` addresses the bucket as `host/bucket/key`, `false` as `bucket.host/key`. Defaults to `true` whenever `S3_ENDPOINT` is set.                              |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Static credentials. Set both or neither — with neither, the AWS credential chain applies, so a deployment on AWS can use an instance or IRSA role and no keys. |

Set the driver and forget the bucket, and the app stops at boot with the variable named. It never falls back to the local disk: files written where nobody would look for them are worse than a refused start.

Downloads stream through the app, not from the bucket, so the store needs no public access and no CORS rules. Give the credentials read, write, and delete on the bucket and nothing else.

### The Azure Blob driver

Set `STORAGE_DRIVER=azure-blob` to keep files in Azure Blob Storage — the one major object store the `s3` driver cannot reach. Fabric / OneLake speaks the same Blob API, so this driver reaches OneLake too.

| Variable                 | Meaning                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_BLOB_CONTAINER`   | Required. The container every file is stored in. **It must already exist** — OpenLaw never creates one.                                                         |
| `AZURE_BLOB_ACCOUNT`     | The storage account. Azure answers at the account's own address (`https://<account>.blob.core.windows.net`), so with this set no endpoint is needed.            |
| `AZURE_BLOB_ACCOUNT_KEY` | The account's shared key. Leave it unset to use the Azure credential chain instead, so a deployment on Azure can use a managed or workload identity and no key. |
| `AZURE_BLOB_ENDPOINT`    | The store's URL. Leave it unset for Azure itself; set it for anything else that answers the Blob API (Azurite, OneLake).                                        |

The same boot rule holds: name the driver and leave out the container, and the app stops with the variable named.

Downloads stream through the app here too. Give the credential read, write, and delete on the container and nothing else — `Storage Blob Data Contributor` scoped to the container, when the credential chain is used.

One account-level caveat: blob **versioning** and **soft delete** keep copies of a blob after a delete the store reports as successful. OpenLaw's hard delete (DOC-010) is a lawful-erasure tool, and it can only remove what the store lets it reach — with either feature on, erased files linger in the account until their retention lapses. Turn both off on this container's account, or own that gap knowingly.

### Changing driver

Every file records the driver that stored it, and reads follow that record across every configured driver (DOC-014) — so **changing driver does not lose the files already stored**. Files written by the local driver stay readable from the volume after you switch to `s3` or `azure-blob`; keep the volume, and keep the old driver's variables set. Drop them and those files' reads fail with a message naming the driver and what to set — never a false "not found". Nothing copies old files into the new store — that is a migration to run yourself, and there is no tool for it yet.

A named store is a configured reader whether or not it is the write driver: setting `S3_BUCKET` or `AZURE_BLOB_CONTAINER` makes that driver readable, and its other variables are then checked at boot exactly as for the write driver — a reader that cannot reach its store stops the start, not the first old file.

### The upload ceiling

One upload may carry at most `MAX_UPLOAD_MB` megabytes (default 100), on every driver. A file over the ceiling is refused with a clear message instead of a timeout. Raising it does not raise what an upload costs in memory: the `s3` and `azure-blob` drivers both stream in 5 MB blocks, four at a time, so each upload in flight holds about 20 MB whatever its size — size the app's memory by how many uploads may overlap, not by the ceiling. If you raise it, raise your reverse proxy's own body limit to match — nginx's `client_max_body_size`, Caddy's `request_body max_size` — or the proxy cuts the request off first and the refusal stops being clear.

## The doc engine

Reading a Word draft in the app, previewing a deck, and getting text out of a scanned PDF all need document tooling that does not belong in the application process: headless LibreOffice, OCRmyPDF/Tesseract, and poppler. They live in one sidecar container, `doc-engine`, built from this repository (TECH-010).

There is nothing to configure. `docker compose up` starts it, and the app finds it by its service name.

Three properties are worth knowing about, because all three are deliberate:

- **It is never published to the host.** The service declares no `ports`, exactly as Postgres declares none, so it is reachable only from the other containers on the compose network. Do not add a port mapping. It carries no authentication and has nothing to authorise — the app decides who may read a file long before it sends the bytes — so a published port would be an open document-conversion service on your network.
- **It holds nothing.** Every call streams a file in, runs one tool, streams the answer back, and removes what it wrote. There is no volume and nothing to back up. Restarting it loses no data; a conversion that was in flight is retried by the job that asked for it.
- **It is the one container that is fenced in.** This is where files a counterparty sent you get opened, by LibreOffice and OCRmyPDF, so the stack assumes one day one of them is made to run code it should not and limits what that code can reach. It sits on its own compose network, which Postgres is not on and which has no route off the host, so it cannot open a socket to your database or call out to the internet — there is no route, not merely no password. Its root filesystem is read-only, it holds no Linux capabilities at all, and it cannot gain privilege it did not start with. The only thing it can write is `/tmp`, which is memory rather than disk and is emptied when the container restarts.

Set `DOC_ENGINE_URL` only if you run the engine somewhere else — a shared host, or outside Compose. `DOC_ENGINE_TIMEOUT_MS` bounds one call, and defaults to five minutes. `DOC_ENGINE_TMPFS_SIZE` sizes that `/tmp`, and defaults to `2g`; raise it if OCR of very long scans runs out of space, and remember it is RAM.

### Do not put the doc engine on your database's network

If you edit `compose.yml`, keep the two networks apart. Every service names its networks explicitly, and the moment a service declares `networks` it stops joining Compose's default network implicitly — so adding a service without a `networks` list gives it no way to reach the rest of the stack, and adding `openlaw-backend` to `doc-engine` quietly undoes the isolation above.

## The background worker

Some of what OpenLaw does cannot happen while somebody waits: reading a scanned contract with OCR takes seconds per page, and an upload must finish at the speed it always did. That work runs in the `worker` service (TECH-007).

There is nothing to configure. It is the same image as the app, started with a different command, and it reads the same `.env` — the same database, the same storage, and the same doc engine.

Four properties are worth knowing about:

- **The queue is Postgres.** Jobs are rows in the database you already run, kept by pg-boss in its own schema. There is no Redis and no broker to operate, and a queue backup is the database backup you already take.
- **It listens on nothing.** No port, no healthcheck, no HTTP surface. It is up when it is running, and what it did is in `docker compose logs worker`.
- **A failed job is retried, and a permanent failure is recorded.** A transient failure — a doc engine restarting mid-deploy — is tried again with a delay. A failure that no retry would change is recorded against the file it belongs to, and the version, its download, and the record itself are untouched. An upload is never blocked or failed by the work that follows it.
- **It catches up on old paper at boot.** Every time a worker starts, it looks for documents that are still owed a preview or their extracted text and asks for them. That is what applies an upgrade to the files you uploaded before: nothing is re-uploaded, and the previews and the text arrive on their own. It skips whatever is already done and whatever a job has already given up on, so restarting a worker does not put your whole library through the doc engine again. The line it writes when it finishes is `the backfill sweep finished`.

Running more than one worker is supported and needs no configuration — they take jobs off the same queue and never take the same one twice:

```bash
docker compose up -d --scale worker=2
```

## AI contract analysis

Configure AI analysis in **Settings → Organization → Integrations → AI analysis**. The connector stores the preset or custom protocol, base URL, model, and API key as organization data. There is no AI provider environment variable: changing the connector applies to the next call without restarting either process.

The **worker makes the provider calls for Contract extraction**. The **API makes only the Test connection call** when an Administrator presses that button. In a restricted deployment, allow outbound HTTPS and provider DNS from the worker for ordinary runs and from the app for the test. A custom connector may point at another reachable HTTP endpoint, including a model server on your own network.

The API key is write-only after save and encrypted at rest under `OPENLAW_SECRET_KEY`. The app and worker must therefore receive the same key, just as they do for the signing connector. Losing it does not damage Contracts or Analysis runs, but the stored provider key cannot be read until the old encryption key is restored or an Administrator replaces that provider key.

## Email

OpenLaw sends through whatever SMTP relay you already run (TECH-011). Configure it one of two ways:

- **In the app**: enter the relay URL and From address in the Welcome to OpenLaw wizard's email step (Administrator only). Saves take effect on the next send — no restart.
- **In the environment**: set `SMTP_URL` and `SMTP_FROM` in `.env`.

**The environment always wins.** Setting `SMTP_URL` pins the instance: values saved in the app are ignored entirely, and the wizard shows the environment configuration read-only instead of accepting settings that would never apply. Pin via the environment when your deployment tooling is the source of truth.

With neither configured, email-dependent flows (invites, magic links) report email as unconfigured rather than failing silently.

To _test_ email locally without a relay, use the development overlay — it adds [Mailpit](https://mailpit.axllent.org/) and points the app at it:

```bash
docker compose -f compose.yml -f compose.dev.yml up -d
```

Every message the app sends is then visible at `http://localhost:8025`. The overlay is for development and E2E only — never run it in production, where a mail catcher would silently swallow real invites and expose their links in an unauthenticated UI.

## Upgrades

```bash
git pull                  # or: edit the image tag in compose.yml to the new release
docker compose pull
docker compose up -d
```

Migrations run automatically when the app container boots (TECH-005); replicas booting together serialize on an advisory lock. Data lives in two named volumes — `openlaw-pgdata` (the database) and `openlaw-files` (uploads, see [Files](#files)) — and both survive `docker compose down`, image upgrades, and rebuilds. The doc engine holds nothing, so it upgrades by being replaced. (`docker compose down -v` deletes them — don't.)

**Take a backup first anyway.** See [Backups](#backups); a migration is the one moment a restore is worth having ready.

**Ask people to reload after an upgrade.** A browser tab that was open before the upgrade still runs the old version of the app. Most of it keeps working. The parts that load on demand (the PDF and email previews) can fail, because the files they ask for were replaced with the new release. When that happens the panel shows "This part of OpenLaw was updated. Reload to continue." with a Reload button. Nothing is lost on the server; a reload picks up the new version.

This path is exercised on every commit rather than assumed. CI fills a baseline install with Contracts across the lifecycle, Documents, users in several roles and a signing connector, then brings the new version up against that same database and checks every record still reads back (TECH-018). It is not a promise that no upgrade ever needs care — it is a promise that the ordinary one is tested with rows in the tables, not only against an empty install.

### A stranded migration journal

The app applies a migration only when it is stamped later than the newest stamp recorded in your database. A recorded stamp that is _too high_ hides every migration behind it — permanently, and with no error at the time.

One release shipped a stamp like that (`0049_contract_tasks`). You need do nothing about it: the app corrects that stamp on the next boot and logs `migrations: corrected the recorded stamp for 0049_contract_tasks`.

If the app instead refuses to start with `This database cannot apply the migrations it is missing`, it found a stamp it does not recognise and will not guess. Repair it by hand:

1. **Back up the database.** See [Backups](#backups). You are about to edit the app's own bookkeeping.

2. **Read the migrations the error lists.** It names each one it would skip, with that migration's stamp.

3. **Map the recorded rows to migrations.** The bookkeeping table stores a hash, not a name:

   ```bash
   # Recorded rows, newest stamp first.
   docker compose exec postgres psql -U openlaw -d openlaw \
     -c 'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5;'

   # Every migration's tag, stamp and hash — join the two on hash.
   # `run`, not `exec`: the app container is refusing to boot right now.
   # The image carries this script, so the mapping is the exact journal
   # your version boots with.
   docker compose run --rm --no-deps app node scripts/lint-migration-journal.mjs --hashes
   ```

4. **Find the offending row.** It is the one whose `created_at` is later than the stamp of a migration that comes after it.

5. **Set that row's stamp to the migration's own `when`**, taken from the `--hashes` output. Match on the hash, never on the stamp alone:

   ```bash
   docker compose exec postgres psql -U openlaw -d openlaw \
     -c "update drizzle.__drizzle_migrations set created_at = <when> where hash = '<hash>';"
   ```

6. **Restart.** `docker compose up -d`. The skipped migrations apply on boot.

The app refuses to start rather than carrying on because a schema several migrations behind is not a degraded install, it is a wrong one: every request it serves writes data against a shape the code does not expect.

### An upgrade that stops on `accounts.issuer`

**Upgrade normally.** `docker compose pull && docker compose up -d`, as above. A container that comes up healthy has already done everything below, and you need read no further.

One migration, `0060_account_issuer`, can refuse instead. It is the only one that can, and it does so on purpose.

From this release the authentication library identifies an account by **who asserted the subject** — a new `issuer` column — rather than by the provider row it was filed under. Every account already in your database needs a truthful value before the new code runs. The migration works it out: a password account gets `local:credential`, and an account from an identity provider gets that provider's own issuer, which your install already recorded when an Administrator registered it.

**If the app container will not start, read its log.** The migration stops in two cases and names which. Fix what it names, then run the upgrade again:

- **`Cannot resolve an issuer for accounts under provider(s): …`** — accounts are filed under an identity provider your database no longer has. It was deleted while people were still linked to it. Either re-register that provider under the same provider ID, or delete the account rows that point at it (the people keep their accounts; they re-link on their next sign-in through the provider).

- **`Two accounts share one 1.7 identity: …`** — two accounts would become the same identity, which happens if one identity provider was registered twice under different IDs and the same person signed in through both. Decide which row is the real one and delete the other.

**Nothing of this migration is half-applied either way.** It opens a transaction of its own, so a refusal applies none of it — the `issuer` column is not there at all. If your upgrade skipped several releases, migrations from those releases stay applied; they only add things, and the old image runs on them unchanged.

So you have two safe moves, in either order. **Start the old image again** and it runs as before, on the same data, for as long as you need. **Correct what the log named, then re-run `docker compose up -d`** — the migration starts from the top and completes.

This is deliberately a full stop rather than a best effort. An account left without a correct issuer is not a cosmetic problem: it is a person who cannot sign in and cannot reset their password, and it would be discovered by them rather than by you.

## The Audit log leaves this process, and those copies are yours

Every row OpenLaw appends to `activity_log` — the one table behind both the per-record **Activity feed** and the Administrator-only **Audit log** — is also written to stdout as one line of JSON (DD-017), so you can ship it to Datadog, Loki, Splunk, or whatever else you already run. Nothing is redacted on the way out: the line is a faithful copy of the stored row, because a shipped copy that disagreed with the record would be worse than no copy at all.

**Two consequences you own rather than we do.**

**Container logs are as sensitive as the database.** They carry contract titles, the people on a record, and the name and email address of every external signer an envelope was sent to. Give them the retention and the access control you give a database backup.

**An erasure inside OpenLaw cannot reach a copy that has already left.** An Administrator can erase an **external signer** — somebody with no account here, named in a send dialog by one of your people — and it rewrites that person's name and address out of the stored `activity_log` rows and deletes the envelope's signer rows (CTR-013). The entry keeps its shape: it still says how many people were asked, and when.

```bash
curl -X POST https://legal.example.com/api/v1/signer-erasures \
  -H 'content-type: application/json' \
  -b "$ADMIN_SESSION_COOKIE" \
  -d '{"email":"someone@counterparty.example"}'
```

It has no settings pane yet — it is an Administrator-only API call, and the API document describes it. It also cannot touch the line your log shipper took months ago. If you have to answer an erasure request in full, purge your own log store as well, and set a retention on it short enough that this is a bounded job rather than an open-ended one.

The same is true of the database backups in [Backups](#backups) below: a `pg_dump` taken before an erasure still holds what was erased.

## Health

- `GET /healthz` — liveness: the process is up.
- `GET /readyz` — readiness: the database answers. The compose healthcheck and any orchestrator should watch this one.

## The credential encryption key

Your Administrators paste five credentials into Settings: the DocuSign RSA private key, the DocuSign Connect secret, the SMTP relay URL with its password inline, the SSO client secret, and the AI provider key. OpenLaw encrypts all five before they reach Postgres, with `OPENLAW_SECRET_KEY` (TECH-022). The app and the worker both read it at boot and refuse to start without it.

The exposure this closes is not "somebody reads a password". Whoever holds the DocuSign key can mint JWTs as your integration user — send, void, and read envelopes as you — and whoever holds the Connect secret can forge a delivery telling OpenLaw a contract was signed when it was not.

### Generate it

```bash
openssl rand -base64 32
```

Use a different value from `AUTH_SECRET`, so rotating one never touches the other.

The two keys guard different things, and neither can stand in for the other. `OPENLAW_SECRET_KEY` seals the five credentials above — the ones an Administrator types into Settings and can type again. `AUTH_SECRET` seals what better-auth stores for a person: 2FA material, and each SSO user's OIDC access and refresh tokens. Those are not re-typable, which is why they are not on this key and not part of the rotation below.

### Where it must not live

**Not in the same archive as the database dump.** The key is what keeps the five sealed credentials unreadable in a stolen `pg_dump` — the rest of the dump is your data in the clear, so it still needs the care any database backup needs. A backup job that tars `.env` alongside `openlaw-2026-08-16.sql` puts the locked box and its key in one file and gives the whole thing back.

Put the key in a password manager or a secret manager. Back it up somewhere your database backups are not, and check that whatever backs up `/opt/openlaw` (or wherever your `.env` lives) is not also the thing that writes your dumps.

### Rotate it

No credential is retyped. It takes two restarts — one to re-encrypt under the new key, one to retire the old variable:

```bash
# 1. Move the current key across and generate a new one.
OLD=$(grep '^OPENLAW_SECRET_KEY=' .env | cut -d= -f2-)
sed -i "s|^#\?OPENLAW_SECRET_KEY_PREVIOUS=.*|OPENLAW_SECRET_KEY_PREVIOUS=$OLD|" .env
sed -i "s|^OPENLAW_SECRET_KEY=.*|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env

# 2. Restart. The app re-encrypts every stored credential under the new key at boot.
docker compose up -d

# 3. Remove the old key.
sed -i "s|^OPENLAW_SECRET_KEY_PREVIOUS=.*|#OPENLAW_SECRET_KEY_PREVIOUS=|" .env
docker compose up -d
```

The retiring key is accepted for reads only. Step 2 logs how many values it re-encrypted; step 3 is what actually retires the old key, so don't stop after step 2.

### If you lose it

You lose those five credentials and nothing else. No Contract, Matter, Document, Analysis run, or activity record depends on this key — they are not encrypted with it and are unaffected.

Set a new `OPENLAW_SECRET_KEY`, start the stack, and the five credentials read as unset: Settings shows the signing connector, SMTP relay, SSO provider, and AI connector as missing their secrets, and your Administrators paste them in again. OpenLaw leaves the unreadable values in place rather than overwriting them, and says so in the boot log — so if the old key turns up later, putting it back in `OPENLAW_SECRET_KEY_PREVIOUS` and restarting still recovers them.

### Upgrading from a version before this

**Set `OPENLAW_SECRET_KEY` before you start the new version**, not after. The app and the worker refuse to boot without it, so an upgrade that skips this step stops at a startup error rather than starting and asking later.

```bash
echo "OPENLAW_SECRET_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

That is the whole migration. The first boot encrypts the credentials the old version stored in the clear, logs which columns it sealed, and asks nobody to retype anything.

## Backups

Two things hold state: the database, and wherever your storage driver keeps its files. Back both up together: a database row points at a file, and a file with no row is unreachable.

Back up `OPENLAW_SECRET_KEY` too — and, as [that section](#the-credential-encryption-key) says, somewhere these archives are not.

The database, on the bundled Postgres:

```bash
docker compose exec postgres pg_dump -U openlaw openlaw > openlaw-$(date +%F).sql
```

For external Postgres, run `pg_dump` against it directly.

The files, on the **local** driver:

```bash
docker compose run --rm --no-deps --entrypoint sh -v "$PWD:/out" app \
  -c 'tar czf "/out/openlaw-files-$(date +%F).tar.gz" -C "$STORAGE_PATH" .'
```

That command archives the files volume through the `app` service, so it picks up whatever volume and `STORAGE_PATH` your stack declares — no volume name to keep in step. It writes the archive into the current directory as the container's `node` user (uid 1000).

On the **s3** driver, do not run it — the volume is empty. Back the bucket up with your store's own tooling: versioning, replication, or a scheduled sync. Keep the old volume too if the install ever ran on the local driver; the files it wrote are still read from it.
