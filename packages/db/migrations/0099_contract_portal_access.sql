CREATE TABLE "contract_stakeholders" (
	"contract_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_stakeholders_pkey" PRIMARY KEY("contract_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "business_owner_id" text;--> statement-breakpoint
ALTER TABLE "contract_stakeholders" ADD CONSTRAINT "contract_stakeholders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_stakeholders" ADD CONSTRAINT "contract_stakeholders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_stakeholders_user_idx" ON "contract_stakeholders" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_business_owner_id_users_id_fk" FOREIGN KEY ("business_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
COMMIT;
--> statement-breakpoint
UPDATE "contracts" SET "business_owner_id" = "requests"."requester_id"
FROM "requests" WHERE "requests"."converted_contract_id" = "contracts"."id"
AND "contracts"."business_owner_id" IS NULL;

--> statement-breakpoint
ALTER TABLE "contracts" VALIDATE CONSTRAINT "contracts_business_owner_id_users_id_fk";
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "contracts_business_owner_idx" ON "contracts" USING btree ("business_owner_id");
