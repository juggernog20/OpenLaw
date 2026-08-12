CREATE TABLE "contract_type_fields" (
	"contract_type_id" text NOT NULL,
	"field_id" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_type_fields_contract_type_id_field_id_pk" PRIMARY KEY("contract_type_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "contract_types" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "contract_type_fields" ADD CONSTRAINT "contract_type_fields_contract_type_id_contract_types_id_fk" FOREIGN KEY ("contract_type_id") REFERENCES "public"."contract_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_type_fields" ADD CONSTRAINT "contract_type_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE no action ON UPDATE no action;