# Troubleshoot a deployment

Identify the failing service or operation, apply a targeted correction, and verify the original action succeeds. Run commands from the installation directory with its established Compose project and file list.

## Start with the observed failure

Record the time, public origin, source/image identities, and affected action. If a particular Contract, Matter, or Document is involved, retain its reference and the displayed error. Keep raw configuration, tokens, and private file contents out of general support reports.

```bash
docker compose config --quiet
docker compose ps --all
docker compose logs --since=10m app worker
```

Read logs locally first: activity and provider errors may contain record titles or recipient details. Share the relevant redacted excerpt, not an entire container log or expanded Compose configuration. Avoid starting a second project while diagnosing the first; it can look like a fresh installation because it has different volumes.

## Startup, origin, and database

| Symptom                                                        | What to check                                                                                                                                                                                                                                                                                                             | Recovery and proof                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Startup refuses a missing key, or a short `OPENLAW_SECRET_KEY` | Required values in `.env`, selected file list, and shell overrides. Compose refuses the command when either key is missing. The app and worker then refuse to start when `OPENLAW_SECRET_KEY` is shorter than 32 characters. A short `AUTH_SECRET` is only logged as a warning, so generate 32 characters for it as well. | Supply the intended keys, run `config --quiet`, then recreate the containers and check startup. A valid Compose configuration does not prove runtime key validation passed. Preserve existing keys for an existing install.                                                                                                                                              |
| Port is already allocated                                      | The chosen host `PORT` and existing listeners.                                                                                                                                                                                                                                                                            | Choose an unused port for this instance or resolve the intended listener. A failed bind leaves the app and worker containers removed, so the instance stays down until the port is corrected and the containers are started again. Update `BASE_URL` and proxy routing consistently, then check the actual origin. Do not stop an unrelated deployment to free its port. |
| App keeps restarting                                           | The first specific startup error in app logs.                                                                                                                                                                                                                                                                             | Correct the named environment, database, storage, or migration problem and recreate the app. A rebuild does not repair an incorrect URL or key.                                                                                                                                                                                                                          |
| `/healthz` works but `/readyz` fails                           | API process versus database connectivity.                                                                                                                                                                                                                                                                                 | Check the selected database and credentials. Restore connectivity, then verify a record read and write.                                                                                                                                                                                                                                                                  |
| Sign-in or emailed links fail behind the proxy                 | Public `BASE_URL`, forwarded `Origin`/`Host`, hostname, port, and TLS.                                                                                                                                                                                                                                                    | Correct the origin and proxy, recreate affected containers, and test sign-in plus a newly issued link through the public address.                                                                                                                                                                                                                                        |
| Live updates arrive only after reloading                       | Proxy buffering or interruption of `/api/events`.                                                                                                                                                                                                                                                                         | Allow the event stream to stay open without buffering; verify a change from a second signed-in browser.                                                                                                                                                                                                                                                                  |

`/readyz` tests database readiness. It does not establish that SMTP, storage, the worker, the document engine, or a provider is working. Probe the action that originally failed after every correction.

## Migration failures

Keep writes paused and take or preserve a [coherent backup](backup-and-restore.md). Read the exact migration error before changing anything. The app migrates at startup; the worker does not repair a failed migration.

If the app reports **This database cannot apply the migrations it is missing**, inspect the recorded journal and the hashes shipped with that exact image:

```bash
docker compose exec -T postgres psql -U openlaw -d openlaw -c 'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5;'
docker compose run -T --rm --no-deps app node scripts/lint-migration-journal.mjs --hashes
```

The known `0049_contract_tasks` timestamp repair is automatic when the app recognizes it. An unrecognized journal inconsistency needs a maintainer to reconcile the exact hash and expected timestamp against the backup and shipped migrations. Do not delete journal rows or mark an unapplied migration as complete to get past startup.

