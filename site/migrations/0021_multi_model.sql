-- Multi-model rater tables: per-model evaluations, scores, and witness facts.
-- Existing stories/scores/fair_witness tables are NOT modified.

-- Per-model evaluation results (one row per hn_id + eval_model)
CREATE TABLE rater_evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id INTEGER NOT NULL,
  eval_model TEXT NOT NULL,
  eval_provider TEXT NOT NULL DEFAULT 'anthropic',
  eval_status TEXT NOT NULL DEFAULT 'pending',
  eval_error TEXT,
  hcb_weighted_mean REAL,
  hcb_classification TEXT,
  hcb_json TEXT,
  hcb_signal_sections INTEGER,
  hcb_nd_count INTEGER,
  hcb_evidence_h INTEGER,
  hcb_evidence_m INTEGER,
  hcb_evidence_l INTEGER,
  eval_prompt_hash TEXT,
  methodology_hash TEXT,
  content_type TEXT,
  schema_version TEXT,
  hcb_theme_tag TEXT,
  hcb_sentiment_tag TEXT,
  hcb_executive_summary TEXT,
  fw_ratio REAL,
  fw_observable_count INTEGER DEFAULT 0,
  fw_inference_count INTEGER DEFAULT 0,
  hcb_editorial_mean REAL,
  hcb_structural_mean REAL,
  hcb_setl REAL,
  hcb_confidence REAL,
  eq_score REAL,
  so_score REAL,
  et_primary_tone TEXT,
  et_valence REAL,
  sr_score REAL,
  pt_flag_count INTEGER DEFAULT 0,
  td_score REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  evaluated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hn_id, eval_model)
);
CREATE INDEX idx_rater_evals_hn_id ON rater_evals(hn_id);
CREATE INDEX idx_rater_evals_model ON rater_evals(eval_model, eval_status);
CREATE INDEX idx_rater_evals_status ON rater_evals(eval_status);
CREATE INDEX idx_rater_evals_score ON rater_evals(hcb_weighted_mean);

-- Per-model section scores (mirrors scores table structure with eval_model in PK)
CREATE TABLE rater_scores (
  hn_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  eval_model TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  final REAL,
  editorial REAL,
  structural REAL,
  evidence TEXT,
  directionality TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  editorial_note TEXT NOT NULL DEFAULT '',
  structural_note TEXT NOT NULL DEFAULT '',
  combined REAL,
  context_modifier REAL,
  PRIMARY KEY (hn_id, section, eval_model)
);
CREATE INDEX idx_rater_scores_model ON rater_scores(eval_model);
CREATE INDEX idx_rater_scores_section ON rater_scores(section, final);

-- Per-model Fair Witness facts (mirrors fair_witness table with eval_model)
CREATE TABLE rater_witness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id INTEGER NOT NULL,
  eval_model TEXT NOT NULL,
  section TEXT NOT NULL,
  fact_type TEXT NOT NULL CHECK(fact_type IN ('observable', 'inference')),
  fact_text TEXT NOT NULL
);
CREATE INDEX idx_rater_witness_hn_model ON rater_witness(hn_id, eval_model);
CREATE INDEX idx_rater_witness_section ON rater_witness(section);

-- Backfill rater_evals from existing stories with eval_status='done'
INSERT INTO rater_evals (
  hn_id, eval_model, eval_provider, eval_status,
  hcb_weighted_mean, hcb_classification, hcb_json,
  hcb_signal_sections, hcb_nd_count,
  hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
  eval_prompt_hash, methodology_hash,
  content_type, schema_version,
  hcb_theme_tag, hcb_sentiment_tag, hcb_executive_summary,
  fw_ratio, fw_observable_count, fw_inference_count,
  hcb_editorial_mean, hcb_structural_mean, hcb_setl, hcb_confidence,
  eq_score, so_score, et_primary_tone, et_valence,
  sr_score, pt_flag_count, td_score,
  evaluated_at
)
SELECT
  hn_id,
  COALESCE(eval_model, 'claude-haiku-4-5-20251001'),
  'anthropic',
  'done',
  hcb_weighted_mean, hcb_classification, hcb_json,
  hcb_signal_sections, hcb_nd_count,
  hcb_evidence_h, hcb_evidence_m, hcb_evidence_l,
  eval_prompt_hash, methodology_hash,
  content_type, schema_version,
  hcb_theme_tag, hcb_sentiment_tag, hcb_executive_summary,
  fw_ratio, fw_observable_count, fw_inference_count,
  hcb_editorial_mean, hcb_structural_mean, hcb_setl, hcb_confidence,
  eq_score, so_score, et_primary_tone, et_valence,
  sr_score, pt_flag_count, td_score,
  evaluated_at
FROM stories WHERE eval_status = 'done';

-- Backfill rater_scores from existing scores table
INSERT INTO rater_scores (
  hn_id, section, eval_model, sort_order,
  final, editorial, structural, evidence,
  directionality, note, editorial_note, structural_note,
  combined, context_modifier
)
SELECT
  s.hn_id, s.section,
  COALESCE(st.eval_model, 'claude-haiku-4-5-20251001'),
  s.sort_order,
  s.final, s.editorial, s.structural, s.evidence,
  s.directionality, s.note, s.editorial_note, s.structural_note,
  s.combined, s.context_modifier
FROM scores s
JOIN stories st ON s.hn_id = st.hn_id
WHERE st.eval_status = 'done';

-- Backfill rater_witness from existing fair_witness table
INSERT INTO rater_witness (
  hn_id, eval_model, section, fact_type, fact_text
)
SELECT
  fw.hn_id,
  COALESCE(st.eval_model, 'claude-haiku-4-5-20251001'),
  fw.section, fw.fact_type, fw.fact_text
FROM fair_witness fw
JOIN stories st ON fw.hn_id = st.hn_id
WHERE st.eval_status = 'done';
