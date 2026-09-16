# Install OpenLaw

Start a new OpenLaw instance, check its services, and hand its address to the person creating the first Administrator. Use [Upgrade a populated instance](upgrade.md) for an existing installation.

## Before you start

Use a Linux host with Git, OpenSSL, and [Docker Engine with the Compose plugin](https://docs.docker.com/engine/install/). Check `docker version` and `docker compose version`, and confirm that `docker context show` identifies your intended host. The operator needs permission to run Docker and enough disk space for the source checkout, builds, database, uploaded files, and backups.

Prepare a browser-facing hostname and TLS reverse proxy for a team deployment. The hostname can be private to the office network and VPN; public internet access is not required. For a private installation, follow [Deploy on a private VM](deployment-configuration.md#deploy-on-a-private-vm) to arrange DNS, certificates, and restricted port bindings before you start the stack. You also need an SMTP relay for invitations, sign-in links, and the welcome wizard. Creating the initial Administrator account does not send email, but the welcome wizard cannot finish until outbound email is configured. Choose an unused app port and an installation directory that will stay in place. The Compose project name identifies the installation's database and file volumes: keep it stable across restarts and upgrades.

This documentation candidate uses a committed source build, not an assumed published release. Its application revision is `57e77e386be31b2a319f7143dd54d00123e65efe`. The commands below build that revision and give its app and document-engine images their own tags. Do not substitute a moving branch or `latest` tag when reproducing this edition.

## Prepare the source and configuration

1. Clone into a new directory, enter it, and select the documented revision:

   ```bash
   git clone https://github.com/juggernog20/OpenLaw.git openlaw
   cd openlaw
   git checkout --detach 57e77e386be31b2a319f7143dd54d00123e65efe
   ```

2. Copy the example environment file. If `.env` already exists, inspect the existing installation before proceeding; do not replace its keys.

   ```bash
   (
     umask 077
     set -C
     cat .env.example > .env || exit 1
     chmod 600 .env
     sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env
     sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env
   )
   ```

   The grouped commands refuse to overwrite an existing `.env` and stop before changing its keys.

3. Edit `.env` with your chosen origin, port, and project name. The following are example values; replace the hostname before using them for a team. Add each setting once, rather than leaving duplicate entries:

   ```dotenv
   COMPOSE_PROJECT_NAME=openlaw
   COMPOSE_FILE=compose.yml:compose.operator.yml
   OPENLAW_BUILD_COMMIT=57e77e386be31b2a319f7143dd54d00123e65efe
   OPENLAW_BUILD_DIRTY=false
   BASE_URL=https://legal.example.com
   PORT=3000
   ```

4. Create `compose.operator.yml` beside `compose.yml`:

   ```yaml
   services:
     app:
       image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}
     worker:
       image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}
     doc-engine:
       image: openlaw-engine-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}
   ```

5. Save both generated keys in your secret store. Keep those recovery copies separate from database backups. `AUTH_SECRET` protects sessions and authentication material; `OPENLAW_SECRET_KEY` protects credentials saved in Settings. They are different keys and must stay consistent when an instance is restored. See [deployment configuration](deployment-configuration.md).

Run the remaining commands from this installation directory. Compose reads the project and file list from `.env`. An exported shell variable takes precedence over `.env`; remove unintended deployment overrides from your shell before starting.

For a private VM, add the private Compose overlay and set the internal HTTPS origin as described in [private deployment](deployment-configuration.md#deploy-on-a-private-vm) before running the following commands. The base Compose file otherwise publishes the app port on all host interfaces.

## Build and start

1. Check that Compose can resolve the configuration without printing its secrets:

   ```bash
   docker compose config --quiet
   docker compose config --services
   ```

   The base installation has `app`, `worker`, `postgres`, and `doc-engine`. Do not add the development overlay to a team deployment: its mail catcher replaces real delivery.

2. Obtain Postgres and build the two selected images. The worker uses the app image and does not need a separate build:

   ```bash
   docker compose pull postgres
   docker compose build app doc-engine
   docker compose up -d --no-build --pull never
   docker compose ps
   ```

3. Check readiness on the chosen local app port. Replace `3000` below with the host port you set in `.env`:

   ```bash
   curl --fail http://127.0.0.1:3000/readyz
   ```

   A successful response means the API can reach its database. Also check that the worker is running and that the document engine becomes healthy. Readiness alone does not test email, storage writes, processing, or external providers.

4. Configure the reverse proxy using [the proxy requirements](deployment-configuration.md#serve-the-intended-origin). Open the intended HTTPS address, check that it reaches **Set up OpenLaw**, and create the initial account by following [first-run setup](first-run.md). Complete this before inviting the team to the address.

For a disposable local check, set `BASE_URL` to the exact local address you will open, including its port. A local HTTP check does not establish a TLS deployment trusted by employee devices. Build and download time depend on the host and cache; check elapsed time on your host rather than assuming installation always finishes within an hour.

## Check the working installation

Sign in through the intended origin. Create a fictional Contract, upload a small supported Document, download it again, and check its processing result. Send a test invitation through the configured relay and confirm the recipient receives a usable link. Confirm that the worker processes new work after a restart. These checks exercise dependencies that `/readyz` does not cover.

Record the source revision, resolved images, project name, origin, storage location, and operator contact. Keep credentials in the secret store. Establish and test [backup and restore](backup-and-restore.md) before the instance holds work you cannot recreate.

If startup fails, use [operator troubleshooting](operator-troubleshooting.md). Missing keys, an occupied port, and an unavailable database need different corrections; repeatedly rebuilding the image does not resolve those configuration problems.
