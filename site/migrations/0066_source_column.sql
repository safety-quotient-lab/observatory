-- Add source discriminator + geographic metadata columns to stories table.
-- Enables multi-source ingestion (Lobsters, GDELT, Federal Register, etc.)
-- without schema changes. All existing rows default to 'hn'.
ALTER TABLE stories ADD COLUMN source TEXT DEFAULT 'hn';
ALTER TABLE stories ADD COLUMN source_country TEXT;
ALTER TABLE stories ADD COLUMN source_language TEXT DEFAULT 'en';
