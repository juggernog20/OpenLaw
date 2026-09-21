COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
CREATE TABLE "contract_type_branches" (
	"contract_type_id" text NOT NULL,
	"id" text NOT NULL,
	"parent_branch_id" text,
	"display_order" integer NOT NULL,
	"match" text NOT NULL,
	"conditions" jsonb NOT NULL,
	CONSTRAINT "contract_type_branches_contract_type_id_id_pk" PRIMARY KEY("contract_type_id","id"),
	CONSTRAINT "contract_type_branches_match_check" CHECK ("contract_type_branches"."match" in ('all', 'any')),
	CONSTRAINT "contract_type_branches_conditions_check" CHECK (jsonb_typeof("contract_type_branches"."conditions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "contract_type_builtin_rows" (
	"contract_type_id" text NOT NULL,
	"builtin_key" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"on_intake_form" boolean DEFAULT false NOT NULL,
	"branch_id" text,
	CONSTRAINT "contract_type_builtin_rows_contract_type_id_builtin_key_pk" PRIMARY KEY("contract_type_id","builtin_key"),
	CONSTRAINT "contract_type_builtin_rows_unpinned_check" CHECK ("contract_type_builtin_rows"."builtin_key" not in ('title', 'contract_type', 'matter_type'))
);
--> statement-breakpoint
CREATE TABLE "entity_type_branches" (
	"entity_type_id" text NOT NULL,
	"id" text NOT NULL,
	"parent_branch_id" text,
	"display_order" integer NOT NULL,
	"match" text NOT NULL,
	"conditions" jsonb NOT NULL,
	CONSTRAINT "entity_type_branches_entity_type_id_id_pk" PRIMARY KEY("entity_type_id","id"),
	CONSTRAINT "entity_type_branches_match_check" CHECK ("entity_type_branches"."match" in ('all', 'any')),
	CONSTRAINT "entity_type_branches_conditions_check" CHECK (jsonb_typeof("entity_type_branches"."conditions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "matter_type_branches" (
	"matter_type_id" text NOT NULL,
	"id" text NOT NULL,
	"parent_branch_id" text,
	"display_order" integer NOT NULL,
	"match" text NOT NULL,
	"conditions" jsonb NOT NULL,
	CONSTRAINT "matter_type_branches_matter_type_id_id_pk" PRIMARY KEY("matter_type_id","id"),
	CONSTRAINT "matter_type_branches_match_check" CHECK ("matter_type_branches"."match" in ('all', 'any')),
	CONSTRAINT "matter_type_branches_conditions_check" CHECK (jsonb_typeof("matter_type_branches"."conditions") = 'array')
);
--> statement-breakpoint
CREATE TABLE "matter_type_builtin_rows" (
	"matter_type_id" text NOT NULL,
	"builtin_key" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"on_intake_form" boolean DEFAULT false NOT NULL,
	"branch_id" text,
	CONSTRAINT "matter_type_builtin_rows_matter_type_id_builtin_key_pk" PRIMARY KEY("matter_type_id","builtin_key"),
	CONSTRAINT "matter_type_builtin_rows_unpinned_check" CHECK ("matter_type_builtin_rows"."builtin_key" not in ('title', 'contract_type', 'matter_type'))
);
--> statement-breakpoint
ALTER TABLE "request_types" ALTER COLUMN "target_module" SET DEFAULT 'matter';--> statement-breakpoint
ALTER TABLE "contract_type_fields" ADD COLUMN "visible_on_portal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_type_fields" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "contract_type_fields" ADD COLUMN "on_intake_form" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_types" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_type_fields" ADD COLUMN "visible_on_portal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_type_fields" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "matter_type_fields" ADD COLUMN "visible_on_portal" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "matter_type_fields" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "matter_type_fields" ADD COLUMN "on_intake_form" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matter_types" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_type_branches" ADD CONSTRAINT "contract_type_branches_contract_type_id_contract_types_id_fk" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_type_branches" ADD CONSTRAINT "contract_type_branches_contract_type_id_parent_branch_id_contract_type_branches_contract_type_id_id_fk" FOREIGN KEY ("contract_type_id","parent_branch_id") REFERENCES "public"."contract_type_branches"("contract_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_type_builtin_rows" ADD CONSTRAINT "contract_type_builtin_rows_contract_type_id_contract_types_id_fk" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_type_builtin_rows" ADD CONSTRAINT "contract_type_builtin_rows_contract_type_id_branch_id_contract_type_branches_contract_type_id_id_fk" FOREIGN KEY ("contract_type_id","branch_id") REFERENCES "public"."contract_type_branches"("contract_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_type_branches" ADD CONSTRAINT "entity_type_branches_entity_type_id_entity_types_id_fk" FOREIGN KEY ("entity_type_id") REFERENCES "public"."entity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_type_branches" ADD CONSTRAINT "entity_type_branches_entity_type_id_parent_branch_id_entity_type_branches_entity_type_id_id_fk" FOREIGN KEY ("entity_type_id","parent_branch_id") REFERENCES "public"."entity_type_branches"("entity_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_type_branches" ADD CONSTRAINT "matter_type_branches_matter_type_id_matter_types_id_fk" FOREIGN KEY ("matter_type_id") REFERENCES "public"."matter_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_type_branches" ADD CONSTRAINT "matter_type_branches_matter_type_id_parent_branch_id_matter_type_branches_matter_type_id_id_fk" FOREIGN KEY ("matter_type_id","parent_branch_id") REFERENCES "public"."matter_type_branches"("matter_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_type_builtin_rows" ADD CONSTRAINT "matter_type_builtin_rows_matter_type_id_matter_types_id_fk" FOREIGN KEY ("matter_type_id") REFERENCES "public"."matter_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_type_builtin_rows" ADD CONSTRAINT "matter_type_builtin_rows_matter_type_id_branch_id_matter_type_branches_matter_type_id_id_fk" FOREIGN KEY ("matter_type_id","branch_id") REFERENCES "public"."matter_type_branches"("matter_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_type_fields" ADD CONSTRAINT "contract_type_fields_contract_type_id_branch_id_contract_type_branches_contract_type_id_id_fk" FOREIGN KEY ("contract_type_id","branch_id") REFERENCES "public"."contract_type_branches"("contract_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_type_fields" ADD CONSTRAINT "entity_type_fields_entity_type_id_branch_id_entity_type_branches_entity_type_id_id_fk" FOREIGN KEY ("entity_type_id","branch_id") REFERENCES "public"."entity_type_branches"("entity_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_type_fields" ADD CONSTRAINT "matter_type_fields_matter_type_id_branch_id_matter_type_branches_matter_type_id_id_fk" FOREIGN KEY ("matter_type_id","branch_id") REFERENCES "public"."matter_type_branches"("matter_type_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_types_one_default" ON "contract_types" USING btree ("is_default") WHERE "contract_types"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "matter_types_one_default" ON "matter_types" USING btree ("is_default") WHERE "matter_types"."is_default";
--> statement-breakpoint
-- Reuse the slug, including an archived administrator-created type.
INSERT INTO contract_types (id, slug, display_name, display_order, is_default, is_system_default)
SELECT gen_random_uuid()::text, 'default', 'Default', coalesce(max(display_order), 0) + 1, true, true FROM contract_types
ON CONFLICT (slug) DO UPDATE SET is_default = true, archived_at = NULL;
--> statement-breakpoint
-- Reuse the slug, including an archived administrator-created type.
INSERT INTO matter_types (id, slug, display_name, display_order, is_default, is_system_default)
SELECT gen_random_uuid()::text, 'default', 'Default', coalesce(max(display_order), 0) + 1, true, true FROM matter_types
ON CONFLICT (slug) DO UPDATE SET is_default = true, archived_at = NULL;
--> statement-breakpoint
-- A destinationless legacy Request could collect Contract built-ins and Fields of
-- either module. Matter has no Rows for the built-ins, and a type attaches only its
-- own module's Fields (Contract also refuses the two Overview attributes). Refuse
-- with names, as the INT-002 re-target guard does, rather than write attachments
-- the API would refuse or silently drop a question.
DO $$
DECLARE unmapped text;
BEGIN
  SELECT string_agg(DISTINCT r.display_name, ', ' ORDER BY r.display_name) INTO unmapped
  FROM request_type_fields j JOIN request_types r ON r.id = j.request_type_id
  JOIN fields f ON f.id = j.field_id
  WHERE CASE WHEN f.built_in_key IS NOT NULL THEN
    r.target_module IS DISTINCT FROM 'contract' OR f.built_in_key NOT IN (
      'entityId', 'counterparties', 'effectiveDate', 'expiryDate', 'termType',
      'renewalPeriodMonths', 'noticePeriodDays', 'valueAmount', 'valueCurrency', 'valueCadence'
    )
  ELSE
    f.module_scope IS DISTINCT FROM coalesce(r.target_module, 'matter')
    OR (r.target_module = 'contract' AND f.slug IN ('owning_department', 'region'))
  END;
  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot migrate the intake form of Request types: %. A Field has no Row on the destination type (outside its module, a Contract Overview attribute, or a built-in without a Matter Row). Re-target the Request type or detach those Fields before upgrading.', unmapped;
  END IF;
END $$;
--> statement-breakpoint
UPDATE request_types SET target_module = 'matter' WHERE target_module IS NULL;
--> statement-breakpoint
UPDATE request_types SET target_contract_type_id = (SELECT id FROM contract_types WHERE is_default)
WHERE target_module = 'contract' AND target_contract_type_id IS NULL;
--> statement-breakpoint
UPDATE request_types SET target_matter_type_id = (SELECT id FROM matter_types WHERE is_default)
WHERE target_module = 'matter' AND target_matter_type_id IS NULL;
--> statement-breakpoint
ALTER TABLE request_types ALTER COLUMN target_module SET NOT NULL;
--> statement-breakpoint
UPDATE contract_type_fields j SET visible_on_portal = (f.field_tag = 'business') FROM fields f WHERE f.id = j.field_id;
--> statement-breakpoint
UPDATE matter_type_fields j SET visible_on_portal = (f.field_tag = 'business') FROM fields f WHERE f.id = j.field_id;
--> statement-breakpoint
UPDATE entity_type_fields j SET visible_on_portal = (f.field_tag = 'business') FROM fields f WHERE f.id = j.field_id;
--> statement-breakpoint
-- Several Request types may feed one type. Merge Required and append each missing Field once.
WITH incoming AS (
  SELECT r.target_contract_type_id AS type_id, f.id AS field_id,
    bool_or(j.is_required) AS is_required, min(j.display_order) AS old_order,
    f.field_tag = 'business' AS visible_on_portal
  FROM request_type_fields j JOIN request_types r ON r.id = j.request_type_id
  JOIN fields f ON f.id = j.field_id
  WHERE r.target_module = 'contract' AND f.built_in_key IS NULL
  GROUP BY r.target_contract_type_id, f.id
), numbered AS (
  SELECT i.*, coalesce((SELECT max(display_order) FROM contract_type_fields WHERE contract_type_id = i.type_id), 0)
    + row_number() OVER (PARTITION BY type_id ORDER BY old_order, field_id) AS new_order
  FROM incoming i
  WHERE NOT EXISTS (SELECT 1 FROM contract_type_fields j WHERE j.contract_type_id = i.type_id AND j.field_id = i.field_id)
), all_rows AS (
  SELECT * FROM numbered UNION ALL
  SELECT i.*, j.display_order FROM incoming i JOIN contract_type_fields j ON j.contract_type_id = i.type_id AND j.field_id = i.field_id
)
INSERT INTO contract_type_fields (contract_type_id, field_id, display_order, is_required, on_intake_form, visible_on_portal)
SELECT type_id, field_id, new_order::integer, is_required, true, visible_on_portal FROM all_rows
ON CONFLICT (contract_type_id, field_id) DO UPDATE SET
  on_intake_form = true, is_required = contract_type_fields.is_required OR excluded.is_required;
--> statement-breakpoint
-- Several Request types may feed one type. Merge Required and append each missing Field once.
WITH incoming AS (
  SELECT r.target_matter_type_id AS type_id, f.id AS field_id,
    bool_or(j.is_required) AS is_required, min(j.display_order) AS old_order,
    f.field_tag = 'business' AS visible_on_portal
  FROM request_type_fields j JOIN request_types r ON r.id = j.request_type_id
  JOIN fields f ON f.id = j.field_id
  WHERE r.target_module = 'matter' AND f.built_in_key IS NULL
  GROUP BY r.target_matter_type_id, f.id
), numbered AS (
  SELECT i.*, coalesce((SELECT max(display_order) FROM matter_type_fields WHERE matter_type_id = i.type_id), 0)
    + row_number() OVER (PARTITION BY type_id ORDER BY old_order, field_id) AS new_order
  FROM incoming i
  WHERE NOT EXISTS (SELECT 1 FROM matter_type_fields j WHERE j.matter_type_id = i.type_id AND j.field_id = i.field_id)
), all_rows AS (
  SELECT * FROM numbered UNION ALL
  SELECT i.*, j.display_order FROM incoming i JOIN matter_type_fields j ON j.matter_type_id = i.type_id AND j.field_id = i.field_id
)
INSERT INTO matter_type_fields (matter_type_id, field_id, display_order, is_required, on_intake_form, visible_on_portal)
SELECT type_id, field_id, new_order::integer, is_required, true, visible_on_portal FROM all_rows
ON CONFLICT (matter_type_id, field_id) DO UPDATE SET
  on_intake_form = true, is_required = matter_type_fields.is_required OR excluded.is_required;
--> statement-breakpoint
INSERT INTO contract_type_builtin_rows (contract_type_id, builtin_key, display_order)
SELECT t.id, b.key, b.position - 14
FROM contract_types t CROSS JOIN (VALUES ('description', 1), ('entity', 2), ('counterparties', 3), ('owning_department', 4), ('region', 5), ('priority', 6), ('risk', 7), ('term_type', 8), ('effective_date', 9), ('expiry_date', 10), ('renewal_period_months', 11), ('notice_period_days', 12), ('value', 13), ('needed_by', 14)) AS b(key, position);
--> statement-breakpoint
INSERT INTO matter_type_builtin_rows (matter_type_id, builtin_key, display_order)
SELECT t.id, b.key, b.position - 6
FROM matter_types t CROSS JOIN (VALUES ('description', 1), ('department', 2), ('region', 3), ('priority', 4), ('risk', 5), ('needed_by', 6)) AS b(key, position);
--> statement-breakpoint
-- The three Value questions now configure one compound Row. Answers stay under __intake_* until M39/11.
WITH incoming AS (
 SELECT r.target_contract_type_id AS type_id,
   CASE f.built_in_key
     WHEN 'entityId' THEN 'entity' WHEN 'counterparties' THEN 'counterparties'
     WHEN 'effectiveDate' THEN 'effective_date' WHEN 'expiryDate' THEN 'expiry_date'
     WHEN 'termType' THEN 'term_type' WHEN 'renewalPeriodMonths' THEN 'renewal_period_months'
     WHEN 'noticePeriodDays' THEN 'notice_period_days'
     WHEN 'valueAmount' THEN 'value' WHEN 'valueCurrency' THEN 'value' WHEN 'valueCadence' THEN 'value'
   END AS builtin_key, bool_or(j.is_required) AS is_required
 FROM request_type_fields j JOIN request_types r ON r.id = j.request_type_id
 JOIN fields f ON f.id = j.field_id
 WHERE r.target_module = 'contract' AND f.built_in_key IS NOT NULL
 GROUP BY r.target_contract_type_id, 2
)
UPDATE contract_type_builtin_rows b SET on_intake_form = true, is_required = b.is_required OR i.is_required
FROM incoming i WHERE b.contract_type_id = i.type_id AND b.builtin_key = i.builtin_key;
