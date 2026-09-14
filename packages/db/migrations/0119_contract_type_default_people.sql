-- SPDX-License-Identifier: AGPL-3.0-only
CREATE TABLE "contract_type_default_people" (
	"contract_type_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_type_default_people_contract_type_id_user_id_pk" PRIMARY KEY("contract_type_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "contract_type_default_people" ADD CONSTRAINT "contract_type_default_people_contract_type_id_contract_types_id_fk" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_type_default_people" ADD CONSTRAINT "contract_type_default_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
