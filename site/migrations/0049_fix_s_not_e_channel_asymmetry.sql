-- Migration 0049: Fix S-not-E channel asymmetry in rater_scores
--
-- Root cause: 2,384 rows in rater_scores have structural IS NOT NULL but editorial IS NULL.
-- These were written before eval-parse.ts added the guard (lines 215-219) that nulls structural
-- when editorial is absent. Per methodology, editorial is the primary channel — structural alone
-- is meaningless for scoring (structural signals require editorial context to direct).
--
-- Models affected: claude-haiku-4-5-20251001 (1141 rows), deepseek-v3.2 (1266), llama-4-scout-wai (8)
-- Stories with stale hcb_weighted_mean: 116 (haiku as primary model)
-- E-not-S rows (editorial set, structural null) are intentional — no fix needed.
--
-- Step 1: Null out structural and final for S-not-E rows (matches parser guard behavior).
-- After this, these sections are ND (not-a-dimension) and excluded from aggregate computation.
UPDATE rater_scores
SET structural = NULL,
    final      = NULL
WHERE editorial IS NULL
  AND structural IS NOT NULL;

-- Step 2: Re-derive hcb_weighted_mean and hcb_structural_mean from corrected rater_scores.
-- Scope: stories whose primary eval_model had S-not-E rows (haiku, deepseek, llama-4-scout-wai).
-- Evidence weights match computeAggregates(): H=1.0, M=0.7, L=0.4, else=0.4.
UPDATE stories
SET
  hcb_weighted_mean = (
    SELECT ROUND(
      SUM(rs.final * CASE rs.evidence WHEN 'H' THEN 1.0 WHEN 'M' THEN 0.7 WHEN 'L' THEN 0.4 ELSE 0.4 END)
      / NULLIF(SUM(CASE rs.evidence WHEN 'H' THEN 1.0 WHEN 'M' THEN 0.7 WHEN 'L' THEN 0.4 ELSE 0.4 END), 0),
      3
    )
    FROM rater_scores rs
    WHERE rs.hn_id = stories.hn_id
      AND rs.eval_model = stories.eval_model
      AND rs.final IS NOT NULL
  ),
  hcb_structural_mean = (
    SELECT ROUND(AVG(rs.structural), 3)
    FROM rater_scores rs
    WHERE rs.hn_id = stories.hn_id
      AND rs.eval_model = stories.eval_model
      AND rs.structural IS NOT NULL
  )
WHERE eval_model IN ('claude-haiku-4-5-20251001', 'deepseek-v3.2', 'llama-4-scout-wai')
  AND hcb_weighted_mean IS NOT NULL;

-- Step 3: Re-derive hcb_classification from corrected hcb_weighted_mean.
-- Thresholds match CLASSIFICATIONS in src/lib/types.ts.
UPDATE stories
SET hcb_classification = CASE
    WHEN hcb_weighted_mean >= 0.6  THEN 'Strong positive'
    WHEN hcb_weighted_mean >= 0.3  THEN 'Moderate positive'
    WHEN hcb_weighted_mean >= 0.1  THEN 'Mild positive'
    WHEN hcb_weighted_mean >= -0.1 THEN 'Neutral'
    WHEN hcb_weighted_mean >= -0.3 THEN 'Mild negative'
    WHEN hcb_weighted_mean >= -0.6 THEN 'Moderate negative'
    ELSE                                'Strong negative'
  END
WHERE eval_model IN ('claude-haiku-4-5-20251001', 'deepseek-v3.2', 'llama-4-scout-wai')
  AND hcb_weighted_mean IS NOT NULL;
