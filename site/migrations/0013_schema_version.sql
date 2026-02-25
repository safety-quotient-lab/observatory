-- Add schema_version column to stories table
ALTER TABLE stories ADD COLUMN schema_version TEXT;

-- Backfill from hcb_json for existing evaluated stories
-- Pre-v3.5 evals lack schema_version in their JSON, so default to '3.4'
UPDATE stories SET schema_version = COALESCE(json_extract(hcb_json, '$.schema_version'), '3.4')
  WHERE eval_status = 'done' AND hcb_json IS NOT NULL;
