CREATE TABLE "allowed_client_links" (
	"client_id" text PRIMARY KEY NOT NULL,
	"allowed_client_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowed_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"metadata_url" text,
	"client_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"callback_urls" text[] DEFAULT '{}' NOT NULL,
	"secret_generated_at" timestamp with time zone,
	"registered_by_client" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_clients_metadata_url_unique" UNIQUE("metadata_url"),
	CONSTRAINT "allowed_clients_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "allowed_clients_kind_check" CHECK ("allowed_clients"."kind" in ('published', 'registered')),
	CONSTRAINT "allowed_clients_identity_check" CHECK (("allowed_clients"."kind" = 'published' and "allowed_clients"."metadata_url" is not null and "allowed_clients"."client_id" is null) or ("allowed_clients"."kind" = 'registered' and "allowed_clients"."metadata_url" is null))
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "mcp_dynamic_client_registration_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "allowed_client_links" ADD CONSTRAINT "allowed_client_links_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowed_client_links" ADD CONSTRAINT "allowed_client_links_allowed_client_id_allowed_clients_id_fk" FOREIGN KEY ("allowed_client_id") REFERENCES "public"."allowed_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowed_clients" ADD CONSTRAINT "allowed_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allowed_client_links_allowed_idx" ON "allowed_client_links" USING btree ("allowed_client_id");--> statement-breakpoint
INSERT INTO allowed_clients (id, name, kind, metadata_url, seeded) VALUES
 ('01997000-0000-7000-8000-000000000001', 'Claude', 'published', 'https://claude.ai/oauth/mcp-oauth-client-metadata', true),
 ('01997000-0000-7000-8000-000000000002', 'Claude Code', 'published', 'https://claude.ai/oauth/claude-code-client-metadata', true),
 ('01997000-0000-7000-8000-000000000003', 'ChatGPT', 'published', 'https://chatgpt.com/oauth/client.json', true);
--> statement-breakpoint
INSERT INTO allowed_clients (id, name, kind, seeded, callback_urls) VALUES
 ('01997000-0000-7000-8000-000000000004', 'Microsoft 365 Copilot', 'registered', true,
 ARRAY['https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect', 'https://vscode.dev/redirect', '']);
