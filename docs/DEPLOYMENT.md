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

| Variable                 | Required | Meaning                                                                                                                                                  |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`            | yes      | Session signing + at-rest crypto for 2FA material. Changing it signs everyone out and breaks enrolled 2FA.                                               |
| `DATABASE_URL`           | no       | Unset = the bundled Postgres. Set for external/managed Postgres (TECH-004 — equally supported).                                                          |
| `BASE_URL`               | in prod  | The public origin (e.g. `https://legal.example.com`). Emailed links and OIDC callbacks point here, and the auth layer checks request origins against it. |
| `SMTP_URL` / `SMTP_FROM` | no       | Outbound email. Unset = email flows report "unconfigured" instead of sending.                                                                            |
| `PORT`                   | no       | The published host port (the container always listens on 3000 internally).                                                                               |

## Reverse proxy contract

The stack serves plain HTTP on one port and ships no proxy (TECH-017): TLS and the public hostname belong to _your_ ingress. Any proxy works if it honors this contract:

1. **Terminate TLS** and forward to the app port (default `3000`).
2. **Set `BASE_URL`** in `.env` to the public origin the proxy serves.
3. **Pass `Origin` and `Host` through unmodified** — the auth layer's CSRF protection compares the `Origin` header against `BASE_URL` (TECH-008); a proxy that rewrites or strips it breaks sign-in.
4. **No path rewriting.** The app owns the whole path space; serve it at the domain root.
5. **Don't buffer `/api/events`.** Live surfaces use Server-Sent Events (TECH-009); response buffering turns them into nothing.

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

## Email

OpenLaw sends through whatever SMTP relay you already run (TECH-011): set `SMTP_URL` and `SMTP_FROM`. With them unset, email-dependent flows (invites, magic links) tell the user email is unconfigured rather than failing silently.

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

Migrations run automatically when the app container boots (TECH-005); replicas booting together serialize on an advisory lock. Data lives in the `openlaw-pgdata` named volume and survives `docker compose down`, image upgrades, and rebuilds. (`docker compose down -v` deletes it — don't.)

## Health

- `GET /healthz` — liveness: the process is up.
- `GET /readyz` — readiness: the database answers. The compose healthcheck and any orchestrator should watch this one.

## Backups

One database, one story (TECH-004):

```bash
docker compose exec postgres pg_dump -U openlaw openlaw > openlaw-$(date +%F).sql
```

For external Postgres, run `pg_dump` against it directly.
