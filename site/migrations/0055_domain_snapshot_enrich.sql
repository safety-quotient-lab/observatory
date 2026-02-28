-- Migration 0055: enrich domain_profile_snapshots with 9 missing fields from domain_aggregates
--
-- domain_aggregates has had avg_confidence, avg_sr, avg_pt_count, avg_dominance,
-- avg_fw_ratio, dominant_scope, dominant_reading_level, dominant_sentiment since
-- migration 0029. avg_pt_score added in migration 0053. None were included in the
-- daily snapshot INSERT. Adding them now so the /api/v1/domain/[domain]/history
-- endpoint exposes the full signal profile for trend analysis.

ALTER TABLE domain_profile_snapshots ADD COLUMN avg_confidence       REAL;
ALTER TABLE domain_profile_snapshots ADD COLUMN avg_sr               REAL;
ALTER TABLE domain_profile_snapshots ADD COLUMN avg_pt_count         REAL;
ALTER TABLE domain_profile_snapshots ADD COLUMN avg_pt_score         REAL;
ALTER TABLE domain_profile_snapshots ADD COLUMN avg_dominance        REAL;
ALTER TABLE domain_profile_snapshots ADD COLUMN avg_fw_ratio         REAL;
ALTER TABLE domain_profile_snapshots ADD COLUMN dominant_scope       TEXT;
ALTER TABLE domain_profile_snapshots ADD COLUMN dominant_reading_level TEXT;
ALTER TABLE domain_profile_snapshots ADD COLUMN dominant_sentiment   TEXT;
