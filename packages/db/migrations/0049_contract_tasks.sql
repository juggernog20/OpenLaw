CREATE TABLE "contract_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"title" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"assignee_id" text,
	"due_date" date,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_tasks_title_check" CHECK (length(btrim("contract_tasks"."title")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "contract_tasks" ADD CONSTRAINT "contract_tasks_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_tasks" ADD CONSTRAINT "contract_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_tasks_contract_order_idx" ON "contract_tasks" USING btree ("contract_id","display_order");
