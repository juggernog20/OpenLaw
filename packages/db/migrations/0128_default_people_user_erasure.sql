-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "contract_type_default_people" DROP CONSTRAINT "contract_type_default_people_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "contract_type_default_people" ADD CONSTRAINT "contract_type_default_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
