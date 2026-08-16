CREATE TABLE "contract_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"approver_id" text NOT NULL,
	"source" text NOT NULL,
	"group_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_by" text NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_approvals_group_source" CHECK ((source = 'group') = (group_id is not null)),
	CONSTRAINT "contract_approvals_decided_at" CHECK ((status = 'pending') = (decided_at is null))
);
--> statement-breakpoint
ALTER TABLE "contract_approvals" ADD CONSTRAINT "contract_approvals_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_approvals" ADD CONSTRAINT "contract_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_approvals" ADD CONSTRAINT "contract_approvals_group_id_approver_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."approver_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_approvals" ADD CONSTRAINT "contract_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_approvals_contract_idx" ON "contract_approvals" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_approvals_pending_idx" ON "contract_approvals" USING btree ("contract_id","approver_id") WHERE status = 'pending';