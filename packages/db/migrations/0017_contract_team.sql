CREATE TABLE "contract_team" (
	"contract_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_team_pkey" PRIMARY KEY("contract_id","user_id","role"),
	CONSTRAINT "contract_team_role_check" CHECK ("contract_team"."role" in ('member', 'watcher', 'creator', 'contributor'))
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "contract_team" ADD CONSTRAINT "contract_team_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_team" ADD CONSTRAINT "contract_team_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_team_user_idx" ON "contract_team" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_manager_idx" ON "contracts" USING btree ("manager_id");