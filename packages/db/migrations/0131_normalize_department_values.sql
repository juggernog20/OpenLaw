-- SPDX-License-Identifier: AGPL-3.0-only

-- Preserve legacy classifications and their selectable names in the shared list.
WITH names AS (
  SELECT btrim(value #>> '{}') AS name
  FROM (
    SELECT custom_fields FROM matters
    UNION ALL SELECT custom_fields FROM requests
    UNION ALL SELECT default_custom_fields FROM matter_templates
  ) records
  CROSS JOIN LATERAL jsonb_each(records.custom_fields) entry(key, value)
  WHERE key IN ('department', 'owning_department', 'owning-department', 'business_unit', 'business-unit')
    AND jsonb_typeof(value) = 'string'
  UNION
  SELECT btrim(option #>> '{}')
  FROM fields CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(options) = 'array' THEN options ELSE '[]'::jsonb END) option
  WHERE slug IN ('department', 'owning_department', 'owning-department', 'business_unit', 'business-unit')
    AND jsonb_typeof(option) = 'string'
), missing AS (
  SELECT min(name) AS name FROM names
  WHERE name <> '' AND NOT EXISTS (SELECT 1 FROM departments WHERE lower(btrim(display_name)) = lower(names.name))
  GROUP BY lower(name)
)
INSERT INTO departments (id, slug, display_name, display_order)
SELECT gen_random_uuid()::text, 'migrated_department_' || md5(lower(name)), name,
  (SELECT coalesce(max(display_order), 0) FROM departments) + row_number() OVER (ORDER BY name)::integer
FROM missing;
--> statement-breakpoint
UPDATE matters SET department_id = (
  SELECT id FROM departments
  WHERE lower(btrim(display_name)) = lower(btrim(coalesce(
    matters.custom_fields ->> 'department', matters.custom_fields ->> 'business_unit',
    matters.custom_fields ->> 'business-unit', matters.custom_fields ->> 'owning_department',
    matters.custom_fields ->> 'owning-department')))
  ORDER BY (archived_at IS NULL) DESC, display_order, id LIMIT 1
);
--> statement-breakpoint
UPDATE requests SET department_id = (
  SELECT id FROM departments
  WHERE lower(btrim(display_name)) = lower(btrim(coalesce(
    requests.custom_fields ->> 'department', requests.custom_fields ->> 'owning_department',
    requests.custom_fields ->> 'owning-department', requests.custom_fields ->> 'business_unit',
    requests.custom_fields ->> 'business-unit')))
  ORDER BY (archived_at IS NULL) DESC, display_order, id LIMIT 1
);
--> statement-breakpoint
-- Retain old answers for historical records; the standard field replaces these controls.
UPDATE fields SET display_name = 'Department', archived_at = coalesce(archived_at, now())
WHERE slug IN ('department', 'owning_department', 'owning-department', 'business_unit', 'business-unit');
