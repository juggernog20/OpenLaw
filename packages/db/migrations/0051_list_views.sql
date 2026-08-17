CREATE TABLE "list_views" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"surface" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_views_name_check" CHECK ("list_views"."name" <> '' and btrim("list_views"."name") = "list_views"."name"
        and length("list_views"."name") <= 60),
	CONSTRAINT "list_views_surface_check" CHECK ("list_views"."surface" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "list_views" ADD CONSTRAINT "list_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "list_views_name_idx" ON "list_views" USING btree ("user_id","surface",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "list_views_default_idx" ON "list_views" USING btree ("user_id","surface") WHERE is_default;