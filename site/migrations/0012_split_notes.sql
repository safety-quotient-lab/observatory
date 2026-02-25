-- Channel-specific notes (split from single "note" column)
ALTER TABLE scores ADD COLUMN editorial_note TEXT NOT NULL DEFAULT '';
ALTER TABLE scores ADD COLUMN structural_note TEXT NOT NULL DEFAULT '';

-- Materialized derived fields (previously only in hcb_json blob)
ALTER TABLE scores ADD COLUMN combined REAL;
ALTER TABLE scores ADD COLUMN context_modifier REAL;

-- Story-level materialized aggregates (eliminate expensive subqueries)
ALTER TABLE stories ADD COLUMN hcb_editorial_mean REAL;
ALTER TABLE stories ADD COLUMN hcb_structural_mean REAL;
ALTER TABLE stories ADD COLUMN hcb_setl REAL;
ALTER TABLE stories ADD COLUMN hcb_confidence REAL;

-- Backfill existing notes to editorial_note (editorial is primary channel)
UPDATE scores SET editorial_note = note WHERE note != '';
