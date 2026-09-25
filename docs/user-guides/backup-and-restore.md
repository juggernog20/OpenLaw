# Back up and restore OpenLaw

Keep a coherent copy of the database and every referenced file store, then prove that a separate installation can read them. A completed archive is not a completed restore.

## Before you start

Use the operator account in the installation directory, with the same Compose project and files used to start that instance. The commands below use the bundled Postgres database and local file volume. For an external database or object storage, use that service's backup tooling and retain a matching snapshot of every store the database references.

Choose a protected backup directory outside the application volumes, and verify available space. Save `AUTH_SECRET` and `OPENLAW_SECRET_KEY` separately in your secret store, along with any required storage or external-database credentials and any `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` set in `.env`. Do not put `.env` in the same archive as the database. The database still contains ordinary record data in readable form; credential encryption does not encrypt the entire backup.

The dump holds the credentials saved in the app, sealed with `OPENLAW_SECRET_KEY`. These include the saved SMTP relay, Signing connector keys, SSO client secret, AI Saved keys, the generated Web Push private key, and the settings saved in **Settings → Advanced**, with any object-store credentials. A restore needs the same key to open them.

Record the source revision, app and engine image identities, database major version, Compose project, and storage configuration. As an Administrator, open each page under **Settings → Advanced** and record every field that shows **Saved in OpenLaw**. A saved **Application address** or **Document storage** value travels inside the dump and applies on a restored target unless that target's `.env` sets the same key. Keep the image/source needed to boot that backup. Decide how long writes can pause, and tell users before stopping services.

## Take a coherent backup

1. Set `BACKUP_DIR` to a new backup directory you own. The example is a placeholder path:

   ```bash
   BACKUP_DIR=/srv/openlaw-backups/2026-09-08
   umask 077
   mkdir -p "$BACKUP_DIR"
   chmod 700 "$BACKUP_DIR"
   ```

   Use a fresh directory for each backup so the commands do not replace an earlier recovery point.

2. Stop all app and worker containers for this project. Keep Postgres running:

   ```bash
   docker compose stop app worker
   docker compose ps --all
   ```

   Confirm no other app or worker deployment is writing to this database or file store. The pause makes the database and file copies describe the same state.

3. Dump the database and archive the local file volume:

   ```bash
   docker compose exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "$BACKUP_DIR/database.dump"
   docker compose run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"
   git rev-parse HEAD > "$BACKUP_DIR/app-source.txt"
   docker compose images --format json > "$BACKUP_DIR/images.json"
   ```

   Check each command's exit status. `git rev-parse HEAD` records the checkout, which is the running build only while the working tree still holds it: during an upgrade the checkout already points at the target, so take the running build's identity from `images.json` and record the pre-upgrade revision with the backup. The file command runs `tar` with the app service's mounted volume; it does not start the API. Keep the entire store, including original uploads and derived renditions. If you have ever used S3 or Azure Blob storage, retain those referenced objects too: archiving the local volume does not copy them.

4. Check that the dump and archive can be listed, then record file hashes:

   ```bash
   docker compose exec -T postgres pg_restore --list < "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-contents.txt"
   tar -tzf "$BACKUP_DIR/files.tar.gz" > "$BACKUP_DIR/file-contents.txt"
   (cd "$BACKUP_DIR" && sha256sum database.dump files.tar.gz > SHA256SUMS)
   ```

5. Restart app and worker when the backup is complete, unless you are proceeding directly with a planned upgrade:

   ```bash
   docker compose up -d --no-build --pull never
   ```

Confirm readiness and an actual operation after the pause. Copy the backup to its retained location and verify its hashes there. File lists can contain sensitive names, so protect them with the backup.

## Restore into a different empty target

Use a new installation directory, a different Compose project, separate volumes, and an unused port. Keep the source installation and backup intact. Confirm that the target's database and file store are empty before importing; these instructions are not an in-place overwrite procedure.

Review restored destinations before starting app or worker. Saved configuration and queued work can use the original relay, object store, identity provider, signing account, or AI provider. The restored Web Push key pair and browser subscriptions let the target's worker send device notifications to the source's users. For a recovery drill, isolate external traffic and arrange controlled recipients and storage before allowing those services to run.

