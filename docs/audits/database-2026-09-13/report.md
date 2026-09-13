Database schema audit — 13 September 2026

The checked-out application has **72 tables and 679 columns**. Every table has a current application, authentication, or explicit history-retention purpose. I found **six column cleanup candidates**, **eight API-only flags to review**, and **49 passive timestamps with no identified application reader**. The evidence does **not** support declaring every remaining column functionally integral: retained provenance, framework compatibility, and active application behavior are distinguished in the ledger.

The most consequential migration finding is a **development database/code mismatch that the startup journal guard accepts**. The committed migration chain itself is consistent: a clean PostgreSQL 16 replay matches the current model, including all application columns, indexes, constraints, and sequences.

This audit targets `dev` at `d20969516104dbebe3e46e4a840edba867370468`, with a clean worktree before audit artifacts were added. The running `openlaw-postgres-1` database was inspected using read-only transactions. It also contains unmerged Portal changes; those are documented below and were checked where they affect cleanup recommendations. This is not a full column audit of a different checkpoint branch or a production database.

The complete, filterable evidence is in:

- [columns.csv](columns.csv): **679 unique table/column rows**, each with a disposition, schema location, introduction migration, runtime evidence, and database dependencies.
- [tables.csv](tables.csv): **72 tables**, their purposes, source evidence, and column exceptions.
- [migrations.csv](migrations.csv): **109 migrations**, snapshot changes, history-chain checks, and replay outcomes.
- [infrastructure-columns.csv](infrastructure-columns.csv): **164 additional observed infrastructure columns**: 161 across 12 pg-boss tables/partitions and three in Drizzle bookkeeping.
- [validation.json](validation.json): catalog comparisons, test results, local data aggregates, and the exact extra migration hashes/objects.
- [preflight.sql](preflight.sql): read-only checks for the principal cleanup candidates.

The column dispositions reconcile as follows:

| Disposition                                                                        | Columns | Meaning                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active application, shared helpers, framework, generated search, or structural use |     603 | A current consumer or database/framework requirement was identified. An API projection counts as a consumer; it does not by itself establish UI necessity. |
| Cleanup candidates                                                                 |       6 | Four unused enrichment fields, one duplicate attribution field, and one unmaintained timestamp.                                                            |
| API-only seed flags                                                                |       8 | Serialized but not used by the shipped UI or application rules.                                                                                            |
| Passive timestamps                                                                 |      49 | Written/defaulted but no application reader identified; retained by the project's timestamp convention.                                                    |
| Other provenance only                                                              |       5 | Written attribution/completion metadata without an application reader.                                                                                     |
| Explicit comment history                                                           |       4 | Retained under CMT-006, despite having no runtime history-read endpoint.                                                                                   |
| Fields with readers but no supported writer                                        |       2 | Counterparty jurisdiction and archiving.                                                                                                                   |
| Version integrity metadata                                                         |       1 | Stored byte fingerprint exposed by the API.                                                                                                                |
| Required by pending Portal work                                                    |       1 | Matter creator, currently duplicated on `dev`.                                                                                                             |
| **Total**                                                                          | **679** |                                                                                                                                                            |

The findings below are ordered by practical importance. No application schema, migration, or application data was changed by this audit.

