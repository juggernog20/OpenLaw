# Upgrade a populated instance

Replace the application build while preserving the installation's database, files, and configuration. First rehearse the change on an isolated copy and verify [backup-based recovery](backup-and-restore.md).

## Before you start

Use the operator account and installation directory from [installation](install.md). Record the existing source revision, app and engine image identities, Compose project name, file list, and storage configuration. An Administrator can also save the instance address, upload limit, storage and document-service settings in **Settings → Advanced**. Record every field there that shows **Saved in OpenLaw**. Keep the existing authentication and credential encryption keys. A new project name creates a different set of default volumes; it is not an upgrade of the original installation.

This edition uses source revision `ad345da5842c22b7d1012bf9f5d7d12dfdb4e496` as its candidate. The starting build for this procedure's checks is revision `067c1646829df85e62b809ee9157921e867c84e7`, which the previous edition of [installation](install.md) built. Do not assume that every older release or database schema can be upgraded without additional work. Read the target build's migration and deployment changes first.

From that starting build, the candidate applies the 12 migrations from `0172_m42-toolset-ceiling` to `0183_sso-provider-name`. Some of them change existing data or add built-in settings:

- The saved **Toolset ceiling** loses Team and Administration. An existing API key or OAuth grant cannot run their Tools until an Administrator selects them again. See [Choose Team and Administration](configure-mcp.md#choose-team-and-administration).
- The Contract Statuses gain the protected **Partially signed** Status at the end of the Signature Stage. The other Statuses keep their order.
- The Contract Document types gain the fixed **Partially signed** type just before **Executed**. The other types keep their order.
- Every existing Envelope counts as a round that completes its Contract. No existing Document Version changes its type.
- Each registered SSO provider has an empty display name, so Settings shows its Provider ID as its name. An Administrator can edit the provider to add a **Display name**.

None of these 12 migrations refuses existing data. They run in one transaction, so a failure applies none of them. An instance on a build older than the starting build also applies the earlier migrations. One of those refuses a Request type whose intake questions have no Row on the destination type. See [Migration failures](operator-troubleshooting.md#migration-failures) before you schedule the pause.

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
   git checkout --detach ad345da5842c22b7d1012bf9f5d7d12dfdb4e496
   docker compose config --quiet
   docker compose build app doc-engine
   ```

   With the per-revision image tags from the installation guide, building the target does not recreate the running containers. Check that the app and worker resolve to the same new image. This procedure does not change the Postgres major version.

3. Review `TRUSTED_PROXIES` in `.env` before the target starts. The target's Compose file is the same as the starting build's, so the port binding, the container ceilings and the services do not change.

   `TRUSTED_PROXIES` must hold the address that the proxy's connections come from, as the app sees it. A proxy on the same host reaches the app from the gateway of the app's Compose network, not from `127.0.0.1`. The starting build's `.env.example` suggested `127.0.0.1,::1`, and that value never matches a proxy on the same host. The network already exists on an installed instance, so [read its gateway](deployment-configuration.md#find-the-trusted-proxy-address) before the upgrade. Without the list, every visitor behind the proxy shares one sign-in rate-limit bucket, and the app logs a warning at start. A value that does not match the proxy has the same effect with no warning.

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

   The app runs migrations at startup. Wait for readiness before allowing writes. Check that the worker stays running after the app is healthy. `docker compose port app 3000` prints the published address, `127.0.0.1:3000` by default. Review logs locally because activity and provider failures can contain record or recipient details.

2. Sign in through the normal origin. Check that the app records the browser's address rather than the proxy's, as described in [Find the trusted proxy address](deployment-configuration.md#find-the-trusted-proxy-address). Check an Administrator and a lower-access account against representative records. Confirm that the lower-access account still cannot reach a Confidential record outside its audience. Choose a record on which that account is not a team member, the Owner or the Business Owner. A Business Owner is also a team member, and a team member reaches the record even when it is Confidential.
3. Check known Contracts, Matters, Entities, configured Fields, and their saved values. Check that the Contract Statuses and Document types keep their names, with **Partially signed** added as described above. [Configure types, Statuses, and Fields](types-statuses-fields.md) shows where Settings lists them. Download representative original and later Document Versions and compare their hashes with the pre-upgrade inventory.
4. Exercise a new upload and worker processing. Check an actual use of saved encrypted configuration, such as a test email through the saved relay. If an AI connector was configured, select **Test connection** on it. A Settings flag saying a secret exists is not proof that it can be decrypted and used. As an Administrator, open **Settings → Advanced → System status** and select **Refresh**. The **API** and **Worker** rows must show **Running** and **Current**. Check that each field you recorded as **Saved in OpenLaw** still shows the expected value.
5. Inspect outstanding jobs and Envelopes, then reopen the instance for normal work when the checks pass. Ask people to reload browser tabs they opened before the upgrade. An old tab can show **This part of OpenLaw was updated. Reload to continue.** Record the source/image identities and results with the deployment change.

Do not use `docker compose down -v`: it deletes the named volumes that hold the installation. Ordinary container replacement preserves those volumes, but it is not a substitute for the backup.

## If the upgrade cannot be accepted

Keep writes paused and collect the specific startup or migration failure. Use [operator troubleshooting](operator-troubleshooting.md), and investigate before changing migration bookkeeping. Repeated restarts do not repair an incompatible or incomplete schema. From the starting build, a failed migration applies none of the pending migrations. From an older build, a migration that stops the start can leave the pending migrations before it applied.

Do not point an older app image at a database that the newer build has migrated and assume a supported downgrade. Restore the pre-upgrade database and matching files into a separate empty target, with the corresponding old image and required keys. Follow [backup and restore](backup-and-restore.md), verify that target, and plan any traffic switch deliberately. A pre-upgrade backup does not contain writes accepted after it was taken.
