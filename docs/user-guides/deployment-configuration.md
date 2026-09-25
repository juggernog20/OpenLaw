# Configure a deployment

Set the origin, services, storage, and secrets used by an OpenLaw installation. Work in its installation directory and retain the Compose project and file list established by [installation](install.md).

## Know where a setting belongs

| Deployment configuration                                                                                                                                                                                                                                                                           | Administrator configuration in OpenLaw                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database, published host address and port, trusted proxies, setup token, volume mounts, local storage path, container resource limits, authentication signing key, credential encryption keys and an optional Web Push key pair. SMTP can be pinned here. Any Advanced setting set here is pinned. | Organization identity, users, authentication, module definitions, Signing and AI connectors, MCP, outbound email. Also the Advanced instance address, upload limit, object storage, document-service client and MCP limit settings that the deployment leaves empty. |

### Advanced settings

Administrators open **Settings → Advanced** at the bottom of the navigation. It contains **Outbound email**, **Authentication** and **Audit log**, and these pages:

- **Instance address** has one field, **Application address**. It sets the origin used in emailed links and authentication. Use the HTTPS hostname employees reach over the office network or VPN. A public endpoint is not required. Changing it does not configure DNS, TLS, firewall rules or the identity provider's callback registration.
- **File uploads** has **Maximum file size (MiB)**, a whole number from 1 to 10,240. Coordinate it with reverse-proxy limits and available resources.
- **Document storage** chooses local, S3-compatible or Azure Blob storage for new documents in **Store new documents in**. Enter the object-store settings, select **Test connection**, then **Save**. **Save** stays unavailable until a test of the current values passes, and the API refuses a save more than 10 minutes after that test. The test writes, reads and deletes a temporary object in local storage and in every configured object store, including retained readers. It runs from the API only, so check worker access separately after the restart. Credentials are encrypted and write-only. A blank credential field keeps the configured credential. A store configured with blank credentials uses the deployment's credential chain. After a bucket or container is configured, its location fields are read only, because a change would strand old documents. A location migration and its reader configuration remain an operator task. **Local storage path** is always read only.
- **Document processing** has **Document service address**, **Processing timeout (milliseconds)** and **Comparison timeout (milliseconds)**. The timeouts apply to the API and worker clients. **Test connection** calls the service's health endpoint from the API. It does not change the document engine's own timeouts or resources; coordinate those separately when you raise a client timeout. The standard Compose file always sets `DOC_ENGINE_URL`, so **Document service address** is read only there. Change it in `.env`.
- **MCP** has **Calls per hour per credential**, default 600, and **OAuth grant lifetime (days)**, from 1 to 365, default 90.
- **System status** shows database availability, the active storage driver, the active document-service address, and one row for each API and worker process. A process with no heartbeat in the last minute shows **No recent heartbeat**, and the page warns that a heartbeat is missing. A process that started with a different configuration from the saved one shows **Restart required** under **Configuration**. Use the connection tests and a real document-processing check to verify the dependent services. A running process alone does not prove them healthy.

Each field shows its source under the value: **Saved in OpenLaw**, **Deployment configuration** or **Default**. The deployment environment always wins. When `.env` or the shell sets a key to a non-empty value, the field shows **Deployment configuration · Read only**, and the API refuses a different value. A value saved in OpenLaw earlier for that key is ignored. A page on which every field is pinned has no **Save** button. A saved value replaces OpenLaw's default only for a key the deployment leaves empty.

A saved **Application address**, **Document service address** or object-store endpoint must use `https`. The API accepts plain `http` only for `localhost`, a private IP address, or a host named in `OPENLAW_PLAIN_HTTP_HOSTS`, a comma-separated list in `.env`. An internal DNS name is not a private IP address for this check. Values from the environment are not checked.

A save does not reconfigure a running process. The page shows **Settings saved. Restart the API and worker to apply changes.**, and each changed value shows **Active:** with the value still in use. Coordinate a maintenance window and restart both app and worker, for example `docker compose restart app worker` when only app-saved settings changed. Then select **Refresh** on **System status** and check that both processes show **Running** and **Current**.

