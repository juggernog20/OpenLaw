-- PostgreSQL rewrites the generated search expression and preserves its index.
ALTER TABLE "requests" RENAME COLUMN "summary" TO "title";
