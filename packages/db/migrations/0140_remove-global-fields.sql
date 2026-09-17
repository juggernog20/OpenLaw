-- Split legacy shared definitions into independent module fields. Keep the original
-- identity in the first area that uses it, preferring Contracts for Auto-Doc mappings.
DO $migration$
DECLARE f record; m record; r record; old_source text; new_source text; old_revision text; new_revision text; area text; areas text[]; first_area text; next_id text; next_slug text; suffix integer;
BEGIN
CREATE TEMP TABLE field_scope_split (
  old_id text NOT NULL, old_slug text NOT NULL, scope text NOT NULL,
  new_id text NOT NULL, new_slug text NOT NULL,
  PRIMARY KEY (old_id, scope)
) ON COMMIT DROP;
  FOR f IN SELECT * FROM fields WHERE module_scope = 'global' ORDER BY id LOOP
    areas := ARRAY[]::text[];
    IF EXISTS (SELECT 1 FROM contract_type_fields WHERE field_id = f.id)
      OR EXISTS (SELECT 1 FROM contracts WHERE custom_fields ? f.slug)
      OR EXISTS (SELECT 1 FROM auto_doc_form_versions v, jsonb_array_elements(v.definition->'fields') item WHERE item->>'catalogFieldId' = f.id)
      OR EXISTS (SELECT 1 FROM request_type_fields rf JOIN request_types rt ON rt.id = rf.request_type_id WHERE rf.field_id = f.id AND rt.target_module = 'contract')
    THEN areas := array_append(areas, 'contract'); END IF;
    IF EXISTS (SELECT 1 FROM matter_type_fields WHERE field_id = f.id)
      OR EXISTS (SELECT 1 FROM matters WHERE custom_fields ? f.slug)
      OR EXISTS (SELECT 1 FROM matter_templates WHERE default_custom_fields ? f.slug)
      OR EXISTS (SELECT 1 FROM conversion_drafts WHERE target_module = 'matter' AND (suggestions ? ('field:' || f.slug) OR conflicts ? ('field:' || f.slug)))
      OR EXISTS (SELECT 1 FROM request_type_fields rf JOIN request_types rt ON rt.id = rf.request_type_id WHERE rf.field_id = f.id AND rt.target_module = 'matter')
    THEN areas := array_append(areas, 'matter'); END IF;
    -- Untargeted intake keeps one question, assigned to the first eligible area.
    IF NOT (areas && ARRAY['contract', 'matter']) AND (
      EXISTS (SELECT 1 FROM request_type_fields WHERE field_id = f.id)
      OR EXISTS (SELECT 1 FROM requests WHERE custom_fields ? f.slug)
    ) THEN areas := array_prepend('contract', areas); END IF;
    IF EXISTS (SELECT 1 FROM entity_type_fields WHERE field_id = f.id)
      OR EXISTS (SELECT 1 FROM entities WHERE custom_fields ? f.slug)
    THEN areas := array_append(areas, 'entity'); END IF;
    IF cardinality(areas) = 0 THEN areas := ARRAY['contract']; END IF;
    first_area := areas[1];
    UPDATE fields SET module_scope = first_area WHERE id = f.id;
    FOREACH area IN ARRAY areas LOOP
      IF area = first_area THEN
        next_id := f.id; next_slug := f.slug;
      ELSE
        next_id := gen_random_uuid()::text;
        next_slug := left(f.slug, 100) || '_' || area;
        suffix := 1;
        WHILE EXISTS (SELECT 1 FROM fields WHERE slug = next_slug) LOOP
          suffix := suffix + 1;
          next_slug := left(f.slug, 100) || '_' || area || '_' || suffix;
        END LOOP;
        INSERT INTO fields (id, slug, display_name, description, module_scope, field_type, options, field_tag, ai_prompt, archived_at, created_at, updated_at)
        VALUES (next_id, next_slug, f.display_name, f.description, area, f.field_type, f.options, f.field_tag,
          CASE WHEN area = 'contract' THEN f.ai_prompt ELSE NULL END, f.archived_at, f.created_at, f.updated_at);
      END IF;
      INSERT INTO field_scope_split VALUES (f.id, f.slug, area, next_id, next_slug);
    END LOOP;
  END LOOP;
