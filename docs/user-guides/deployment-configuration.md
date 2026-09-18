# Configure a deployment

Set the origin, services, storage, and secrets used by an OpenLaw installation. Work in its installation directory and retain the Compose project and file list established by [installation](install.md).

## Know where a setting belongs

| Deployment configuration                                                                                                                                             | Administrator configuration in OpenLaw                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database, listening ports, volume mounts, local storage path, sidecar resources, authentication signing key and credential encryption keys. SMTP can be pinned here. | Organization identity, users, authentication, module definitions, Signing and AI connectors, outbound email, instance address, upload limit, object storage and document-service client settings. |

### Advanced settings

Administrators open **Settings → Advanced** at the bottom of the navigation. It contains **Outbound email**, **Authentication**, **Audit log**, and these additional pages:

- **Instance address** sets the origin used in emailed links and authentication. Use the HTTPS hostname employees can reach over the office network or VPN; a public endpoint is not required. Changing this does not configure DNS, TLS, firewall rules or the identity provider's callback registration.
- **File uploads** sets the per-file limit in MiB, from 1 to 10,240. Coordinate it with reverse-proxy limits and available resources.
- **Document storage** selects local, S3-compatible or Azure Blob storage for new documents. Enter the object-store settings, select **Test connection**, then **Save**. The test writes, reads and deletes a temporary object in every configured store, including retained readers. It runs from the API; verify worker access separately after restarting. Credentials are encrypted and write-only. Blank credential fields preserve configured credentials; an initially unconfigured store can use the deployment credential chain. Existing locations cannot be renamed or removed here because that would strand old documents. A location migration and its reader configuration remain an operator task. The local path is read-only and managed by the deployment.
- **Document processing** sets the document-service address and API/worker client timeouts. **Test connection** checks its health endpoint from the API. This does not alter sidecar timeouts or resources; coordinate those separately when raising a client timeout.
- **System status** shows database availability, active storage and document-service addresses, and recent API/worker heartbeats. A heartbeat older than one minute is shown as stale. Configuration differences are flagged as requiring a restart. Use the connection tests and a real document-processing check to verify the dependent services; a running process alone does not prove them healthy.

The four editable Advanced pages save settings in the database. Saved values override the corresponding deployment defaults. The pages show each value's source, and show the API's active value separately while a change is pending. Saves do not reconfigure a running process. Coordinate a maintenance window and restart **both** app and worker, for example `docker compose restart app worker` when only app-saved settings changed. Afterward, refresh **System status** and check that both processes have current configuration. Old process rows can remain stale for up to a day.

Keep the same encryption key on both processes. An unreadable saved Advanced configuration stops startup rather than silently switching document storage. Restore the key before restarting. Database/bootstrap secrets and volume mounts remain deployment-managed. SMTP retains its separate rule: a deployment SMTP configuration takes precedence over an app-saved relay, and saving an app relay otherwise takes effect on the next send.

If a saved address prevents sign-in, an operator can remove that section's overrides from the installation directory:

```bash
docker compose exec app node apps/api/dist/reset-advanced-settings.js instance
docker compose restart app worker
```

The recovery command also accepts `uploads`, `storage` or `processing`. It removes only that section's app-saved overrides and never prints their values. For a storage migration, stop document writes, migrate and verify the files, configure the intended locations and credentials in the deployment, then remove the saved storage overrides and recreate both services. Removing overrides alone does not move files. Keep backups and the previous stores until verification is complete.

Apply deployment changes with `docker compose up -d --no-build --pull never`. `docker compose restart` restarts the existing containers with their existing environment; it does not apply a changed `.env`. Check the effective behavior after recreation. Avoid printing `docker compose config` into a shared log: the expanded configuration can contain secrets. Use `docker compose config --quiet` for validation.

The app and worker must use the same database, file configuration, browser-facing origin, and credential encryption key. They run the same app image with different commands. The document engine receives files from them and has no database or credential-store access.

## Serve the intended origin

Set **Settings → Advanced → Instance address**, or set `BASE_URL` before first startup, to the browser-facing origin, such as `https://legal.example.com`, with no application subpath. This address can be reachable only on the company network or VPN; it does not need public internet access. It determines emailed links, authentication callbacks, signing callbacks, and accepted request origins. `PORT` changes the published host port; the app container still listens on port 3000.

The reverse proxy must terminate TLS, preserve the incoming `Origin` and `Host`, forward paths without rewriting them, and allow uploads at least as large as the app limit. Disable response buffering for `/api/events` so live updates can arrive. Keep the database and document-engine ports unpublished.

For example, a Caddy instance on the app host can forward a public hostname to the local port:

