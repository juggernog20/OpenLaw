ALTER TABLE "contract_envelopes" ADD COLUMN "completes_contract" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
WITH position AS (
  SELECT coalesce(max(display_order), 0) + 1 AS next_order
  FROM contract_statuses WHERE stage = 'signature' AND archived_at IS NULL
)
UPDATE contract_statuses SET display_order = display_order + 1
WHERE archived_at IS NULL AND display_order >= (SELECT next_order FROM position)
  AND NOT EXISTS (SELECT 1 FROM contract_statuses WHERE slug = 'partially_signed');
--> statement-breakpoint
INSERT INTO contract_statuses (id, slug, display_name, stage, display_order, is_system_default)
SELECT '01a0dea0-0000-7000-8000-000000000001', 'partially_signed', 'Partially signed', 'signature',
  coalesce(max(display_order), 0) + 1, true
FROM contract_statuses WHERE stage = 'signature' AND archived_at IS NULL
ON CONFLICT (slug) DO NOTHING;
