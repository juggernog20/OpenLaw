COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_group_check";--> statement-breakpoint
CREATE INDEX "contract_approvals_approver_status_idx" ON "contract_approvals" USING btree ("approver_id","status");--> statement-breakpoint
CREATE INDEX "contract_tasks_assignee_due_idx" ON "contract_tasks" USING btree ("assignee_id","due_date");--> statement-breakpoint
CREATE INDEX "matter_tasks_assignee_due_idx" ON "matter_tasks" USING btree ("assignee_id","due_date");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_briefing_email_only" CHECK ("notification_preferences"."event_group" not like 'briefing.%' or "notification_preferences"."channel" = 'email');--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_group_check" CHECK ("notification_preferences"."event_group" in ('assigned_to_you', 'activity_on_your_records', 'dates_approaching', 'new_requests', 'knowledge', 'requester_events', 'briefing.approvals', 'briefing.tasks', 'briefing.dates', 'briefing.obligations', 'briefing.intake'));--> statement-breakpoint
COMMIT;
