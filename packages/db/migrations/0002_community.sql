CREATE SCHEMA IF NOT EXISTS community;

-- Public projection only. Contact details and unpublished originals live separately below.
CREATE TABLE archive.credits (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id)
);
INSERT INTO archive.credits (id, data) VALUES ('initial-compilation', '{"id":"initial-compilation","displayName":"Initial archive compilation","kind":"initial"}') ON CONFLICT DO NOTHING;
CREATE TABLE archive.contributions (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES archive.persons(id),
  credit_id text NOT NULL REFERENCES archive.credits(id),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CHECK ((data->>'id') IS NOT DISTINCT FROM id),
  CHECK ((data->>'personId') IS NOT DISTINCT FROM person_id),
  CHECK ((data->>'creditId') IS NOT DISTINCT FROM credit_id)
);
CREATE INDEX contributions_person_idx ON archive.contributions(person_id);

UPDATE archive.persons SET data = data || '{"creditIds":["initial-compilation"]}'::jsonb WHERE NOT data ? 'creditIds';
UPDATE archive.places SET data = data || '{"creditIds":["initial-compilation"]}'::jsonb WHERE NOT data ? 'creditIds';
UPDATE archive.sources SET data = data || '{"creditIds":["initial-compilation"]}'::jsonb WHERE NOT data ? 'creditIds';
UPDATE archive.person_places SET data = data || '{"creditIds":["initial-compilation"]}'::jsonb WHERE NOT data ? 'creditIds';
UPDATE archive.materials SET data = data || '{"creditIds":["initial-compilation"]}'::jsonb WHERE NOT data ? 'creditIds';

CREATE TABLE community.submissions (
  id text PRIMARY KEY,
  client_request_id text NOT NULL UNIQUE,
  input jsonb NOT NULL,
  receipt_hash text NOT NULL,
  user_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','needs-information','published','rejected','withdrawn')),
  published_entry_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  mail_status text
);
CREATE INDEX submissions_user_idx ON community.submissions(user_id);
CREATE INDEX submissions_status_idx ON community.submissions(status, created_at);
CREATE TABLE community.photos (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES community.submissions(id),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_submission_idx ON community.photos(submission_id);
CREATE TABLE community.supplements (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES community.submissions(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community.reviews (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES community.submissions(id),
  reviewer_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('publish','needs-information','reject','withdraw')),
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community.publication_revisions (
  sequence bigserial UNIQUE,
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES community.submissions(id),
  review_id text NOT NULL REFERENCES community.reviews(id),
  target_table text NOT NULL CHECK (target_table IN ('persons','places','person_places','contributions','sources','credits')),
  target_id text NOT NULL,
  previous_data jsonb,
  published_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community.rate_limits (
  key_hash text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE community.mail_events (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES community.submissions(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
