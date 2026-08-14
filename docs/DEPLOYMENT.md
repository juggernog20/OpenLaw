# Deploying OpenLaw

The blessed path is Docker Compose (TECH-005): one documented `docker compose up` from a clean Linux VM to the first-run setup screen. The stack today is two services — the app (API + built SPA in one container, TECH-017) and Postgres — and grows a service only when a feature needs it.

## Requirements

- A Linux host with Docker Engine and the Compose plugin
- Outbound SMTP if you want email flows (invites, magic links) — see [Email](#email)
- A reverse proxy for TLS in any real deployment — see [the proxy contract](#reverse-proxy-contract)

## Quickstart

```bash
git clone https://github.com/juggernog20/OpenLaw.git
cd OpenLaw
cp .env.example .env
# set the one required secret:
sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env
docker compose up -d
```

Then open `http://<host>:3000` — a fresh install lands on first-run setup, where you create the initial Administrator.

`compose.yml` references the release image and carries a `build:` context, so the same file works before any release exists: Compose builds the image locally when it isn't present.

## Configuration

All configuration is environment variables in `.env`; [`.env.example`](../.env.example) documents every one. The short version:

| Variable                 | Required | Meaning                                                                                                                                                                                                                           |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`            | yes      | Session signing + at-rest crypto for 2FA material. Changing it signs everyone out and breaks enrolled 2FA.                                                                                                                        |
| `DATABASE_URL`           | no       | Unset = the bundled Postgres. Set for external/managed Postgres (TECH-004 — equally supported).                                                                                                                                   |
| `BASE_URL`               | in prod  | The public origin (e.g. `https://legal.example.com`). Emailed links and OIDC callbacks point here, and the auth layer checks request origins against it.                                                                          |
| `SMTP_URL` / `SMTP_FROM` | no       | Outbound email; setting `SMTP_URL` pins SMTP to the environment, overriding anything saved in the app (see [Email](#email)). Unset = configurable in the app; with neither, email flows report "unconfigured" instead of sending. |
| `STORAGE_DRIVER`         | no       | Where uploaded files go (DOC-009): `local` (the default — a directory, no extra service) or `s3` (an S3-compatible object store). See [Files](#files).                                                                            |
| `STORAGE_PATH`           | no       | The `local` driver's root. Defaults to `/var/lib/openlaw/files`, the mount point of the `openlaw-files` named volume. Keep the default under Compose — see [Files](#files).                                                       |
| `S3_*`                   | no       | The `s3` driver's bucket, endpoint, region, addressing, and credentials. Required when `STORAGE_DRIVER=s3` — see [Files](#files).                                                                                                 |
| `MAX_UPLOAD_MB`          | no       | Caps each upload, in whole MB. Defaults to 100. Raise your reverse proxy's body limit to match when you raise this — see [Files](#files).                                                                                         |
| `PORT`                   | no       | The published host port (the container always listens on 3000 internally).                                                                                                                                                        |

## Reverse proxy contract

The stack serves plain HTTP on one port and ships no proxy (TECH-017): TLS and the public hostname belong to _your_ ingress. Any proxy works if it honors this contract:

1. **Terminate TLS** and forward to the app port (default `3000`).
2. **Set `BASE_URL`** in `.env` to the public origin the proxy serves.
3. **Pass `Origin` and `Host` through unmodified** — the auth layer's CSRF protection compares the `Origin` header against `BASE_URL` (TECH-008); a proxy that rewrites or strips it breaks sign-in.
4. **No path rewriting.** The app owns the whole path space; serve it at the domain root.
5. **Don't buffer `/api/events`.** Live surfaces use Server-Sent Events (TECH-009); response buffering turns them into nothing.
6. **Allow a request body at least as large as `MAX_UPLOAD_MB`.** File uploads stream through the app (DOC-012); a proxy with a smaller body limit refuses them first, with its own error instead of the app's.

Everything else — HTTP/2, compression, request logging — is your choice.

### Example: Caddy

Caddy meets the contract with nothing but a site address (automatic HTTPS, no buffering that breaks SSE, headers passed through by default):

```caddy
legal.example.com {
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

Uploaded files go through one storage driver (DOC-009, TECH-014), chosen by `STORAGE_DRIVER`. There are two.

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

Every file records the driver that stored it, so **changing driver does not lose the files already stored**. Files written by the local driver stay readable from the volume after you switch to `s3`; keep the volume. Nothing copies old files into the bucket — that is a migration to run yourself, and there is no tool for it yet.

Downloads stream through the app, not from the bucket, so the store needs no public access and no CORS rules. Give the credentials read, write, and delete on the bucket and nothing else.

### The upload ceiling

One upload may carry at most `MAX_UPLOAD_MB` megabytes (default 100), on either driver. A file over the ceiling is refused with a clear message instead of a timeout. If you raise it, raise your reverse proxy's own body limit to match — nginx's `client_max_body_size`, Caddy's `request_body max_size` — or the proxy cuts the request off first and the refusal stops being clear.

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

Migrations run automatically when the app container boots (TECH-005); replicas booting together serialize on an advisory lock. Data lives in two named volumes — `openlaw-pgdata` (the database) and `openlaw-files` (uploads, see [Files](#files)) — and both survive `docker compose down`, image upgrades, and rebuilds. (`docker compose down -v` deletes them — don't.)

## Health

- `GET /healthz` — liveness: the process is up.
- `GET /readyz` — readiness: the database answers. The compose healthcheck and any orchestrator should watch this one.

## Backups

Two things hold state: the database, and wherever your storage driver keeps its files. Back both up together: a database row points at a file, and a file with no row is unreachable.

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
