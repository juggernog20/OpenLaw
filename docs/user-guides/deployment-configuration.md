# Configure a deployment

Set the origin, services, storage, and secrets used by an OpenLaw installation. Work in its installation directory and retain the Compose project and file list established by [installation](install.md).

## Know where a setting belongs

| Operator configuration in `.env`                                                                                                                         | Administrator configuration in OpenLaw                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public origin, app port, database, storage, upload limits, document engine, authentication and credential encryption keys. SMTP can also be pinned here. | Organization identity, users, authentication choices and domains, module definitions, Signing connector, AI connector and prompts. The first-run wizard can save an SMTP relay when the environment does not pin one. |

Apply deployment changes with `docker compose up -d --no-build --pull never`. `docker compose restart` restarts the existing containers with their existing environment; it does not apply a changed `.env`. Check the effective behavior after recreation. Avoid printing `docker compose config` into a shared log: the expanded configuration can contain secrets. Use `docker compose config --quiet` for validation.

The app and worker must use the same database, file configuration, public origin, and credential encryption key. They run the same app image with different commands. The document engine receives files from them and has no database or credential-store access.

## Serve the intended origin

Set `BASE_URL` to the public origin, such as `https://legal.example.com`, with no application subpath. It determines emailed links, authentication callbacks, signing callbacks, and accepted request origins. `PORT` changes the published host port; the app container still listens on port 3000.

The reverse proxy must terminate TLS, preserve the incoming `Origin` and `Host`, forward paths without rewriting them, and allow uploads at least as large as the app limit. Disable response buffering for `/api/events` so live updates can arrive. Keep the database and document-engine ports unpublished.

For example, a Caddy instance on the app host can forward a public hostname to the local port:

```caddy
legal.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Use [Caddy's HTTPS instructions](https://caddyserver.com/docs/quick-starts/https) for DNS, public ports, and certificate prerequisites. A proxy in a container needs a reachable upstream address; its own `127.0.0.1` is not the app container. Restrict direct access to the app port through your host/network rules when the proxy is the intended entry point.

Check sign-in, an invitation link, an upload, a download, and a live update through that origin. A responding home page alone does not prove the proxy preserves authentication or event delivery. Configure origin-wide response headers and traffic limits at the proxy according to your deployment policy; the app's sign-in rate limiter remains enabled in a normal installation.

## Connect the database

With `DATABASE_URL` unset, Compose uses its bundled Postgres 16 database and named volume. To use an external PostgreSQL 16-or-later database, supply its connection URL and access credentials. The app applies migrations when it starts; that database account must be able to perform them. The worker reads the same URL.

The bundled Postgres service remains part of the base Compose topology when an external URL is configured. Its availability does not prove the external database is reachable. Check `/readyz`, the app's startup result, and actual record writes against the selected database.

Keep the database version and credentials with your operational configuration. Changing `DATABASE_URL` selects another database; it does not transfer an existing installation's records. Use [backup and restore](backup-and-restore.md) for a deliberate move.

## Select and retain storage

`STORAGE_DRIVER` chooses where new files are written. Existing files remember their own storage driver, so changing the setting does not move earlier files. Keep every old store and its reader configuration available for as long as a stored file refers to it.

| Driver       | Required setup                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`      | The default. Keep `STORAGE_PATH=/var/lib/openlaw/files` under the standard Compose deployment. Both app and worker mount the same named volume there. A different path can have unsuitable ownership for the image's unprivileged user.                                |
| `s3`         | Create the bucket first. Set `S3_BUCKET`, and the endpoint, region, addressing, and credentials appropriate to the store. An S3-compatible service can use `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=true`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.                  |
| `azure-blob` | Create the container first. Set `AZURE_BLOB_CONTAINER`, `AZURE_BLOB_ACCOUNT`, and the credential configuration. For an explicit-key connection, use `AZURE_BLOB_ACCOUNT_KEY`; `AZURE_BLOB_ENDPOINT` selects a non-default compatible service such as a local emulator. |

