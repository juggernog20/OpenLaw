# Upgrade a populated instance

Replace the application build while preserving the installation's database, files, and configuration. First rehearse the change on an isolated copy and verify [backup-based recovery](backup-and-restore.md).

## Before you start

Use the operator account and installation directory from [installation](install.md). Record the existing source revision, app and engine image identities, Compose project name, file list, and storage configuration. Keep the existing authentication and credential encryption keys. A new project name creates a different set of default volumes; it is not an upgrade of the original installation.

This edition uses source revision `6a8873dbda333fd9992eb77525d4bfa3f47af20d` as its candidate. The starting build for this procedure's checks is development revision `d1d098ba9f4ba6557a542857d530446b76b1847c`. Do not assume that every older release or database schema can be upgraded without additional work. Read the target build's migration and deployment changes first.

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
   git checkout --detach 6a8873dbda333fd9992eb77525d4bfa3f47af20d
   docker compose config --quiet
   docker compose build app doc-engine
   ```

   With the per-revision image tags from the installation guide, building the target does not recreate the running containers. Check that the app and worker resolve to the same new image. This procedure does not change the Postgres major version.

3. Take the [coherent database and file backup](backup-and-restore.md#take-a-coherent-backup). That procedure stops app and worker writes while copying. Keep them stopped for the next step.

## Start and verify the upgrade

1. Start the target using the retained project and volumes:

   ```bash
   docker compose up -d --no-build --pull never
   docker compose ps
   docker compose logs --tail=100 app worker
   ```

   The app runs migrations at startup. Wait for readiness before allowing writes. Review logs locally because activity and provider failures can contain record or recipient details.

2. Sign in through the normal origin. Check an Administrator and a lower-access account against representative records. Confirm that the lower-access account still cannot reach a Confidential record outside its audience.
3. Check known Contracts, Matters, Entities, configured Fields, and their saved values. Download representative original and later Document Versions and compare their hashes with the pre-upgrade inventory.
4. Exercise a new upload and worker processing. Check an actual use of saved encrypted configuration, such as a test email through the saved relay. A Settings flag saying a secret exists is not proof that it can be decrypted and used.
5. Inspect outstanding jobs and Envelopes, then reopen the instance for normal work when the checks pass. Record the source/image identities and results with the deployment change.

Do not use `docker compose down -v`: it deletes the named volumes that hold the installation. Ordinary container replacement preserves those volumes, but it is not a substitute for the backup.

## If the upgrade cannot be accepted

Keep writes paused and collect the specific startup or migration failure. Use [operator troubleshooting](operator-troubleshooting.md), and investigate before changing migration bookkeeping. Repeated restarts do not repair an incompatible or incomplete schema.

Do not point an older app image at a database that the newer build has migrated and assume a supported downgrade. Restore the pre-upgrade database and matching files into a separate empty target, with the corresponding old image and required keys. Follow [backup and restore](backup-and-restore.md), verify that target, and plan any traffic switch deliberately. A pre-upgrade backup does not contain writes accepted after it was taken.