The `accounts.issuer` migration refuses rather than guessing an identity, and a refusal applies none of that migration. Read the app log for the case it names, and preserve the named account details. **Cannot resolve an issuer for accounts under provider(s)** means accounts still point at an identity provider the database no longer holds: re-register that provider under its original provider ID, or delete those account rows, after which those people re-link on their next sign-in through the provider. **Two accounts share one 1.7 identity** means one provider was registered twice and the same person signed in through both: keep the correct row and delete the duplicate. Correct what the log names, then start the target again. Do not rewrite sign-in identities by guesswork. If the target build cannot be accepted, use [backup-based recovery](upgrade.md#if-the-upgrade-cannot-be-accepted) in a separate target rather than booting an older image against a changed database.

## Email and stored credentials

Check whether `SMTP_URL` pins the environment configuration. If it does, the saved wizard relay is ignored. Supply a valid `SMTP_FROM` as well, recreate both app and worker, and verify a message in a controlled recipient's inbox. If the saved relay should apply, remove the environment override and recreate the containers.

If saved credentials appear unavailable after a deployment or restore, compare the intended `OPENLAW_SECRET_KEY` with the secret-store record without printing it. Both processes need the correct value. A wrong key does not announce itself as a key problem: the app then reads a saved relay as absent, so the email state says email is unset and a test send fails with **The test email could not be sent. SMTP is not configured — save a relay first.** Saving a new relay at that point writes over a credential the retained key can still open. Restore the key before replacing saved credentials; an unrelated Contract remaining readable does not prove connector decryption works.

Use [deployment configuration](deployment-configuration.md) for key rotation, and [authentication and email](authentication-and-email.md) for the Administrator's controls. The production installation should not be using the development mail catcher.

## Storage and uploads

Check the configured write driver and every store referenced by older Documents. The app and worker need the same configuration. Buckets and containers must already exist. Startup validates reader configuration even when another driver receives new uploads, but an unreachable endpoint can surface only when a file is read or written. A ready app does not establish storage access.

For local storage, retain the standard Compose path and check volume ownership for the image's unprivileged user. Do not use a broad recursive permission change on unrelated host directories. For object storage, check the endpoint, container/bucket, credentials, and network access. A change of write driver does not migrate earlier objects.

If an upload is too large, compare `MAX_UPLOAD_MB` with the proxy body limit. Test a file below and above the intended ceiling after correcting the limits. If a Document is listed but cannot be downloaded, check its original store and bytes; do not delete the Document row to hide a missing file. Use [restore verification](backup-and-restore.md#verify-the-restored-instance).

## Worker and document processing

```bash
docker compose ps worker doc-engine
docker compose logs --since=10m worker doc-engine
```

The worker has no public port or HTTP readiness endpoint. Check that it is running, inspect its work result, and submit a new fictional Document to verify processing. It uses the app image with the worker command and must reach the same database and file stores.

An engine failure need not stop the API. Check the engine container, private endpoint, timeout settings, and scratch-space limit. Restore the dependency, then retry the failed operation through the app when offered or submit a new controlled input. Do not promise that every permanently failed processing record will retry merely because the engine restarted.

Confirm that the original file remains downloadable and inspect the Document's actual processing state. [Document reading and processing](document-previews.md) explains the reader-facing results. Do not publish the engine's port as a workaround for internal connectivity.

## External providers

For signing, check the saved environment/account, enabled state, outbound access, and public Connect callback. A green configuration badge is not a connection test, and a successful connection test is not a completed Envelope. Use [Signing connector recovery](configure-signing.md).

For Analysis, test the configured model and endpoint from Settings, then inspect an actual run. The API's probe can succeed while the worker cannot reach the provider or read the Document. Use [AI connector recovery](configure-analysis.md) and retain the run's Document Version and model when escalating.

Finish a diagnosis by repeating the failed action and checking its saved result, delivery, or downloaded bytes. Record the correction and the verified outcome with the deployment change.