1. Prepare the source and images recorded with the backup, using the [installation procedure](install.md). Before starting app or worker, supply the retained `AUTH_SECRET` and `OPENLAW_SECRET_KEY`, the target's origin and port, and its distinct project name. Set `BASE_URL` in the target's `.env` to the target's own origin. Otherwise an **Application address** saved on the source applies on the target, and emailed links and sign-in use the source's address. Configure access to every restored file store in the target's `.env`. A storage key that the target's `.env` leaves empty takes the value saved on the source, which can be the source's live bucket or container. Do not complete first-run setup on this target before importing the database.
2. Make the retained backup available on the target host. Set `BACKUP_DIR` to its path there, then verify its hashes. The path below is a placeholder:

   ```bash
   BACKUP_DIR=/srv/openlaw-backups/2026-09-08
   (cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
   docker compose up -d postgres
   ```

3. Wait for target Postgres to become healthy, then restore the database:

   ```bash
   docker compose exec -T postgres pg_restore -U openlaw -d openlaw --exit-on-error --no-owner --no-privileges < "$BACKUP_DIR/database.dump"
   ```

   Stop on an import error. Do not start the app on a partly restored database. See [PostgreSQL's dump and restore instructions](https://www.postgresql.org/docs/16/backup-dump.html) when your database topology or roles differ.

4. Restore the local files through the target app service's volume:

   ```bash
   docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"
   ```

   Restore any object-store snapshots separately before proceeding. This command only fills the local volume.

5. Start the target and check readiness:

   ```bash
   docker compose up -d --no-build --pull never
   docker compose ps
   ```

## Verify the restored instance

Sign in with an existing restored account. Check its role and record access, including a lower-access account's refusal on a Confidential record it cannot reach. Compare representative Contract, Matter, Entity, and Field values with the backup inventory.

As an Administrator, open **Settings → Advanced**. **Instance address** must show the target's origin, and each **Document storage** field must name the restored store you configured. A value that the target's `.env` sets shows **Deployment configuration · Read only**. On **System status**, select **Refresh**. The target's **API** and **Worker** rows must show **Running** and **Current**, and **Active storage** must name the intended driver.

Download original and later Document Versions and compare their SHA-256 hashes. A visible Document row does not prove its bytes were restored. Check a new upload and its worker processing. Verify a real use of restored encrypted configuration, such as sending through the saved SMTP relay, and test enrolled authentication where applicable.

Use a controlled recipient and target origin for recovery tests, with the destination controls established before startup.

Only after verification should you plan a cutover to the recovered instance. Record which backup was restored and when writes resumed. Reconcile any work accepted after the backup separately; restoring an archive cannot recover data that was never in it.

## If verification fails

| Symptom                                                                       | Check and recovery                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup reports a missing key                                                 | Supply the retained required keys to both app and worker, then recreate them.                                                                                                                                                                                                                                                                                 |
| The app log says **No configured key opens these stored credentials**         | The target has a different `OPENLAW_SECRET_KEY` from the source. The line names each unreadable column, such as `vapid_private_key`. Without a VAPID pair in `.env`, the app also logs **Device notifications are off until the VAPID pair can be read**. Stop app and worker, supply the retained key, and recreate them. Do not save new credentials first. |
| App and worker keep restarting with **Advanced settings cannot be decrypted** | The source saved settings in **Settings → Advanced**, and the target's `OPENLAW_SECRET_KEY` cannot open them. Supply the retained key and recreate both services.                                                                                                                                                                                             |
| Records work but saved provider or relay credentials are unavailable          | Check `OPENLAW_SECRET_KEY`. Restore the correct key before overwriting the saved credentials; unreadable values are retained for recovery.                                                                                                                                                                                                                    |
| Emailed links or sign-in go to the source's address                           | The source saved an **Application address** and the target's `.env` does not set `BASE_URL`. Set `BASE_URL` to the target's origin and recreate app and worker.                                                                                                                                                                                               |
| Existing two-factor authentication no longer works                            | Check the retained `AUTH_SECRET` and the account's normal sign-in requirements. Do not re-enroll users merely to hide a missing restore key.                                                                                                                                                                                                                  |
| A Document is listed but its download fails                                   | Check that the matching store and object bytes were restored and remain reachable. Reapply the correct file backup to the isolated target, then compare hashes.                                                                                                                                                                                               |
| Import stopped partway through                                                | Preserve the error and original backup. Prepare another empty target and repeat a corrected restore; do not declare a partially imported target usable.                                                                                                                                                                                                       |

Keep failed recovery attempts isolated. Do not delete the original volumes or backup while investigating them.
