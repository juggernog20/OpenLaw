ALTER TABLE "entities" ADD COLUMN "register_kind" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "head_office_entity_id" text;--> statement-breakpoint
ALTER TABLE "entity_types" ADD COLUMN "register_kind" text DEFAULT 'shares' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_head_office_entity_id_entities_id_fk" FOREIGN KEY ("head_office_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_head_office_idx" ON "entities" USING btree ("head_office_entity_id");--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_register_kind_check" CHECK ("entities"."register_kind" in ('shares', 'partnership', 'trust', 'none'));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_head_office_not_self" CHECK ("entities"."head_office_entity_id" <> "entities"."id");--> statement-breakpoint
ALTER TABLE "entity_types" ADD CONSTRAINT "entity_types_register_kind_check" CHECK ("entity_types"."register_kind" in ('shares', 'partnership', 'trust', 'none'));--> statement-breakpoint
UPDATE entity_types SET register_kind = CASE slug
  WHEN 'partnership' THEN 'partnership' WHEN 'branch' THEN 'none' ELSE 'shares' END;
--> statement-breakpoint
UPDATE entities e SET register_kind = 'shares'
FROM entity_types t
WHERE e.entity_type_id = t.id AND t.register_kind <> 'shares'
  AND (EXISTS (SELECT 1 FROM entity_share_classes c WHERE c.entity_id = e.id)
    OR EXISTS (SELECT 1 FROM entity_share_entries r WHERE r.entity_id = e.id));
