-- Signal 1: Epistemic Quality (CRAAP-adapted)
ALTER TABLE stories ADD COLUMN eq_score REAL;
ALTER TABLE stories ADD COLUMN eq_source_quality REAL;
ALTER TABLE stories ADD COLUMN eq_evidence_reasoning REAL;
ALTER TABLE stories ADD COLUMN eq_uncertainty_handling REAL;
ALTER TABLE stories ADD COLUMN eq_purpose_transparency REAL;
ALTER TABLE stories ADD COLUMN eq_claim_density TEXT;

-- Signal 2: Propaganda Techniques (PTC-18)
ALTER TABLE stories ADD COLUMN pt_flag_count INTEGER DEFAULT 0;
ALTER TABLE stories ADD COLUMN pt_flags_json TEXT;

-- Signal 3: Solution Orientation
ALTER TABLE stories ADD COLUMN so_score REAL;
ALTER TABLE stories ADD COLUMN so_framing TEXT;
ALTER TABLE stories ADD COLUMN so_reader_agency REAL;

-- Signal 4: Emotional Tone (VAD + discrete)
ALTER TABLE stories ADD COLUMN et_primary_tone TEXT;
ALTER TABLE stories ADD COLUMN et_valence REAL;
ALTER TABLE stories ADD COLUMN et_arousal REAL;
ALTER TABLE stories ADD COLUMN et_dominance REAL;

-- Signal 5: Stakeholder Representation
ALTER TABLE stories ADD COLUMN sr_score REAL;
ALTER TABLE stories ADD COLUMN sr_perspective_count INTEGER;
ALTER TABLE stories ADD COLUMN sr_voice_balance REAL;
ALTER TABLE stories ADD COLUMN sr_who_speaks TEXT;
ALTER TABLE stories ADD COLUMN sr_who_spoken_about TEXT;

-- Signal 6: Temporal Framing
ALTER TABLE stories ADD COLUMN tf_primary_focus TEXT;
ALTER TABLE stories ADD COLUMN tf_time_horizon TEXT;

-- Signal 7: Geographic Scope
ALTER TABLE stories ADD COLUMN gs_scope TEXT;
ALTER TABLE stories ADD COLUMN gs_regions_json TEXT;

-- Signal 8: Complexity Level
ALTER TABLE stories ADD COLUMN cl_reading_level TEXT;
ALTER TABLE stories ADD COLUMN cl_jargon_density TEXT;
ALTER TABLE stories ADD COLUMN cl_assumed_knowledge TEXT;

-- Signal 9: Transparency & Disclosure
ALTER TABLE stories ADD COLUMN td_score REAL;
ALTER TABLE stories ADD COLUMN td_author_identified INTEGER;
ALTER TABLE stories ADD COLUMN td_conflicts_disclosed INTEGER;
ALTER TABLE stories ADD COLUMN td_funding_disclosed INTEGER;
