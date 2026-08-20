CREATE TABLE "request_type_fields" (
	"request_type_id" text NOT NULL,
	"field_id" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_fields_request_type_id_field_id_pk" PRIMARY KEY("request_type_id","field_id")
);
--> statement-breakpoint
ALTER TABLE "request_type_fields" ADD CONSTRAINT "request_type_fields_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_fields" ADD CONSTRAINT "request_type_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_type_fields_field_id_idx" ON "request_type_fields" USING btree ("field_id");