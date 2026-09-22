-- 0158 ends outside a transaction; keep the retirement atomic on fresh installs too.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
-- DD-028: migrate answers before retiring the protected intake catalog.
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_entityId') ||
  CASE WHEN custom_fields ? 'entity' THEN '{}'::jsonb
  ELSE jsonb_build_object('entity', custom_fields->'__intake_contract_entityId') END
WHERE custom_fields ? '__intake_contract_entityId';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_counterparties') ||
  CASE WHEN custom_fields ? 'counterparties' THEN '{}'::jsonb
  ELSE jsonb_build_object('counterparties', (select coalesce(jsonb_agg(name order by first), '[]'::jsonb) from (select (array_agg(btrim(name) order by ord))[1] as name, min(ord) as first from regexp_split_to_table(custom_fields->>'__intake_contract_counterparties', E'\r?\n') with ordinality as names(name, ord) where btrim(name) <> '' group by lower(btrim(name))) names)) END
WHERE custom_fields ? '__intake_contract_counterparties';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_effectiveDate') ||
  CASE WHEN custom_fields ? 'effective_date' THEN '{}'::jsonb
  ELSE jsonb_build_object('effective_date', custom_fields->'__intake_contract_effectiveDate') END
WHERE custom_fields ? '__intake_contract_effectiveDate';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_expiryDate') ||
  CASE WHEN custom_fields ? 'expiry_date' THEN '{}'::jsonb
  ELSE jsonb_build_object('expiry_date', custom_fields->'__intake_contract_expiryDate') END
WHERE custom_fields ? '__intake_contract_expiryDate';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_termType') ||
  CASE WHEN custom_fields ? 'term_type' THEN '{}'::jsonb
  ELSE jsonb_build_object('term_type', to_jsonb(case custom_fields->>'__intake_contract_termType' when 'Fixed term' then 'fixed' when 'Auto-renewing' then 'auto_renew' when 'Evergreen' then 'evergreen' else custom_fields->>'__intake_contract_termType' end)) END
WHERE custom_fields ? '__intake_contract_termType';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_renewalPeriodMonths') ||
  CASE WHEN custom_fields ? 'renewal_period_months' THEN '{}'::jsonb
  ELSE jsonb_build_object('renewal_period_months', custom_fields->'__intake_contract_renewalPeriodMonths') END
WHERE custom_fields ? '__intake_contract_renewalPeriodMonths';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_noticePeriodDays') ||
  CASE WHEN custom_fields ? 'notice_period_days' THEN '{}'::jsonb
  ELSE jsonb_build_object('notice_period_days', custom_fields->'__intake_contract_noticePeriodDays') END
WHERE custom_fields ? '__intake_contract_noticePeriodDays';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_valueAmount') ||
  CASE WHEN custom_fields ? 'value_amount' THEN '{}'::jsonb
  ELSE jsonb_build_object('value_amount', to_jsonb(round((custom_fields->>'__intake_contract_valueAmount')::numeric * power(10::numeric, case coalesce(custom_fields->>'value_currency', custom_fields->>'__intake_contract_valueCurrency') when 'BHD' then 3 when 'IQD' then 3 when 'JOD' then 3 when 'KWD' then 3 when 'LYD' then 3 when 'OMR' then 3 when 'TND' then 3 when 'CLF' then 4 when 'UYW' then 4 else case when coalesce(custom_fields->>'value_currency', custom_fields->>'__intake_contract_valueCurrency') in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0 else 2 end end)))) END
WHERE custom_fields ? '__intake_contract_valueAmount';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_valueCurrency') ||
  CASE WHEN custom_fields ? 'value_currency' THEN '{}'::jsonb
  ELSE jsonb_build_object('value_currency', custom_fields->'__intake_contract_valueCurrency') END
WHERE custom_fields ? '__intake_contract_valueCurrency';
--> statement-breakpoint
UPDATE requests SET custom_fields = (custom_fields - '__intake_contract_valueCadence') ||
  CASE WHEN custom_fields ? 'value_cadence' THEN '{}'::jsonb
  ELSE jsonb_build_object('value_cadence', to_jsonb(case custom_fields->>'__intake_contract_valueCadence' when 'One-time' then 'one_time' when 'Monthly' then 'monthly' when 'Annually' then 'annually' else custom_fields->>'__intake_contract_valueCadence' end)) END
