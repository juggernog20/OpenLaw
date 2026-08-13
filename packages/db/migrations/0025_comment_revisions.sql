CREATE TABLE "comment_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"comment_id" text NOT NULL,
	"body" text NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "redacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_revisions_comment_idx" ON "comment_revisions" USING btree ("comment_id","replaced_at");