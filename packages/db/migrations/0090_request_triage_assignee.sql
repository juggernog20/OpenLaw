ALTER TABLE "requests" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_assignee_idx" ON "requests" USING btree ("assignee_id");