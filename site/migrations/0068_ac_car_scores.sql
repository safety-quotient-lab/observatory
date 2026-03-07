-- Accessibility Compliance (AC) — per-story composite from CL indicators
-- Layer 2 (LLM-generated): reading_level + jargon_density + assumed_knowledge
ALTER TABLE stories ADD COLUMN ac_score REAL;

-- Consent Architecture Rating (CAR) — per-domain composite from browser audit
-- Layer 1 (objective): security + tracking + accessibility
ALTER TABLE domain_browser_audit ADD COLUMN car_score REAL;

-- Domain aggregates: avg AC + CAR for domain-level display
ALTER TABLE domain_aggregates ADD COLUMN avg_ac REAL;
ALTER TABLE domain_aggregates ADD COLUMN car_score REAL;
