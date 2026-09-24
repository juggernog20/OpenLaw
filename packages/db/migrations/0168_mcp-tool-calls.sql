CREATE TABLE "mcp_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"client_name" text NOT NULL,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_calls_duration_check" CHECK ("mcp_tool_calls"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_credential_time_idx" ON "mcp_tool_calls" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_created_at_idx" ON "mcp_tool_calls" USING btree ("created_at");