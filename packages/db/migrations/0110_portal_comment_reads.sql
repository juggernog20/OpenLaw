ALTER TABLE "comment_last_read" ALTER COLUMN "read_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_last_read" ADD COLUMN "full_thread_read_at" timestamp with time zone;