```caddy
legal.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

This example assumes a hostname eligible for automatic certificate issuance. For a private installation, use the certificate and port-binding example below. Use [Caddy's HTTPS instructions](https://caddyserver.com/docs/quick-starts/https) for DNS, public ports, and certificate prerequisites. A proxy in a container needs a reachable upstream address; its own `127.0.0.1` is not the app container. Restrict direct access to the app port through your host/network rules when the proxy is the intended entry point.

Check sign-in, an invitation link, an upload, a download, and a live update through that origin. A responding home page alone does not prove the proxy preserves authentication or event delivery. Configure origin-wide response headers and traffic limits at the proxy according to your deployment policy; the app's sign-in rate limiter remains enabled in a normal installation.

## Deploy on a private VM

Employees can use one shared OpenLaw instance over the office network or VPN without exposing it to the public internet. Their browsers connect to a private HTTPS address; they do not run OpenLaw locally. Receiving an email does not provide network access to that address.

The following example uses a VM at `10.20.30.40` and `https://openlaw.company.example`. Replace both with your organization's actual private IP and hostname. The `.example` domain is a placeholder.

### 1. Arrange private routing and DNS

Give the VM a stable private IP. Create an internal DNS record mapping the chosen hostname to that IP, and configure the company VPN to provide both DNS resolution and a route to the VM. Remote employees must connect to the VPN before opening OpenLaw links. External collaborators need approved private access too.

At the network firewall or cloud security group, allow TCP 443 to the VM only from the intended office and VPN ranges. Restrict administrative access separately. Do not add public inbound forwarding or a public load balancer for the app, and check IPv6 rules as well as IPv4. Internal DNS makes the hostname resolvable; routing and firewall rules enforce access.

### 2. Keep the app port behind the proxy

Run the HTTPS reverse proxy on the VM host. Before starting the stack, create `compose.private.yml` beside `compose.yml`:

```yaml
services:
  app:
    ports: !override
      - "127.0.0.1:3000:3000"
```

