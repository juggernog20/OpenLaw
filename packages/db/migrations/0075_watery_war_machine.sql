-- The parent column lands empty, so adding it does not rewrite existing
-- Matters. Its guards are installed NOT VALID first, then validated in
-- separate statements: validation takes the lighter lock intended for
-- checking an existing table. The parent index is deliberately a plain
-- build. Migrations run at container start before readiness (TECH-005),
-- and keeping this migration transactional means a failed upgrade can be
-- retried without a half-installed column or table.
CREATE TABLE "matter_relations" (
	"matter_a_id" text NOT NULL,
	"matter_b_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_relations_pkey" PRIMARY KEY("matter_a_id","matter_b_id"),
	CONSTRAINT "matter_relations_canonical_check" CHECK ("matter_relations"."matter_a_id" < "matter_relations"."matter_b_id")
);
--> statement-breakpoint
ALTER TABLE "matters" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "matter_relations" ADD CONSTRAINT "matter_relations_matter_a_id_matters_id_fk" FOREIGN KEY ("matter_a_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_relations" ADD CONSTRAINT "matter_relations_matter_b_id_matters_id_fk" FOREIGN KEY ("matter_b_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_relations" ADD CONSTRAINT "matter_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_relations_b_idx" ON "matter_relations" USING btree ("matter_b_id");--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_parent_id_matters_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "matters_parent_idx" ON "matters" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_parent_self_check" CHECK ("matters"."parent_id" is null or "matters"."parent_id" <> "matters"."id") NOT VALID;--> statement-breakpoint
ALTER TABLE "matters" VALIDATE CONSTRAINT "matters_parent_id_matters_id_fk";--> statement-breakpoint
ALTER TABLE "matters" VALIDATE CONSTRAINT "matters_parent_self_check";
