-- Site-wide settings staff change in the archive admin: the AI review connection ('ai') and
-- whether the public site is offline ('site'). Values are private; the API key never leaves the server.
CREATE TABLE IF NOT EXISTS community.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