This requires Docker Compose 2.24.4 or later. The `!override` tag replaces the base file's port list. Adding a loopback mapping without it can retain the original mapping on all interfaces because of [Compose's port merge rules](https://docs.docker.com/reference/compose-file/merge/).

When following the installation guide, update these entries in `.env`:

```dotenv
COMPOSE_FILE=compose.yml:compose.operator.yml:compose.private.yml
BASE_URL=https://openlaw.company.example
PORT=3000
```

For an existing installation with other operator overlays, append `compose.private.yml` to its existing file list. Keep the project name, image selection, volumes, and secrets unchanged. The private overlay deliberately fixes the host port at 3000; if you need another port, change that mapping and the proxy upstream together.

Keep Postgres and the document engine unpublished. Do not use the development overlays. Docker publishes ports on all host addresses by default, and its rules can bypass some host firewall configurations; use the explicit loopback binding and network access controls together. See [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/) and [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

### 3. Serve HTTPS with a trusted certificate

Obtain a certificate for the actual hostname from your corporate certificate authority. Ensure employee devices trust that authority and arrange certificate renewal. Install the certificate chain and private key where the proxy service can read them, keeping the key access restricted.

For Caddy installed on the VM host, adapt this Caddyfile:

```caddy
{
    auto_https disable_redirects
}

openlaw.company.example {
    bind 10.20.30.40
    tls /etc/caddy/certs/openlaw.pem /etc/caddy/certs/openlaw-key.pem
    header {
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        X-Content-Type-Options nosniff
    }
    reverse_proxy 127.0.0.1:3000
}
```

This serves HTTPS on the VM's private address using the supplied certificate, with automatic HTTP redirects disabled. Validate the adapted Caddyfile before reloading the proxy. Apply your organization's header and traffic policies as described in the proxy requirements above. See Caddy's [bind directive](https://caddyserver.com/docs/caddyfile/directives/bind) and [certificate configuration](https://caddyserver.com/docs/caddyfile/directives/tls).

A public certificate is also possible for a domain your organization owns: use DNS-01 validation and arrange renewal through the DNS provider. That method proves domain control using public DNS records and does not require exposing the app's HTTP or HTTPS ports. The short automatic-HTTPS example above does not configure DNS-01; see [Caddy's certificate challenge options](https://caddyserver.com/docs/automatic-https#dns-challenge). Public certificates cannot be issued for the placeholder `.example` hostname.

### 4. Apply the address to links and authentication

Finish the installation guide's image build steps if this is a new instance. Validate and apply the configuration from the installation directory:

```bash
docker compose config --quiet
docker compose up -d --no-build --pull never
```

The standard Compose configuration passes `BASE_URL` to both app and worker. An address saved in **Advanced → Instance address** overrides it; update that saved value if one exists. Recreate both processes when changing it; a container restart alone does not update their environment. The production app serves both the web interface and API behind this one HTTPS origin. Port 5173 belongs to local frontend development and is not needed on the VM.

For OIDC SSO, register `https://openlaw.company.example/api/auth/sso/callback` with the identity provider, replacing the hostname with the real one. Employees' browsers must reach both the identity provider and the private OpenLaw callback, and the app must reach the provider's required endpoints. Match the callback to the configured origin.

New invitation, password-setup, and sign-in emails must use the configured HTTPS hostname. `localhost` always refers to the recipient's own computer. Changing `BASE_URL` does not rewrite previously sent emails; issue fresh links after the change.

### 5. Allow outbound services and verify access

A private app can send real email through a corporate or hosted SMTP relay using an outbound connection. Allow the configured SMTP host and port, DNS, and required identity-provider or other service endpoints from the processes that use them. No inbound SMTP port or public app endpoint is needed to send email. Configure the relay in the welcome wizard or pin it in the environment as described below.

Signing in Polling mode also uses outbound connections. Webhook mode needs a reachable provider callback; use a separately controlled gateway if required. Do not expose the whole app just to enable a webhook.

Before inviting the team, check the following from an employee device:

- On the office network or VPN, the hostname resolves to the private address, HTTPS is trusted, and sign-in works.
- A newly issued invitation or password-setup email points to that hostname and opens successfully while connected to the private network.
- Uploads, downloads, processing, and live updates work through the proxy; SSO returns to the correct address if enabled.
- From outside the permitted network with the VPN disconnected, the app is unreachable. Direct access to the VM's port 3000 is also unavailable from another device.

Record the hostname, VPN requirements, certificate renewal owner, and firewall rules with the installation's operational configuration.

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

Set both `SMTP_URL` and `SMTP_FROM` to pin email to the deployment environment. A set `SMTP_URL` takes precedence over the saved wizard relay, even if the environment configuration is incomplete. Remove the override and recreate the containers if the saved relay should be used again. If `SMTP_URL` is set and `SMTP_FROM` is not, OpenLaw cannot send email. The email step of the welcome wizard shows a warning that the environment sets `SMTP_URL` but not `SMTP_FROM`, and it has no **Send test email** button. An Administrator cannot finish the welcome wizard in that state. The sign-in page does not show **Set up or reset your password** or **Email me a sign-in link**. The API also refuses test email, sign-in link, password-setup, and invite requests, and no email reaches the relay. Expect **Send invite** in **Settings → Users → Invite user** to refuse with a message that names the environment, and expect no **Invited** row. Expect the same message beside the row from **Resend invite**. Set both values, then invite a test address and check that the invitation reaches the relay.

An Administrator can save and test the relay in the welcome wizard or afterward at **Settings → Advanced → Outbound email**. Use [authentication and email](authentication-and-email.md) for the Administrator steps. Verify real delivery to an intended test recipient, including the link's origin; a successful SMTP connection alone is insufficient.

Configure [Signing](configure-signing.md) and [AI analysis](configure-analysis.md) in their Administrator Settings pages. Allow the required outbound provider traffic from both the app and worker. AI model discovery and connection probes run in the app; Contract extraction and Conversion drafts run in the worker. Signing in Polling mode uses outbound calls. Webhook mode also needs a publicly reachable HTTPS callback, which can use a separate gateway. Provider credentials and models are runtime Settings, not substitute environment variables.

## Preserve and rotate encryption keys

`AUTH_SECRET` protects session signing and authentication material, including enrolled two-factor authentication. Changing it can invalidate sessions and make that material unreadable. Preserve it for a restore; do not use an ad hoc change as an account-recovery procedure.

`OPENLAW_SECRET_KEY` encrypts the Signing connector's RSA key and HMAC secret, the saved SMTP server address and credentials, the SSO client secret, the AI-provider key, and the saved Advanced configuration, including object-store credentials. It does not encrypt the database's Contract text or ordinary records. Store its recovery copy separately from database archives. Both processes require it at startup.

To rotate this credential key:

1. Preserve the current value in your secret store. Set `OPENLAW_SECRET_KEY_PREVIOUS` to that value and replace `OPENLAW_SECRET_KEY` with a newly generated key.
2. Recreate the app and worker with `docker compose up -d --no-build --pull never`. Check the app's re-encryption result and verify the saved configuration actually works, such as sending through the stored SMTP relay.
3. Remove `OPENLAW_SECRET_KEY_PREVIOUS` from `.env` and recreate the containers again. Verify the saved configuration once more, then retain the new key under your recovery policy.

The previous key is accepted for reads during rotation. Keeping it configured indefinitely does not finish retiring it. If the wrong key was supplied, restore the correct key and recreate the app and worker before replacing saved provider credentials. Unreadable saved secrets are retained for recovery; replacing them intentionally writes new values.
