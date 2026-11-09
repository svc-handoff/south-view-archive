-- Private staff reports. No AI result is projected into archive/public tables.
CREATE TABLE community.vet_runs (
  id text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES community.submissions(id),
  reviewer_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  input_revision text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  report jsonb,
  attachments jsonb NOT NULL DEFAULT '[]',
  sources jsonb NOT NULL DEFAULT '[]',
  error text,
  CHECK (status <> 'completed' OR report IS NOT NULL)
);
CREATE INDEX vet_runs_submission_idx ON community.vet_runs(submission_id, started_at DESC);
-- The synchronous review desk permits one active request across all staff/processes.
CREATE UNIQUE INDEX vet_one_running ON community.vet_runs ((true)) WHERE status = 'running';
ALTER TABLE community.vet_runs ENABLE ROW LEVEL SECURITY;
-- Access is through the server database role only, as with other community tables.
