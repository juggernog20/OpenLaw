-- SPDX-License-Identifier: AGPL-3.0-only

CREATE UNIQUE INDEX "matter_templates_name_idx" ON "matter_templates" USING btree ("matter_type_id",lower("name")) WHERE "matter_templates"."archived_at" is null;
