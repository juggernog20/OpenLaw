-- Preserve Inbox column order, widths and sorting across the Request Title rename.
UPDATE list_views SET config = jsonb_set(config, '{columns}', (
  SELECT jsonb_agg(CASE WHEN col ->> 'key' = 'summary'
    THEN jsonb_set(col, '{key}', '"title"'::jsonb) ELSE col END ORDER BY position)
  FROM jsonb_array_elements(config -> 'columns') WITH ORDINALITY AS columns(col, position)
)) WHERE surface = 'inbox' AND jsonb_typeof(config -> 'columns') = 'array'
  AND config -> 'columns' @> '[{"key":"summary"}]'::jsonb;
--> statement-breakpoint
UPDATE list_views SET config = jsonb_set(config, '{sort,key}', '"title"'::jsonb)
WHERE surface = 'inbox' AND config #>> '{sort,key}' = 'summary';
