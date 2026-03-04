-- Migration 0058: add editorial_uncertain flag to rater_evals
--
-- Stores explicit detection of the Llama lazy-neutral failure mode:
-- model outputs editorial=50 (→ 0.0) with high confidence despite the
-- prompt specification prohibiting it. The flag preserves the original
-- score (no value fabrication) while making the instrument failure
-- explicit in the audit trail.
--
-- Detection rule: prompt_mode='lite', hcb_editorial_mean=0.0,
-- hcb_confidence>=0.7. The confidence threshold excludes genuine
-- low-confidence neutrals (model unsure → confidence<0.7).

ALTER TABLE rater_evals ADD COLUMN editorial_uncertain INTEGER DEFAULT 0;

-- Backfill existing lazy-neutral evals
UPDATE rater_evals
SET editorial_uncertain = 1
WHERE prompt_mode IN ('lite', 'light')
  AND hcb_editorial_mean = 0.0
  AND hcb_confidence >= 0.7
  AND eval_status = 'done';
