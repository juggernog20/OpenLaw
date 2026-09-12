ALTER TABLE "contracts" ADD COLUMN "owning_department" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "region" text;
--> statement-breakpoint
UPDATE contracts SET
  owning_department = nullif(btrim(custom_fields ->> 'owning_department'), ''),
  region = nullif(btrim(custom_fields ->> 'region'), ''),
  custom_fields = custom_fields - 'owning_department' - 'region',
  ai_unverified = nullif(ai_unverified - 'owning_department' - 'field:owning_department' - 'region' - 'field:region', '{}'::jsonb),
  analysis_human_fields = analysis_human_fields - 'owning_department' - 'region'
WHERE custom_fields ?| ARRAY['owning_department', 'region']
   OR ai_unverified ?| ARRAY['owning_department', 'field:owning_department', 'region', 'field:region']
   OR analysis_human_fields ?| ARRAY['owning_department', 'region'];
--> statement-breakpoint
-- Keep the catalog definitions and Request answers used by other modules.
DELETE FROM contract_type_fields
WHERE field_id IN (SELECT id FROM fields WHERE slug IN ('owning_department', 'region'));
