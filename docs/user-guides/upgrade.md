# Upgrade a populated instance

Replace the application build while preserving the installation's database, files, and configuration. First rehearse the change on an isolated copy and verify [backup-based recovery](backup-and-restore.md).

## Before you start

Use the operator account and installation directory from [installation](install.md). Record the existing source revision, app and engine image identities, Compose project name, file list, and storage configuration. An Administrator can also save the instance address, upload limit, storage and document-service settings in **Settings → Advanced**. Record every field there that shows **Saved in OpenLaw**. Keep the existing authentication and credential encryption keys. A new project name creates a different set of default volumes; it is not an upgrade of the original installation.

This edition uses source revision `067c1646829df85e62b809ee9157921e867c84e7` as its candidate. The starting build for this procedure's checks is development revision `d1d098ba9f4ba6557a542857d530446b76b1847c`. Do not assume that every older release or database schema can be upgraded without additional work. Read the target build's migration and deployment changes first.

From that starting build, the candidate applies every migration up to `0171_m41-oauth-clients`. Several of them rewrite existing data:

- Every Business Owner becomes a team member of their Contract or Matter. The record's Activity shows the addition.
- A Field that more than one module used becomes one Field per module. The Contract module keeps the original Field. Each other module gets a copy with the same name, and each record keeps its saved value.
- Request type questions move onto the Form of the destination Contract type or Matter type. The earlier protected intake Fields are removed after their answers move to the Request.
- Contract Document Versions get the Document type that matches their kind.
- A saved AI connector key becomes a Saved key for that provider destination.

One of these migrations can stop the start. It refuses a Request type whose intake questions have no Row on the destination type. See [Migration failures](operator-troubleshooting.md#migration-failures) before you schedule the pause.

Tell users when writes will pause. Check outstanding signing and processing work before the pause. Prepare enough free space for the coherent backup and the new images, and keep the old source, images, and backup until the upgraded instance has been accepted.

## Prepare the target without changing the live data

1. Fetch the source and inspect local changes:

   ```bash
   git status --short
   git fetch origin
   git rev-parse HEAD
   ```

   Preserve operator overrides and local changes before switching revisions. Do not discard them to make a checkout succeed.

2. Select the intended committed target and update `OPENLAW_BUILD_COMMIT` in `.env` to the same revision. Keep `COMPOSE_PROJECT_NAME`, the keys, and existing storage/database settings unchanged unless a separately planned migration requires a change.

   ```bash
   git checkout --detach 067c1646829df85e62b809ee9157921e867c84e7
   docker compose config --quiet
   docker compose build app doc-engine
   ```

   With the per-revision image tags from the installation guide, building the target does not recreate the running containers. Check that the app and worker resolve to the same new image. This procedure does not change the Postgres major version.

3. Review the deployment settings that the target's Compose file changes. Make each decision in `.env` before the target starts:
   - The starting build published the app port on every host address. The target publishes it on `127.0.0.1` unless `APP_BIND` says otherwise. A reverse proxy on the same host still reaches the port. A proxy in a container or on another host needs `APP_BIND` and a network rule that admits only the proxy. See [Serve the intended origin](deployment-configuration.md#serve-the-intended-origin).
   - Set `TRUSTED_PROXIES` to the address that the proxy's connections come from, as the app sees it. A proxy on the same host reaches the app from the gateway of the app's Compose network, not from `127.0.0.1`. The network already exists on an installed instance, so [read its gateway](deployment-configuration.md#find-the-trusted-proxy-address) before the upgrade. Without the list, every visitor behind the proxy shares one sign-in rate-limit bucket, and the app logs a warning at start. A value that does not match the proxy has the same effect with no warning.
   - The target adds container ceilings. The app and worker each get 2 CPUs and `1g` of memory by default, and the document engine gets 2 CPUs and `4g`. Raise `APP_MEM_LIMIT`, `WORKER_MEM_LIMIT` or the other limits in `.env` if the instance needs more. See [Set file and processing limits](deployment-configuration.md#set-file-and-processing-limits).
   - Leave `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` unset unless you want to pin a Web Push key pair. On its first start, the app generates a pair and stores the private key sealed with `OPENLAW_SECRET_KEY`.

   An existing `compose.private.yml` overlay that sets `ports: !override` can stay in `COMPOSE_FILE`. While it stays, it fixes the host port at 3000 and ignores `PORT` and `APP_BIND`.

4. Take the [coherent database and file backup](backup-and-restore.md#take-a-coherent-backup). That procedure stops app and worker writes while copying. Keep them stopped for the next step.

## Start and verify the upgrade

1. Start the target using the retained project and volumes:

   ```bash
   docker compose up -d --no-build --pull never
   docker compose ps
   docker compose port app 3000
   docker compose logs --tail=100 app worker
   ```

   The app runs migrations at startup. Wait for readiness before allowing writes. From the starting build named above, the app log first shows `migrations: reconciled 0090_onboarding_reviewed_types; continuing with pending migrations`. This line is expected: the starting build recorded an earlier numbering of the Request assignment migration, and the app applies the migration that numbering skipped. While the app migrates, the worker can stop with an error that names a missing column or table, such as `advanced_settings` or `runtime_status`. Compose restarts it. Check that the worker stays running after the app is healthy. `docker compose port app 3000` prints the published address, `127.0.0.1:3000` by default. Review logs locally because activity and provider failures can contain record or recipient details.

2. Sign in through the normal origin. Check that the app records the browser's address rather than the proxy's, as described in [Find the trusted proxy address](deployment-configuration.md#find-the-trusted-proxy-address). Check an Administrator and a lower-access account against representative records. Confirm that the lower-access account still cannot reach a Confidential record outside its audience. Choose a record on which that account is not a team member, the Owner or the Business Owner. The upgrade makes each Business Owner a team member, and a team member reaches the record even when it is Confidential.
3. Check known Contracts, Matters, Entities, configured Fields, and their saved values. A Field that several modules shared now appears once in each module, with the same name and the same saved values. Download representative original and later Document Versions and compare their hashes with the pre-upgrade inventory.
4. Exercise a new upload and worker processing. Check an actual use of saved encrypted configuration, such as a test email through the saved relay. If an AI connector was configured, select **Test connection** on it. A Settings flag saying a secret exists is not proof that it can be decrypted and used. As an Administrator, open **Settings → Advanced → System status** and select **Refresh**. The **API** and **Worker** rows must show **Running** and **Current**. Check that each field you recorded as **Saved in OpenLaw** still shows the expected value.
5. Inspect outstanding jobs and Envelopes, then reopen the instance for normal work when the checks pass. Ask people to reload browser tabs they opened before the upgrade. An old tab can show **This part of OpenLaw was updated. Reload to continue.** Record the source/image identities and results with the deployment change.

Do not use `docker compose down -v`: it deletes the named volumes that hold the installation. Ordinary container replacement preserves those volumes, but it is not a substitute for the backup.

## If the upgrade cannot be accepted

Keep writes paused and collect the specific startup or migration failure. Use [operator troubleshooting](operator-troubleshooting.md), and investigate before changing migration bookkeeping. Repeated restarts do not repair an incompatible or incomplete schema. A migration that stops the start can leave the pending migrations before it applied.

Do not point an older app image at a database that the newer build has migrated and assume a supported downgrade. Restore the pre-upgrade database and matching files into a separate empty target, with the corresponding old image and required keys. Follow [backup and restore](backup-and-restore.md), verify that target, and plan any traffic switch deliberately. A pre-upgrade backup does not contain writes accepted after it was taken.