WHERE custom_fields ? '__intake_contract_valueCadence';
--> statement-breakpoint
DROP TABLE "request_type_fields";
--> statement-breakpoint
DELETE FROM fields WHERE slug IN ('__intake_contract_entityId','__intake_contract_counterparties','__intake_contract_effectiveDate','__intake_contract_expiryDate','__intake_contract_termType','__intake_contract_renewalPeriodMonths','__intake_contract_noticePeriodDays','__intake_contract_valueAmount','__intake_contract_valueCurrency','__intake_contract_valueCadence');
--> statement-breakpoint
ALTER TABLE "fields" DROP CONSTRAINT "fields_field_tag_check";--> statement-breakpoint
DROP INDEX "fields_built_in_key_unique";--> statement-breakpoint
ALTER TABLE "fields" DROP COLUMN "built_in_key";--> statement-breakpoint
ALTER TABLE "fields" DROP COLUMN "field_tag";--> statement-breakpoint
ALTER TABLE "request_types" DROP COLUMN "form_field_order";
--> statement-breakpoint
-- Auto-Doc definitions retain their version and answers; only destination identities change.
UPDATE auto_doc_form_versions SET definition = jsonb_set(definition, '{fields}', (
  SELECT coalesce(jsonb_agg(CASE field->>'contractAttribute'
    WHEN 'primary_counterparty_name' THEN jsonb_set(field, '{contractAttribute}', '"counterparties"')
    WHEN 'entity_id' THEN jsonb_set(field, '{contractAttribute}', '"entity"')
    WHEN 'owning_department_id' THEN jsonb_set(field, '{contractAttribute}', '"owning_department"')
    ELSE field END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(definition->'fields') WITH ORDINALITY AS elements(field, ord)
)) WHERE definition->'fields' IS NOT NULL;
--> statement-breakpoint
-- Rename metadata keys without changing extracted values or source citations.
CREATE FUNCTION pg_temp.rename_counterparty_key(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN value ? 'counterparty' THEN
    (value - 'counterparty') || CASE WHEN value ? 'counterparties' THEN '{}'::jsonb
      ELSE jsonb_build_object('counterparties', value->'counterparty') END
    ELSE value END
$$;
--> statement-breakpoint
CREATE FUNCTION pg_temp.rename_counterparty_slugs(value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN value IS NULL THEN NULL ELSE
    (SELECT coalesce(jsonb_agg(CASE WHEN item = '"counterparty"'::jsonb THEN '"counterparties"'::jsonb ELSE item END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(value) WITH ORDINALITY AS elements(item, ord)) END
$$;
--> statement-breakpoint
UPDATE contracts SET ai_unverified = pg_temp.rename_counterparty_key(ai_unverified),
  analysis_human_fields = pg_temp.rename_counterparty_slugs(analysis_human_fields);
--> statement-breakpoint
UPDATE conversion_drafts SET suggestions = pg_temp.rename_counterparty_key(suggestions),
  conflicts = pg_temp.rename_counterparty_key(conflicts);
--> statement-breakpoint
UPDATE contract_analysis_runs SET source_context = jsonb_set(source_context, '{suggestions}',
  pg_temp.rename_counterparty_key(source_context->'suggestions'))
WHERE source_context->'suggestions' IS NOT NULL;
--> statement-breakpoint
UPDATE contract_analysis_runs SET outcome = outcome || jsonb_build_object(
  'written', pg_temp.rename_counterparty_slugs(outcome->'written'),
  'kept', pg_temp.rename_counterparty_slugs(outcome->'kept'),
  'unsupported', pg_temp.rename_counterparty_slugs(outcome->'unsupported'),
  'invalid', pg_temp.rename_counterparty_slugs(outcome->'invalid')
) || CASE WHEN outcome ? 'results' THEN jsonb_build_object('results', (
  SELECT coalesce(jsonb_agg(CASE WHEN result->>'slug' = 'counterparty'
    THEN jsonb_set(result, '{slug}', '"counterparties"') ELSE result END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(outcome->'results') WITH ORDINALITY AS elements(result, ord)
)) ELSE '{}'::jsonb END WHERE outcome IS NOT NULL;
--> statement-breakpoint
INSERT INTO ai_field_prompts (slug, prompt, updated_at)
SELECT 'counterparties', prompt, updated_at FROM ai_field_prompts WHERE slug = 'counterparty'
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
DELETE FROM ai_field_prompts WHERE slug = 'counterparty';
