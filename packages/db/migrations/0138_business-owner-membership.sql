-- SPDX-License-Identifier: AGPL-3.0-only

-- DD-023 (2026-09-17): every current Business Owner is a team member.
WITH added AS (
  INSERT INTO contract_team (contract_id, user_id)
  SELECT id, business_owner_id FROM contracts WHERE business_owner_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING contract_id, user_id
)
INSERT INTO activity_log (id, entity_type, entity_id, action, visibility, payload)
SELECT gen_random_uuid()::text, 'contract', r.id, 'contract.team_added', 'full_thread',
  jsonb_build_object('number', r.number, 'title', r.title, 'member', u.display_name,
    'reason', 'Business Owner membership backfill')
FROM added a JOIN contracts r ON r.id = a.contract_id JOIN users u ON u.id = a.user_id;
--> statement-breakpoint
WITH added AS (
  INSERT INTO matter_team (matter_id, user_id)
  SELECT id, business_owner_id FROM matters WHERE business_owner_id IS NOT NULL
  ON CONFLICT DO NOTHING
  RETURNING matter_id, user_id
)
INSERT INTO activity_log (id, entity_type, entity_id, action, visibility, payload)
SELECT gen_random_uuid()::text, 'matter', r.id, 'matter.team_added', 'full_thread',
  jsonb_build_object('number', r.number, 'title', r.title, 'member', u.display_name,
    'reason', 'Business Owner membership backfill')
FROM added a JOIN matters r ON r.id = a.matter_id JOIN users u ON u.id = a.user_id;
