-- Phase 39C: Internet Archive integration
-- archive_url: Wayback Machine URL after preservation submission
-- archive_used: 1 if Wayback Machine was used as fallback content source

ALTER TABLE stories ADD COLUMN archive_url TEXT;
ALTER TABLE stories ADD COLUMN archive_used INTEGER NOT NULL DEFAULT 0;
