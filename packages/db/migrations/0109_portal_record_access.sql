-- DD-023 preserves creator provenance before the tagged roster is removed.
ALTER TABLE "contracts" ADD COLUMN "created_by" text;
--> statement-breakpoint
ALTER TABLE "matters" ADD COLUMN "business_owner_id" text;
--> statement-breakpoint
UPDATE contracts c SET created_by = (
  SELECT t.user_id FROM contract_team t
  WHERE t.contract_id = c.id AND t.role = 'creator'
  ORDER BY t.created_at, t.user_id LIMIT 1
);
--> statement-breakpoint
UPDATE matters m SET business_owner_id = (
  SELECT r.requester_id FROM requests r WHERE r.converted_matter_id = m.id
  ORDER BY r.created_at, r.id LIMIT 1
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_business_owner_id_users_id_fk" FOREIGN KEY ("business_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Keep the source of every affiliation until the Confidential gate has been applied.
CREATE TEMP TABLE portal_membership_backfill ON COMMIT DROP AS
SELECT 'contract'::text AS kind, s.contract_id AS record_id, s.user_id, 'stakeholder'::text AS source, s.created_at
FROM contract_stakeholders s
UNION ALL
SELECT 'contract', c.id, c.business_owner_id, 'business_owner', c.created_at
FROM contracts c WHERE c.business_owner_id IS NOT NULL
UNION ALL
SELECT 'contract', r.converted_contract_id, r.requester_id, 'requester', r.created_at
FROM requests r WHERE r.converted_contract_id IS NOT NULL
UNION ALL
SELECT 'matter', m.id, m.business_owner_id, 'business_owner', m.created_at
FROM matters m WHERE m.business_owner_id IS NOT NULL
UNION ALL
SELECT 'matter', r.converted_matter_id, r.requester_id, 'requester', r.created_at
FROM requests r WHERE r.converted_matter_id IS NOT NULL;
--> statement-breakpoint
-- An affiliation outside the wall remains a historical fact, not a new grant.
INSERT INTO activity_log (id, entity_type, entity_id, action, visibility, payload)
SELECT gen_random_uuid()::text, 'contract', r.id, 'contract.portal_access_excluded', 'legal_only',
  jsonb_build_object('number', r.number, 'title', r.title, 'userId', p.user_id,
    'member', u.display_name, 'source', p.source, 'affiliatedAt', p.created_at)
FROM portal_membership_backfill p JOIN contracts r ON r.id = p.record_id
JOIN users u ON u.id = p.user_id
WHERE p.kind = 'contract' AND r.is_confidential
  AND r.manager_id IS DISTINCT FROM p.user_id
  AND NOT EXISTS (SELECT 1 FROM contract_team t WHERE t.contract_id = r.id AND t.user_id = p.user_id);
--> statement-breakpoint
INSERT INTO contract_team (contract_id, user_id, role, created_at)
SELECT p.record_id, p.user_id, 'member', min(p.created_at)
FROM portal_membership_backfill p JOIN contracts r ON r.id = p.record_id
WHERE p.kind = 'contract' AND (
  NOT r.is_confidential OR r.manager_id = p.user_id OR EXISTS (
    SELECT 1 FROM contract_team t WHERE t.contract_id = r.id AND t.user_id = p.user_id
  )
)
GROUP BY p.record_id, p.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The earliest membership timestamp survives when several tags name one person.
DELETE FROM contract_team t USING contract_team keep
WHERE t.contract_id = keep.contract_id AND t.user_id = keep.user_id
  AND (t.created_at, t.role) > (keep.created_at, keep.role);
--> statement-breakpoint
ALTER TABLE "contract_team" DROP CONSTRAINT "contract_team_pkey";
--> statement-breakpoint
ALTER TABLE "contract_team" DROP CONSTRAINT "contract_team_role_check";
--> statement-breakpoint
ALTER TABLE "contract_team" DROP COLUMN "role";
--> statement-breakpoint
ALTER TABLE "contract_team" ADD CONSTRAINT "contract_team_pkey" PRIMARY KEY("contract_id","user_id");
--> statement-breakpoint
-- An affiliation outside the wall remains a historical fact, not a new grant.
INSERT INTO activity_log (id, entity_type, entity_id, action, visibility, payload)
SELECT gen_random_uuid()::text, 'matter', r.id, 'matter.portal_access_excluded', 'legal_only',
  jsonb_build_object('number', r.number, 'title', r.title, 'userId', p.user_id,
    'member', u.display_name, 'source', p.source, 'affiliatedAt', p.created_at)
FROM portal_membership_backfill p JOIN matters r ON r.id = p.record_id
JOIN users u ON u.id = p.user_id
WHERE p.kind = 'matter' AND r.is_confidential
  AND r.manager_id IS DISTINCT FROM p.user_id
  AND NOT EXISTS (SELECT 1 FROM matter_team t WHERE t.matter_id = r.id AND t.user_id = p.user_id);
--> statement-breakpoint
INSERT INTO matter_team (matter_id, user_id, role, created_at)
SELECT p.record_id, p.user_id, 'member', min(p.created_at)
FROM portal_membership_backfill p JOIN matters r ON r.id = p.record_id
WHERE p.kind = 'matter' AND (
  NOT r.is_confidential OR r.manager_id = p.user_id OR EXISTS (
    SELECT 1 FROM matter_team t WHERE t.matter_id = r.id AND t.user_id = p.user_id
  )
)
GROUP BY p.record_id, p.user_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The earliest membership timestamp survives when several tags name one person.
DELETE FROM matter_team t USING matter_team keep
WHERE t.matter_id = keep.matter_id AND t.user_id = keep.user_id
  AND (t.created_at, t.role) > (keep.created_at, keep.role);
--> statement-breakpoint
ALTER TABLE "matter_team" DROP CONSTRAINT "matter_team_pkey";
--> statement-breakpoint
ALTER TABLE "matter_team" DROP CONSTRAINT "matter_team_role_check";
--> statement-breakpoint
ALTER TABLE "matter_team" DROP COLUMN "role";
--> statement-breakpoint
ALTER TABLE "matter_team" ADD CONSTRAINT "matter_team_pkey" PRIMARY KEY("matter_id","user_id");
--> statement-breakpoint
DROP TABLE "contract_stakeholders";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";
--> statement-breakpoint
UPDATE users SET role = 'business_user', updated_at = now() WHERE role = 'contributor';
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('administrator', 'legal_team_member', 'business_user'));
