-- Direct corrections made by staff in the archive admin. Each row keeps the record before and
-- after the change so it can be shown in the change history and undone field by field.
CREATE TABLE community.staff_edits (
  sequence bigserial UNIQUE,
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  target_table text NOT NULL CHECK (target_table IN ('persons','places','person_places','materials')),
  target_id text NOT NULL,
  reason text NOT NULL,
  previous_data jsonb,
  next_data jsonb,
  undo_of text REFERENCES community.staff_edits(id),
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_edits_target_idx ON community.staff_edits (target_table, target_id, sequence DESC);
REVOKE ALL ON community.staff_edits FROM PUBLIC;
ALTER TABLE community.staff_edits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON community.staff_edits FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON community.staff_edits FROM authenticated;
  END IF;
END $$;
