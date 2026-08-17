CREATE TABLE "contract_relations" (
	"from_contract_id" text NOT NULL,
	"to_contract_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_relations_pkey" PRIMARY KEY("from_contract_id","to_contract_id","relation_type"),
	CONSTRAINT "contract_relations_type_check" CHECK ("contract_relations"."relation_type" in ('related', 'renews', 'amends')),
	CONSTRAINT "contract_relations_self_check" CHECK ("contract_relations"."from_contract_id" <> "contract_relations"."to_contract_id")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "contract_relations" ADD CONSTRAINT "contract_relations_from_contract_id_contracts_id_fk" FOREIGN KEY ("from_contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_relations" ADD CONSTRAINT "contract_relations_to_contract_id_contracts_id_fk" FOREIGN KEY ("to_contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_relations_to_idx" ON "contract_relations" USING btree ("to_contract_id","relation_type");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_parent_id_contracts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_parent_idx" ON "contracts" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_parent_not_self_check" CHECK ("contracts"."parent_id" is null or "contracts"."parent_id" <> "contracts"."id");