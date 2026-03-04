-- Transparency Quotient (TQ): binary verifiability indicators replacing Llama structural channel
-- Collected via lite-1.6 prompt; computed tq_score used as structural proxy in weighted_mean
ALTER TABLE rater_evals ADD COLUMN tq_score REAL;         -- computed: sum(binaries)/5, 0.0–1.0
ALTER TABLE rater_evals ADD COLUMN tq_author INTEGER;     -- 0/1: author identified by real name
ALTER TABLE rater_evals ADD COLUMN tq_date INTEGER;       -- 0/1: publication date visible
ALTER TABLE rater_evals ADD COLUMN tq_sources INTEGER;    -- 0/1: primary sources cited
ALTER TABLE rater_evals ADD COLUMN tq_corrections INTEGER; -- 0/1: correction notice or policy present
ALTER TABLE rater_evals ADD COLUMN tq_conflicts INTEGER;  -- 0/1: conflicts of interest explicitly disclosed

-- Story-level TQ aggregate: COALESCE fill-in from primary model lite eval (like td_score)
ALTER TABLE stories ADD COLUMN tq_score REAL;
