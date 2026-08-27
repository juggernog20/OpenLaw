-- M25/2: every vector is stored and generated from its row, so this
-- ALTER computes the complete existing install and later writes cannot
-- leave the index stale (DOC-009, TECH-014).
--
-- Plain CREATE INDEX is deliberate. The blessed upgrade runs before
-- the API starts, so this batch needs no CONCURRENTLY and therefore no
-- COMMIT; BEGIN; preamble.
ALTER TABLE "contracts" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english', 'C-' || "number"::text), 'A') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'B')
    ) STORED;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("jurisdiction", '')), 'C')
    ) STORED;--> statement-breakpoint
-- A tsvector cannot exceed 1 MB. One million characters of prose fits
-- with room to spare, but the same length of serial numbers, hashes, or
-- OCR noise does not, and a generated column that raises on the write
-- would take the extracted text down with the index. The function keeps
-- the text and leaves that one version unindexed (DOC-009).
CREATE FUNCTION "document_text_search_vector"("state" text, "body" text) RETURNS "tsvector"
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF "state" <> 'ready' THEN
    RETURN ''::tsvector;
  END IF;
  RETURN setweight(to_tsvector('english', left(coalesce("body", ''), 1000000)), 'D');
EXCEPTION WHEN program_limit_exceeded THEN
  RETURN ''::tsvector;
END
$$;--> statement-breakpoint
ALTER TABLE "document_version_text" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (document_text_search_vector("state", "text")) STORED;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'B')
    ) STORED;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("legal_name", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("jurisdiction", '')), 'C') ||
      setweight(to_tsvector('english', coalesce("registration_number", '')), 'C') ||
      setweight(to_tsvector('english', coalesce("status", '')), 'C')
    ) STORED;--> statement-breakpoint
ALTER TABLE "matters" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
      setweight(to_tsvector('english', 'M-' || "number"::text), 'A') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'B')
    ) STORED;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("summary", '')), 'A') ||
      setweight(to_tsvector('english', 'R-' || "number"::text), 'A') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
      setweight(to_tsvector('english', coalesce("status", '')), 'C')
    ) STORED;--> statement-breakpoint
CREATE INDEX "contracts_search_vector_idx" ON "contracts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "counterparties_search_vector_idx" ON "counterparties" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_version_text_search_vector_idx" ON "document_version_text" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_search_vector_idx" ON "documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "entities_search_vector_idx" ON "entities" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "matters_search_vector_idx" ON "matters" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "requests_search_vector_idx" ON "requests" USING gin ("search_vector");