Each save writes an Audit log entry. A save that moves an endpoint to another host also writes an entry and a process log line with the old and new host names. Neither contains a credential.

The API refuses a save and shows the reason when:

- another session saved the page since it loaded: "These settings changed in another session. Reload the page before saving."
- a value is out of range or malformed, such as an **Application address** with a path.
- the save would change or remove a configured bucket or container location.
- a pinned value is itself invalid, such as `MAX_UPLOAD_MB=ten`. Every Advanced save then fails with that setting's message until you correct `.env` and recreate the containers.

Only an Administrator can open these pages. The navigation does not show them to other roles, opening their address leads elsewhere, and the API refuses their requests with 403.

Keep the same encryption key on both processes. The saved Advanced configuration is sealed with `OPENLAW_SECRET_KEY`. With a key that cannot open it, the app and worker still start, and every saved value falls back to the deployment environment or the default. Document storage then falls back to the local driver. See [Preserve and rotate encryption keys](#preserve-and-rotate-encryption-keys) for the symptoms and recovery. Database/bootstrap secrets and volume mounts remain deployment-managed. SMTP has its own rule: a deployment SMTP configuration takes precedence over an app-saved relay, and saving an app relay otherwise takes effect on the next send.

If a saved address prevents sign-in, set `BASE_URL` in `.env` and recreate app and worker; the environment value pins the address. Removing the saved address alone is not enough: the app then uses `BASE_URL`, or `http://localhost:3000` when `BASE_URL` is empty, and sign-in at the public address still fails. To remove one section's saved overrides from the installation directory:

```bash
docker compose run -T --rm --no-deps app node apps/api/dist/reset-advanced-settings.js instance
docker compose restart app worker
```

The recovery command also accepts `uploads`, `storage`, `processing` or `mcp`. It removes only that section's app-saved overrides, never prints their values, and writes an Audit log entry. `run` starts a one-off container, so the command works while the app keeps restarting. It needs the correct `OPENLAW_SECRET_KEY`. With a key that cannot open the saved settings, it still exits successfully, but it replaces the whole saved configuration with an empty one. That removes every section's saved values, not only the named section, and the correct key can no longer recover them. For a storage migration, stop document writes, migrate and verify the files, configure the intended locations and credentials in the deployment, then remove the saved storage overrides and recreate both services. Removing overrides alone does not move files. Keep backups and the previous stores until verification is complete.

Apply deployment changes with `docker compose up -d --no-build --pull never`. `docker compose restart` restarts the existing containers with their existing environment; it does not apply a changed `.env`. Check the effective behavior after recreation. Avoid printing `docker compose config` into a shared log: the expanded configuration can contain secrets. Use `docker compose config --quiet` for validation.

`SETUP_TOKEN` is optional. While the installation has no users, the app prints a new setup token to its log at each start. Set `SETUP_TOKEN` to choose the token, for example with more than one API replica. The app ignores it once a user exists.

The app and worker must use the same database, file configuration, browser-facing origin, credential encryption key and Web Push key pair. They run the same app image with different commands. The document engine receives files from them and has no database or credential-store access.

## Serve the intended origin

Set `BASE_URL` in `.env` to the browser-facing origin, such as `https://legal.example.com`, with no application subpath. When `BASE_URL` is set, it pins **Instance address**. Leave it empty only if an Administrator will set **Application address** in **Settings → Advanced → Instance address** instead. This address can be reachable only on the company network or VPN; it does not need public internet access. It determines emailed links, authentication callbacks, signing callbacks, and accepted request origins. `PORT` changes the published host port. `APP_BIND` changes the host address the port is published on, default `127.0.0.1`. The app container still listens on port 3000.

The reverse proxy must terminate TLS, preserve the incoming `Origin` and `Host`, forward paths without rewriting them, and allow uploads at least as large as the app limit. Disable response buffering for `/api/events` so live updates can arrive. Keep the database and document-engine ports unpublished.

The proxy must also set `X-Forwarded-For` to the client's address, replacing any value the client sent, and set `X-Forwarded-Proto`. Caddy's `reverse_proxy` does both by default. Then set `TRUSTED_PROXIES` in `.env` to the address that the proxy's connections come from, as the app sees it. The app reads the client address from `X-Forwarded-For` only when the request comes from a listed address. Without the list, everyone behind the proxy shares one sign-in rate-limit bucket, and the app logs a warning at start.

### Find the trusted proxy address

`TRUSTED_PROXIES` is a comma-separated list. Each entry is an IP address or a CIDR range. A proxy on the same host does not reach the app from `127.0.0.1`. Docker forwards the published port into the container, so the proxy's connections arrive from the gateway of the app's Compose network. Read that gateway and the network's range after the first start. Replace the first `openlaw` with your `COMPOSE_PROJECT_NAME`:

```bash
docker network inspect openlaw_openlaw-backend --format '{{range .IPAM.Config}}{{.Gateway}} {{.Subnet}}{{end}}'
```

Set `TRUSTED_PROXIES` to the gateway address, such as `172.18.0.1`, then run `docker compose up -d --no-build --pull never`. Docker can give the network another range when it creates it again, for example after `docker compose down`. Read the gateway again after that. A proxy on another host, reached through `APP_BIND`, keeps its own source address. List that address.

Check the value through the proxy. Sign in once from a browser, then list the client addresses the app recorded:

```bash
docker compose logs --since=5m app | grep -o '"remoteAddress":"[^"]*"' | sort | uniq -c
```

With a correct value, the lines show the browsers' addresses. If every request shows the gateway address, the list does not match the proxy.

A value that does not match, such as `127.0.0.1,::1` for a proxy on the same host, trusts nothing. Every visitor then shares one sign-in rate-limit bucket, as with an empty list, but the app logs no warning. A few wrong passwords from one person then refuse password sign-in for everyone for a short time. An entry that is not an IP address or CIDR range stops the app at start with `invalid IP address`. Never list a range that also contains clients.

For example, a Caddy instance on the app host can forward a public hostname to the local port:

```caddy
legal.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

This example assumes a hostname eligible for automatic certificate issuance. For a private installation, use the certificate example below. Use [Caddy's HTTPS instructions](https://caddyserver.com/docs/quick-starts/https) for DNS, public ports, and certificate prerequisites.

The standard Compose file publishes the app only on the host's `127.0.0.1`, so a proxy running directly on the host can reach it. A proxy in a container has its own `127.0.0.1`, and a proxy on another host cannot reach the host's loopback address. For those, set `APP_BIND` to a host address the proxy can reach, such as `0.0.0.0`. Add a network rule that admits only the proxy to the port, and set `TRUSTED_PROXIES` to the address the proxy connects from, as described in [Find the trusted proxy address](#find-the-trusted-proxy-address).

Check sign-in, an invitation link, an upload, a download, and a live update through that origin. A responding home page alone does not prove the proxy preserves authentication or event delivery. Configure origin-wide response headers and traffic limits at the proxy according to your deployment policy; the app's sign-in rate limiter remains enabled in a normal installation.

## Deploy on a private VM

Employees can use one shared OpenLaw instance over the office network or VPN without exposing it to the public internet. Their browsers connect to a private HTTPS address; they do not run OpenLaw locally. Receiving an email does not provide network access to that address.

The following example uses a VM at `10.20.30.40` and `https://openlaw.company.example`. Replace both with your organization's actual private IP and hostname. The `.example` domain is a placeholder.

### 1. Arrange private routing and DNS

Give the VM a stable private IP. Create an internal DNS record mapping the chosen hostname to that IP, and configure the company VPN to provide both DNS resolution and a route to the VM. Remote employees must connect to the VPN before opening OpenLaw links. External collaborators need approved private access too.

At the network firewall or cloud security group, allow TCP 443 to the VM only from the intended office and VPN ranges. Restrict administrative access separately. Do not add public inbound forwarding or a public load balancer for the app, and check IPv6 rules as well as IPv4. Internal DNS makes the hostname resolvable; routing and firewall rules enforce access.

### 2. Keep the app port behind the proxy

Run the HTTPS reverse proxy on the VM host. The standard Compose file publishes the app on `127.0.0.1` only, so no override file is needed. Leave `APP_BIND` unset. When following the installation guide, add these entries to `.env`:

```dotenv
BASE_URL=https://openlaw.company.example
PORT=3000
```

After the first start, set `TRUSTED_PROXIES` to the gateway address from [Find the trusted proxy address](#find-the-trusted-proxy-address) and recreate the app.

For an existing installation, keep the project name, image selection, file list, volumes, and secrets unchanged. If you need another port, change `PORT` and the proxy upstream together. After startup, `docker compose port app 3000` must print `127.0.0.1:3000`. If it prints `0.0.0.0:3000`, remove `APP_BIND` from `.env` and from the shell, then recreate the app.

An earlier edition of this guide added a `compose.private.yml` overlay with `ports: !override`. It gives the same loopback mapping, so you can keep it in `COMPOSE_FILE` or remove it. While it stays in the list, it fixes the host port at 3000 and ignores `PORT` and `APP_BIND`.

Keep Postgres and the document engine unpublished. Do not use the development overlays. Docker's port rules can bypass some host firewall configurations, so use the loopback binding and network access controls together. See [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/) and [Docker firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

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

The standard Compose configuration passes `BASE_URL` to both app and worker. When it is set, it pins **Advanced → Instance address**, and an address saved there earlier is ignored. Recreate both processes when changing it; a container restart alone does not update their environment. The production app serves both the web interface and API behind this one HTTPS origin. Port 5173 belongs to local frontend development and is not needed on the VM.

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

## LAN only

This profile serves API keys and Claude Code's loopback OAuth. OAuth requires an HTTPS `BASE_URL`, or HTTP on a loopback host for development. A plain-HTTP LAN address boots without the authorization server. Keys work, OAuth Clients toggles refuse with failed checks named, and the well-known documents answer 404. Use a trusted private HTTPS origin to enable OAuth on the LAN.

Run MCP at the private HTTPS origin from [Deploy on a private VM](#deploy-on-a-private-vm). Keep the loopback app binding, private DNS, trusted certificate, and office/VPN firewall rules from that profile. No public address, inbound internet forwarding, or OAuth configuration is needed for API keys.

1. Set the intended private Instance address and recreate app and worker as described above. An Administrator copies **Server address** from **Settings → Organization → MCP**. It should read `https://openlaw.company.example/mcp`, with your actual hostname.
2. Forward `/mcp` and its upload paths unchanged to the app. Preserve `x-api-key`, `Authorization`, MCP protocol headers, and `Accept` and `Content-Type`. The private Caddy example forwards these paths through the same upstream. Do not put an interactive proxy sign-in page in front of the MCP endpoint.
3. Ask the Administrator to [enable MCP and the intended account group's API keys](configure-mcp.md#enable-api-keys). Keep the Toolset ceiling and Read-only policy appropriate to the work.
4. From a device on the office network or VPN, follow [Connect a headless Client](connect-headless-client.md). Approve the key request, read the key once, and confirm that the Client connects and lists Tools.
5. Revoke the test key and confirm that the next Client request is unauthorized. With VPN disconnected on an outside device, confirm that the private address is unreachable. Keep direct app port 3000 unavailable from other devices.

The Client device needs private DNS, routing, and certificate trust, even if its model service is hosted elsewhere. Give Node-based Clients the corporate CA through their supported trust configuration, such as `NODE_EXTRA_CA_CERTS` pointing to a PEM CA file before starting Claude Code. Do not disable certificate verification. A private OpenLaw endpoint does not make the Client's model service local; outbound access to that service follows the Client's own requirements.

For [Claude Code with OAuth](connect-claude.md#connect-claude-code), also forward the discovery, authorization, sign-in and consent paths in the publicly reachable profile below. Keep them private. Keep Claude Code enabled in Allowed Clients and enable OAuth Clients for the person's account group. The browser and Client reach OpenLaw over the office network or VPN; the browser returns to Claude Code's loopback callback on the same device. The API needs outbound access to Claude Code's published identity. The public-address pill may warn on this private deployment.

`/mcp` uses Streamable HTTP. There is no separate `/sse` endpoint or browser-cookie authentication. Signed Document upload URLs returned by a Tool use the same private origin and need the same routing and upload limits. Treat the complete signed URL as a credential while it is valid.

## Publicly reachable

Use this profile for claude.ai, Claude Desktop and Cowork custom connectors, ChatGPT, and Microsoft-hosted Copilot connections. Their servers must reach OpenLaw. A VPN on the person's device is not enough.

1. Give the instance a public DNS hostname with a public IPv4 address. Terminate TLS there with a publicly trusted certificate. Set that HTTPS origin as `BASE_URL`, without an application subpath. Use the saved **Application address** only when `BASE_URL` is empty. Recreate app and worker after environment changes; restart both after app-saved changes.
2. Keep the app port behind the reverse proxy and the database and document engine unpublished. Forward the paths below unchanged on the same host. Do not redirect a Client to another hostname, rewrite paths, or put an interactive proxy sign-in in front of the protocol endpoints.
3. Preserve `Authorization`, MCP protocol headers, `Accept` and `Content-Type`, and preserve `x-api-key` if keys are enabled. Preserve browser cookies, `Origin`, `Host` and query strings for sign-in and consent. Keep Streamable HTTP responses unbuffered. Allow signed uploads within the app's upload limit.
4. Apply the vendor source allowlists below if the firewall limits incoming connections. Also allow the people's browsers to reach sign-in and consent. Allow the API outbound HTTPS and DNS access to the published identity metadata and signing-key URLs. Keep the existing outbound identity-provider access for SSO.
5. Ask an Administrator to [enable OAuth Clients](configure-mcp.md#enable-oauth-clients). Inspect the **Reachable** or **Not reachable ·** pill beside **Server address**. Test a connection from each intended vendor, choose consent, call a Tool, then disconnect and confirm the next call is refused.

| Paths to forward unchanged                                                                       | Purpose                                                                           |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `/mcp` and `/mcp/uploads`                                                                        | Streamable HTTP and signed Document uploads                                       |
| `/.well-known/oauth-authorization-server` and `/.well-known/oauth-authorization-server/api/auth` | Authorization server discovery                                                    |
| `/.well-known/openid-configuration` and `/.well-known/openid-configuration/api/auth`             | Alternate authorization server discovery                                          |
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`          | MCP resource discovery                                                            |
| `/api/auth/*`, including `/api/auth/oauth2/*`, `/api/auth/jwks` and `/api/auth/.well-known/*`    | Authorization, token exchange, signing keys, discovery aliases and normal sign-in |
| `/auth/consent` and `/api/v1/oauth-grants/consent`                                               | Consent page, its facts and its answer                                            |
| `/auth/*`, `/portal/login`, the app's static assets and normal sign-in API routes                | Browser sign-in and its return to consent                                         |

Forwarding the complete app origin, as in the Caddy example above, preserves these routes. A path-restricted gateway must also carry the normal browser sign-in flow and its callbacks. Discovery must return JSON, not the SPA HTML fallback. An unauthenticated `/mcp` request should return 401 with a `WWW-Authenticate` header pointing to resource discovery.

The reachability warning checks the HTTPS scheme, an IPv4 record and public IPv4 addresses from the API's view. Private DNS or a missing IPv4 record does not block saving OAuth Clients when the authorization server is available, because a proxy may front it. A passing pill does not prove vendor reachability or certificate trust. See [each failed check](configure-mcp.md#enable-oauth-clients).

OAuth requires an HTTPS `BASE_URL`, or HTTP on a loopback host for development. Loopback development is not a publicly reachable deployment. A plain-HTTP LAN address boots without the authorization server: API keys work, OAuth Clients toggles refuse with failed checks named, and the well-known documents return 404. Putting TLS on a proxy without updating the effective Instance address does not enable OAuth.

The OAuth grant lifetime is in **Settings → Advanced → MCP → OAuth grant lifetime (days)**. It defaults to 90 days, with a range of 1 to 365. `MCP_OAUTH_GRANT_LIFETIME_DAYS` pins the value when set in the deployment. A pinned value outside that range stops the app at startup. **Calls per hour per credential** on the same page defaults to 600, and `MCP_RATE_LIMIT_PER_HOUR` pins it. A pinned rate limit that is not a positive whole number falls back to 600. Restart app and worker after app-saved changes.

### Allow vendor egress addresses

These are the vendors' outbound source addresses, allowed inbound to your public HTTPS listener. They do not replace OAuth or the Allowed Clients list.

| Client service | Source allowlist and maintenance                                                                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic      | Allow `160.79.104.0/21`. Track [Anthropic's outbound IP addresses](https://platform.claude.com/docs/en/api/ip-addresses).                                                                                                                                                                                                   |
| OpenAI         | Read the current prefixes from [chatgpt-connectors.json](https://openai.com/chatgpt-connectors.json). Refresh the firewall on a schedule, for example daily, and alert on failed refreshes. See [OpenAI's egress guidance](https://developers.openai.com/api/docs/guides/ip-addresses).                                     |
| Copilot Studio | Use the regional `AzureConnectors` and `PowerPlatformPlex` service tags for the tenant's geography. Refresh their address ranges at least every 90 days using Microsoft's discovery API or download. See [managed connector outbound addresses](https://learn.microsoft.com/en-us/connectors/common/outbound-ip-addresses). |

Copilot Studio's ranges do not establish the egress ranges for Microsoft 365 Copilot chat or the Agent 365 gateway. Those ranges are not published in the cited connector list. Confirm the network requirements for that path before applying a source-only restriction.

## Connect the database

With `DATABASE_URL` unset, Compose uses its bundled Postgres 16 database and named volume. To use an external PostgreSQL 16-or-later database, supply its connection URL and access credentials. The app applies migrations when it starts; that database account must be able to perform them. The worker reads the same URL.

The bundled Postgres service remains part of the base Compose topology when an external URL is configured. Its availability does not prove the external database is reachable. Check `/readyz`, the app's startup result, and actual record writes against the selected database.

Keep the database version and credentials with your operational configuration. Changing `DATABASE_URL` selects another database; it does not transfer an existing installation's records. Use [backup and restore](backup-and-restore.md) for a deliberate move.

## Select and retain storage

`STORAGE_DRIVER` chooses where new files are written. A storage variable set in `.env` pins the matching field in **Settings → Advanced → Document storage**. Existing files remember their own storage driver, so changing the setting does not move earlier files. Keep every old store and its reader configuration available for as long as a stored file refers to it.

| Driver       | Required setup                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`      | The default. Keep `STORAGE_PATH=/var/lib/openlaw/files` under the standard Compose deployment. Both app and worker mount the same named volume there. A different path can have unsuitable ownership for the image's unprivileged user.                                |
| `s3`         | Create the bucket first. Set `S3_BUCKET`, and the endpoint, region, addressing, and credentials appropriate to the store. An S3-compatible service can use `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=true`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.                  |
| `azure-blob` | Create the container first. Set `AZURE_BLOB_CONTAINER`, `AZURE_BLOB_ACCOUNT`, and the credential configuration. For an explicit-key connection, use `AZURE_BLOB_ACCOUNT_KEY`; `AZURE_BLOB_ENDPOINT` selects a non-default compatible service such as a local emulator. |

A configured bucket or container can remain a reader even when another driver receives new writes. Startup validates its configuration, but readiness does not prove the store is reachable: an older Document's download can fail while the app remains ready. Verify actual reads and writes, and keep stores referenced by existing Documents available. Provider identity-based credential setup is separate from the explicit-key examples here.

After a storage change, upload and download a new Document, compare its bytes, and download an older Document from the previous store. Check processing as well: the worker needs the same storage access as the app. Back up all referenced stores, including a retained local volume after moving new writes elsewhere.

## Set file and processing limits

| Setting                                                            | Meaning in this build                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MAX_UPLOAD_MB`                                                    | Maximum size of one upload in MiB, default 100. Match the proxy's body limit to the intended ceiling. An unreadable value falls back to the default instead of stopping startup, so check the ceiling an upload actually meets. A set value pins **File uploads**. |
| `DOC_ENGINE_URL`                                                   | Defaults to the bundled `http://doc-engine:8080`, which pins **Document service address** under Compose. Keep the engine on its private service network.                                                                                                           |
| `DOC_ENGINE_TIMEOUT_MS`                                            | Per-call processing bound, default 300000 milliseconds, maximum 420000. A larger value stops app and worker startup.                                                                                                                                               |
| `DOC_ENGINE_COMPARE_TIMEOUT_MS`                                    | Word Comparison bound, default 600000 milliseconds, maximum 840000. A larger value stops startup as well. The app, worker, and engine must agree.                                                                                                                  |
| `DOC_ENGINE_TMPFS_SIZE`                                            | Engine scratch-space limit, default `2g`. Scratch space consumes memory and is discarded with the container.                                                                                                                                                       |
| `DOC_ENGINE_MAX_CONCURRENT`, `DOC_ENGINE_MAX_QUEUED`               | How many engine tools run at once, default 2, and how many requests wait for a slot, default 8. Past both, the engine answers 503 with `Retry-After` and the caller retries.                                                                                       |
| `APP_CPUS`, `APP_MEM_LIMIT`, `APP_PIDS_LIMIT`                      | App container limits, default `2` CPUs, `1g` memory and 256 processes.                                                                                                                                                                                             |
| `WORKER_CPUS`, `WORKER_MEM_LIMIT`, `WORKER_PIDS_LIMIT`             | Worker container limits, with the app's defaults.                                                                                                                                                                                                                  |
| `DOC_ENGINE_CPUS`, `DOC_ENGINE_MEM_LIMIT`, `DOC_ENGINE_PIDS_LIMIT` | Engine container limits, default `2` CPUs, `4g` memory and 512 processes. Keep the memory limit above `DOC_ENGINE_TMPFS_SIZE`, because scratch space counts against it.                                                                                            |

The resource limits are ceilings, not reservations. The defaults fit a 4 CPU, 8 GB host with room for Postgres. Raise them in `.env` for a larger team and recreate the containers.

An unavailable engine can leave the app ready while processing fails or retries. Check the Document's actual processing state and a worker completion, not just container readiness. See [Document processing](document-previews.md) and [operator troubleshooting](operator-troubleshooting.md).

## Configure outbound email and providers

Set both `SMTP_URL` and `SMTP_FROM` to pin email to the deployment environment. A set `SMTP_URL` takes precedence over the saved wizard relay, even if the environment configuration is incomplete. Remove the override and recreate the containers if the saved relay should be used again. If `SMTP_URL` is set and `SMTP_FROM` is not, OpenLaw cannot send email. The email step of the welcome wizard shows a warning that the environment sets `SMTP_URL` but not `SMTP_FROM`, and it has no **Send test email** button. An Administrator cannot finish the welcome wizard in that state. The sign-in page does not show **Set up or reset your password** or **Email me a sign-in link**. The API also refuses test email, sign-in link, password-setup, and invite requests, and no email reaches the relay. Expect **Send invite** in **Settings → Users → Invite user** to refuse with a message that names the environment, and expect no **Invited** row. Expect the same message beside the row from **Resend invite**. Set both values, then invite a test address and check that the invitation reaches the relay.

An Administrator can save and test the relay in the welcome wizard or afterward at **Settings → Advanced → Outbound email**. Use [authentication and email](authentication-and-email.md) for the Administrator steps. Verify real delivery to an intended test recipient, including the link's origin; a successful SMTP connection alone is insufficient.

Configure [Signing](configure-signing.md) and [AI analysis](configure-analysis.md) in their Administrator Settings pages. Allow the required outbound provider traffic from both the app and worker. AI model discovery and connection probes run in the app; Contract extraction and Conversion drafts run in the worker. Signing in Polling mode uses outbound calls. Webhook mode also needs a publicly reachable HTTPS callback, which can use a separate gateway. Provider credentials and models are runtime Settings, not substitute environment variables.

## Preserve and rotate encryption keys

`AUTH_SECRET` protects session signing and authentication material, including enrolled two-factor authentication. Changing it can invalidate sessions and make that material unreadable. Preserve it for a restore; do not use an ad hoc change as an account-recovery procedure.

`OPENLAW_SECRET_KEY` encrypts the Signing connector's RSA key and HMAC secret, the saved SMTP server address and credentials, the SSO client secret, Saved keys for AI provider destinations, the saved Advanced configuration including object-store credentials, the generated Web Push private key, and an approved API key until its owner reads it once. It does not encrypt the database's Contract text or ordinary records. Store its recovery copy separately from database archives. Both processes require it at startup.

To rotate this credential key:

1. Preserve the current value in your secret store. Set `OPENLAW_SECRET_KEY_PREVIOUS` to that value and replace `OPENLAW_SECRET_KEY` with a newly generated key.
2. Recreate the app and worker with `docker compose up -d --no-build --pull never`. Check the app's re-encryption result and verify the saved configuration actually works, such as sending through the stored SMTP relay.
3. Remove `OPENLAW_SECRET_KEY_PREVIOUS` from `.env` and recreate the containers again. Verify the saved configuration once more, then retain the new key under your recovery policy.

Device notifications use a VAPID key pair. With `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` unset, OpenLaw generates a pair on first use and stores it. Set both to pin a pair of your own; setting only one stops startup. Use the same pair for app and worker, and keep it stable while browsers are subscribed. A new pair means people must enable device notifications again.

The previous key is accepted for reads during rotation. Keeping it configured indefinitely does not finish retiring it.

A wrong `OPENLAW_SECRET_KEY` does not stop the app or the worker. Each stored value the key cannot open reads as empty:

- Saved **Settings → Advanced** values fall back to the deployment environment or the default, and those fields show **Default**. The instance address becomes `BASE_URL`, or `http://localhost:3000` when `BASE_URL` is empty. Storage becomes the local driver, so a Document stored only in a saved bucket or container fails to download.
- The saved SMTP relay reads as unset, and a test email fails with **The test email could not be sent. SMTP is not configured — save a relay first.**
- The Signing connector shows its private key and Connect secret as missing. Sending fails, and webhook deliveries are refused.
- The AI connector's Saved key reads as missing, so calls to a provider that needs a key fail.
- SSO sign-in through a saved provider fails, because its client configuration cannot be read.
- Device notifications stop. The app logs **Device notifications are off until the VAPID pair can be read**.

The app's start log names each affected column in a line that begins **No configured key opens these stored credentials**, for example `advanced_settings`, `smtp_url` and `vapid_private_key`. Restore the correct key, then recreate the app and worker. Until then, do not save in **Settings → Advanced**, run the recovery command, or paste credentials again. Each of those writes over a value that the correct key can still open.

If the key is lost, the same symptoms remain. Set `BASE_URL` and the storage variables in `.env` first, so that the instance address and every store that holds Documents are pinned. Then paste the provider credentials again and save the Advanced values again. A value you save replaces the unreadable one for good.
