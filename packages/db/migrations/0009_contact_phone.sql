-- Optional contact numbers remain private and outside publication JSON.
ALTER TABLE community.contacts ADD COLUMN phone text NOT NULL DEFAULT '';
