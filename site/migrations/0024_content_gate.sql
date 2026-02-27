-- Add structured content gate columns to stories table
ALTER TABLE stories ADD COLUMN gate_category TEXT;
ALTER TABLE stories ADD COLUMN gate_confidence REAL;

-- Backfill from existing eval_error format: 'Content gate: <cat> (<conf>)'
UPDATE stories
SET gate_category = TRIM(SUBSTR(eval_error, LENGTH('Content gate: ') + 1,
      INSTR(SUBSTR(eval_error, LENGTH('Content gate: ') + 1), ' (') - 1)),
    gate_confidence = CAST(REPLACE(REPLACE(SUBSTR(eval_error,
      INSTR(eval_error, '(') + 1,
      INSTR(eval_error, ')') - INSTR(eval_error, '(') - 1), '(', ''), ')', '') AS REAL)
WHERE eval_error LIKE 'Content gate:%';

-- Indexes for gate queries (partial — only rows with gate data)
CREATE INDEX IF NOT EXISTS idx_stories_gate_category ON stories(gate_category) WHERE gate_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stories_domain_gate ON stories(domain, gate_category) WHERE gate_category IS NOT NULL;
