-- Drop legacy scores and fair_witness tables.
-- All reads migrated to rater_scores/rater_witness (commit d72cdac).
-- All writes removed from writeEvalResult (this commit).
-- Data preserved in rater_scores/rater_witness tables.
DROP TABLE IF EXISTS scores;
DROP TABLE IF EXISTS fair_witness;