A configured bucket or container can remain a reader even when another driver receives new writes. Startup validates its configuration, but readiness does not prove the store is reachable: an older Document's download can fail while the app remains ready. Verify actual reads and writes, and keep stores referenced by existing Documents available. Provider identity-based credential setup is separate from the explicit-key examples here.

After a storage change, upload and download a new Document, compare its bytes, and download an older Document from the previous store. Check processing as well: the worker needs the same storage access as the app. Back up all referenced stores, including a retained local volume after moving new writes elsewhere.

## Set file and processing limits

| Setting                         | Meaning in this build                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_UPLOAD_MB`                 | Maximum size of one upload, default 100 MB. Match the proxy's body limit to the intended ceiling. An unreadable value falls back to the default instead of stopping startup, so check the ceiling an upload actually meets. |
| `DOC_ENGINE_URL`                | Defaults to the bundled `http://doc-engine:8080`. Keep the engine on its private service network.                                                                                                                           |
| `DOC_ENGINE_TIMEOUT_MS`         | Per-call processing bound, default 300000 milliseconds, maximum 420000. A larger value stops app and worker startup.                                                                                                        |
| `DOC_ENGINE_COMPARE_TIMEOUT_MS` | Word Comparison bound, default 600000 milliseconds, maximum 840000. A larger value stops startup as well. The app, worker, and engine must agree.                                                                           |
| `DOC_ENGINE_TMPFS_SIZE`         | Engine scratch-space limit, default `2g`. Scratch space consumes memory and is discarded with the container.                                                                                                                |

An unavailable engine can leave the app ready while processing fails or retries. Check the Document's actual processing state and a worker completion, not just container readiness. See [Document processing](document-previews.md) and [operator troubleshooting](operator-troubleshooting.md).

## Configure outbound email and providers

Set both `SMTP_URL` and `SMTP_FROM` to pin email to the deployment environment. A set `SMTP_URL` takes precedence over the saved wizard relay, even if the environment configuration is incomplete. Remove the override and recreate the containers if the saved relay should be used again. When neither source is configured, email-dependent flows report that email is unavailable.

An Administrator can initially save and test the relay in the welcome wizard. This build has no separate email Settings page after that wizard is finished. Use [authentication and email](authentication-and-email.md) for the Administrator steps. Verify real delivery to an intended test recipient, including the link's origin; a successful SMTP connection alone is insufficient.

Configure [Signing](configure-signing.md) and [AI analysis](configure-analysis.md) in their Administrator Settings pages. Allow the required outbound provider traffic from both the app and worker. AI model discovery and connection probes run in the app; Contract extraction runs in the worker. Signing in Polling mode uses outbound calls. Webhook mode also needs a publicly reachable HTTPS callback, which can use a separate gateway. Provider credentials and models are runtime Settings, not substitute environment variables.

## Preserve and rotate encryption keys

`AUTH_SECRET` protects session signing and authentication material, including enrolled two-factor authentication. Changing it can invalidate sessions and make that material unreadable. Preserve it for a restore; do not use an ad hoc change as an account-recovery procedure.

`OPENLAW_SECRET_KEY` encrypts the Signing connector's RSA key and HMAC secret, the saved SMTP URL, the SSO client secret, and the AI-provider key. It does not encrypt the database's Contract text or ordinary records. Store its recovery copy separately from database archives. Both processes require it at startup.

To rotate this credential key:

1. Preserve the current value in your secret store. Set `OPENLAW_SECRET_KEY_PREVIOUS` to that value and replace `OPENLAW_SECRET_KEY` with a newly generated key.
2. Recreate the app and worker with `docker compose up -d --no-build --pull never`. Check the app's re-encryption result and verify the saved configuration actually works, such as sending through the stored SMTP relay.
3. Remove `OPENLAW_SECRET_KEY_PREVIOUS` from `.env` and recreate the containers again. Verify the saved configuration once more, then retain the new key under your recovery policy.

The previous key is accepted for reads during rotation. Keeping it configured indefinitely does not finish retiring it. If the wrong key was supplied, restore the correct key and recreate the app and worker before replacing saved provider credentials. Unreadable saved secrets are retained for recovery; replacing them intentionally writes new values.
