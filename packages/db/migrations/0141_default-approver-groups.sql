ALTER TABLE "contract_types" ADD COLUMN "default_approver_group_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "default_approver_group_id" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "allow_legal_approver_group_override" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_types" ADD CONSTRAINT "contract_types_default_approver_group_id_approver_groups_id_fk" FOREIGN KEY ("default_approver_group_id") REFERENCES "public"."approver_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_default_approver_group_id_approver_groups_id_fk" FOREIGN KEY ("default_approver_group_id") REFERENCES "public"."approver_groups"("id") ON DELETE no action ON UPDATE no action;
