ALTER TABLE "comment_last_read" DROP CONSTRAINT "comment_last_read_entity_type_check";--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_entity_type_check";--> statement-breakpoint
ALTER TABLE "contract_tasks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "matter_tasks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "comment_last_read" ADD CONSTRAINT "comment_last_read_entity_type_check" CHECK ("comment_last_read"."entity_type" in ('matter', 'contract', 'document', 'request', 'matter_task', 'contract_task'));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_entity_type_check" CHECK ("comments"."entity_type" in ('matter', 'contract', 'document', 'request', 'matter_task', 'contract_task'));