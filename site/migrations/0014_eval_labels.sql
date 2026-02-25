-- Story-level evaluation labels: theme, sentiment, executive summary
ALTER TABLE stories ADD COLUMN hcb_theme_tag TEXT;
ALTER TABLE stories ADD COLUMN hcb_sentiment_tag TEXT;
ALTER TABLE stories ADD COLUMN hcb_executive_summary TEXT;

-- Defensive backfill for any manually-injected v3.6 evals
UPDATE stories SET
  hcb_theme_tag = json_extract(hcb_json, '$.theme_tag'),
  hcb_sentiment_tag = json_extract(hcb_json, '$.sentiment_tag'),
  hcb_executive_summary = json_extract(hcb_json, '$.executive_summary')
WHERE eval_status = 'done'
  AND hcb_json IS NOT NULL
  AND json_extract(hcb_json, '$.theme_tag') IS NOT NULL;
