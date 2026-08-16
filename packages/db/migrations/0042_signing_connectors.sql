CREATE TABLE "signing_connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"integration_key" text NOT NULL,
	"api_user_id" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_connectors_provider_check" CHECK ("signing_connectors"."provider" in ('docusign')),
	CONSTRAINT "signing_connectors_environment_check" CHECK ("signing_connectors"."environment" in ('demo', 'production'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signing_connectors_provider_idx" ON "signing_connectors" USING btree ("provider");