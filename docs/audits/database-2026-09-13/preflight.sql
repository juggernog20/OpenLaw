-- SPDX-License-Identifier: AGPL-3.0-only

-- Read-only data checks for the audit's principal cleanup candidates.
-- Run on the intended deployment before authoring/applying a removal migration.
-- Counts reveal no contact values, comment text, credentials, or identities.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT count(*) AS counterparties,
       count(primary_contact_name) AS populated_primary_contact_names,
       count(primary_contact_email) AS populated_primary_contact_emails,
       count(address) AS populated_addresses,
       count(notes) AS populated_notes,
       count(jurisdiction) AS populated_jurisdictions,
       count(archived_at) AS archived_counterparties
FROM counterparties;

SELECT count(*) AS comment_attachments,
       count(*) FILTER (WHERE c.id IS NULL) AS missing_parent_comments,
       count(*) FILTER (WHERE a.uploaded_by IS DISTINCT FROM c.author_id)
         AS uploader_author_mismatches
FROM comment_attachments a
LEFT JOIN comments c ON c.id = a.comment_id;

SELECT count(*) AS two_factors,
       count(*) FILTER (WHERE updated_at IS DISTINCT FROM created_at)
         AS timestamps_differing_from_creation
FROM two_factors;

-- A zero count alone does not prove a field is unused. The report traces readers,
-- writers, library models and database dependencies independently of these counts.
ROLLBACK;
