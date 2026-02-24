-- Truncate long hcb_classification values to just the label (e.g. "Mild positive")
-- Some evaluations stored full paragraphs like "Mild positive — The article discusses..."
UPDATE stories
SET hcb_classification = SUBSTR(hcb_classification, 1, INSTR(hcb_classification, ' — ') - 1)
WHERE hcb_classification LIKE '% — %';
