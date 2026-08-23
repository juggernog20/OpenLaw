CREATE TABLE "matter_key_dates" (
	"id" text PRIMARY KEY NOT NULL,
	"matter_id" text NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_key_dates_label_check" CHECK (length(btrim("matter_key_dates"."label")) between 1 and 200),
	CONSTRAINT "matter_key_dates_note_check" CHECK ("matter_key_dates"."note" is null or length(btrim("matter_key_dates"."note")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "matter_key_dates" ADD CONSTRAINT "matter_key_dates_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matter_key_dates_matter_date_idx" ON "matter_key_dates" USING btree ("matter_id","date");