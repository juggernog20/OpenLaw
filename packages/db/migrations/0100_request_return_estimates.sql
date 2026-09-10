ALTER TABLE "request_types" ADD COLUMN "turnaround_days" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "expected_by" date;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_turnaround_days_check" CHECK ("request_types"."turnaround_days" >= 0 AND "request_types"."turnaround_days" <= 36500);