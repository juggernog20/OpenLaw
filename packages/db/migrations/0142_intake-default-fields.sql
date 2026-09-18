ALTER TABLE "fields" ADD COLUMN "built_in_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "fields_built_in_key_unique" ON "fields" USING btree ("built_in_key");