-- These helpers exist only for this transaction; no runtime aliasing remains.
CREATE FUNCTION pg_temp.rename_field_key(value jsonb, old_key text, new_key text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN value ? old_key AND old_key <> new_key
    THEN (value - old_key) || jsonb_build_object(new_key, value->old_key) ELSE value END
$$;
-- Match conversionSources' JSON serialization so an unchanged answer keeps valid citations.
CREATE FUNCTION pg_temp.field_source_revision(source_id text, label text, value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT encode(sha256(convert_to('{"id":' || to_json(source_id)::text || ',"kind":"field","label":' || to_json(label)::text || ',"text":' ||
    to_json(CASE jsonb_typeof(value)
      WHEN 'string' THEN value #>> '{}'
      WHEN 'array' THEN '[' || coalesce((SELECT string_agg(v::text, ',' ORDER BY ord) FROM jsonb_array_elements(value) WITH ORDINALITY x(v, ord)), '') || ']'
      ELSE value::text END)::text || '}', 'UTF8')), 'hex')
$fn$;
CREATE FUNCTION pg_temp.remap_field_citations(value jsonb, old_source text, new_source text, old_revision text, new_revision text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(value) = 'array' THEN
    SELECT coalesce(jsonb_agg(pg_temp.remap_field_citations(v, old_source, new_source, old_revision, new_revision) ORDER BY ord), '[]')
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY x(v, ord);
  ELSIF jsonb_typeof(value) = 'object' THEN
    SELECT coalesce(jsonb_object_agg(k, pg_temp.remap_field_citations(v, old_source, new_source, old_revision, new_revision)), '{}')
      INTO result FROM jsonb_each(value) x(k, v);
    IF value->>'sourceId' = old_source THEN
      result := jsonb_set(result, '{sourceId}', to_jsonb(new_source));
      -- Already stale citations stay stale; only an exact source revision is rebased.
      IF value->>'revision' = old_revision THEN
        result := jsonb_set(result, '{revision}', to_jsonb(new_revision));
      END IF;
    END IF;
  ELSE result := value;
  END IF;
  RETURN result;
END $fn$;

  FOR m IN SELECT * FROM field_scope_split WHERE old_id <> new_id LOOP
    IF m.scope = 'matter' THEN
      UPDATE matter_type_fields SET field_id = m.new_id WHERE field_id = m.old_id;
      UPDATE matters SET custom_fields = pg_temp.rename_field_key(custom_fields, m.old_slug, m.new_slug),
        ai_unverified = pg_temp.rename_field_key(ai_unverified, 'field:' || m.old_slug, 'field:' || m.new_slug)
        WHERE custom_fields ? m.old_slug OR ai_unverified ? ('field:' || m.old_slug);
      UPDATE matter_templates SET default_custom_fields = pg_temp.rename_field_key(default_custom_fields, m.old_slug, m.new_slug)
        WHERE default_custom_fields ? m.old_slug;
      UPDATE conversion_drafts SET
        suggestions = pg_temp.rename_field_key(suggestions, 'field:' || m.old_slug, 'field:' || m.new_slug),
        conflicts = pg_temp.rename_field_key(conflicts, 'field:' || m.old_slug, 'field:' || m.new_slug)
        WHERE target_module = 'matter';
    ELSIF m.scope = 'entity' THEN
      UPDATE entity_type_fields SET field_id = m.new_id WHERE field_id = m.old_id;
      UPDATE entities SET custom_fields = pg_temp.rename_field_key(custom_fields, m.old_slug, m.new_slug)
        WHERE custom_fields ? m.old_slug;
    END IF;
    -- Contract is always the original when present, so immutable Auto-Doc
    -- definitions, generation snapshots and Contract analysis history keep their IDs.
    UPDATE request_type_fields rf SET field_id = m.new_id FROM request_types rt
      WHERE rt.id = rf.request_type_id AND rt.target_module = m.scope AND rf.field_id = m.old_id;
    FOR r IN SELECT req.id, req.custom_fields, definition.display_name, definition.field_type FROM requests req
      JOIN request_types rt ON rt.id = req.request_type_id JOIN fields definition ON definition.id = m.old_id
      WHERE rt.target_module = m.scope AND req.custom_fields ? m.old_slug LOOP
      old_source := 'field:' || r.id || ':' || m.old_slug;
      new_source := 'field:' || r.id || ':' || m.new_slug;
      old_revision := pg_temp.field_source_revision(old_source, r.display_name || ' (' || r.field_type || ')', r.custom_fields->m.old_slug);
      new_revision := pg_temp.field_source_revision(new_source, r.display_name || ' (' || r.field_type || ')', r.custom_fields->m.old_slug);
      UPDATE conversion_drafts SET
        suggestions = pg_temp.remap_field_citations(suggestions, old_source, new_source, old_revision, new_revision),
        conflicts = pg_temp.remap_field_citations(conflicts, old_source, new_source, old_revision, new_revision)
        WHERE request_id = r.id;
      UPDATE contract_analysis_runs SET source_context = pg_temp.remap_field_citations(source_context, old_source, new_source, old_revision, new_revision)
        WHERE source_context->>'requestId' = r.id;
    END LOOP;
    UPDATE requests req SET custom_fields = pg_temp.rename_field_key(req.custom_fields, m.old_slug, m.new_slug)
      FROM request_types rt WHERE rt.id = req.request_type_id AND rt.target_module = m.scope
      AND req.custom_fields ? m.old_slug;
  END LOOP;
ALTER TABLE "fields" DROP CONSTRAINT "fields_module_scope_check";
ALTER TABLE "fields" ADD CONSTRAINT "fields_module_scope_check" CHECK ("fields"."module_scope" in ('matter', 'contract', 'entity'));

DROP FUNCTION pg_temp.rename_field_key(jsonb, text, text);
DROP FUNCTION pg_temp.field_source_revision(text, text, jsonb);
DROP FUNCTION pg_temp.remap_field_citations(jsonb, text, text, text, text);
END $migration$;
