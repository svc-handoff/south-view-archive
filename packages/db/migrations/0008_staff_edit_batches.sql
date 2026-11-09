-- Staff changes can now touch every public table, and one action (removing a person with their
-- links, merging two records) may change several rows: those rows share a batch and are undone
-- together.
ALTER TABLE community.staff_edits DROP CONSTRAINT staff_edits_target_table_check;
ALTER TABLE community.staff_edits ADD CONSTRAINT staff_edits_target_table_check
  CHECK (target_table IN ('persons','places','person_places','materials','sources','issues','contributions'));
ALTER TABLE community.staff_edits ADD COLUMN batch_id text;
UPDATE community.staff_edits SET batch_id = id WHERE batch_id IS NULL;
ALTER TABLE community.staff_edits ALTER COLUMN batch_id SET NOT NULL;
CREATE INDEX staff_edits_batch_idx ON community.staff_edits (batch_id, sequence);
