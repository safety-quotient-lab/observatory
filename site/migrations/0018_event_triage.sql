-- Add triage columns to events table for tracking investigation and resolution status.
-- NULL = not yet triaged, 1 = yes, 0 = no (for investigated/resolved).

ALTER TABLE events ADD COLUMN investigated INTEGER DEFAULT NULL;
ALTER TABLE events ADD COLUMN resolved INTEGER DEFAULT NULL;