1. **High priority: the local database is ahead of this checkout, and the journal guard does not reject it.**

   The local journal has **120 records**: all 109 canonical migration hashes, five known historical Home-branch hashes, and six newer Portal migrations (`0109`–`0114`). The five Home entries are explicitly recognized in [migration-journal.ts](../../../packages/db/src/migration-journal.ts#L214). All eleven extra hashes were matched to SQL blobs in local Git history; none was guessed from its timestamp.

   The six newer migrations are `0109_portal_record_access`, `0110_portal_comment_reads`, `0111_retire_business_sponsor`, `0112_contract_overview_classification`, `0113_request_title`, and `0114_request_title_preferences`. They are absent from this checkout's journal. Their effects include:

   | Object                         | Current `dev` expects                        | Running local database contains                        |
   | ------------------------------ | -------------------------------------------- | ------------------------------------------------------ |
   | `contract_stakeholders`        | Table with three columns                     | Table removed                                          |
   | `contract_team`, `matter_team` | `role` columns and three-column primary keys | No `role`; two-column primary keys                     |
   | `requests`                     | `summary`                                    | `title`; search expression also changed                |
   | `comment_last_read`            | Non-null `read_at`                           | Nullable `read_at` plus `full_thread_read_at`          |
   | `contracts`                    | No creator/classification columns            | Additional `created_by`, `owning_department`, `region` |
   | `matters`                      | No business owner column                     | Additional `business_owner_id`                         |
   | `users.role` check             | Allows `contributor`                         | Excludes `contributor`                                 |

   The local database has 71 application tables; its application column count happens also to be 679, despite the incompatible shapes. Counting columns or checking that all known migrations ran would miss this.

   **Verified guard gap:** copying the local journal into an isolated database and calling `guardMigrationJournal` returned `{ repaired: [] }` without an error. The guard checks for missing canonical migrations stranded behind the newest timestamp; when all canonical hashes are present, it returns successfully. It does not establish that newer/foreign migrations are compatible. See [migration-journal.ts](../../../packages/db/src/migration-journal.ts#L320).

   **Recommendation:** align the running database with the intended branch, or give incompatible branches separate development databases. Add a compatibility guard for newer/unknown migration history, with explicit handling of the already supported Home history. Do not delete the extra columns or journal rows to make the counts agree: these represent real schema transitions, including renamed data and changed access control.

2. **High confidence: four counterparty columns have no application purpose today.**

   Candidates: `counterparties.primary_contact_name`, `primary_contact_email`, `address`, and `notes`.

   Migration `0019_counterparties` introduced them. The [schema comment](../../../packages/db/src/schema/counterparties.ts#L13) explicitly reserves enrichment for a later feature. That feature is still absent: [creation](../../../apps/api/src/lib/counterparty-link.ts#L35) accepts/writes only a name, while the [typeahead](../../../apps/api/src/modules/counterparties/routes.ts#L34) and contract projection expose identity, name, and jurisdiction. None of these four fields has a runtime reader, writer, response property, search-vector dependency, index, check, or foreign-key dependency.

   Local corroboration: all four are NULL across **54 counterparties**. This confirms the finding on this development dataset; it is not evidence about an uninspected deployment or direct SQL import.

   **Recommendation:** remove these four columns and their model/documentation declarations in a new forward migration after the data preflight. Do not edit migration `0019` or remove its historical snapshot. This is the clearest instance of schema added for a future feature that never arrived.

3. **High confidence for current writers: `comment_attachments.uploaded_by` duplicates the immutable comment author.**

   [Posting a comment](../../../apps/api/src/modules/comments/post.ts#L98) writes `comments.author_id = author.id`; the same transaction writes [every attachment](../../../apps/api/src/modules/comments/post.ts#L111) with `uploaded_by = author.id`. There is no later independent attachment-uploader flow or application reader of the stored `uploaded_by`. The attachment requires its parent comment, and the [author reference](../../../packages/db/src/schema/comments.ts#L67) is non-null and not changed by the edit/delete/redact routes. Filing uses the filing actor for the new document/version, not this column.

   Local corroboration: **26 attachments, zero uploader/author mismatches**. The inspected newer Portal code keeps the same writer.

   **Recommendation:** remove the duplicate column and its write after checking historical equality on the target database. If a historical uploader differs from the author, preserve that attribution before deciding on removal. The existing FK is not an independent reason to keep a duplicate fact; the parent author already references the same person for application-created data.

4. **High confidence: `two_factors.updated_at` does not record the last modification.**

   This [column](../../../packages/db/src/schema/auth.ts#L217) has an insertion-time `DEFAULT now()` and no Drizzle `$onUpdate` hook. The installed Better Auth **1.7.4** [two-factor model](../../../apps/api/node_modules/better-auth/dist/plugins/two-factor/schema.mjs) defines secret, backup codes, user, verification, failure count, and lockout fields, but no `updatedAt`. The plugin's factor updates do not maintain the extra column, and there is no application reader or database trigger doing so.

   **Recommendation:** remove it if minimizing schema is the governing policy. If it is meant to support operational investigation, implement and verify timestamp maintenance on every factor mutation instead. Do not describe its existing value as the time of the last factor change. `two_factors.created_at` is separately classified as passive creation metadata.

   The other two-factor fields are required by the configured plugin and must remain. The local database contains no factor rows, so the conclusion here comes from the model and writer implementation, not a population sample.

5. **Medium confidence cleanup candidates: eight `is_system_default` flags are API-only provenance.**

   Affected tables: `contract_types`, `matter_types`, `entity_types`, `request_types`, `knowledge_types`, `officer_roles`, `contract_statuses`, and `matter_statuses`.

   Seed migrations write these flags. The [shared taxonomy projection](../../../apps/api/src/lib/taxonomy-routes.ts#L254) and the two status projections return them. The shipped web code contains their type declarations but no rendering, filtering, protection, or default-selection behavior based on their values. The shared taxonomy's [protected-row rule](../../../apps/api/src/lib/taxonomy-routes.ts#L363) uses the configured slug. Workflow behavior uses stage/category/progression fields and the appropriate status selectors.

   **Recommendation:** if seed provenance is not a supported API requirement, deprecate/remove the response properties, update the generated client and tests, and drop all eight flags in a forward migration. They are not zero-reference columns: a database-only drop would break their current projections. External API consumers were not inspected, so these have lower removal confidence than the four unused counterparty fields.

6. **Two counterparty fields have live readers but no supported writer.**

   `jurisdiction` is returned as a disambiguator and contributes to the generated search vector. `archived_at` is used by matching, typeahead, and visibility filters. The current app has neither a counterparty enrichment writer nor an archive endpoint; both fields are NULL across the sampled 54 local rows. [The creation helper](../../../apps/api/src/lib/counterparty-link.ts#L35) only receives a name.

   **Recommendation:** decide whether to complete these capabilities or remove their response/filter/search behavior as a coordinated product change. They are dormant capabilities, not columns that can be removed solely because writes are absent. `counterparties.updated_at` is listed with passive metadata below.

7. **Forty-nine timestamps have no identified application reader.**

   These are not hidden behind authentication or shared field-attachment helpers: those cases were resolved separately. They are present by the [schema timestamp convention](../../../docs/decision-records/SCHEMA.md#L18), maintained by defaults and, where declared, Drizzle update hooks. There are no indexes, constraints, generated expressions, or current application reads that require the values listed here. Whole-row fetching alone was not counted as meaningful consumption.

   | Table                        | Passive timestamps         |
   | ---------------------------- | -------------------------- |
   | `ai_connector`               | `created_at`               |
   | `ai_field_prompts`           | `updated_at`               |
   | `approver_group_members`     | `created_at`               |
   | `approver_groups`            | `updated_at`               |
   | `comments`                   | `updated_at`               |
   | `contract_analysis_runs`     | `created_at`, `updated_at` |
   | `contract_approvals`         | `updated_at`               |
   | `contract_envelope_signers`  | `created_at`               |
   | `contract_envelopes`         | `created_at`, `updated_at` |
   | `contract_key_dates`         | `created_at`, `updated_at` |
   | `contract_stakeholders`      | `created_at`               |
   | `contract_statuses`          | `updated_at`               |
   | `contract_tasks`             | `created_at`, `updated_at` |
   | `contract_team`              | `created_at`               |
   | `contract_types`             | `updated_at`               |
   | `conversion_drafts`          | `created_at`, `updated_at` |
   | `counterparties`             | `updated_at`               |
   | `document_version_rendition` | `created_at`               |
   | `document_version_text`      | `created_at`               |
   | `entity_grants`              | `created_at`               |
   | `entity_types`               | `updated_at`               |
   | `fields`                     | `updated_at`               |
   | `intake_links`               | `updated_at`               |
   | `knowledge_types`            | `updated_at`               |
   | `list_views`                 | `created_at`, `updated_at` |
   | `matter_key_dates`           | `created_at`, `updated_at` |
   | `matter_statuses`            | `updated_at`               |
   | `matter_tasks`               | `created_at`, `updated_at` |
   | `matter_team`                | `created_at`               |
   | `matter_templates`           | `updated_at`               |
   | `matter_types`               | `updated_at`               |
   | `notification_preferences`   | `created_at`, `updated_at` |
   | `officer_roles`              | `updated_at`               |
   | `org_settings`               | `created_at`, `updated_at` |
   | `request_types`              | `updated_at`               |
   | `requests`                   | `updated_at`               |
   | `signing_connectors`         | `created_at`               |
   | `sso_providers`              | `updated_at`               |
   | `two_factors`                | `created_at`               |

   **Recommendation:** keep these under the current documented convention, or explicitly replace that convention with a narrower rule and remove them in a separate reviewed batch. They should not be presented as functionally necessary merely because every table traditionally has timestamps. Some are recent intentional additions: migration `0108` added analysis/draft timestamps for internal lifecycle records, and [the schema addendum](../../../docs/decision-records/SCHEMA.md#L1339) explicitly says they are not public response fields. This is a retention-policy choice, not evidence of an abandoned feature.

   Branch caveat: pending Portal migration `0109` reads team/stakeholder creation timestamps to preserve membership provenance during its backfill. Removing those timestamps before that migration would break the transition, even though current `dev` runtime code does not read them.

8. **Other write-only metadata needs an explicit retention purpose, not an automatic unused-column verdict.**

   | Column                              | Current behavior                                                                          | Assessment                                                                                                                                                    |
   | ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `document_comparisons.requested_by` | Written when comparison work is requested; absent from the response and worker decisions. | Sole row-level initiator provenance; keep unless attribution is intentionally discarded.                                                                      |
   | `matter_relations.created_by`       | Written when a relation is created; not used to authorize, list, or delete it.            | Attribution also appears in activity; candidate for a policy-based simplification.                                                                            |
   | `request_attachments.uploaded_by`   | Written at upload; no runtime reader.                                                     | The [schema contract](../../../docs/decision-records/SCHEMA.md#L1185) explicitly distinguishes uploader from requester. Keep pending an attribution decision. |
   | `conversion_drafts.model`           | Written on completion; omitted by `DraftSchema`.                                          | Internal provider provenance; no functional consumer.                                                                                                         |
   | `conversion_drafts.finished_at`     | Written on completion/failure and cleared on retry; omitted by `DraftSchema`.             | Internal completion history; recovery uses lease/start state instead.                                                                                         |

   The two draft fields are populated in all **10 sampled local drafts**. Their population proves writes, not application necessity. The [worker](../../../apps/api/src/pipeline/conversion-draft.ts#L146) writes them, and the [response schema](../../../apps/api/src/modules/requests/conversion-draft.ts#L36) strips them. Keep or remove them according to an explicit operational/provenance requirement.

9. **Do not remove the apparent false positives.**

   - **`matters.created_by`:** on this checkout it is written with the same actor as the immutable `creator` membership and is not read by runtime code. However, checkpoint `80e5f61b` reads it in `apps/api/src/lib/matter-access.ts:110` and in the matter response after Portal migration `0109` removes role-tagged teams. It becomes authorization data. The ledger marks it `KEEP_PORTAL_DEPENDENCY`.
   - **`comment_revisions`, all four columns:** [CMT-006](../../../docs/decision-records/DECISIONS-COMMENTS.md#L92) deliberately retains previous text outside the append-only activity log so hard redaction can erase it. Edits and soft deletes insert history, and redaction deletes it. The absence of a history viewer is not evidence that the retention contract was superseded.
   - **Authentication compatibility fields:** OAuth tokens/expiry/scope, session client data, two-factor fields, ban/impersonation fields, and SSO compatibility columns are owned by configured Better Auth models. In particular, `saml_config` and `organization_id` lack OpenLaw product behavior but remain plugin-model fields. Removing them requires changing the integration contract, not just deleting database columns.
   - **Type-field join tables:** all four sets of five columns are consumed through [shared helpers](../../../apps/api/src/lib/custom-fields.ts#L118). Their foreign keys, ordering, required flags, and creation-time tie-breakers are active even where direct searches for `entityTypeFields.someColumn` find nothing.
   - **Generated vectors and notification outbox fields:** all eight vectors are maintained by PostgreSQL and read by search. Notification email state and reminder identity are consumed by delivery/retry/deduplication, even when they are not UI fields.
   - **Document designation/provenance fields:** a contract's primary document, a document's executed version, an envelope's fetched executed version, and a generated redline's operand versions describe different facts. Their readers and FK/check relationships are present in the ledger; these are not duplicate identifiers to collapse.
   - **`document_versions.checksum_sha256`:** calculated at upload/copy and exposed in the version API. It preserves a byte fingerprint. No automatic stored-blob checksum verification job was found, so the ledger labels it integrity metadata rather than claiming a verification workflow exists.

10. **The schema reference still describes an unimplemented view.**

    [SCHEMA.md](../../../docs/decision-records/SCHEMA.md#L295) states that `parties_view` is a SQL union used by cross-cutting reads. No committed migration, Drizzle definition, application query, replayed catalog, or inspected local catalog contains this view. Current searches and party pickers use the underlying tables.

    **Recommendation:** correct the reference to describe the implemented design or explicitly mark the view as unimplemented. This is stale documentation; there is no physical view to drop. The historical `accounts.issuer` column, conversely, was correctly retired by migration `0091` and is absent from the current model and replay.

Validation covered the following:

- `pnpm lint:migrations`: **109 journal entries**, ordered and paired with SQL files.
- Snapshot history: **109 snapshots**, all predecessor links valid; latest snapshot to current Drizzle model produces **no migration statements**.
- `pnpm --filter @openlaw/db build`: passed, so model inspection used the current compiled schema.
- A new, isolated PostgreSQL 16 container replayed all **109 committed migrations** through `runMigrations`.
- An independent model-based schema was constructed in a second scratch database and compared using PostgreSQL's normalized catalogs. The comparison found **zero differences** in **679 application columns, 210 indexes, 321 constraints, and three sequences**. Foreign-key statements were deferred until their referenced unique indexes existed in this scratch construction; this was comparison setup, not an alteration to committed migrations.
- The migration-owned `document_text_search_vector` function was supplied to that scratch model so its generated expression could resolve. It is an intentional SQL-only support object. The application schema has **one such function, no triggers, no views, and no RLS policies**; permission enforcement is in application code.
- `pnpm exec vitest run src/*migration*.test.ts --maxWorkers 2`, from `apps/api`: **19 suites, 60 tests passed**. These include existing populated upgrade/backfill/refusal scenarios; this does not claim every historical production dataset was exercised.
- The six principal candidate columns were dropped **without `CASCADE` inside a transaction in the scratch replay**, and the transaction was rolled back. PostgreSQL found no dependent view/generated expression requiring a wider cascade. A production cleanup still needs matching source changes and appropriate feature tests.
- The observed pg-boss installation uses **12.31.0 / schema 41**, matching the installed library's schema version. Its twelve tables/partitions, including dated `queue_stats` partitions, are library-managed storage. Their 161 columns and the three Drizzle bookkeeping columns are individually listed in the infrastructure ledger. They are not application cleanup targets.

The source audit used TypeScript-aware table/column references, row projections, writes, generic helper registrations, raw SQL, current frontend consumption, installed authentication/queue implementations, and migration/catalog dependencies. Schema declarations, tests, generated clients, documentation, and `SELECT *` alone were not treated as proof of functional use. Those sources were used to explain contracts, provenance, and migration history after runtime tracing.

For a cleanup implementation, first settle the code/database baseline. Then remove the four enrichment fields and the duplicate comment-uploader field with data preflights, resolve the two-factor timestamp, and consider the eight API flags as a coordinated response-contract change. Handle passive timestamps/provenance under an explicit retention policy. Preserve historical migrations and add forward changes; rerun the migration rehearsal and the affected application tests after those changes.

The remaining uncertainty is specific: external SQL consumers/imports and production data were not inspected, and the newer Portal checkpoint did not receive a second complete column audit. No removal recommendation should be interpreted as permission to discard non-null historical data or undo those pending Portal migrations.
