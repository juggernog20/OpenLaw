CREATE TABLE "comment_last_read" (
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_last_read_pkey" PRIMARY KEY("user_id","entity_type","entity_id"),
	CONSTRAINT "comment_last_read_entity_type_check" CHECK ("comment_last_read"."entity_type" in ('matter', 'contract', 'document', 'request'))
);
--> statement-breakpoint
ALTER TABLE "comment_last_read" ADD CONSTRAINT "comment_last_read_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;