-- Fair Witness evidence table: normalized storage of observable facts and inferences
CREATE TABLE IF NOT EXISTS fair_witness (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hn_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  fact_type TEXT NOT NULL CHECK(fact_type IN ('observable', 'inference')),
  fact_text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fw_hn_id ON fair_witness(hn_id);
CREATE INDEX IF NOT EXISTS idx_fw_section ON fair_witness(section);
CREATE INDEX IF NOT EXISTS idx_fw_fact_type ON fair_witness(fact_type);

-- Aggregate FW metrics on stories table
ALTER TABLE stories ADD COLUMN fw_ratio REAL;
ALTER TABLE stories ADD COLUMN fw_observable_count INTEGER DEFAULT 0;
ALTER TABLE stories ADD COLUMN fw_inference_count INTEGER DEFAULT 0;
